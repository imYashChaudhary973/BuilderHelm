use serde::de::DeserializeOwned;
use serde_json::Value;
use uuid::Uuid;

use helm_shared::to_utc_timestamp;

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct ParseError(pub String);

impl ParseError {
    pub fn new(msg: impl Into<String>) -> Self {
        Self(msg.into())
    }
}

pub fn from_strict<T: DeserializeOwned>(value: &Value) -> Result<T, ParseError> {
    serde_json::from_value(value.clone()).map_err(|err| ParseError(err.to_string()))
}

pub fn is_uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok()
}

pub fn require_uuid(value: &str) -> Result<(), ParseError> {
    if is_uuid(value) {
        Ok(())
    } else {
        Err(ParseError::new("Invalid uuid"))
    }
}

pub fn require_datetime(value: &str) -> Result<(), ParseError> {
    to_utc_timestamp(value)
        .map(|_| ())
        .map_err(|_| ParseError::new("Invalid datetime"))
}

pub fn require_len(value: &str, min: usize, max: usize) -> Result<(), ParseError> {
    if value.len() < min || value.len() > max {
        Err(ParseError::new("string length"))
    } else {
        Ok(())
    }
}

pub fn trim_len(value: &str, min: usize, max: usize) -> Result<String, ParseError> {
    let trimmed = value.trim().to_string();
    require_len(&trimmed, min, max)?;
    Ok(trimmed)
}

pub fn require_model_ref(value: &str) -> Result<(), ParseError> {
    if value.len() > 500 {
        return Err(ParseError::new("modelRef too long"));
    }
    let Some((left, right)) = value.split_once(':') else {
        return Err(ParseError::new("modelRef"));
    };
    if left.is_empty() || right.is_empty() || left.contains(':') {
        return Err(ParseError::new("modelRef"));
    }
    Ok(())
}

pub fn is_http_url(value: &str) -> bool {
    (value.starts_with("http://") || value.starts_with("https://"))
        && !value.chars().any(char::is_whitespace)
        && value.len() > "http://".len()
}

pub fn finite_json(value: &Value) -> Result<(), ParseError> {
    match value {
        Value::Null | Value::Bool(_) | Value::String(_) => Ok(()),
        Value::Number(n) => {
            if n.as_f64().is_some_and(|f| f.is_finite())
                || n.as_i64().is_some()
                || n.as_u64().is_some()
            {
                Ok(())
            } else {
                Err(ParseError::new("non-finite number"))
            }
        }
        Value::Array(items) => items.iter().try_for_each(finite_json),
        Value::Object(map) => map.values().try_for_each(finite_json),
    }
}

pub fn sha(value: &str, min: usize, max: usize) -> Result<(), ParseError> {
    if value.len() < min
        || value.len() > max
        || !value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    {
        Err(ParseError::new("invalid sha"))
    } else {
        Ok(())
    }
}
