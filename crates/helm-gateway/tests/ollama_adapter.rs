use std::sync::{Arc, Mutex};

use helm_gateway::{
    GatewayFetch, HttpRequest, HttpResponse, OllamaAdapter, ProviderAdapter,
    ProviderInvocationContext,
};
use helm_protocol::{
    FinishReason, MessageRole, ModelContentPart, ModelRequest, ToolDefinition, ZeroMessage,
};
use helm_shared::{create_correlation_id, utc_now, ZeroErrorCode};
use serde_json::{json, Value};

fn id() -> String {
    create_correlation_id().to_string()
}

fn context(credential: &str) -> ProviderInvocationContext {
    ProviderInvocationContext {
        provider_id: id(),
        base_url: None,
        credential: credential.into(),
        headers: vec![],
        aborted: false,
    }
}

fn request(provider_id: &str, stream: bool) -> ModelRequest {
    ModelRequest {
        model_ref: format!("{provider_id}:qwen3:8b"),
        messages: vec![ZeroMessage {
            id: id(),
            role: MessageRole::User,
            content: vec![ModelContentPart::Text {
                text: "Hello".into(),
            }],
            created_at: utc_now(),
        }],
        tools: Some(vec![ToolDefinition {
            name: "lookup".into(),
            description: "Lookup".into(),
            input_schema: json!({ "type": "object" }),
        }]),
        response_schema: Some(
            json!({ "type": "object", "properties": { "answer": { "type": "string" } } }),
        ),
        reasoning: Some(helm_protocol::ReasoningLevel::Low),
        data_classifications: vec![helm_protocol::DataClassification::Public],
        max_output_tokens: Some(200),
        stream,
    }
}

fn fetch_with(
    handler: impl Fn(HttpRequest) -> HttpResponse + Send + Sync + 'static,
) -> GatewayFetch {
    let handler = Arc::new(handler);
    Arc::new(move |req| {
        let handler = Arc::clone(&handler);
        Box::pin(async move { Ok(handler(req)) })
    })
}

#[tokio::test]
async fn uses_the_local_native_chat_api_without_inventing_an_authorization_header() {
    let provider = context("");
    let captured = Arc::new(Mutex::new(None));
    let fetch = {
        let captured = Arc::clone(&captured);
        fetch_with(move |req| {
            *captured.lock().unwrap() = Some(req.clone());
            HttpResponse {
                status: 200,
                body: serde_json::to_vec(&json!({
                    "model": "qwen3:8b",
                    "message": {
                        "role": "assistant",
                        "content": "Checking.",
                        "thinking": "private provider reasoning",
                        "tool_calls": [{ "function": { "name": "lookup", "arguments": { "query": "hello" } } }],
                    },
                    "done": true,
                    "done_reason": "stop",
                    "prompt_eval_count": 9,
                    "eval_count": 3,
                }))
                .unwrap(),
            }
        })
    };
    let response = OllamaAdapter::new(fetch)
        .invoke(&request(&provider.provider_id, false), &provider)
        .await
        .unwrap();
    let req = captured.lock().unwrap().clone().unwrap();
    assert_eq!(req.url, "http://127.0.0.1:11434/api/chat");
    assert!(req
        .headers
        .iter()
        .all(|(k, _)| !k.eq_ignore_ascii_case("authorization")));
    let body: Value = serde_json::from_str(req.body.as_deref().unwrap()).unwrap();
    assert_eq!(body["model"], "qwen3:8b");
    assert_eq!(body["stream"], false);
    assert_eq!(body["think"], "low");
    assert_eq!(body["options"]["num_predict"], 200);
    assert_eq!(body["format"]["type"], "object");
    assert_eq!(response.text, "Checking.");
    assert_eq!(response.finish_reason, FinishReason::ToolCalls);
}

#[tokio::test]
async fn normalizes_native_newline_delimited_streaming_and_requires_a_done_record() {
    let provider = context("remote-ollama-token");
    let records = [
        json!({ "model": "qwen3:8b", "message": { "content": "Hel" }, "done": false }),
        json!({ "model": "qwen3:8b", "message": { "content": "lo" }, "done": false }),
        json!({
            "model": "qwen3:8b",
            "message": { "content": "", "tool_calls": [{ "function": { "name": "lookup", "arguments": { "query": "x" } } }] },
            "done": true,
            "done_reason": "stop",
            "prompt_eval_count": 4,
            "eval_count": 2,
        }),
    ];
    let body = records
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n");
    let captured = Arc::new(Mutex::new(None));
    let fetch = {
        let captured = Arc::clone(&captured);
        fetch_with(move |req| {
            *captured.lock().unwrap() = Some(req.clone());
            HttpResponse {
                status: 200,
                body: body.as_bytes().to_vec(),
            }
        })
    };
    let events = OllamaAdapter::new(fetch)
        .stream(&request(&provider.provider_id, true), &provider)
        .await
        .unwrap();
    let req = captured.lock().unwrap().clone().unwrap();
    assert!(
        req.headers
            .iter()
            .any(|(k, v)| k.eq_ignore_ascii_case("authorization")
                && v == "Bearer remote-ollama-token")
    );
    assert_eq!(events.len(), 5);
    let early = fetch_with(|_| HttpResponse {
        status: 200,
        body: b"{\"message\":{\"content\":\"partial\"},\"done\":false}\n".to_vec(),
    });
    let err = OllamaAdapter::new(early)
        .stream(&request(&provider.provider_id, true), &provider)
        .await
        .unwrap_err();
    let zero = err.downcast_ref::<helm_shared::ZeroError>().unwrap();
    assert_eq!(zero.code, ZeroErrorCode::ModelUnavailable);
}

#[tokio::test]
async fn discovers_local_models_with_useful_non_sensitive_tags() {
    let provider = context("");
    let fetch = fetch_with(|req| {
        assert_eq!(req.url, "http://127.0.0.1:11434/api/tags");
        HttpResponse {
            status: 200,
            body: serde_json::to_vec(&json!({
                "models": [{
                    "name": "qwen3:8b",
                    "details": {
                        "family": "qwen3",
                        "parameter_size": "8.2B",
                        "quantization_level": "Q4_K_M",
                    }
                }]
            }))
            .unwrap(),
        }
    });
    let models = OllamaAdapter::new(fetch)
        .discover_models(&provider)
        .await
        .unwrap();
    assert_eq!(models[0].model_id, "qwen3:8b");
    assert_eq!(models[0].privacy_class, helm_protocol::PrivacyClass::Local);
    assert_eq!(
        models[0].tags,
        vec!["family:qwen3", "parameters:8.2B", "quantization:Q4_K_M"]
    );
}
