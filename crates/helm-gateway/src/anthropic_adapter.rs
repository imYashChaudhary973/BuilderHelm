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
use crate::error_mapping::{NamedError, ProviderHttpError};
use crate::http::{provider_endpoint, read_server_sent_events, HttpRequest};

pub struct AnthropicMessagesAdapter {
    fetch: GatewayFetch,
}

impl AnthropicMessagesAdapter {
    pub fn new(fetch: GatewayFetch) -> Self {
        Self { fetch }
    }

    fn headers(context: &ProviderInvocationContext) -> Vec<(String, String)> {
        let mut headers = context.headers.clone();
        headers.push(("x-api-key".into(), context.credential.clone()));
        headers.push(("anthropic-version".into(), "2023-06-01".into()));
        headers.push(("Content-Type".into(), "application/json".into()));
        headers
    }

    fn body(request: &ModelRequest, stream: bool) -> Result<Value, ZeroError> {
        if let Some(tools) = &request.tools {
            for tool in tools {
                if tool.input_schema.get("type") != Some(&json!("object")) {
                    return Err(ZeroError::new(
                        ZeroErrorCode::ValidationFailed,
                        "Anthropic tool input schemas must be JSON objects with type object",
                        ZeroErrorOptions::default(),
                    ));
                }
            }
        }
        let system: Vec<Value> = request
            .messages
            .iter()
            .filter(|message| matches!(message.role, helm_protocol::MessageRole::System))
            .flat_map(|message| {
                message.content.iter().filter_map(|part| match part {
                    helm_protocol::ModelContentPart::Text { text } => {
                        Some(json!({ "type": "text", "text": text }))
                    }
                    _ => None,
                })
            })
            .collect();
        let messages: Vec<Value> = request
            .messages
            .iter()
            .filter(|message| !matches!(message.role, helm_protocol::MessageRole::System))
            .map(|message| {
                let role = if matches!(message.role, helm_protocol::MessageRole::Assistant) {
                    "assistant"
                } else {
                    "user"
                };
                let content: Vec<Value> = message
                    .content
                    .iter()
                    .map(|part| match part {
                        helm_protocol::ModelContentPart::Text { text } => {
                            json!({ "type": "text", "text": text })
                        }
                        helm_protocol::ModelContentPart::ToolCall { call } => json!({
                            "type": "tool_use",
                            "id": call.id,
                            "name": call.name,
                            "input": call.arguments,
                        }),
                        helm_protocol::ModelContentPart::ToolResult {
                            call_id,
                            output,
                            is_error,
                        } => json!({
                            "type": "tool_result",
                            "tool_use_id": call_id,
                            "content": output.to_string(),
                            "is_error": is_error,
                        }),
                        _ => json!({ "type": "text", "text": "" }),
                    })
                    .collect();
                json!({ "role": role, "content": content })
            })
            .collect();
        let mut body = json!({
            "model": request.model_ref.split_once(':').map(|(_, rest)| rest).unwrap_or(&request.model_ref),
            "max_tokens": request.max_output_tokens.unwrap_or(4096),
            "messages": messages,
            "stream": stream,
        });
        if !system.is_empty() {
            body["system"] = json!(system);
        }
        let mut output_config = serde_json::Map::new();
        if let Some(reason) = request.reasoning {
            if !matches!(reason, helm_protocol::ReasoningLevel::None) {
                output_config.insert(
                    "effort".into(),
                    json!(match reason {
                        helm_protocol::ReasoningLevel::Low => "low",
                        helm_protocol::ReasoningLevel::Medium => "medium",
                        helm_protocol::ReasoningLevel::High => "high",
                        helm_protocol::ReasoningLevel::None => "none",
                    }),
                );
            }
        }
        if let Some(schema) = &request.response_schema {
            output_config.insert(
                "format".into(),
                json!({ "type": "json_schema", "schema": schema }),
            );
        }
        if !output_config.is_empty() {
            body["output_config"] = Value::Object(output_config);
        }
        if let Some(tools) = &request.tools {
            body["tools"] = json!(tools
                .iter()
                .map(|tool| json!({
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.input_schema,
                }))
                .collect::<Vec<_>>());
        }
        Ok(body)
    }
}

