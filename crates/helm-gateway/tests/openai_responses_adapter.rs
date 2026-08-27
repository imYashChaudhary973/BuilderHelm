use std::sync::Arc;

use helm_gateway::{
    GatewayFetch, HttpRequest, HttpResponse, OpenAIResponsesAdapter, ProviderAdapter,
    ProviderHttpError, ProviderInvocationContext,
};
use helm_protocol::{FinishReason, MessageRole, ModelContentPart, ModelRequest, ZeroMessage};
use helm_shared::{create_correlation_id, utc_now};
use serde_json::json;

fn id() -> String {
    create_correlation_id().to_string()
}

fn context() -> ProviderInvocationContext {
    ProviderInvocationContext {
        provider_id: id(),
        base_url: Some("https://api.example.test/v1".into()),
        credential: "fake-openai-contract-credential".into(),
        headers: vec![("X-Zero-Test".into(), "contract".into())],
        aborted: false,
    }
}

fn request(provider_id: &str, stream: bool) -> ModelRequest {
    ModelRequest {
        model_ref: format!("{provider_id}:gpt-example"),
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
                    text: "Hello".into(),
                }],
                created_at: utc_now(),
            },
            ZeroMessage {
                id: id(),
                role: MessageRole::Assistant,
                content: vec![ModelContentPart::Text {
                    text: "Prior answer.".into(),
                }],
                created_at: utc_now(),
            },
        ],
        tools: None,
        response_schema: None,
        reasoning: Some(helm_protocol::ReasoningLevel::Medium),
        data_classifications: vec![helm_protocol::DataClassification::Public],
        max_output_tokens: Some(400),
        stream,
    }
}

#[tokio::test]
async fn converts_a_normalized_request_and_response_without_storing_provider_conversation_state() {
    let provider = context();
    let captured = Arc::new(std::sync::Mutex::new(None));
    let fetch: GatewayFetch = {
        let captured = captured.clone();
        Arc::new(move |req: HttpRequest| {
            *captured.lock().unwrap() = Some(req.clone());
            Box::pin(async move {
                Ok(HttpResponse {
                    status: 200,
                    body: serde_json::to_vec(&json!({
                        "id": "resp_contract",
                        "status": "completed",
                        "output": [
                            {"id":"message_1","type":"message","role":"assistant","content":[{"type":"output_text","text":"Hello back.","annotations":[]}]},
                            {"id":"function_1","call_id":"call_1","type":"function_call","name":"lookup","arguments":"{\"query\":\"hello\"}"},
                            {"id":"reasoning_1","type":"reasoning","summary":[{"type":"summary_text","text":"Answered directly."}]}
                        ],
                        "usage": {
                            "input_tokens": 12,
                            "output_tokens": 8,
                            "input_tokens_details": { "cached_tokens": 4 },
                            "output_tokens_details": { "reasoning_tokens": 2 }
                        }
                    }))
                    .unwrap(),
                })
            })
        })
    };
    let response = OpenAIResponsesAdapter::new(fetch)
        .invoke(&request(&provider.provider_id, false), &provider)
        .await
        .unwrap();
    let req = captured.lock().unwrap().clone().unwrap();
    assert_eq!(req.url, "https://api.example.test/v1/responses");
    let body: serde_json::Value = serde_json::from_str(req.body.as_deref().unwrap()).unwrap();
    assert_eq!(body["store"], false);
    assert_eq!(body["max_output_tokens"], 400);
    assert_eq!(response.text, "Hello back.");
    assert_eq!(
        response.reasoning_summary.as_deref(),
        Some("Answered directly.")
    );
    assert_eq!(response.finish_reason, FinishReason::ToolCalls);
}

#[tokio::test]
async fn normalizes_responses_api_server_sent_events() {
    let provider = context();
    let frames = [
        json!({"type":"response.output_text.delta","delta":"Hel"}),
        json!({"type":"response.output_text.delta","delta":"lo"}),
        json!({"type":"response.function_call_arguments.done","item_id":"call_1","name":"lookup","arguments":"{\"query\":\"hello\"}"}),
        json!({"type":"response.completed","response":{"id":"resp_stream","status":"completed","output":[],"usage":{"input_tokens":4,"output_tokens":3}}}),
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
    let events = OpenAIResponsesAdapter::new(fetch)
        .stream(&request(&provider.provider_id, true), &provider)
        .await
        .unwrap();
    assert_eq!(events.len(), 5);
}

#[tokio::test]
async fn discovers_models_conservatively_and_surfaces_http_status_without_response_bodies() {
    let provider = context();
    let fetch: GatewayFetch = Arc::new(|_req| {
        Box::pin(async {
            Ok(HttpResponse {
                status: 200,
                body: serde_json::to_vec(&json!({
                    "object": "list",
                    "data": [{ "id": "gpt-example", "object": "model", "owned_by": "openai" }]
                }))
                .unwrap(),
            })
        })
    });
    let models = OpenAIResponsesAdapter::new(fetch)
        .discover_models(&provider)
        .await
        .unwrap();
    assert_eq!(models[0].model_id, "gpt-example");
    let rejected: GatewayFetch = Arc::new(|_req| {
        Box::pin(async {
            Ok(HttpResponse {
                status: 401,
                body: b"provider-sensitive-error-body".to_vec(),
            })
        })
    });
    let err = OpenAIResponsesAdapter::new(rejected)
        .invoke(&request(&provider.provider_id, false), &provider)
        .await
        .unwrap_err();
    assert_eq!(err.downcast_ref::<ProviderHttpError>().unwrap().status, 401);
}
