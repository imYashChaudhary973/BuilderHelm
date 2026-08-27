use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use helm_gateway::{
    AnthropicMessagesAdapter, GatewayFetch, HttpRequest, HttpResponse, ProviderAdapter,
    ProviderHttpError, ProviderInvocationContext,
};
use helm_protocol::{
    FinishReason, MessageRole, ModelContentPart, ModelRequest, NormalizedToolCall, ToolDefinition,
    ZeroMessage,
};
use helm_shared::{create_correlation_id, utc_now, ZeroErrorCode};
use serde_json::json;

fn id() -> String {
    create_correlation_id().to_string()
}

fn context(base_url: Option<&str>, aborted: bool) -> ProviderInvocationContext {
    ProviderInvocationContext {
        provider_id: id(),
        base_url: base_url.map(str::to_string),
        credential: "fake-anthropic-contract-credential".into(),
        headers: vec![("X-Zero-Test".into(), "contract".into())],
        aborted,
    }
}

fn request(provider_id: &str, stream: bool) -> ModelRequest {
    ModelRequest {
        model_ref: format!("{provider_id}:claude-example"),
        messages: vec![
            ZeroMessage {
                id: id(),
                role: MessageRole::System,
                content: vec![ModelContentPart::Text {
                    text: "Be concise.".into(),
                }],
                created_at: utc_now(),
            },
            ZeroMessage {
                id: id(),
                role: MessageRole::User,
                content: vec![ModelContentPart::Text {
                    text: "Look this up.".into(),
                }],
                created_at: utc_now(),
            },
            ZeroMessage {
                id: id(),
                role: MessageRole::Assistant,
                content: vec![
                    ModelContentPart::Text {
                        text: "I will check.".into(),
                    },
                    ModelContentPart::ToolCall {
                        call: NormalizedToolCall {
                            id: "toolu_prior".into(),
                            name: "lookup".into(),
                            arguments: json!({ "query": "prior" }),
                        },
                    },
                ],
                created_at: utc_now(),
            },
            ZeroMessage {
                id: id(),
                role: MessageRole::User,
                content: vec![ModelContentPart::ToolResult {
                    call_id: "toolu_prior".into(),
                    output: json!({ "answer": 42 }),
                    is_error: false,
                }],
                created_at: utc_now(),
            },
        ],
        tools: Some(vec![ToolDefinition {
            name: "lookup".into(),
            description: "Lookup a value".into(),
            input_schema: json!({ "type": "object", "properties": { "query": { "type": "string" } } }),
        }]),
        reasoning: Some(helm_protocol::ReasoningLevel::None),
        response_schema: None,
        data_classifications: vec![helm_protocol::DataClassification::Public],
        max_output_tokens: Some(400),
        stream,
    }
}

#[tokio::test]
async fn converts_normalized_messages_tools_response_and_usage() {
    let provider = context(Some("https://api.example.test/v1"), false);
    let captured = Arc::new(std::sync::Mutex::new(None));
    let fetch: GatewayFetch = {
        let captured = captured.clone();
        Arc::new(move |req: HttpRequest| {
            *captured.lock().unwrap() = Some(req.clone());
            Box::pin(async move {
                Ok(HttpResponse {
                    status: 200,
                    body: serde_json::to_vec(&json!({
                        "id": "msg_contract",
                        "type": "message",
                        "role": "assistant",
                        "content": [
                            { "type": "text", "text": "Found it." },
                            { "type": "tool_use", "id": "toolu_1", "name": "lookup", "input": { "query": "current" } }
                        ],
                        "model": "claude-example",
                        "stop_reason": "tool_use",
                        "usage": {
                            "input_tokens": 20,
                            "output_tokens": 8,
                            "cache_read_input_tokens": 5,
                            "output_tokens_details": { "thinking_tokens": 2 }
                        }
                    }))
                    .unwrap(),
                })
            })
        })
    };
    let mut req = request(&provider.provider_id, false);
    req.reasoning = Some(helm_protocol::ReasoningLevel::Medium);
    req.response_schema =
        Some(json!({ "type": "object", "properties": { "answer": { "type": "string" } } }));
    let response = AnthropicMessagesAdapter::new(fetch)
        .invoke(&req, &provider)
        .await
        .unwrap();
    let http = captured.lock().unwrap().clone().unwrap();
    assert_eq!(http.url, "https://api.example.test/v1/messages");
    assert!(http
        .headers
        .iter()
        .any(|(k, v)| k == "x-api-key" && v == "fake-anthropic-contract-credential"));
    assert!(http
        .headers
        .iter()
        .any(|(k, v)| k == "anthropic-version" && v == "2023-06-01"));
    assert!(!http
        .headers
        .iter()
        .any(|(k, _)| k.eq_ignore_ascii_case("authorization")));
    assert_eq!(response.text, "Found it.");
    assert_eq!(response.finish_reason, FinishReason::ToolCalls);
}

