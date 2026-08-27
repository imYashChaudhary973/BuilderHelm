use serde_json::Value;

use crate::validate::{finite_json, ParseError};

pub type JsonValue = Value;

pub fn parse_json_value(value: &Value) -> Result<JsonValue, ParseError> {
    finite_json(value)?;
    Ok(value.clone())
}
