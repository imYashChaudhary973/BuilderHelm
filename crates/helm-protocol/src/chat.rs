use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{
    parse_model_error, parse_token_usage, provider_uuid_from_model_ref, ChatStreamEvent,
    FinishReason, MessageRole, ModelContentPart, ModelError, ProviderContinuation, TokenUsage,
};
use crate::validate::{
    from_strict, is_uuid, require_datetime, require_len, require_model_ref, require_uuid,
    ParseError,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatThread {
    pub id: String,
    pub title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatTurn {
    pub id: String,
    pub thread_id: String,
    pub ordinal: i64,
    pub role: MessageRole,
    pub content: Vec<ModelContentPart>,
    pub model_ref: Option<String>,
    pub finish_reason: Option<FinishReason>,
    pub provider_continuation: Option<ProviderContinuation>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatUsageRecord {
    pub id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub provider_id: String,
    pub model_ref: String,
    pub usage: TokenUsage,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatTranscript {
    pub thread: ChatThread,
    pub turns: Vec<ChatTurn>,
    pub usage: Vec<ChatUsageRecord>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateChatThreadInput {
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppendChatTurnInput {
    pub thread_id: String,
    pub role: MessageRole,
    pub content: Vec<ModelContentPart>,
    #[serde(default)]
    pub model_ref: Option<String>,
    #[serde(default)]
    pub finish_reason: Option<FinishReason>,
    #[serde(default)]
    pub provider_continuation: Option<ProviderContinuation>,
    #[serde(default)]
    pub usage: Option<TokenUsage>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatStreamInput {
    pub thread_id: String,
    pub model_ref: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatStreamStartRequest {
    pub correlation_id: String,
    pub run_id: String,
    pub input: ChatStreamInput,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ChatClientStreamEvent {
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
        call: crate::model::NormalizedToolCall,
    },
    Usage {
        usage: TokenUsage,
    },
    Done {
        #[serde(rename = "finishReason")]
        finish_reason: FinishReason,
    },
    Error {
        error: ModelError,
    },
}

fn chat_content(content: &[ModelContentPart]) -> Result<(), ParseError> {
    if content.is_empty() || content.len() > 10_000 {
        return Err(ParseError::new("content length"));
    }
    let serialized = serde_json::to_string(content).map_err(|err| ParseError(err.to_string()))?;
    if serialized.len() > 4_000_000 {
        return Err(ParseError::new(
            "Chat turn content exceeds the 4 MB persistence limit",
        ));
    }
    Ok(())
}

pub fn parse_create_chat_thread_input(value: &Value) -> Result<CreateChatThreadInput, ParseError> {
    let mut input: CreateChatThreadInput = from_strict(value)?;
    if let Some(title) = input.title.take() {
        let trimmed = title.trim();
        if trimmed.is_empty() || trimmed.len() > 200 {
            return Err(ParseError::new("title"));
        }
        input.title = Some(trimmed.to_string());
    }
    Ok(input)
}

pub fn parse_append_chat_turn_input(value: &Value) -> Result<AppendChatTurnInput, ParseError> {
    let input: AppendChatTurnInput = from_strict(value)?;
    require_uuid(&input.thread_id)?;
    chat_content(&input.content)?;
    if let Some(model_ref) = &input.model_ref {
        require_model_ref(model_ref)?;
    }
    if let Some(cont) = &input.provider_continuation {
        require_uuid(&cont.provider_id)?;
        require_len(&cont.response_id, 1, 1_000)?;
    }
    if let Some(usage) = &input.usage {
        parse_token_usage(&serde_json::to_value(usage).unwrap())?;
    }
    let assistant_meta = [
        input.model_ref.is_some(),
        input.finish_reason.is_some(),
        input.provider_continuation.is_some(),
        input.usage.is_some(),
    ];
    if input.role == MessageRole::Assistant {
        let Some(model_ref) = &input.model_ref else {
            return Err(ParseError::new(
                "Assistant turns require the selected model reference",
            ));
        };
        let prefix = model_ref
            .split_once(':')
            .map(|(left, _)| left)
            .unwrap_or("");
        if !is_uuid(prefix) {
            return Err(ParseError::new(
                "Assistant model references must begin with a provider UUID",
            ));
        }
        if input.finish_reason.is_none() {
            return Err(ParseError::new("Assistant turns require a finish reason"));
        }
        if let Some(cont) = &input.provider_continuation {
            if !model_ref.starts_with(&format!("{}:", cont.provider_id)) {
                return Err(ParseError::new(
                    "Continuation provider must match the selected model",
                ));
            }
        }
    } else if assistant_meta.iter().any(|v| *v) {
        return Err(ParseError::new(
            "Only assistant turns may include model response metadata",
        ));
    }
    Ok(input)
}

pub fn parse_chat_stream_start_request(
    value: &Value,
) -> Result<ChatStreamStartRequest, ParseError> {
    let request: ChatStreamStartRequest = from_strict(value)?;
    require_uuid(&request.correlation_id)?;
    require_uuid(&request.run_id)?;
    require_uuid(&request.input.thread_id)?;
    require_model_ref(&request.input.model_ref)?;
    let text = request.input.text.trim();
    if text.is_empty() || text.len() > 100_000 {
        return Err(ParseError::new("text"));
    }
    Ok(request)
}

pub fn parse_chat_client_stream_event(value: &Value) -> Result<ChatClientStreamEvent, ParseError> {
    let event: ChatClientStreamEvent = from_strict(value)?;
    if let ChatClientStreamEvent::Error { error } = &event {
        parse_model_error(&serde_json::to_value(error).unwrap())?;
    }
    if let ChatClientStreamEvent::Usage { usage } = &event {
        parse_token_usage(&serde_json::to_value(usage).unwrap())?;
    }
    Ok(event)
}

pub fn parse_chat_thread(value: &Value) -> Result<ChatThread, ParseError> {
    let thread: ChatThread = from_strict(value)?;
    require_uuid(&thread.id)?;
    require_datetime(&thread.created_at)?;
    require_datetime(&thread.updated_at)?;
    Ok(thread)
}

pub fn parse_chat_stream_event_for_client(value: &Value) -> Result<ChatStreamEvent, ParseError> {
    crate::model::parse_chat_stream_event(value)
}

pub fn provider_uuid_prefix(model_ref: &str) -> Option<&str> {
    provider_uuid_from_model_ref(model_ref)
}
