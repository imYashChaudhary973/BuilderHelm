use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use helm_db::{migrations, open_database_unchecked, run_migrations};
use helm_gateway::{header, GatewayFetch, HttpResponse, ProviderHttpError};
use helm_observability::create_logger;
use helm_protocol::{ChatClientStreamEvent, FinishReason, MessageRole, ModelContentPart};
use helm_shared::{create_correlation_id, ZeroErrorCode};
use serde_json::json;

use helm_core::chat::ChatService;
use helm_core::{MemorySecretStore, ModelService, ProviderService};

fn provider_input(api_key: &str) -> serde_json::Value {
    json!({
        "label": "OpenAI",
        "protocol": "openai",
        "baseUrl": "https://api.example.test/v1",
        "headers": [],
        "privacy": { "allowPersonal": true, "allowSensitive": false, "allowHealth": false },
        "enabled": true,
        "apiKey": api_key,
    })
}

fn sse(frames: &[serde_json::Value]) -> Vec<u8> {
    frames
        .iter()
        .map(|frame| format!("data: {frame}\n\n"))
        .collect::<String>()
        .into_bytes()
}

async fn collect(
    mut stream: helm_core::chat::ChatClientStream<'_>,
) -> Result<Vec<ChatClientStreamEvent>, helm_shared::ZeroError> {
    let mut events = Vec::new();
    while let Some(event) = stream.next().await {
        events.push(event?);
    }
    Ok(events)
}

#[tokio::test(flavor = "current_thread")]
async fn streams_canonical_history_and_persists_the_assistant_response_before_completion() {
    let secret = "stream-secret-sentinel";
    let response_id = "provider-response-sentinel";
    let prompt = "private-prompt-sentinel";
    let logs = Rc::new(RefCell::new(Vec::<String>::new()));
    let captured = Arc::new(Mutex::new(None::<String>));
    let fetch: GatewayFetch = {
        let captured = Arc::clone(&captured);
        Arc::new(move |req| {
            let url = req.url.clone();
            assert_eq!(
                header(&req.headers, "Authorization").as_deref(),
                Some("Bearer stream-secret-sentinel")
            );
            let body = req.body.clone();
            let captured = Arc::clone(&captured);
            let response_id = response_id.to_string();
            Box::pin(async move {
                if url.ends_with("/models") {
                    return Ok(HttpResponse {
                        status: 200,
                        body: serde_json::to_vec(&json!({
                            "data": [{ "id": "gpt-stream", "owned_by": "openai" }]
                        }))
                        .unwrap(),
                    });
                }
                *captured.lock().unwrap() = body;
                Ok(HttpResponse {
                    status: 200,
                    body: sse(&[
                        json!({ "type": "response.output_text.delta", "delta": "Hello " }),
                        json!({ "type": "response.reasoning_summary_text.delta", "delta": "Concise answer." }),
                        json!({ "type": "response.output_text.delta", "delta": "back." }),
                        json!({
                            "type": "response.completed",
                            "response": {
                                "id": response_id,
                                "status": "completed",
                                "output": [],
                                "usage": {
                                    "input_tokens": 7,
                                    "output_tokens": 2,
                                    "input_tokens_details": { "cached_tokens": 1 },
                                },
                            },
                        }),
                    ]),
                })
            })
        })
    };
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let secrets = MemorySecretStore::new();
    let logger = {
        let logs = Rc::clone(&logs);
        create_logger(move |line| logs.borrow_mut().push(line))
    };
    let providers = ProviderService::new(&database, &secrets, &logger);
    let models = ModelService::new(&database, &secrets, &logger, fetch);
    let chats = ChatService::new(&database, &logger, &models);
    let provider = providers
        .create(&provider_input(secret), create_correlation_id().as_str())
        .unwrap();
    let model = models
        .discover(&provider.id, create_correlation_id().as_str())
        .await
        .unwrap()
        .into_iter()
        .next()
        .expect("Expected a discovered test model");
    let thread = chats
        .create(
            &json!({ "title": "Streaming" }),
            create_correlation_id().as_str(),
        )
        .unwrap();
    let events = collect(chats.stream(
        json!({ "threadId": thread.id, "modelRef": model.model_ref, "text": prompt }),
        create_correlation_id().as_str(),
        Arc::new(AtomicBool::new(false)),
    ))
    .await
    .unwrap();
    assert_eq!(
        events,
        vec![
            ChatClientStreamEvent::TextDelta {
                text: "Hello ".into()
            },
            ChatClientStreamEvent::TextDelta {
                text: "back.".into()
            },
            ChatClientStreamEvent::Usage {
                usage: helm_protocol::TokenUsage {
                    input_tokens: 7,
                    output_tokens: 2,
                    cached_input_tokens: Some(1),
                    reasoning_tokens: None,
                }
            },
            ChatClientStreamEvent::Done {
                finish_reason: FinishReason::Stop
            },
        ]
    );
    let events_json = serde_json::to_string(&events).unwrap();
    assert!(!events_json.contains(response_id));
    let request: serde_json::Value =
        serde_json::from_str(captured.lock().unwrap().as_deref().unwrap()).unwrap();
    assert_eq!(request["model"], "gpt-stream");
    assert_eq!(request["store"], false);
    assert_eq!(request["stream"], true);
    assert_eq!(
        request["input"],
        json!([{
            "type": "message",
            "role": "user",
            "content": [{ "type": "input_text", "text": prompt }],
        }])
    );
    let transcript = chats.get(&thread.id).unwrap();
    assert_eq!(transcript.turns.len(), 2);
    let assistant = &transcript.turns[1];
    assert_eq!(assistant.role, MessageRole::Assistant);
    assert_eq!(
        assistant.content,
        vec![ModelContentPart::Text {
            text: "Hello back.".into()
        }]
    );
    assert_eq!(
        assistant.model_ref.as_deref(),
        Some(model.model_ref.as_str())
    );
    assert_eq!(assistant.finish_reason, Some(FinishReason::Stop));
    assert_eq!(
        assistant
            .provider_continuation
            .as_ref()
            .map(|c| c.response_id.as_str()),
        Some(response_id)
    );
    assert_eq!(transcript.usage.len(), 1);
    assert_eq!(transcript.usage[0].turn_id, assistant.id);
    assert_eq!(transcript.usage[0].model_ref, model.model_ref);
    assert_eq!(transcript.usage[0].usage.input_tokens, 7);
    assert_eq!(transcript.usage[0].usage.output_tokens, 2);
    assert_eq!(transcript.usage[0].usage.cached_input_tokens, Some(1));
    let joined = logs.borrow().join("\n");
    assert!(!joined.contains(secret));
    assert!(!joined.contains(prompt));
    assert!(!joined.contains(response_id));
}

