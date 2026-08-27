use std::collections::BTreeMap;
use std::sync::Arc;

use helm_protocol::{
    ChatStreamEvent, FinishReason, ModelRecord, ModelRequest, ModelResponse, NormalizedToolCall,
    TokenUsage,
};
use helm_shared::{ZeroError, ZeroErrorCode, ZeroErrorOptions};
use serde_json::{json, Value};

use crate::adapter::{
    BoxFuture, GatewayFetch, ProviderAdapter, ProviderConnectionResult, ProviderInvocationContext,
};
use crate::error_mapping::ProviderHttpError;
use crate::http::{provider_endpoint, read_server_sent_events, HttpRequest};

pub struct OpenAIChatCompletionsAdapter {
    fetch: GatewayFetch,
}

impl OpenAIChatCompletionsAdapter {
    pub fn new(fetch: GatewayFetch) -> Self {
        Self { fetch }
    }

    fn endpoint(context: &ProviderInvocationContext, path: &str) -> Result<String, ZeroError> {
        let Some(base) = context.base_url.as_deref() else {
            return Err(ZeroError::new(
                ZeroErrorCode::ValidationFailed,
                "OpenAI-compatible providers require an explicit base URL",
                ZeroErrorOptions::default(),
            ));
        };
        Ok(provider_endpoint(Some(base), path))
    }

    fn headers(context: &ProviderInvocationContext) -> Vec<(String, String)> {
        let mut headers = context.headers.clone();
        headers.push((
            "Authorization".into(),
            format!("Bearer {}", context.credential),
        ));
        headers.push(("Content-Type".into(), "application/json".into()));
        headers
    }

    fn body(request: &ModelRequest, stream: bool) -> Value {
        let model = request
            .model_ref
            .split_once(':')
            .map(|(_, rest)| rest)
            .unwrap_or(&request.model_ref);
        let mut body = json!({
            "model": model,
            "messages": [],
            "stream": stream,
        });
        if stream {
            body["stream_options"] = json!({ "include_usage": true });
        }
        if let Some(max) = request.max_output_tokens {
            body["max_tokens"] = json!(max);
        }
        if let Some(reason) = request.reasoning {
            if !matches!(reason, helm_protocol::ReasoningLevel::None) {
                body["reasoning_effort"] = json!(match reason {
                    helm_protocol::ReasoningLevel::Low => "low",
                    helm_protocol::ReasoningLevel::Medium => "medium",
                    helm_protocol::ReasoningLevel::High => "high",
                    helm_protocol::ReasoningLevel::None => "none",
                });
            }
        }
        if request.response_schema.is_some() {
            body["response_format"] = json!({ "type": "json_schema" });
        }
        body
    }

    fn usage(value: &Value) -> TokenUsage {
        TokenUsage {
            input_tokens: value["prompt_tokens"].as_i64().unwrap_or(0),
            output_tokens: value["completion_tokens"].as_i64().unwrap_or(0),
            cached_input_tokens: value
                .pointer("/prompt_tokens_details/cached_tokens")
                .and_then(Value::as_i64),
            reasoning_tokens: value
                .pointer("/completion_tokens_details/reasoning_tokens")
                .and_then(Value::as_i64),
        }
    }

    fn finish(value: Option<&str>) -> FinishReason {
        match value {
            Some("stop") => FinishReason::Stop,
            Some("length") => FinishReason::Length,
            Some("tool_calls") | Some("function_call") => FinishReason::ToolCalls,
            Some("content_filter") => FinishReason::ContentFilter,
            _ => FinishReason::Unknown,
        }
    }
}

