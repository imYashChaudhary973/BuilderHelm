use std::sync::Arc;

use helm_protocol::{
    ChatStreamEvent, FinishReason, ModelRecord, ModelRequest, ModelResponse, NormalizedToolCall,
    TokenUsage,
};
use helm_shared::ZeroErrorCode;
use serde_json::{json, Value};

use crate::adapter::{
    BoxFuture, GatewayFetch, ProviderAdapter, ProviderConnectionResult, ProviderInvocationContext,
};
use crate::error_mapping::ProviderHttpError;
use crate::http::{provider_endpoint, read_server_sent_events, HttpRequest};

pub struct OpenAIResponsesAdapter {
    fetch: GatewayFetch,
}

impl OpenAIResponsesAdapter {
    pub fn new(fetch: GatewayFetch) -> Self {
        Self { fetch }
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

    fn input(request: &ModelRequest) -> Vec<Value> {
        request
            .messages
            .iter()
            .map(|message| {
                let role = match message.role {
                    helm_protocol::MessageRole::System => "system",
                    helm_protocol::MessageRole::User => "user",
                    helm_protocol::MessageRole::Assistant => "assistant",
                    helm_protocol::MessageRole::Tool => "user",
                };
                let content: Vec<Value> = message
                    .content
                    .iter()
                    .filter_map(|part| match part {
                        helm_protocol::ModelContentPart::Text { text } => Some(json!({
                            "type": if matches!(message.role, helm_protocol::MessageRole::Assistant) {
                                "output_text"
                            } else {
                                "input_text"
                            },
                            "text": text,
                        })),
                        _ => None,
                    })
                    .collect();
                json!({ "type": "message", "role": role, "content": content })
            })
            .collect()
    }

    fn body(request: &ModelRequest, stream: bool) -> Value {
        let model = request
            .model_ref
            .split_once(':')
            .map(|(_, rest)| rest)
            .unwrap_or(&request.model_ref);
        let mut body = json!({
            "model": model,
            "input": Self::input(request),
            "store": false,
            "stream": stream,
        });
        if let Some(max) = request.max_output_tokens {
            body["max_output_tokens"] = json!(max);
        }
        if let Some(reason) = request.reasoning {
            if !matches!(reason, helm_protocol::ReasoningLevel::None) {
                body["reasoning"] = json!({
                    "effort": match reason {
                        helm_protocol::ReasoningLevel::Low => "low",
                        helm_protocol::ReasoningLevel::Medium => "medium",
                        helm_protocol::ReasoningLevel::High => "high",
                        helm_protocol::ReasoningLevel::None => "none",
                    },
                    "summary": "auto",
                });
            }
        }
        body
    }

    fn usage(value: &Value) -> TokenUsage {
        TokenUsage {
            input_tokens: value["input_tokens"].as_i64().unwrap_or(0),
            output_tokens: value["output_tokens"].as_i64().unwrap_or(0),
            cached_input_tokens: value
                .pointer("/input_tokens_details/cached_tokens")
                .and_then(Value::as_i64),
            reasoning_tokens: value
                .pointer("/output_tokens_details/reasoning_tokens")
                .and_then(Value::as_i64),
        }
    }
}

impl ProviderAdapter for OpenAIResponsesAdapter {
    fn protocol(&self) -> &'static str {
        "openai"
    }

    fn invoke(
        &self,
        request: &ModelRequest,
        context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<ModelResponse, Box<dyn std::error::Error + Send + Sync>>> {
        let fetch = Arc::clone(&self.fetch);
        let url = provider_endpoint(context.base_url.as_deref(), "responses");
        let headers = Self::headers(context);
        let body = Self::body(request, false).to_string();
        let provider_id = context.provider_id.clone();
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
            let raw = response.json()?;
            let mut text = String::new();
            let mut reasoning = None;
            let mut tool_calls = Vec::new();
            for item in raw["output"].as_array().cloned().unwrap_or_default() {
                match item["type"].as_str() {
                    Some("message") => {
                        for part in item["content"].as_array().cloned().unwrap_or_default() {
                            if part["type"] == "output_text" {
                                text.push_str(part["text"].as_str().unwrap_or(""));
                            }
                        }
                    }
                    Some("function_call") => tool_calls.push(NormalizedToolCall {
                        id: item["call_id"].as_str().unwrap_or("").to_string(),
                        name: item["name"].as_str().unwrap_or("").to_string(),
                        arguments: serde_json::from_str(item["arguments"].as_str().unwrap_or("{}"))
                            .unwrap_or(json!({})),
                    }),
                    Some("reasoning") => {
                        reasoning = item["summary"][0]["text"].as_str().map(str::to_string);
                    }
                    _ => {}
                }
            }
            Ok(ModelResponse {
                text,
                reasoning_summary: reasoning,
                finish_reason: if tool_calls.is_empty() {
                    FinishReason::Stop
                } else {
                    FinishReason::ToolCalls
                },
                tool_calls,
                usage: raw.get("usage").map(Self::usage),
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
        let url = provider_endpoint(context.base_url.as_deref(), "responses");
        let headers = Self::headers(context);
        let body = Self::body(request, true).to_string();
        let provider_id = context.provider_id.clone();
        Box::pin(async move {
            let response = fetch(HttpRequest {
                url,
                method: "POST".into(),
                headers,
                body: Some(body),
            })
            .await?;
            let frames = read_server_sent_events(&response.body)?;
            let mut events = Vec::new();
            let mut response_id = String::new();
            for frame in frames {
                match frame["type"].as_str() {
                    Some("response.output_text.delta") => {
                        events.push(ChatStreamEvent::TextDelta {
                            text: frame["delta"].as_str().unwrap_or("").to_string(),
                        });
                    }
                    Some("response.function_call_arguments.done") => {
                        events.push(ChatStreamEvent::ToolProposed {
                            call: NormalizedToolCall {
                                id: frame["item_id"].as_str().unwrap_or("").to_string(),
                                name: frame["name"].as_str().unwrap_or("").to_string(),
                                arguments: serde_json::from_str(
                                    frame["arguments"].as_str().unwrap_or("{}"),
                                )
                                .unwrap_or(json!({})),
                            },
                        });
                    }
                    Some("response.completed") => {
                        response_id = frame["response"]["id"].as_str().unwrap_or("").to_string();
                        if frame.pointer("/response/usage").is_some() {
                            events.push(ChatStreamEvent::Usage {
                                usage: Self::usage(&frame["response"]["usage"]),
                            });
                        }
                    }
                    _ => {}
                }
            }
            events.push(ChatStreamEvent::Done {
                finish_reason: FinishReason::Stop,
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
        let url = provider_endpoint(context.base_url.as_deref(), "models");
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
        let _ = ZeroErrorCode::InternalError;
        let fetch = Arc::clone(&self.fetch);
        let url = provider_endpoint(context.base_url.as_deref(), "models");
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
