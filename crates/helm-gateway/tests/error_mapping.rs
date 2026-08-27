use helm_gateway::{normalize_provider_error, NamedError, ProviderHttpError};
use helm_shared::ZeroErrorCode;

#[test]
fn maps_http_status_codes() {
    for (status, code) in [
        (401, ZeroErrorCode::AuthFailed),
        (429, ZeroErrorCode::RateLimited),
        (404, ZeroErrorCode::ModelUnavailable),
        (413, ZeroErrorCode::ContextTooLarge),
        (503, ZeroErrorCode::ModelUnavailable),
    ] {
        let error = NamedError {
            name: "Status".into(),
            status: Some(status),
        };
        assert_eq!(normalize_provider_error(&error).code, code);
        let http = ProviderHttpError { status };
        assert_eq!(normalize_provider_error(&http).code, code);
    }
}

#[test]
fn maps_aborts_without_leaking_provider_error_bodies() {
    let error = NamedError {
        name: "AbortError".into(),
        status: None,
    };
    let mapped = normalize_provider_error(&error);
    assert_eq!(mapped.code, ZeroErrorCode::Cancelled);
    assert_eq!(mapped.message(), "Model request was cancelled");
}

#[test]
fn maps_request_deadlines_to_a_retryable_timeout_without_leaking_details() {
    let error = NamedError {
        name: "TimeoutError".into(),
        status: None,
    };
    let mapped = normalize_provider_error(&error);
    assert_eq!(mapped.code, ZeroErrorCode::IntegrationOffline);
    assert_eq!(mapped.message(), "Provider request timed out");
    assert!(mapped.retryable);
}
