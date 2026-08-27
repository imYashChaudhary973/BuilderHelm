use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::ModelError;
use crate::validate::{from_strict, require_len, require_uuid, ParseError};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorFile {
    pub path: String,
    pub name: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorEntry {
    pub path: String,
    pub name: String,
    pub kind: EditorKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditorKind {
    File,
    Dir,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorReadInput {
    pub root: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorReadRequest {
    pub correlation_id: String,
    pub input: EditorReadInput,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorListInput {
    pub root: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EditorIpcResult<T> {
    Ok { ok: bool, value: T },
    Err { ok: bool, error: ModelError },
}

fn path(value: &str) -> Result<(), ParseError> {
    require_len(value, 1, 4096)
}

pub fn parse_editor_read_input(value: &Value) -> Result<EditorReadInput, ParseError> {
    let input: EditorReadInput = from_strict(value)?;
    path(&input.root)?;
    path(&input.path)?;
    Ok(input)
}

pub fn parse_editor_read_request(value: &Value) -> Result<EditorReadRequest, ParseError> {
    let request: EditorReadRequest = from_strict(value)?;
    require_uuid(&request.correlation_id)?;
    path(&request.input.root)?;
    path(&request.input.path)?;
    Ok(request)
}

pub fn parse_editor_list_input(value: &Value) -> Result<EditorListInput, ParseError> {
    let input: EditorListInput = from_strict(value)?;
    path(&input.root)?;
    if let Some(p) = &input.path {
        path(p)?;
    }
    Ok(input)
}

pub fn parse_editor_read_ipc_response(
    value: &Value,
) -> Result<EditorIpcResult<EditorFile>, ParseError> {
    let parsed: EditorIpcResult<EditorFile> = from_strict(value)?;
    if let EditorIpcResult::Ok { value, .. } = &parsed {
        path(&value.path)?;
        path(&value.name)?;
    }
    Ok(parsed)
}

pub fn parse_editor_pick_ipc_response(
    value: &Value,
) -> Result<EditorIpcResult<Option<EditorFile>>, ParseError> {
    from_strict(value)
}

pub fn parse_editor_list_ipc_response(
    value: &Value,
) -> Result<EditorIpcResult<Vec<EditorEntry>>, ParseError> {
    from_strict(value)
}

pub fn parse_editor_git_ipc_response(
    value: &Value,
) -> Result<EditorIpcResult<Option<Value>>, ParseError> {
    from_strict(value)
}
