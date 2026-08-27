use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::validate::{from_strict, require_datetime, require_uuid, ParseError};

pub struct IpcChannels {
    pub system_health: &'static str,
    pub provider_list: &'static str,
    pub provider_create: &'static str,
    pub provider_update: &'static str,
    pub provider_delete: &'static str,
    pub provider_test_connection: &'static str,
    pub model_discover: &'static str,
    pub model_list: &'static str,
    pub model_capability_override_list: &'static str,
    pub model_capability_override_update: &'static str,
    pub knowledge_vault_list: &'static str,
    pub knowledge_vault_select: &'static str,
    pub knowledge_vault_sync: &'static str,
    pub knowledge_query: &'static str,
    pub knowledge_source_get: &'static str,
    pub action_snapshot: &'static str,
    pub action_command: &'static str,
    pub action_approve: &'static str,
    pub action_reject: &'static str,
    pub action_policy_update: &'static str,
    pub project_dashboard: &'static str,
    pub project_repository_select: &'static str,
    pub project_repository_refresh: &'static str,
    pub chat_list: &'static str,
    pub chat_create: &'static str,
    pub chat_get: &'static str,
    pub chat_stream_start: &'static str,
    pub chat_stream_cancel: &'static str,
    pub chat_stream_event: &'static str,
    pub board_create: &'static str,
    pub board_event: &'static str,
    pub board_write: &'static str,
    pub board_resize: &'static str,
    pub board_pane_close: &'static str,
    pub board_pane_add: &'static str,
    pub board_pane_drain: &'static str,
    pub board_home_dir: &'static str,
    pub board_select_folder: &'static str,
    pub board_detect_agents: &'static str,
    pub board_preset_list: &'static str,
    pub board_preset_save: &'static str,
    pub board_preset_delete: &'static str,
    pub board_land: &'static str,
    pub board_land_preview: &'static str,
    pub swarm_create: &'static str,
    pub swarm_state: &'static str,
    pub swarm_direct: &'static str,
    pub swarm_task_update: &'static str,
    pub swarm_stop: &'static str,
    pub swarm_stop_seat: &'static str,
    pub swarm_add_seat: &'static str,
    pub swarm_latest: &'static str,
    pub swarm_event: &'static str,
    pub kanban_project_list: &'static str,
    pub kanban_project_create: &'static str,
    pub kanban_list: &'static str,
    pub kanban_create: &'static str,
    pub kanban_move: &'static str,
    pub kanban_update: &'static str,
    pub kanban_delete: &'static str,
    pub browser_command: &'static str,
    pub editor_pick: &'static str,
    pub editor_read: &'static str,
    pub editor_list: &'static str,
    pub editor_git: &'static str,
    pub editor_write: &'static str,
    pub editor_create: &'static str,
    pub editor_search: &'static str,
    pub editor_git_stage: &'static str,
    pub editor_git_commit: &'static str,
    pub helm: &'static str,
}

pub const IPC_CHANNELS: IpcChannels = IpcChannels {
    system_health: "zero:system:health",
    provider_list: "zero:provider:list",
    provider_create: "zero:provider:create",
    provider_update: "zero:provider:update",
    provider_delete: "zero:provider:delete",
    provider_test_connection: "zero:provider:test-connection",
    model_discover: "zero:model:discover",
    model_list: "zero:model:list",
    model_capability_override_list: "zero:model-capability-override:list",
    model_capability_override_update: "zero:model-capability-override:update",
    knowledge_vault_list: "zero:knowledge:vault-list",
    knowledge_vault_select: "zero:knowledge:vault-select",
    knowledge_vault_sync: "zero:knowledge:vault-sync",
    knowledge_query: "zero:knowledge:query",
    knowledge_source_get: "zero:knowledge:source-get",
    action_snapshot: "zero:action:snapshot",
    action_command: "zero:action:command",
    action_approve: "zero:action:approve",
    action_reject: "zero:action:reject",
    action_policy_update: "zero:action:policy-update",
    project_dashboard: "zero:project:dashboard",
    project_repository_select: "zero:project:repository-select",
    project_repository_refresh: "zero:project:repository-refresh",
    chat_list: "zero:chat:list",
    chat_create: "zero:chat:create",
    chat_get: "zero:chat:get",
    chat_stream_start: "zero:chat:stream-start",
    chat_stream_cancel: "zero:chat:stream-cancel",
    chat_stream_event: "zero:chat:stream-event",
    board_create: "zero:board:create",
    board_event: "zero:board:event",
    board_write: "zero:board:write",
    board_resize: "zero:board:resize",
    board_pane_close: "zero:board:pane-close",
    board_pane_add: "zero:board:pane-add",
    board_pane_drain: "zero:board:pane-drain",
    board_home_dir: "zero:board:home-dir",
    board_select_folder: "zero:board:select-folder",
    board_detect_agents: "zero:board:detect-agents",
    board_preset_list: "zero:board:preset-list",
    board_preset_save: "zero:board:preset-save",
    board_preset_delete: "zero:board:preset-delete",
    board_land: "zero:board:land",
    board_land_preview: "zero:board:land-preview",
    swarm_create: "zero:swarm:create",
    swarm_state: "zero:swarm:state",
    swarm_direct: "zero:swarm:direct",
    swarm_task_update: "zero:swarm:task-update",
    swarm_stop: "zero:swarm:stop",
    swarm_stop_seat: "zero:swarm:stop-seat",
    swarm_add_seat: "zero:swarm:add-seat",
    swarm_latest: "zero:swarm:latest",
    swarm_event: "zero:swarm:event",
    kanban_project_list: "zero:kanban:project-list",
    kanban_project_create: "zero:kanban:project-create",
    kanban_list: "zero:kanban:list",
    kanban_create: "zero:kanban:create",
    kanban_move: "zero:kanban:move",
    kanban_update: "zero:kanban:update",
    kanban_delete: "zero:kanban:delete",
    browser_command: "zero:browser:command",
    editor_pick: "zero:editor:pick",
    editor_read: "zero:editor:read",
    editor_list: "zero:editor:list",
    editor_git: "zero:editor:git",
    editor_write: "zero:editor:write",
    editor_create: "zero:editor:create",
    editor_search: "zero:editor:search",
    editor_git_stage: "zero:editor:git-stage",
    editor_git_commit: "zero:editor:git-commit",
    helm: "zero:helm",
};

pub fn ipc_channel_count() -> usize {
    71
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SystemHealthRequest {
    pub correlation_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SystemHealthResponse {
    pub status: String,
    pub database: String,
    pub occurred_at: String,
    pub correlation_id: String,
}

pub fn parse_system_health_request(value: &Value) -> Result<SystemHealthRequest, ParseError> {
    let request: SystemHealthRequest = from_strict(value)?;
    require_uuid(&request.correlation_id)?;
    Ok(request)
}

pub fn parse_system_health_response(value: &Value) -> Result<SystemHealthResponse, ParseError> {
    let response: SystemHealthResponse = from_strict(value)?;
    if response.status != "ok" || response.database != "ready" {
        return Err(ParseError::new("health"));
    }
    require_datetime(&response.occurred_at)?;
    require_uuid(&response.correlation_id)?;
    Ok(response)
}
