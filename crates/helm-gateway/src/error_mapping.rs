use helm_shared::{ZeroError, ZeroErrorCode, ZeroErrorOptions};

fn retryable() -> ZeroErrorOptions {
    ZeroErrorOptions {
        retryable: true,
        ..Default::default()
    }
}

#[derive(Debug)]
pub struct ProviderHttpError {
    pub status: u16,
}

impl std::fmt::Display for ProviderHttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Provider HTTP request failed with status {}",
            self.status
        )
    }
}

impl std::error::Error for ProviderHttpError {}

#[derive(Debug)]
pub struct NamedError {
    pub name: String,
    pub status: Option<u16>,
}

impl std::fmt::Display for NamedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.name)
    }
}

impl std::error::Error for NamedError {}

pub fn normalize_provider_error(error: &(dyn std::error::Error + 'static)) -> ZeroError {
    if let Some(zero) = error.downcast_ref::<ZeroError>() {
        return zero.clone();
    }
    if let Some(http) = error.downcast_ref::<ProviderHttpError>() {
        return normalize_status(http.status);
    }
    if let Some(named) = error.downcast_ref::<NamedError>() {
        if named.name == "AbortError" {
            return ZeroError::new(
                ZeroErrorCode::Cancelled,
                "Model request was cancelled",
                ZeroErrorOptions::default(),
            );
        }
        if named.name == "TimeoutError" {
            return ZeroError::new(
                ZeroErrorCode::IntegrationOffline,
                "Provider request timed out",
                retryable(),
            );
        }
        if let Some(status) = named.status {
            return normalize_status(status);
        }
    }
    ZeroError::new(
        ZeroErrorCode::ModelUnavailable,
        "The provider request failed",
        ZeroErrorOptions::default(),
    )
}

fn normalize_status(status: u16) -> ZeroError {
    if status == 401 || status == 403 {
        ZeroError::new(
            ZeroErrorCode::AuthFailed,
            "Provider authentication failed",
            ZeroErrorOptions::default(),
        )
    } else if status == 408 || status == 429 {
        ZeroError::new(
            ZeroErrorCode::RateLimited,
            "Provider rate limit reached",
            retryable(),
        )
    } else if status == 404 {
        ZeroError::new(
            ZeroErrorCode::ModelUnavailable,
            "The selected model is unavailable",
            ZeroErrorOptions::default(),
        )
    } else if status == 413 {
        ZeroError::new(
            ZeroErrorCode::ContextTooLarge,
            "The model context is too large",
            ZeroErrorOptions::default(),
        )
    } else if status >= 500 {
        ZeroError::new(
            ZeroErrorCode::ModelUnavailable,
            "The provider is temporarily unavailable",
            retryable(),
        )
    } else {
        ZeroError::new(
            ZeroErrorCode::ModelUnavailable,
            "The provider request failed",
            ZeroErrorOptions::default(),
        )
    }
}
