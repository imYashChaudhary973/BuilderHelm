use std::sync::Arc;

use helm_protocol::{
    ChatStreamEvent, FinishReason, ModelRecord, ModelRequest, ModelResponse, NormalizedToolCall,
};
use helm_shared::{ZeroError, ZeroErrorCode, ZeroErrorOptions};
use serde_json::{json, Value};

use crate::adapter::{
    BoxFuture, GatewayFetch, ProviderAdapter, ProviderConnectionResult, ProviderInvocationContext,
};
use crate::error_mapping::ProviderHttpError;
use crate::http::{header, provider_endpoint, read_json_lines, HttpRequest};

pub struct OllamaAdapter {
    fetch: GatewayFetch,
}

impl OllamaAdapter {
    pub fn new(fetch: GatewayFetch) -> Self {
        Self { fetch }
    }

    fn headers(context: &ProviderInvocationContext) -> Vec<(String, String)> {
        let mut headers = context.headers.clone();
        if !context.credential.is_empty() {
            headers.push((
                "Authorization".into(),
                format!("Bearer {}", context.credential),
            ));
        }
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
            "messages": request.messages.iter().map(|message| {
                json!({
                    "role": match message.role {
                        helm_protocol::MessageRole::System => "system",
                        helm_protocol::MessageRole::User => "user",
                        helm_protocol::MessageRole::Assistant => "assistant",
                        helm_protocol::MessageRole::Tool => "tool",
                    },
                    "content": message.content.iter().filter_map(|part| match part {
                        helm_protocol::ModelContentPart::Text { text } => Some(text.as_str()),
                        _ => None,
                    }).collect::<String>(),
                })
            }).collect::<Vec<_>>(),
            "stream": stream,
        });
        if let Some(schema) = &request.response_schema {
            body["format"] = schema.clone();
        }
        if let Some(reason) = request.reasoning {
            if !matches!(reason, helm_protocol::ReasoningLevel::None) {
                body["think"] = json!(match reason {
                    helm_protocol::ReasoningLevel::Low => "low",
                    helm_protocol::ReasoningLevel::Medium => "medium",
                    helm_protocol::ReasoningLevel::High => "high",
                    helm_protocol::ReasoningLevel::None => "none",
                });
            }
        }
        if let Some(max) = request.max_output_tokens {
            body["options"] = json!({ "num_predict": max });
        }
        if let Some(tools) = &request.tools {
            body["tools"] = json!(tools
                .iter()
                .map(|tool| json!({
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.input_schema,
                    }
                }))
                .collect::<Vec<_>>());
        }
        body
    }

    fn tool_calls(value: &Value) -> Vec<NormalizedToolCall> {
        value
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
            .filter_map(|(index, call)| {
                let function = call.get("function")?;
                Some(NormalizedToolCall {
                    id: format!("ollama-tool-{index}"),
                    name: function.get("name")?.as_str()?.to_string(),
                    arguments: function.get("arguments").cloned().unwrap_or(json!({})),
                })
            })
            .collect()
    }

    fn finish(done_reason: Option<&str>, calls: &[NormalizedToolCall]) -> FinishReason {
        if !calls.is_empty() {
            return FinishReason::ToolCalls;
        }
        match done_reason {
            Some("stop") => FinishReason::Stop,
            Some("length") => FinishReason::Length,
            Some("cancelled") => FinishReason::Cancelled,
            None => FinishReason::Unknown,
            _ => FinishReason::Stop,
        }
    }
}

