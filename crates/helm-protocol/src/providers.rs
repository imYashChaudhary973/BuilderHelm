use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{
    parse_model_capability_overrides, ModelCapabilityOverrides, ModelError, ModelRecord,
};
use crate::validate::{
    from_strict, is_http_url, require_datetime, require_len, require_model_ref, require_uuid,
    ParseError,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderProtocol {
    Openai,
    Anthropic,
    OpenaiCompatible,
    AnthropicCompatible,
    Ollama,
    Litellm,
    Custom,
}

pub const PROVIDER_PROTOCOLS: [&str; 7] = [
    "openai",
    "anthropic",
    "openai-compatible",
    "anthropic-compatible",
    "ollama",
    "litellm",
    "custom",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "camelCase", deny_unknown_fields)]
pub enum ProviderHeader {
    Static {
        name: String,
        value: String,
    },
    Secret {
        name: String,
        #[serde(rename = "secretRef")]
        secret_ref: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderPrivacy {
    #[serde(default = "default_true")]
    pub allow_personal: bool,
    #[serde(default)]
    pub allow_sensitive: bool,
    #[serde(default)]
    pub allow_health: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateProviderInput {
    pub label: String,
    pub protocol: ProviderProtocol,
    pub base_url: Option<String>,
    pub headers: Vec<ProviderHeader>,
    pub privacy: ProviderPrivacy,
    pub enabled: bool,
    pub api_key: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderOperationInput {
    pub provider_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderTestConnectionRequest {
    pub correlation_id: String,
    pub input: ProviderOperationInput,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelCapabilityOverrideUpdateInput {
    pub model_ref: String,
    pub overrides: ModelCapabilityOverrides,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelCapabilityOverrideUpdateRequest {
    pub correlation_id: String,
    pub input: ModelCapabilityOverrideUpdateInput,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum IpcResult<T> {
    Ok { ok: bool, value: T },
    Err { ok: bool, error: ModelError },
}

fn sensitive_header_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("authorization")
        || lower.contains("cookie")
        || lower.contains("credential")
        || lower.contains("token")
        || lower.contains("secret")
        || lower.contains("api-key")
        || lower.contains("api_key")
        || lower.contains("apikey")
}

fn validate_header(header: &ProviderHeader) -> Result<(), ParseError> {
    let name = match header {
        ProviderHeader::Static { name, value } => {
            require_len(value, 0, 2_000)?;
            name
        }
        ProviderHeader::Secret { name, secret_ref } => {
            if secret_ref.trim().is_empty() || secret_ref.trim().len() > 200 {
                return Err(ParseError::new("secretRef"));
            }
            name
        }
    };
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 100 {
        return Err(ParseError::new("header name"));
    }
    if matches!(header, ProviderHeader::Static { .. }) && sensitive_header_name(trimmed) {
        return Err(ParseError::new(
            "Sensitive headers must reference secure storage",
        ));
    }
    Ok(())
}

fn validate_base_url(url: &Option<String>) -> Result<(), ParseError> {
    match url {
        None => Ok(()),
        Some(url) if is_http_url(url) => Ok(()),
        Some(_) => Err(ParseError::new("baseUrl")),
    }
}

pub fn parse_create_provider_input(value: &Value) -> Result<CreateProviderInput, ParseError> {
    let mut input: CreateProviderInput = from_strict(value)?;
    input.label = crate::validate::trim_len(&input.label, 1, 100)?;
    if input.headers.len() > 20 {
        return Err(ParseError::new("headers max"));
    }
    input.headers.iter().try_for_each(validate_header)?;
    validate_base_url(&input.base_url)?;
    if input.api_key.len() > 16_384 {
        return Err(ParseError::new("apiKey"));
    }
    if input.protocol != ProviderProtocol::Ollama && input.api_key.is_empty() {
        return Err(ParseError::new("An API key is required for this protocol"));
    }
    if input.protocol == ProviderProtocol::OpenaiCompatible && input.base_url.is_none() {
        return Err(ParseError::new(
            "An explicit base URL is required for this protocol",
        ));
    }
    Ok(input)
}

pub fn parse_provider_test_connection_request(
    value: &Value,
) -> Result<ProviderTestConnectionRequest, ParseError> {
    let request: ProviderTestConnectionRequest = from_strict(value)?;
    require_uuid(&request.correlation_id)?;
    require_uuid(&request.input.provider_id)?;
    Ok(request)
}

pub fn parse_model_capability_override_update_request(
    value: &Value,
) -> Result<ModelCapabilityOverrideUpdateRequest, ParseError> {
    let request: ModelCapabilityOverrideUpdateRequest = from_strict(value)?;
    require_uuid(&request.correlation_id)?;
    require_model_ref(&request.input.model_ref)?;
    parse_model_capability_overrides(&serde_json::to_value(&request.input.overrides).unwrap())?;
    Ok(request)
}

pub fn parse_model_list_ipc_response(
    value: &Value,
) -> Result<IpcResult<Vec<ModelRecord>>, ParseError> {
    let parsed: IpcResult<Vec<ModelRecord>> = from_strict(value)?;
    match &parsed {
        IpcResult::Ok { ok, .. } if *ok => Ok(parsed),
        IpcResult::Err { ok, error } if !*ok => {
            crate::model::parse_model_error(&serde_json::to_value(error).unwrap())?;
            Ok(parsed)
        }
        _ => Err(ParseError::new("ipc result")),
    }
}

pub fn parse_provider_privacy(value: &Value) -> Result<ProviderPrivacy, ParseError> {
    from_strict(value)
}

pub fn require_datetime_field(value: &str) -> Result<(), ParseError> {
    require_datetime(value)
}

pub fn require_len_field(value: &str, min: usize, max: usize) -> Result<(), ParseError> {
    require_len(value, min, max)
}
