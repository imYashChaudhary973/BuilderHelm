use helm_protocol::{
    parse_append_chat_turn_input, parse_chat_client_stream_event, parse_chat_stream_start_request,
};
use helm_shared::create_correlation_id;
use serde_json::json;

#[test]
fn defaults_non_assistant_response_metadata_to_null() {
    let thread_id = create_correlation_id();
    let parsed = parse_append_chat_turn_input(&json!({
        "threadId": thread_id.as_str(),
        "role": "user",
        "content": [{ "type": "text", "text": "Hello" }],
    }))
    .unwrap();
    assert_eq!(parsed.thread_id, thread_id.as_str());
    assert!(parsed.model_ref.is_none());
    assert!(parsed.finish_reason.is_none());
    assert!(parsed.provider_continuation.is_none());
    assert!(parsed.usage.is_none());
}

#[test]
fn accepts_normalized_assistant_usage_and_matching_continuation_metadata() {
    let provider_id = create_correlation_id();
    let input = json!({
        "threadId": create_correlation_id().as_str(),
        "role": "assistant",
        "content": [{ "type": "text", "text": "Hello back" }],
        "modelRef": format!("{provider_id}:gpt-example"),
        "finishReason": "stop",
        "providerContinuation": { "providerId": provider_id.as_str(), "responseId": "response-123" },
        "usage": {
            "inputTokens": 12,
            "outputTokens": 4,
            "cachedInputTokens": 3,
            "reasoningTokens": 1,
        },
    });
    let parsed = parse_append_chat_turn_input(&input).unwrap();
    assert_eq!(
        parsed.model_ref.as_deref(),
        Some(input["modelRef"].as_str().unwrap())
    );
}

#[test]
fn rejects_incomplete_mismatched_and_credential_shaped_turn_data() {
    let provider_id = create_correlation_id();
    let base = json!({
        "threadId": create_correlation_id().as_str(),
        "role": "assistant",
        "content": [{ "type": "text", "text": "Hello" }],
        "modelRef": format!("{provider_id}:gpt-example"),
        "finishReason": "stop",
    });
    let mut missing = base.clone();
    missing["modelRef"] = json!(null);
    assert!(parse_append_chat_turn_input(&missing).is_err());
    let mut mismatched = base.clone();
    mismatched["providerContinuation"] = json!({
        "providerId": create_correlation_id().as_str(),
        "responseId": "wrong-provider",
    });
    assert!(parse_append_chat_turn_input(&mismatched).is_err());
    let mut extra = base.clone();
    extra["apiKey"] = json!("must-not-persist");
    assert!(parse_append_chat_turn_input(&extra).is_err());
    let mut user = base.clone();
    user["role"] = json!("user");
    assert!(parse_append_chat_turn_input(&user).is_err());
}

#[test]
fn strictly_validates_stream_requests_before_they_cross_ipc() {
    let request = json!({
        "correlationId": create_correlation_id().as_str(),
        "runId": create_correlation_id().as_str(),
        "input": {
            "threadId": create_correlation_id().as_str(),
            "modelRef": format!("{}:gpt-example", create_correlation_id()),
            "text": "Hello",
        },
    });
    assert!(parse_chat_stream_start_request(&request).is_ok());
    let mut extra = request.clone();
    extra["input"]["apiKey"] = json!("must-not-cross-ipc");
    assert!(parse_chat_stream_start_request(&extra).is_err());
}

#[test]
fn keeps_provider_continuation_identifiers_out_of_renderer_stream_events() {
    assert!(
        parse_chat_client_stream_event(&json!({ "type": "done", "finishReason": "stop" })).is_ok()
    );
    assert!(parse_chat_client_stream_event(&json!({
        "type": "done",
        "finishReason": "stop",
        "providerContinuation": {
            "providerId": create_correlation_id().as_str(),
            "responseId": "private-provider-response-id",
        },
    }))
    .is_err());
}