impl ProviderAdapter for AnthropicMessagesAdapter {
    fn protocol(&self) -> &'static str {
        "anthropic"
    }

    fn invoke(
        &self,
        request: &ModelRequest,
        context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<ModelResponse, Box<dyn std::error::Error + Send + Sync>>> {
        if context.aborted {
            return Box::pin(async {
                Err(Box::new(NamedError {
                    name: "AbortError".into(),
                    status: None,
                })
                    as Box<dyn std::error::Error + Send + Sync>)
            });
        }
        let fetch = Arc::clone(&self.fetch);
        let url = provider_endpoint(
            context
                .base_url
                .as_deref()
                .or(Some("https://api.anthropic.com/v1")),
            "messages",
        );
        let headers = Self::headers(context);
        let body = Self::body(request, false);
        let provider_id = context.provider_id.clone();
        Box::pin(async move {
            let body = body?;
            let response = fetch(HttpRequest {
                url,
                method: "POST".into(),
                headers,
                body: Some(body.to_string()),
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
            let mut tool_calls = Vec::new();
            for block in raw["content"].as_array().cloned().unwrap_or_default() {
                match block["type"].as_str() {
                    Some("text") => text.push_str(block["text"].as_str().unwrap_or("")),
                    Some("tool_use") => tool_calls.push(NormalizedToolCall {
                        id: block["id"].as_str().unwrap_or("").to_string(),
                        name: block["name"].as_str().unwrap_or("").to_string(),
                        arguments: block.get("input").cloned().unwrap_or(json!({})),
                    }),
                    _ => {}
                }
            }
            Ok(ModelResponse {
                text,
                reasoning_summary: None,
                tool_calls,
                usage: Some(TokenUsage {
                    input_tokens: raw["usage"]["input_tokens"].as_i64().unwrap_or(0),
                    output_tokens: raw["usage"]["output_tokens"].as_i64().unwrap_or(0),
                    cached_input_tokens: raw["usage"]["cache_read_input_tokens"].as_i64(),
                    reasoning_tokens: raw
                        .pointer("/usage/output_tokens_details/thinking_tokens")
                        .and_then(Value::as_i64),
                }),
                finish_reason: if raw["stop_reason"] == "tool_use" {
                    FinishReason::ToolCalls
                } else {
                    FinishReason::Stop
                },
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
        let url = provider_endpoint(
            context
                .base_url
                .as_deref()
                .or(Some("https://api.anthropic.com/v1")),
            "messages",
        );
        let headers = Self::headers(context);
        let body = Self::body(request, true);
        let provider_id = context.provider_id.clone();
        Box::pin(async move {
            let body = body?;
            let response = fetch(HttpRequest {
                url,
                method: "POST".into(),
                headers,
                body: Some(body.to_string()),
            })
            .await?;
            let frames = read_server_sent_events(&response.body)?;
            let mut events = Vec::new();
            let mut response_id = String::new();
            let mut input_tokens = 0;
            let mut cached = None;
            let mut output_tokens = 0;
            let mut stop = None;
            let mut tool_id = String::new();
            let mut tool_name = String::new();
            let mut tool_json = String::new();
            for frame in frames {
                match frame["type"].as_str() {
                    Some("error") => {
                        let options = ZeroErrorOptions {
                            retryable: true,
                            ..Default::default()
                        };
                        return Err(Box::new(ZeroError::new(
                            ZeroErrorCode::ModelUnavailable,
                            "Anthropic response stream failed",
                            options,
                        ))
                            as Box<dyn std::error::Error + Send + Sync>);
                    }
                    Some("message_start") => {
                        response_id = frame["message"]["id"].as_str().unwrap_or("").to_string();
                        input_tokens = frame["message"]["usage"]["input_tokens"]
                            .as_i64()
                            .unwrap_or(0);
                        cached = frame["message"]["usage"]["cache_read_input_tokens"].as_i64();
                    }
                    Some("content_block_delta") => {
                        if frame["delta"]["type"] == "text_delta" {
                            events.push(ChatStreamEvent::TextDelta {
                                text: frame["delta"]["text"].as_str().unwrap_or("").to_string(),
                            });
                        }
                        if frame["delta"]["type"] == "input_json_delta" {
                            tool_json
                                .push_str(frame["delta"]["partial_json"].as_str().unwrap_or(""));
                        }
                    }
                    Some("content_block_start") => {
                        if frame["content_block"]["type"] == "tool_use" {
                            tool_id = frame["content_block"]["id"]
                                .as_str()
                                .unwrap_or("")
                                .to_string();
                            tool_name = frame["content_block"]["name"]
                                .as_str()
                                .unwrap_or("")
                                .to_string();
                        }
                    }
                    Some("message_delta") => {
                        stop = frame["delta"]["stop_reason"].as_str().map(str::to_string);
                        output_tokens = frame["usage"]["output_tokens"]
                            .as_i64()
                            .unwrap_or(output_tokens);
                    }
                    Some("message_stop") => {}
                    _ => {}
                }
            }
            if response_id.is_empty() || stop.is_none() {
                return Err(Box::new(ZeroError::new(
                    ZeroErrorCode::ModelUnavailable,
                    "Anthropic response stream ended early",
                    ZeroErrorOptions::default(),
                ))
                    as Box<dyn std::error::Error + Send + Sync>);
            }
            if !tool_id.is_empty() {
                events.push(ChatStreamEvent::ToolProposed {
                    call: NormalizedToolCall {
                        id: tool_id,
                        name: tool_name,
                        arguments: serde_json::from_str(&tool_json).unwrap_or(json!({})),
                    },
                });
            }
            events.push(ChatStreamEvent::Usage {
                usage: TokenUsage {
                    input_tokens,
                    output_tokens,
                    cached_input_tokens: cached,
                    reasoning_tokens: None,
                },
            });
            events.push(ChatStreamEvent::Done {
                finish_reason: if stop.as_deref() == Some("tool_use") {
                    FinishReason::ToolCalls
                } else {
                    FinishReason::Stop
                },
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
        let base = context
            .base_url
            .clone()
            .unwrap_or_else(|| "https://api.anthropic.com/v1".into());
        let headers = Self::headers(context);
        let provider_id = context.provider_id.clone();
        Box::pin(async move {
            let mut models = Vec::new();
            let mut after: Option<String> = None;
            loop {
                let mut url = format!("{}/models?limit=1000", base.trim_end_matches('/'));
                if let Some(after) = &after {
                    url.push_str("&after_id=");
                    url.push_str(after);
                }
                let response = fetch(HttpRequest {
                    url,
                    method: "GET".into(),
                    headers: headers.clone(),
                    body: None,
                })
                .await?;
                let raw = response.json()?;
                for model in raw["data"].as_array().cloned().unwrap_or_default() {
                    let id = model["id"].as_str().unwrap_or("").to_string();
                    let label = model["display_name"].as_str().unwrap_or(&id).to_string();
                    let mut tags = Vec::new();
                    if let Some(created) = model["created_at"].as_str() {
                        tags.push(format!("created:{created}"));
                    }
                    let caps = model.get("capabilities");
                    models.push(ModelRecord {
                        model_ref: format!("{provider_id}:{id}"),
                        provider_id: provider_id.clone(),
                        model_id: id,
                        label,
                        capabilities: helm_protocol::ModelCapabilities {
                            text: true,
                            vision: caps
                                .and_then(|c| c.pointer("/image_input/supported"))
                                .and_then(Value::as_bool)
                                .unwrap_or(false),
                            audio_input: false,
                            tool_calling: false,
                            parallel_tools: false,
                            structured_output: caps
                                .and_then(|c| c.pointer("/structured_outputs/supported"))
                                .and_then(Value::as_bool)
                                .unwrap_or(false),
                            streaming: true,
                            reasoning_controls: caps
                                .and_then(|c| c.pointer("/effort/supported"))
                                .and_then(Value::as_bool)
                                .unwrap_or(false),
                            server_web_search: false,
                            server_mcp: false,
                            context_window: model["max_input_tokens"].as_i64(),
                            max_output_tokens: model["max_tokens"].as_i64(),
                        },
                        privacy_class: helm_protocol::PrivacyClass::Remote,
                        tags,
                    });
                }
                if raw["has_more"] == true {
                    after = raw["last_id"].as_str().map(str::to_string);
                    if after.is_none() {
                        break;
                    }
                } else {
                    break;
                }
            }
            Ok(models)
        })
    }

    fn test_connection(
        &self,
        context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<ProviderConnectionResult, Box<dyn std::error::Error + Send + Sync>>> {
        let _ = context;
        Box::pin(async {
            Ok(ProviderConnectionResult {
                ok: true,
                latency_ms: 0,
            })
        })
    }
}
