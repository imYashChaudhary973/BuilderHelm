use helm_shared::ZERO_ERROR_CODES;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::json::parse_json_value;
use crate::validate::{
    from_strict, is_http_url, is_uuid, require_datetime, require_len, require_model_ref,
    require_uuid, ParseError,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DataClassification {
    Public,
    Personal,
    Sensitive,
    Health,
    Secret,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MessageRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FinishReason {
    Stop,
    Length,
    ToolCalls,
    ContentFilter,
    Cancelled,
    Error,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PrivacyClass {
    Local,
    Remote,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReasoningLevel {
    None,
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NormalizedToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ImageSource {
    Url { url: String },
    Attachment { attachment_id: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ModelContentPart {
    Text {
        text: String,
    },
    Image {
        source: ImageSource,
        #[serde(rename = "mediaType")]
        media_type: String,
    },
    ToolCall {
        call: NormalizedToolCall,
    },
    ToolResult {
        #[serde(rename = "callId")]
        call_id: String,
        output: Value,
        #[serde(rename = "isError")]
        is_error: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ZeroMessage {
    pub id: String,
    pub role: MessageRole,
    pub content: Vec<ModelContentPart>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelCapabilities {
    pub text: bool,
    pub vision: bool,
    pub audio_input: bool,
    pub tool_calling: bool,
    pub parallel_tools: bool,
    pub structured_output: bool,
    pub streaming: bool,
    pub reasoning_controls: bool,
    pub server_web_search: bool,
    pub server_mcp: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelCapabilityOverrides {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vision: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_input: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calling: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parallel_tools: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured_output: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub streaming: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_controls: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_web_search: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_mcp: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelCapabilityOverrideRecord {
    pub model_ref: String,
    pub overrides: ModelCapabilityOverrides,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelRecord {
    #[serde(rename = "ref")]
    pub model_ref: String,
    pub provider_id: String,
    pub model_id: String,
    pub label: String,
    pub capabilities: ModelCapabilities,
    pub privacy_class: PrivacyClass,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelRequest {
    pub model_ref: String,
    pub messages: Vec<ZeroMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<ToolDefinition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_schema: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<ReasoningLevel>,
    pub data_classifications: Vec<DataClassification>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<i64>,
    pub stream: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TokenUsage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cached_input_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_tokens: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderContinuation {
    pub provider_id: String,
    pub response_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelResponse {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_summary: Option<String>,
    pub tool_calls: Vec<NormalizedToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
    pub finish_reason: FinishReason,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_continuation: Option<ProviderContinuation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ChatStreamEvent {
    #[serde(rename = "text.delta")]
    TextDelta {
        text: String,
    },
    #[serde(rename = "reasoning.summary")]
    ReasoningSummary {
        text: String,
    },
    #[serde(rename = "tool.proposed")]
    ToolProposed {
        call: NormalizedToolCall,
    },
    Usage {
        usage: TokenUsage,
    },
    Done {
        #[serde(rename = "finishReason")]
        finish_reason: FinishReason,
        #[serde(
            rename = "providerContinuation",
            skip_serializing_if = "Option::is_none"
        )]
        provider_continuation: Option<ProviderContinuation>,
    },
    Error {
        error: ModelError,
    },
}

fn require_nonneg(n: i64) -> Result<(), ParseError> {
    if n < 0 {
        Err(ParseError::new("must be nonnegative"))
    } else {
        Ok(())
    }
}

fn require_pos(n: i64) -> Result<(), ParseError> {
    if n <= 0 {
        Err(ParseError::new("must be positive"))
    } else {
        Ok(())
    }
}

fn validate_tool_call(call: &NormalizedToolCall) -> Result<(), ParseError> {
    require_len(&call.id, 1, 200)?;
    require_len(&call.name, 1, 200)?;
    parse_json_value(&call.arguments)?;
    Ok(())
}

fn validate_part(part: &ModelContentPart) -> Result<(), ParseError> {
    match part {
        ModelContentPart::Text { .. } => Ok(()),
        ModelContentPart::Image { source, media_type } => {
            require_len(media_type, 1, 100)?;
            match source {
                ImageSource::Url { url } if is_http_url(url) => Ok(()),
                ImageSource::Attachment { attachment_id } => require_uuid(attachment_id),
                ImageSource::Url { .. } => Err(ParseError::new("invalid url")),
            }
        }
        ModelContentPart::ToolCall { call } => validate_tool_call(call),
        ModelContentPart::ToolResult {
            call_id, output, ..
        } => {
            require_len(call_id, 1, 200)?;
            parse_json_value(output).map(|_| ())
        }
    }
}

fn validate_message(message: &ZeroMessage) -> Result<(), ParseError> {
    require_uuid(&message.id)?;
    if message.content.is_empty() {
        return Err(ParseError::new("content min 1"));
    }
    message.content.iter().try_for_each(validate_part)?;
    require_datetime(&message.created_at)
}

fn validate_caps(
    context_window: Option<i64>,
    max_output_tokens: Option<i64>,
) -> Result<(), ParseError> {
    if let Some(n) = context_window {
        require_pos(n)?;
    }
    if let Some(n) = max_output_tokens {
        require_pos(n)?;
    }
    Ok(())
}

fn validate_usage(usage: &TokenUsage) -> Result<(), ParseError> {
    require_nonneg(usage.input_tokens)?;
    require_nonneg(usage.output_tokens)?;
    if let Some(n) = usage.cached_input_tokens {
        require_nonneg(n)?;
    }
    if let Some(n) = usage.reasoning_tokens {
        require_nonneg(n)?;
    }
    Ok(())
}

fn validate_continuation(cont: &ProviderContinuation) -> Result<(), ParseError> {
    require_uuid(&cont.provider_id)?;
    require_len(&cont.response_id, 1, 1_000)
}

pub fn parse_model_error(value: &Value) -> Result<ModelError, ParseError> {
    let error: ModelError = from_strict(value)?;
    if !ZERO_ERROR_CODES
        .iter()
        .any(|code| code.as_str() == error.code)
    {
        return Err(ParseError::new("unknown error code"));
    }
    Ok(error)
}

pub fn parse_token_usage(value: &Value) -> Result<TokenUsage, ParseError> {
    let usage: TokenUsage = from_strict(value)?;
    validate_usage(&usage)?;
    Ok(usage)
}

pub fn parse_model_request(value: &Value) -> Result<ModelRequest, ParseError> {
    let request: ModelRequest = from_strict(value)?;
    require_model_ref(&request.model_ref)?;
    if request.messages.is_empty() || request.messages.len() > 10_000 {
        return Err(ParseError::new("messages length"));
    }
    request.messages.iter().try_for_each(validate_message)?;
    if let Some(tools) = &request.tools {
        if tools.len() > 128 {
            return Err(ParseError::new("tools max"));
        }
        for tool in tools {
            require_len(&tool.name, 1, 200)?;
            require_len(&tool.description, 0, 4_000)?;
            parse_json_value(&tool.input_schema)?;
        }
    }
    if let Some(schema) = &request.response_schema {
        parse_json_value(schema)?;
    }
    if request.data_classifications.is_empty() {
        return Err(ParseError::new("dataClassifications min 1"));
    }
    if let Some(n) = request.max_output_tokens {
        require_pos(n)?;
    }
    Ok(request)
}

pub fn parse_model_response(value: &Value) -> Result<ModelResponse, ParseError> {
    let response: ModelResponse = from_strict(value)?;
    response
        .tool_calls
        .iter()
        .try_for_each(validate_tool_call)?;
    if let Some(usage) = &response.usage {
        validate_usage(usage)?;
    }
    if let Some(cont) = &response.provider_continuation {
        validate_continuation(cont)?;
    }
    Ok(response)
}

pub fn parse_chat_stream_event(value: &Value) -> Result<ChatStreamEvent, ParseError> {
    let event: ChatStreamEvent = from_strict(value)?;
    match &event {
        ChatStreamEvent::ToolProposed { call } => validate_tool_call(call)?,
        ChatStreamEvent::Usage { usage } => validate_usage(usage)?,
        ChatStreamEvent::Done {
            provider_continuation: Some(cont),
            ..
        } => validate_continuation(cont)?,
        ChatStreamEvent::Error { error }
            if !ZERO_ERROR_CODES
                .iter()
                .any(|code| code.as_str() == error.code) =>
        {
            return Err(ParseError::new("unknown error code"));
        }
        _ => {}
    }
    Ok(event)
}

pub fn parse_model_capability_overrides(
    value: &Value,
) -> Result<ModelCapabilityOverrides, ParseError> {
    let overrides: ModelCapabilityOverrides = from_strict(value)?;
    validate_caps(overrides.context_window, overrides.max_output_tokens)?;
    Ok(overrides)
}

pub fn parse_model_record(value: &Value) -> Result<ModelRecord, ParseError> {
    let record: ModelRecord = from_strict(value)?;
    require_model_ref(&record.model_ref)?;
    require_uuid(&record.provider_id)?;
    require_len(&record.model_id, 1, 300)?;
    require_len(&record.label, 1, 300)?;
    validate_caps(
        record.capabilities.context_window,
        record.capabilities.max_output_tokens,
    )?;
    for tag in &record.tags {
        require_len(tag, 1, 100)?;
    }
    Ok(record)
}

pub fn parse_zero_message(value: &Value) -> Result<ZeroMessage, ParseError> {
    let message: ZeroMessage = from_strict(value)?;
    validate_message(&message)?;
    Ok(message)
}

pub fn provider_uuid_from_model_ref(model_ref: &str) -> Option<&str> {
    let idx = model_ref.find(':')?;
    let left = &model_ref[..idx];
    is_uuid(left).then_some(left)
}
