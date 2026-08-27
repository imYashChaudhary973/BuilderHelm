use helm_protocol::ParseError;
use helm_shared::{ZeroError, ZeroErrorCode, ZeroErrorOptions};

pub fn parse_failed(err: ParseError) -> ZeroError {
    ZeroError::new(
        ZeroErrorCode::ValidationFailed,
        err.0,
        ZeroErrorOptions::default(),
    )
}

pub fn failed(code: ZeroErrorCode, message: impl Into<String>) -> ZeroError {
    ZeroError::new(code, message, ZeroErrorOptions::default())
}
