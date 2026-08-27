use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::validate::{from_strict, require_len, require_model_ref, require_uuid, ParseError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Todo,
    InProgress,
    Blocked,
    Done,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskPriority {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionCommandInput {
    pub request_id: String,
    pub text: String,
    #[serde(default)]
    pub model_ref: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionCommandRequest {
    pub correlation_id: String,
    pub input: ActionCommandInput,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovalResolveInput {
    pub approval_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovalResolveRequest {
    pub correlation_id: String,
    pub input: ApprovalResolveInput,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskUpdateInput {
    pub task_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<TaskStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<TaskPriority>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_at: Option<Option<String>>,
}

pub fn parse_action_command_request(value: &Value) -> Result<ActionCommandRequest, ParseError> {
    let request: ActionCommandRequest = from_strict(value)?;
    require_uuid(&request.correlation_id)?;
    require_uuid(&request.input.request_id)?;
    let text = request.input.text.trim();
    if text.is_empty() || text.len() > 2_000 {
        return Err(ParseError::new("text"));
    }
    if let Some(model_ref) = &request.input.model_ref {
        require_model_ref(model_ref)?;
    }
    Ok(request)
}

pub fn parse_approval_resolve_request(value: &Value) -> Result<ApprovalResolveRequest, ParseError> {
    let request: ApprovalResolveRequest = from_strict(value)?;
    require_uuid(&request.correlation_id)?;
    require_uuid(&request.input.approval_id)?;
    Ok(request)
}

pub fn parse_task_update_input(value: &Value) -> Result<TaskUpdateInput, ParseError> {
    let input: TaskUpdateInput = from_strict(value)?;
    require_uuid(&input.task_id)?;
    if input.title.is_none()
        && input.description.is_none()
        && input.status.is_none()
        && input.priority.is_none()
        && input.due_at.is_none()
    {
        return Err(ParseError::new(
            "Task update requires at least one changed field",
        ));
    }
    if let Some(title) = &input.title {
        require_len(title.trim(), 1, 500)?;
    }
    Ok(input)
}
