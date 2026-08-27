use std::cell::RefCell;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;

use helm_db::{migrations, open_database_unchecked, run_migrations};
use helm_observability::create_logger;
use helm_protocol::{ChatStreamEvent, ModelRequest};
use helm_shared::{create_correlation_id, ZeroError};
use serde_json::json;

use helm_core::chat::{ChatModelStreamer, ChatService};

struct NoopStreamer;

impl ChatModelStreamer for NoopStreamer {
    fn stream<'a>(
        &'a self,
        _request: ModelRequest,
        _correlation_id: &'a str,
        _aborted: bool,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ChatStreamEvent>, ZeroError>> + 'a>> {
        Box::pin(async { Ok(Vec::new()) })
    }
}

#[test]
fn persists_canonical_turns_and_usage_across_restarts_and_model_switches() {
    let directory = std::env::temp_dir().join(format!("zero-chat-{}", create_correlation_id()));
    std::fs::create_dir_all(&directory).unwrap();
    let database_path = directory.join("zero.sqlite");
    let logs = Rc::new(RefCell::new(Vec::<String>::new()));
    let first_provider_id = create_correlation_id().to_string();
    let first_model_ref = format!("{first_provider_id}:model-a");
    let second_provider_id = create_correlation_id().to_string();
    let second_model_ref = format!("{second_provider_id}:model-b");
    let thread_id;
    {
        let database = open_database_unchecked(database_path.to_str().unwrap());
        run_migrations(&database, &migrations());
        let logger = {
            let logs = Rc::clone(&logs);
            create_logger(move |line| logs.borrow_mut().push(line))
        };
        let streamer = NoopStreamer;
        let chats = ChatService::new(&database, &logger, &streamer);
        let thread = chats
            .create(
                &json!({ "title": "Model switch" }),
                create_correlation_id().as_str(),
            )
            .unwrap();
        thread_id = thread.id.clone();
        chats
            .append(
                &json!({
                    "threadId": thread.id,
                    "role": "user",
                    "content": [{ "type": "text", "text": "private-message-sentinel" }],
                }),
                create_correlation_id().as_str(),
            )
            .unwrap();
        chats
            .append(
                &json!({
                    "threadId": thread.id,
                    "role": "assistant",
                    "content": [{ "type": "text", "text": "First answer" }],
                    "modelRef": first_model_ref,
                    "finishReason": "stop",
                    "providerContinuation": {
                        "providerId": first_provider_id,
                        "responseId": "opaque-response-sentinel",
                    },
                    "usage": { "inputTokens": 8, "outputTokens": 3 },
                }),
                create_correlation_id().as_str(),
            )
            .unwrap();
        chats
            .append(
                &json!({
                    "threadId": thread.id,
                    "role": "assistant",
                    "content": [{ "type": "text", "text": "Second answer" }],
                    "modelRef": second_model_ref,
                    "finishReason": "length",
                    "usage": {
                        "inputTokens": 11,
                        "outputTokens": 7,
                        "cachedInputTokens": 4,
                        "reasoningTokens": 2,
                    },
                }),
                create_correlation_id().as_str(),
            )
            .unwrap();
    }
    let database = open_database_unchecked(database_path.to_str().unwrap());
    run_migrations(&database, &migrations());
    let logger = {
        let logs = Rc::clone(&logs);
        create_logger(move |line| logs.borrow_mut().push(line))
    };
    let streamer = NoopStreamer;
    let chats = ChatService::new(&database, &logger, &streamer);
    let transcript = chats.get(&thread_id).unwrap();
    let listed = chats.list().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, thread_id);
    assert_eq!(listed[0].title.as_deref(), Some("Model switch"));
    let refs: Vec<Option<String>> = transcript
        .turns
        .iter()
        .map(|turn| turn.model_ref.clone())
        .collect();
    assert_eq!(
        refs,
        vec![
            None,
            Some(first_model_ref.clone()),
            Some(second_model_ref.clone())
        ]
    );
    assert_eq!(transcript.usage.len(), 2);
    assert_eq!(transcript.usage[0].model_ref, first_model_ref);
    assert_eq!(transcript.usage[1].model_ref, second_model_ref);
    assert_eq!(transcript.usage[1].usage.input_tokens, 11);
    assert_eq!(transcript.usage[1].usage.output_tokens, 7);
    assert_eq!(transcript.usage[1].usage.cached_input_tokens, Some(4));
    assert_eq!(transcript.usage[1].usage.reasoning_tokens, Some(2));
    let joined = logs.borrow().join("\n");
    assert!(!joined.contains("private-message-sentinel"));
    assert!(!joined.contains("opaque-response-sentinel"));
    let _ = std::fs::remove_dir_all(directory);
}

#[test]
fn validates_the_complete_turn_before_writing_any_data() {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = create_logger(|_| {});
    let streamer = NoopStreamer;
    let chats = ChatService::new(&database, &logger, &streamer);
    let thread = chats
        .create(&json!({}), create_correlation_id().as_str())
        .unwrap();
    let err = chats.append(
        &json!({
            "threadId": thread.id,
            "role": "user",
            "content": [{ "type": "text", "text": "Hello" }],
            "apiKey": "must-not-persist",
        }),
        create_correlation_id().as_str(),
    );
    assert!(err.is_err());
    assert!(chats.get(&thread.id).unwrap().turns.is_empty());
}