impl ProviderAdapter for OpenAIChatCompletionsAdapter {
    fn protocol(&self) -> &'static str {
        "openai-compatible"
    }

    fn invoke(
        &self,
        request: &ModelRequest,
        context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<ModelResponse, Box<dyn std::error::Error + Send + Sync>>> {
        let fetch = Arc::clone(&self.fetch);
        let url = Self::endpoint(context, "chat/completions");
        let headers = Self::headers(context);
        let body = Self::body(request, false).to_string();
        let provider_id = context.provider_id.clone();
        Box::pin(async move {
            let url = url?;
            let response = fetch(HttpRequest {
                url,
                method: "POST".into(),
                headers,
                body: Some(body),
            })
            .await?;
            let raw = response.json()?;
            let choice = &raw["choices"][0];
            let tool_calls = choice["message"]["tool_calls"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|call| NormalizedToolCall {
                    id: call["id"].as_str().unwrap_or("").to_string(),
                    name: call["function"]["name"].as_str().unwrap_or("").to_string(),
                    arguments: serde_json::from_str(
                        call["function"]["arguments"].as_str().unwrap_or("{}"),
                    )
                    .unwrap_or(json!({})),
                })
                .collect();
            Ok(ModelResponse {
                text: choice["message"]["content"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
                reasoning_summary: None,
                tool_calls,
                usage: raw.get("usage").map(Self::usage),
                finish_reason: Self::finish(choice["finish_reason"].as_str()),
                provider_continuation: Some(helm_protocol::ProviderContinuation {
                    provider_id,
                    response_id: raw["id"].as_str().unwrap_or("").to_string(),
                }),
            })
        })
    }

    fn stream(
        &self,
        request: &ModelRequest,
        context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<Vec<ChatStreamEvent>, Box<dyn std::error::Error + Send + Sync>>> {
        let fetch = Arc::clone(&self.fetch);
        let url = Self::endpoint(context, "chat/completions");
        let headers = Self::headers(context);
        let body = Self::body(request, true).to_string();
        let provider_id = context.provider_id.clone();
        Box::pin(async move {
            let url = url?;
            let response = fetch(HttpRequest {
                url,
                method: "POST".into(),
                headers,
                body: Some(body),
            })
            .await?;
            if !response.ok() {
                return Err(Box::new(ProviderHttpError {
                    status: response.status,
                })
                    as Box<dyn std::error::Error + Send + Sync>);
            }
            let chunks = read_server_sent_events(&response.body)?;
            let mut events = Vec::new();
            let mut pending: BTreeMap<i64, (Option<String>, Option<String>, String)> =
                BTreeMap::new();
            let mut response_id = None;
            let mut completed = None;
            let mut usage = None;
            for chunk in chunks {
                response_id = chunk.get("id").and_then(Value::as_str).map(str::to_string);
                if chunk.get("usage").is_some() && !chunk["usage"].is_null() {
                    usage = Some(Self::usage(&chunk["usage"]));
                }
                for choice in chunk["choices"].as_array().cloned().unwrap_or_default() {
                    if let Some(text) = choice.pointer("/delta/content").and_then(Value::as_str) {
                        events.push(ChatStreamEvent::TextDelta {
                            text: text.to_string(),
                        });
                    }
                    for delta in choice
                        .pointer("/delta/tool_calls")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default()
                    {
                        let index = delta["index"].as_i64().unwrap_or(0);
                        let entry = pending.entry(index).or_insert((None, None, String::new()));
                        if let Some(id) = delta["id"].as_str() {
                            entry.0 = Some(id.to_string());
                        }
                        if let Some(name) = delta.pointer("/function/name").and_then(Value::as_str)
                        {
                            entry.1 = Some(name.to_string());
                        }
                        if let Some(args) =
                            delta.pointer("/function/arguments").and_then(Value::as_str)
                        {
                            entry.2.push_str(args);
                        }
                    }
                    if let Some(reason) = choice["finish_reason"].as_str() {
                        completed = Some(Self::finish(Some(reason)));
                    }
                }
            }
            let (Some(response_id), Some(completed)) = (response_id, completed) else {
                return Err(Box::new(ZeroError::new(
                    ZeroErrorCode::ModelUnavailable,
                    "Provider response stream ended early",
                    ZeroErrorOptions::default(),
                ))
                    as Box<dyn std::error::Error + Send + Sync>);
            };
            for (_, (id, name, arguments)) in pending {
                events.push(ChatStreamEvent::ToolProposed {
                    call: NormalizedToolCall {
                        id: id.unwrap_or_default(),
                        name: name.unwrap_or_default(),
                        arguments: serde_json::from_str(&arguments).unwrap_or(json!({})),
                    },
                });
            }
            if let Some(usage) = usage {
                events.push(ChatStreamEvent::Usage { usage });
            }
            events.push(ChatStreamEvent::Done {
                finish_reason: completed,
                provider_continuation: Some(helm_protocol::ProviderContinuation {
                    provider_id,
                    response_id,
                }),
            });
            Ok(events)
        })
    }

    fn discover_models(
        &self,
        context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<Vec<ModelRecord>, Box<dyn std::error::Error + Send + Sync>>> {
        let fetch = Arc::clone(&self.fetch);
        let url = Self::endpoint(context, "models");
        let headers = Self::headers(context);
        let provider_id = context.provider_id.clone();
        Box::pin(async move {
            let url = url?;
            let response = fetch(HttpRequest {
                url,
                method: "GET".into(),
                headers,
                body: None,
            })
            .await?;
            let raw = response.json()?;
            Ok(raw["data"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|model| {
                    let id = model["id"].as_str().unwrap_or("").to_string();
                    let tags = model
                        .get("owned_by")
                        .and_then(Value::as_str)
                        .map(|owner| vec![format!("owner:{owner}")])
                        .unwrap_or_default();
                    ModelRecord {
                        model_ref: format!("{provider_id}:{id}"),
                        provider_id: provider_id.clone(),
                        model_id: id.clone(),
                        label: id,
                        capabilities: helm_protocol::ModelCapabilities {
                            text: true,
                            vision: false,
                            audio_input: false,
                            tool_calling: false,
                            parallel_tools: false,
                            structured_output: false,
                            streaming: true,
                            reasoning_controls: false,
                            server_web_search: false,
                            server_mcp: false,
                            context_window: None,
                            max_output_tokens: None,
                        },
                        privacy_class: helm_protocol::PrivacyClass::Remote,
                        tags,
                    }
                })
                .collect())
        })
    }

    fn test_connection(
        &self,
        context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<ProviderConnectionResult, Box<dyn std::error::Error + Send + Sync>>> {
        let fetch = Arc::clone(&self.fetch);
        let url = Self::endpoint(context, "models");
        let headers = Self::headers(context);
        Box::pin(async move {
            let url = url?;
            let response = fetch(HttpRequest {
                url,
                method: "GET".into(),
                headers,
                body: None,
            })
            .await?;
            response.json()?;
            Ok(ProviderConnectionResult {
                ok: true,
                latency_ms: 0,
            })
        })
    }
}