#[tokio::test]
async fn normalizes_streamed_text_tool_input_final_usage_and_completion() {
    let provider = context(Some("https://api.example.test/v1"), false);
    let frames = [
        json!({"type":"message_start","message":{"id":"msg_stream","usage":{"input_tokens":12,"output_tokens":1,"cache_read_input_tokens":3}}}),
        json!({"type":"content_block_start","index":0,"content_block":{"type":"text"}}),
        json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}),
        json!({"type":"content_block_stop","index":0}),
        json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"lookup","input":{}}}),
        json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"query\":"}}),
        json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"hello\"}"}}),
        json!({"type":"content_block_stop","index":1}),
        json!({"type":"ping"}),
        json!({"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":9}}),
        json!({"type":"message_stop"}),
    ];
    let body = frames
        .iter()
        .map(|f| format!("data: {f}\n\n"))
        .collect::<String>();
    let fetch: GatewayFetch = Arc::new(move |_req| {
        let body = body.clone();
        Box::pin(async move {
            Ok(HttpResponse {
                status: 200,
                body: body.into_bytes(),
            })
        })
    });
    let events = AnthropicMessagesAdapter::new(fetch)
        .stream(&request(&provider.provider_id, true), &provider)
        .await
        .unwrap();
    assert_eq!(events.len(), 4);
}

