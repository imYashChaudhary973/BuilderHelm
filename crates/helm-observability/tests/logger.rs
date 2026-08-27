use std::cell::RefCell;
use std::rc::Rc;

use helm_observability::{create_logger, redact, LogInput};
use helm_shared::create_correlation_id;
use serde_json::{json, Value};

#[test]
fn redacts_sensitive_keys_and_token_shaped_values_recursively() {
    let output = redact(&json!({
        "headers": { "Authorization": "Bearer highly-sensitive-token" },
        "apiKey": "sentinel-secret-value",
        "note": "received sk-live_abcdefghijk",
    }));
    let serialized = output.to_string();
    assert!(!serialized.contains("highly-sensitive-token"));
    assert!(!serialized.contains("sentinel-secret-value"));
    assert!(!serialized.contains("sk-live_abcdefghijk"));
}

#[test]
fn redacts_bearer_in_non_sensitive_strings() {
    let output = redact(&json!({ "note": "use Bearer abc.def_ghi" }));
    assert_eq!(output["note"], "use Bearer [REDACTED]");
}

#[test]
fn redacts_cookie_password_secret_token_keys() {
    let output = redact(&json!({
        "cookie": "session=abc",
        "password": "hunter2",
        "clientSecret": "shh",
        "refreshToken": "xyz",
    }));
    assert_eq!(output["cookie"], "[REDACTED]");
    assert_eq!(output["password"], "[REDACTED]");
    assert_eq!(output["clientSecret"], "[REDACTED]");
    assert_eq!(output["refreshToken"], "[REDACTED]");
}

#[test]
fn redacts_private_key_and_api_key_variants() {
    let output = redact(&json!({
        "privateKey": "pk",
        "private-key": "pk2",
        "api-key": "ak",
        "api_key": "ak2",
    }));
    assert_eq!(output["privateKey"], "[REDACTED]");
    assert_eq!(output["private-key"], "[REDACTED]");
    assert_eq!(output["api-key"], "[REDACTED]");
    assert_eq!(output["api_key"], "[REDACTED]");
}

#[test]
fn redacts_arrays_and_leaves_primitives() {
    let output = redact(&json!({
        "items": ["sk-live_abcdefghijk", 7, true, null],
    }));
    assert_eq!(output["items"][0], "[REDACTED]");
    assert_eq!(output["items"][1], 7);
    assert_eq!(output["items"][2], true);
    assert_eq!(output["items"][3], Value::Null);
}

#[test]
fn writes_a_parseable_record_with_correlation_metadata() {
    let lines = Rc::new(RefCell::new(Vec::<String>::new()));
    let correlation_id = create_correlation_id();
    let logger = create_logger({
        let lines = lines.clone();
        move |line| lines.borrow_mut().push(line)
    });
    logger.info(LogInput {
        event: "core.started",
        correlation_id: correlation_id.as_str(),
        data: Some(json!({ "status": "ready" })),
    });
    let parsed: Value = serde_json::from_str(&lines.borrow()[0]).unwrap();
    assert_eq!(parsed["level"], "info");
    assert_eq!(parsed["event"], "core.started");
    assert_eq!(parsed["correlationId"], correlation_id.as_str());
    assert_eq!(parsed["data"]["status"], "ready");
    assert!(parsed.get("timestamp").and_then(Value::as_str).is_some());
}
