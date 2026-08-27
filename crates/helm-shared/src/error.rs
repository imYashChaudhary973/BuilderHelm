use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ZeroErrorCode {
    AuthFailed,
    RateLimited,
    ModelUnavailable,
    ModelCapabilityMismatch,
    ContextTooLarge,
    ToolSchemaInvalid,
    ToolExecutionFailed,
    PermissionDenied,
    IntegrationOffline,
    IndexStale,
    Cancelled,
    ValidationFailed,
    DatabaseFailed,
    MigrationFailed,
    InternalError,
}

pub const ZERO_ERROR_CODES: &[ZeroErrorCode] = &[
    ZeroErrorCode::AuthFailed,
    ZeroErrorCode::RateLimited,
    ZeroErrorCode::ModelUnavailable,
    ZeroErrorCode::ModelCapabilityMismatch,
    ZeroErrorCode::ContextTooLarge,
    ZeroErrorCode::ToolSchemaInvalid,
    ZeroErrorCode::ToolExecutionFailed,
    ZeroErrorCode::PermissionDenied,
    ZeroErrorCode::IntegrationOffline,
    ZeroErrorCode::IndexStale,
    ZeroErrorCode::Cancelled,
    ZeroErrorCode::ValidationFailed,
    ZeroErrorCode::DatabaseFailed,
    ZeroErrorCode::MigrationFailed,
    ZeroErrorCode::InternalError,
];

impl ZeroErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AuthFailed => "AUTH_FAILED",
            Self::RateLimited => "RATE_LIMITED",
            Self::ModelUnavailable => "MODEL_UNAVAILABLE",
            Self::ModelCapabilityMismatch => "MODEL_CAPABILITY_MISMATCH",
            Self::ContextTooLarge => "CONTEXT_TOO_LARGE",
            Self::ToolSchemaInvalid => "TOOL_SCHEMA_INVALID",
            Self::ToolExecutionFailed => "TOOL_EXECUTION_FAILED",
            Self::PermissionDenied => "PERMISSION_DENIED",
            Self::IntegrationOffline => "INTEGRATION_OFFLINE",
            Self::IndexStale => "INDEX_STALE",
            Self::Cancelled => "CANCELLED",
            Self::ValidationFailed => "VALIDATION_FAILED",
            Self::DatabaseFailed => "DATABASE_FAILED",
            Self::MigrationFailed => "MIGRATION_FAILED",
            Self::InternalError => "INTERNAL_ERROR",
        }
    }
}

impl std::str::FromStr for ZeroErrorCode {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        ZERO_ERROR_CODES
            .iter()
            .copied()
            .find(|code| code.as_str() == value)
            .ok_or(())
    }
}

#[derive(Debug, Default, Clone)]
pub struct ZeroErrorOptions {
    pub metadata: HashMap<String, String>,
    pub retryable: bool,
}

#[derive(Debug, Clone, thiserror::Error)]
#[error("{message}")]
pub struct ZeroError {
    pub code: ZeroErrorCode,
    message: String,
    metadata: HashMap<String, String>,
    pub retryable: bool,
}

pub struct ZeroErrorJson {
    pub name: &'static str,
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
    pub metadata: HashMap<String, String>,
}

impl ZeroError {
    pub fn new(code: ZeroErrorCode, message: impl Into<String>, options: ZeroErrorOptions) -> Self {
        Self {
            code,
            message: message.into(),
            metadata: options.metadata,
            retryable: options.retryable,
        }
    }

    pub fn with_metadata(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.metadata.insert(key.into(), value.into());
        self
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub fn metadata(&self) -> &HashMap<String, String> {
        &self.metadata
    }

    pub fn to_json(&self) -> ZeroErrorJson {
        ZeroErrorJson {
            name: "ZeroError",
            code: self.code.as_str(),
            message: self.message.clone(),
            retryable: self.retryable,
            metadata: self.metadata.clone(),
        }
    }
}

pub enum Thrown {
    Zero(ZeroError),
    Other { message: String },
    Unknown { original_type: &'static str },
}

pub fn normalize_error(error: Thrown) -> ZeroError {
    normalize_error_with(error, ZeroErrorCode::InternalError)
}

pub fn normalize_error_with(error: Thrown, fallback_code: ZeroErrorCode) -> ZeroError {
    match error {
        Thrown::Zero(error) => error,
        Thrown::Other { message } => {
            ZeroError::new(fallback_code, message, ZeroErrorOptions::default())
        }
        Thrown::Unknown { original_type } => ZeroError::new(
            fallback_code,
            "An unknown error occurred",
            ZeroErrorOptions::default(),
        )
        .with_metadata("originalType", original_type),
    }
}

impl fmt::Display for ZeroErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