impl ProviderAdapter for OllamaAdapter {
    fn protocol(&self) -> &'static str {
        "ollama"
    }

    fn invoke(
        &self,
        request: &ModelRequest,
        context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<ModelResponse, Box<dyn std::error::Error + Send + Sync>>> {
        let fetch = Arc::clone(&self.fetch);
        let url = provider_endpoint(
            context
                .base_url
                .as_deref()
                .or(Some("http://127.0.0.1:11434")),
            "api/chat",
        );
        let headers = Self::headers(context);
        let body = Self::body(request, false).to_string();
        Box::pin(async move {
            let response = fetch(HttpRequest {
                url,
                method: "POST".into(),
                headers,
                body: Some(body),
            })
            .await?;
            let raw = response.json()?;
            if raw.get("done") != Some(&json!(true)) {
                return Err(Box::new(ZeroError::new(
                    ZeroErrorCode::ModelUnavailable,
                    "Ollama returned an incomplete response",
                    ZeroErrorOptions::default(),
                ))
                    as Box<dyn std::error::Error + Send + Sync>);
            }
            let calls = Self::tool_calls(raw["message"].get("tool_calls").unwrap_or(&json!([])));
            let mut response = ModelResponse {
                text: raw["message"]["content"].as_str().unwrap_or("").to_string(),
                reasoning_summary: None,
                tool_calls: calls.clone(),
                usage: None,
                finish_reason: Self::finish(raw.get("done_reason").and_then(Value::as_str), &calls),
                provider_continuation: None,
            };
            if let (Some(input), Some(output)) =
                (raw.get("prompt_eval_count"), raw.get("eval_count"))
            {
                response.usage = Some(helm_protocol::TokenUsage {
                    input_tokens: input.as_i64().unwrap_or(0),
                    output_tokens: output.as_i64().unwrap_or(0),
                    cached_input_tokens: None,
                    reasoning_tokens: None,
                });
            }
            Ok(response)
        })
    }

    fn stream(
        &self,
        request: &ModelRequest,
        context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<Vec<ChatStreamEvent>, Box<dyn std::error::Error + Send + Sync>>> {
        let fetch = Arc::clone(&self.fetch);
        let url = provider_endpoint(
            context
                .base_url
                .as_deref()
                .or(Some("http://127.0.0.1:11434")),
            "api/chat",
        );
        let headers = Self::headers(context);
        let body = Self::body(request, true).to_string();
        Box::pin(async move {
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
            let lines = read_json_lines(&response.body)?;
            let mut events = Vec::new();
            let mut pending = Vec::new();
            let mut final_chunk = None;
            for raw in lines {
                if let Some(text) = raw.pointer("/message/content").and_then(Value::as_str) {
                    if !text.is_empty() {
                        events.push(ChatStreamEvent::TextDelta {
                            text: text.to_string(),
                        });
                    }
                }
                if let Some(calls) = raw.pointer("/message/tool_calls") {
                    pending.extend(Self::tool_calls(calls));
                }
                if raw.get("done") == Some(&json!(true)) {
                    final_chunk = Some(raw);
                }
            }
            let Some(final_chunk) = final_chunk else {
                return Err(Box::new(ZeroError::new(
                    ZeroErrorCode::ModelUnavailable,
                    "Ollama response stream ended early",
                    ZeroErrorOptions::default(),
                ))
                    as Box<dyn std::error::Error + Send + Sync>);
            };
            for call in &pending {
                events.push(ChatStreamEvent::ToolProposed { call: call.clone() });
            }
            if let (Some(input), Some(output)) = (
                final_chunk.get("prompt_eval_count").and_then(Value::as_i64),
                final_chunk.get("eval_count").and_then(Value::as_i64),
            ) {
                events.push(ChatStreamEvent::Usage {
                    usage: helm_protocol::TokenUsage {
                        input_tokens: input,
                        output_tokens: output,
                        cached_input_tokens: None,
                        reasoning_tokens: None,
                    },
                });
            }
            events.push(ChatStreamEvent::Done {
                finish_reason: Self::finish(
                    final_chunk.get("done_reason").and_then(Value::as_str),
                    &pending,
                ),
                provider_continuation: None,
            });
            let _ = header(&[], "authorization");
            Ok(events)
        })
    }

    fn discover_models(
        &self,
        context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<Vec<ModelRecord>, Box<dyn std::error::Error + Send + Sync>>> {
        let fetch = Arc::clone(&self.fetch);
        let url = provider_endpoint(
            context
                .base_url
                .as_deref()
                .or(Some("http://127.0.0.1:11434")),
            "api/tags",
        );
        let headers = Self::headers(context);
        let provider_id = context.provider_id.clone();
        Box::pin(async move {
            let response = fetch(HttpRequest {
                url,
                method: "GET".into(),
                headers,
                body: None,
            })
            .await?;
            let raw = response.json()?;
            let models = raw["models"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|model| {
                    let name = model["name"].as_str().unwrap_or("").to_string();
                    let mut tags = Vec::new();
                    if let Some(family) = model.pointer("/details/family").and_then(Value::as_str) {
                        tags.push(format!("family:{family}"));
                    }
                    if let Some(parameters) = model
                        .pointer("/details/parameter_size")
                        .and_then(Value::as_str)
                    {
                        tags.push(format!("parameters:{parameters}"));
                    }
                    if let Some(quant) = model
                        .pointer("/details/quantization_level")
                        .and_then(Value::as_str)
                    {
                        tags.push(format!("quantization:{quant}"));
                    }
                    ModelRecord {
                        model_ref: format!("{provider_id}:{name}"),
                        provider_id: provider_id.clone(),
                        model_id: name.clone(),
                        label: name,
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
                        privacy_class: helm_protocol::PrivacyClass::Local,
                        tags,
                    }
                })
                .collect();
            Ok(models)
        })
    }

    fn test_connection(
        &self,
        context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<ProviderConnectionResult, Box<dyn std::error::Error + Send + Sync>>> {
        let fetch = Arc::clone(&self.fetch);
        let url = provider_endpoint(
            context
                .base_url
                .as_deref()
                .or(Some("http://127.0.0.1:11434")),
            "api/tags",
        );
        let headers = Self::headers(context);
        Box::pin(async move {
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