#[tokio::test(flavor = "current_thread")]
async fn aborts_the_provider_request_and_persists_a_partial_cancelled_response() {
    let fetch: GatewayFetch = Arc::new(|req| {
        let url = req.url.clone();
        Box::pin(async move {
            if url.ends_with("/models") {
                return Ok(HttpResponse {
                    status: 200,
                    body: serde_json::to_vec(&json!({ "data": [{ "id": "gpt-stream" }] })).unwrap(),
                });
            }
            Ok(HttpResponse {
                status: 200,
                body: sse(&[
                    json!({
                        "type": "response.output_text.delta",
                        "delta": "Partial",
                    }),
                    json!({
                        "type": "response.completed",
                        "response": {
                            "id": "resp-partial",
                            "status": "completed",
                            "output": [],
                        },
                    }),
                ]),
            })
        })
    });
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let secrets = MemorySecretStore::new();
    let logger = create_logger(|_| {});
    let providers = ProviderService::new(&database, &secrets, &logger);
    let models = ModelService::new(&database, &secrets, &logger, fetch);
    let chats = ChatService::new(&database, &logger, &models);
    let provider = providers
        .create(
            &provider_input("chat-stream-test-key"),
            create_correlation_id().as_str(),
        )
        .unwrap();
    let model = models
        .discover(&provider.id, create_correlation_id().as_str())
        .await
        .unwrap()
        .into_iter()
        .next()
        .expect("Expected a discovered test model");
    let thread = chats
        .create(&json!({}), create_correlation_id().as_str())
        .unwrap();
    let aborted = Arc::new(AtomicBool::new(false));
    let mut stream = chats.stream(
        json!({ "threadId": thread.id, "modelRef": model.model_ref, "text": "Cancel me" }),
        create_correlation_id().as_str(),
        Arc::clone(&aborted),
    );
    let first = stream.next().await.unwrap().unwrap();
    assert_eq!(
        first,
        ChatClientStreamEvent::TextDelta {
            text: "Partial".into()
        }
    );
    aborted.store(true, Ordering::SeqCst);
    let second = stream.next().await.unwrap().unwrap();
    assert_eq!(
        second,
        ChatClientStreamEvent::Done {
            finish_reason: FinishReason::Cancelled
        }
    );
    assert!(stream.next().await.is_none());
    drop(stream);
    let turns = chats.get(&thread.id).unwrap().turns;
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0].role, MessageRole::User);
    assert_eq!(turns[1].role, MessageRole::Assistant);
    assert_eq!(
        turns[1].content,
        vec![ModelContentPart::Text {
            text: "Partial".into()
        }]
    );
    assert_eq!(turns[1].finish_reason, Some(FinishReason::Cancelled));
}

#[tokio::test(flavor = "current_thread")]
async fn returns_a_stable_provider_error_without_exposing_its_response_body() {
    let provider_body = "provider-private-error-body";
    let logs = Rc::new(RefCell::new(Vec::<String>::new()));
    let fetch: GatewayFetch = Arc::new(move |req| {
        let url = req.url.clone();
        Box::pin(async move {
            if url.ends_with("/models") {
                Ok(HttpResponse {
                    status: 200,
                    body: serde_json::to_vec(&json!({ "data": [{ "id": "gpt-stream" }] })).unwrap(),
                })
            } else {
                Err(ProviderHttpError { status: 500 })
            }
        })
    });
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let secrets = MemorySecretStore::new();
    let logger = {
        let logs = Rc::clone(&logs);
        create_logger(move |line| logs.borrow_mut().push(line))
    };
    let providers = ProviderService::new(&database, &secrets, &logger);
    let models = ModelService::new(&database, &secrets, &logger, fetch);
    let chats = ChatService::new(&database, &logger, &models);
    let provider = providers
        .create(
            &provider_input("chat-stream-test-key"),
            create_correlation_id().as_str(),
        )
        .unwrap();
    let model = models
        .discover(&provider.id, create_correlation_id().as_str())
        .await
        .unwrap()
        .into_iter()
        .next()
        .expect("Expected a discovered test model");
    let thread = chats
        .create(&json!({}), create_correlation_id().as_str())
        .unwrap();
    let err = collect(chats.stream(
        json!({ "threadId": thread.id, "modelRef": model.model_ref, "text": "Hello" }),
        create_correlation_id().as_str(),
        Arc::new(AtomicBool::new(false)),
    ))
    .await
    .unwrap_err();
    assert_eq!(err.code, ZeroErrorCode::ModelUnavailable);
    assert_eq!(err.message(), "The provider is temporarily unavailable");
    let turns = chats.get(&thread.id).unwrap().turns;
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].role, MessageRole::User);
    assert!(!logs.borrow().join("\n").contains(provider_body));
}
