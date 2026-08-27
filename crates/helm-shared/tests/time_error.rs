use helm_shared::{
    normalize_error, to_utc_timestamp, Thrown, ZeroError, ZeroErrorCode, ZERO_ERROR_CODES,
};

#[test]
fn normalizes_timestamps_to_utc() {
    assert_eq!(
        to_utc_timestamp("2026-08-09T12:30:00+05:30").unwrap(),
        "2026-08-09T07:00:00.000Z"
    );
}

#[test]
fn rejects_invalid_timestamps() {
    assert!(to_utc_timestamp("not-a-date").is_err());
}

#[test]
fn preserves_stable_error_codes_without_serializing_the_cause() {
    let error = ZeroError::new(
        ZeroErrorCode::PermissionDenied,
        "Denied",
        Default::default(),
    )
    .with_metadata("toolId", "task.create");
    let json = error.to_json();
    assert_eq!(json.name, "ZeroError");
    assert_eq!(json.code, "PERMISSION_DENIED");
    assert_eq!(json.message, "Denied");
    assert!(!json.retryable);
    assert_eq!(
        json.metadata.get("toolId").map(String::as_str),
        Some("task.create")
    );
}

#[test]
fn normalizes_unknown_thrown_values_without_exposing_their_contents() {
    let error = normalize_error(Thrown::Unknown {
        original_type: "object",
    });
    assert_eq!(error.message(), "An unknown error occurred");
    assert_eq!(
        error.metadata().get("originalType").map(String::as_str),
        Some("object")
    );
}

#[test]
fn every_error_code_round_trips_to_the_typescript_string() {
    for code in ZERO_ERROR_CODES {
        assert_eq!(code.as_str().parse::<ZeroErrorCode>(), Ok(*code));
    }
    assert_eq!(ZERO_ERROR_CODES.len(), 15);
}
