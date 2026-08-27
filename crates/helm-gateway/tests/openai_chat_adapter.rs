use std::sync::Arc;

use helm_gateway::{
    GatewayFetch, HttpRequest, HttpResponse, OpenAIChatCompletionsAdapter, ProviderAdapter,
    ProviderInvocationContext,
};
use helm_protocol::{FinishReason, MessageRole, ModelContentPart, ModelRequest, ZeroMessage};
use helm_shared::{create_correlation_id, utc_now, ZeroErrorCode};
use serde_json::json;

fn id() -> String {
    create_correlation_id().to_string()
}

fn context(base_url: Option<&str>) -> ProviderInvocationContext {
    ProviderInvocationContext {
        provider_id: id(),
        base_url: base_url.map(str::to_string),
        credential: "compatible-test-secret".into(),
        headers: vec![("X-Provider-Tenant".into(), "contract".into())],
        aborted: false,
    }
}

fn request(provider_id: &str, stream: bool) -> ModelRequest {
    ModelRequest {
        model_ref: format!("{provider_id}:example-chat"),
        messages: vec![ZeroMessage {
            id: id(),
            role: MessageRole::User,
            content: vec![ModelContentPart::Text {
                text: "Hello".into(),
            }],
            created_at: utc_now(),
        }],
        tools: None,
        response_schema: Some(json!({ "type": "object" })),
        reasoning: Some(helm_protocol::ReasoningLevel::Medium),
        data_classifications: vec![helm_protocol::DataClassification::Public],
        max_output_tokens: Some(300),
        stream,
    }
}

fn fetch_ok(body: Vec<u8>) -> GatewayFetch {
    Arc::new(move |_req: HttpRequest| {
        let body = body.clone();
        Box::pin(async move { Ok(HttpResponse { status: 200, body }) })
    })
}

#[tokio::test]
async fn uses_the_configured_endpoint_and_normalizes_text_tools_usage_and_finish_state() {
    let provider = context(Some("https://compatible.example.test/v1"));
    let captured = std::sync::Arc::new(std::sync::Mutex::new(None));
    let fetch = {
        let captured = captured.clone();
        Arc::new(move |req: HttpRequest| {
            *captured.lock().unwrap() = Some(req.clone());
            Box::pin(async move {
                Ok(HttpResponse {
                    status: 200,
                    body: serde_json::to_vec(&json!({
                        "id": "chatcmpl-contract",
                        "choices": [{
                            "finish_reason": "tool_calls",
                            "message": {
                                "content": "Checking.",
                                "tool_calls": [{
                                    "id": "call-1",
                                    "type": "function",
                                    "function": { "name": "lookup", "arguments": "{\"query\":\"hello\"}" }
                                }]
                            }
                        }],
                        "usage": {
                            "prompt_tokens": 10,
                            "completion_tokens": 4,
                            "prompt_tokens_details": { "cached_tokens": 2 },
                            "completion_tokens_details": { "reasoning_tokens": 1 }
                        }
                    }))
                    .unwrap(),
                })
            }) as helm_gateway::BoxFuture<_>
        })
    };
    let response = OpenAIChatCompletionsAdapter::new(fetch)
        .invoke(&request(&provider.provider_id, false), &provider)
        .await
        .unwrap();
    let req = captured.lock().unwrap().clone().unwrap();
    assert_eq!(
        req.url,
        "https://compatible.example.test/v1/chat/completions"
    );
    assert!(req
        .headers
        .iter()
        .any(|(k, v)| k.eq_ignore_ascii_case("authorization")
            && v == "Bearer compatible-test-secret"));
    assert_eq!(response.text, "Checking.");
    assert_eq!(response.finish_reason, FinishReason::ToolCalls);
    assert_eq!(
        response.usage.as_ref().unwrap().cached_input_tokens,
        Some(2)
    );
}

#[tokio::test]
async fn accumulates_streamed_tool_arguments_and_fails_closed_without_a_finish_chunk() {
    let provider = context(Some("https://compatible.example.test/v1"));
    let frames = [
        json!({"id":"chatcmpl-stream","choices":[{"delta":{"content":"Looking","tool_calls":[{"index":0,"id":"call-1","function":{"name":"lookup","arguments":"{\"q"}}]},"finish_reason":null}]}),
        json!({"id":"chatcmpl-stream","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"uery\":\"x\"}"}}]}}]}),
        json!({"id":"chatcmpl-stream","choices":[{"delta":{},"finish_reason":"tool_calls"}]}),
        json!({"id":"chatcmpl-stream","choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}),
    ];
    let body = frames
        .iter()
        .map(|frame| format!("data: {frame}\n\n"))
        .collect::<String>();
    let events = OpenAIChatCompletionsAdapter::new(fetch_ok(body.into_bytes()))
        .stream(&request(&provider.provider_id, true), &provider)
        .await
        .unwrap();
    assert_eq!(events.len(), 4);
    let truncated = OpenAIChatCompletionsAdapter::new(fetch_ok(
        b"data: {\"id\":\"partial\",\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n\n".to_vec(),
    ));
    let err = truncated
        .stream(&request(&provider.provider_id, true), &provider)
        .await
        .unwrap_err();
    assert_eq!(
        err.downcast_ref::<helm_shared::ZeroError>().unwrap().code,
        ZeroErrorCode::ModelUnavailable
    );
}

#[tokio::test]
async fn requires_an_explicit_base_url_and_discovers_conservatively() {
    let provider = context(Some("https://compatible.example.test/v1"));
    let fetch = fetch_ok(
        serde_json::to_vec(&json!({ "data": [{ "id": "example-chat", "owned_by": "vendor" }] }))
            .unwrap(),
    );
    let models = OpenAIChatCompletionsAdapter::new(fetch)
        .discover_models(&provider)
        .await
        .unwrap();
    assert_eq!(models[0].model_id, "example-chat");
    assert_eq!(models[0].tags, vec!["owner:vendor"]);
    assert!(!models[0].capabilities.tool_calling);
    let missing = context(None);
    let err = OpenAIChatCompletionsAdapter::new(fetch_ok(b"{}".to_vec()))
        .discover_models(&missing)
        .await
        .unwrap_err();
    assert_eq!(
        err.downcast_ref::<helm_shared::ZeroError>().unwrap().code,
        ZeroErrorCode::ValidationFailed
    );
}