#[tokio::test]
async fn fails_closed_on_early_streams_and_exposes_only_http_status() {
    let provider = context(Some("https://api.example.test/v1"), false);
    let truncated: GatewayFetch = Arc::new(|_req| {
        Box::pin(async {
            Ok(HttpResponse {
                status: 200,
                body: format!(
                    "data: {}\n\n",
                    json!({"type":"message_start","message":{"id":"msg_truncated","usage":{"input_tokens":1,"output_tokens":0}}})
                )
                .into_bytes(),
            })
        })
    });
    let err = AnthropicMessagesAdapter::new(truncated)
        .stream(&request(&provider.provider_id, true), &provider)
        .await
        .unwrap_err();
    assert_eq!(
        err.downcast_ref::<helm_shared::ZeroError>().unwrap().code,
        ZeroErrorCode::ModelUnavailable
    );
    let rejected: GatewayFetch = Arc::new(|_req| {
        Box::pin(async {
            Ok(HttpResponse {
                status: 401,
                body: b"provider-sensitive-error-body".to_vec(),
            })
        })
    });
    let err = AnthropicMessagesAdapter::new(rejected)
        .invoke(&request(&provider.provider_id, false), &provider)
        .await
        .unwrap_err();
    assert_eq!(err.downcast_ref::<ProviderHttpError>().unwrap().status, 401);
    let calls = Arc::new(AtomicUsize::new(0));
    let fetch: GatewayFetch = {
        let calls = calls.clone();
        Arc::new(move |_req| {
            calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                Ok(HttpResponse {
                    status: 200,
                    body: b"{}".to_vec(),
                })
            })
        })
    };
    let mut bad = request(&provider.provider_id, false);
    bad.tools = Some(vec![ToolDefinition {
        name: "invalid_schema".into(),
        description: "Invalid fixture".into(),
        input_schema: json!({ "type": "array" }),
    }]);
    let err = AnthropicMessagesAdapter::new(fetch)
        .invoke(&bad, &provider)
        .await
        .unwrap_err();
    assert_eq!(
        err.downcast_ref::<helm_shared::ZeroError>().unwrap().code,
        ZeroErrorCode::ValidationFailed
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn uses_the_native_models_endpoint_and_propagates_cancellation() {
    let provider = context(None, false);
    let fetch: GatewayFetch = Arc::new(|req: HttpRequest| {
        assert_eq!(req.url, "https://api.anthropic.com/v1/models?limit=1000");
        Box::pin(async {
            Ok(HttpResponse {
                status: 200,
                body: serde_json::to_vec(&json!({
                    "data": [{
                        "id": "claude-example",
                        "display_name": "Claude Example",
                        "created_at": "2026-01-01T00:00:00Z",
                        "max_input_tokens": 200000,
                        "max_tokens": 64000,
                        "capabilities": {
                            "image_input": { "supported": true },
                            "structured_outputs": { "supported": true },
                            "effort": { "supported": true }
                        }
                    }],
                    "has_more": false
                }))
                .unwrap(),
            })
        })
    });
    let models = AnthropicMessagesAdapter::new(fetch)
        .discover_models(&provider)
        .await
        .unwrap();
    assert_eq!(models[0].label, "Claude Example");
    assert!(models[0].capabilities.vision);
    let aborted = context(Some("https://api.example.test/v1"), true);
    let err = AnthropicMessagesAdapter::new(Arc::new(|_req| {
        Box::pin(async {
            Ok(HttpResponse {
                status: 200,
                body: b"{}".to_vec(),
            })
        })
    }))
    .invoke(&request(&aborted.provider_id, false), &aborted)
    .await
    .unwrap_err();
    assert_eq!(
        err.downcast_ref::<helm_gateway::NamedError>().unwrap().name,
        "AbortError"
    );
}

#[tokio::test]
async fn follows_bounded_model_pagination_and_normalizes_stream_errors() {
    let provider = context(Some("https://api.example.test/v1"), false);
    let calls = Arc::new(AtomicUsize::new(0));
    let fetch: GatewayFetch = {
        let calls = calls.clone();
        Arc::new(move |req: HttpRequest| {
            let n = calls.fetch_add(1, Ordering::SeqCst);
            let body = if n == 0 {
                json!({"data":[{"id":"claude-new","display_name":"Claude New"}],"has_more":true,"last_id":"claude-new"})
            } else {
                assert!(req.url.contains("after_id=claude-new"));
                json!({"data":[{"id":"claude-old","display_name":"Claude Old"}],"has_more":false,"last_id":"claude-old"})
            };
            Box::pin(async move {
                Ok(HttpResponse {
                    status: 200,
                    body: serde_json::to_vec(&body).unwrap(),
                })
            })
        })
    };
    let models = AnthropicMessagesAdapter::new(fetch)
        .discover_models(&provider)
        .await
        .unwrap();
    assert_eq!(models.len(), 2);
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    let error_body = format!(
        "data: {}\n\n",
        json!({"type":"error","error":{"type":"overloaded_error","message":"provider detail"}})
    );
    let fetch: GatewayFetch = Arc::new(move |_req| {
        let error_body = error_body.clone();
        Box::pin(async move {
            Ok(HttpResponse {
                status: 200,
                body: error_body.into_bytes(),
            })
        })
    });
    let err = AnthropicMessagesAdapter::new(fetch)
        .stream(&request(&provider.provider_id, true), &provider)
        .await
        .unwrap_err();
    let zero = err.downcast_ref::<helm_shared::ZeroError>().unwrap();
    assert_eq!(zero.code, ZeroErrorCode::ModelUnavailable);
    assert!(zero.retryable);
    assert_eq!(zero.message(), "Anthropic response stream failed");
}
