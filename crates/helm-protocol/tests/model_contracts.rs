use helm_protocol::{parse_chat_stream_event, parse_model_request, parse_model_response};
use helm_shared::{create_correlation_id, utc_now};
use serde_json::json;

#[test]
fn accepts_provider_independent_messages_and_rejects_credential_shaped_extras() {
    let provider_id = create_correlation_id();
    let request = json!({
        "modelRef": format!("{provider_id}:example-model"),
        "messages": [{
            "id": create_correlation_id().as_str(),
            "role": "user",
            "content": [{ "type": "text", "text": "Hello" }],
            "createdAt": utc_now(),
        }],
        "dataClassifications": ["public"],
        "stream": false,
    });
    let parsed = parse_model_request(&request).unwrap();
    assert_eq!(
        serde_json::to_value(&parsed).unwrap()["modelRef"],
        request["modelRef"]
    );
    let mut extra = request.clone();
    extra["apiKey"] = json!("must-not-cross");
    assert!(parse_model_request(&extra).is_err());
}

#[test]
fn keeps_provider_continuation_optional_rather_than_canonical() {
    let parsed = parse_model_response(&json!({
        "text": "Hello",
        "toolCalls": [],
        "finishReason": "stop",
    }))
    .unwrap();
    assert_eq!(parsed.text, "Hello");
    assert!(parsed.tool_calls.is_empty());
}

#[test]
fn validates_every_stream_event_variant_independently() {
    let parsed = parse_chat_stream_event(&json!({ "type": "text.delta", "text": "Hi" })).unwrap();
    match parsed {
        helm_protocol::ChatStreamEvent::TextDelta { text } => assert_eq!(text, "Hi"),
        _ => panic!("expected text.delta"),
    }
    assert!(parse_chat_stream_event(&json!({
        "type": "usage",
        "usage": { "inputTokens": -1, "outputTokens": 0 },
    }))
    .is_err());
}
