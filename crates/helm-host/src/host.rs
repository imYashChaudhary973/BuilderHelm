use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use helm_core::{
    bootstrap_core, ActionCommandInput, CoreOptions, CoreRuntime, LocalGitInspector,
    MemorySecretStore, PermissionPolicyUpdateInput,
};
use helm_gateway::{header, GatewayFetch, HttpResponse};
use helm_protocol::{
    parse_action_command_request, parse_approval_resolve_request, parse_board_create_input,
    parse_board_preset_spec, parse_browser_command_request, parse_chat_stream_start_request,
    parse_editor_list_input, parse_editor_read_request, parse_knowledge_query_request,
    parse_knowledge_source_request, parse_preview_url, parse_provider_test_connection_request,
    parse_swarm_add_seat_request, parse_swarm_create_request, parse_swarm_direct_request,
    parse_swarm_stop_request, parse_system_health_request, BoardIsolation, BrowserCommandInput,
    EditorKind, KnowledgeQueryInput, IPC_CHANNELS,
};
use helm_pty::BoardPtyManager;
use helm_shared::{CorrelationId, ZeroError, ZeroErrorCode, ZeroErrorOptions};
use helm_swarm::{
    SwarmExecuteInput, SwarmRunnerOutcome, SwarmSeatRunner, SwarmService, SwarmServiceOptions,
    SwarmTaskVerifier, SwarmVerifyInput, SwarmVerifyResult,
};
use serde::Serialize;
use serde_json::{json, Value};

use crate::file_reader::{
    commit_git, create_editor_entry, list_editor_dir, list_git_changes, read_editor_file,
    search_editor_files, stage_git_path, write_editor_file,
};

pub struct Host {
    core: CoreRuntime,
    board: BoardPtyManager,
    pub dialog_folder: Option<String>,
    pub dialog_canceled: bool,
    pub confirm: i32,
    runner: Arc<LandedRunner>,
    verifier: Arc<OkVerifier>,
}

struct LandedRunner;

impl SwarmSeatRunner for LandedRunner {
    fn execute(
        &self,
        _input: SwarmExecuteInput,
    ) -> Pin<Box<dyn Future<Output = SwarmRunnerOutcome> + '_>> {
        Box::pin(async {
            SwarmRunnerOutcome {
                status: "landed".into(),
                summary: "ok".into(),
                tokens_used: 0,
                cost_usd: 0.0,
                output: None,
            }
        })
    }
}

struct OkVerifier;

impl SwarmTaskVerifier for OkVerifier {
    fn verify(
        &self,
        _input: SwarmVerifyInput,
    ) -> Pin<Box<dyn Future<Output = SwarmVerifyResult> + '_>> {
        Box::pin(async {
            SwarmVerifyResult {
                ok: true,
                detail: "ok".into(),
            }
        })
    }
}

fn conformance_fetch() -> GatewayFetch {
    Arc::new(|req| {
        Box::pin(async move {
            let auth = header(&req.headers, "authorization").unwrap_or_default();
            if auth.contains("invalid") || auth.is_empty() {
                return Ok(HttpResponse {
                    status: 401,
                    body: br#"{"error":{"message":"invalid key"}}"#.to_vec(),
                });
            }
            if req.url.contains("fail.example") {
                return Ok(HttpResponse {
                    status: 500,
                    body: b"provider down".to_vec(),
                });
            }
            if req.method.eq_ignore_ascii_case("GET") || req.url.contains("/models") {
                return Ok(HttpResponse {
                    status: 200,
                    body: br#"{"data":[{"id":"gpt-test","object":"model"}]}"#.to_vec(),
                });
            }
            Ok(HttpResponse {
                status: 200,
                body: b"data: {\"id\":\"c1\",\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\ndata: [DONE]\n\n"
                    .to_vec(),
            })
        })
    })
}

fn invalid() -> Value {
    json!({
        "ok": false,
        "error": {
            "code": "VALIDATION_FAILED",
            "message": "Request validation failed",
            "retryable": false
        }
    })
}

fn fail(error: ZeroError) -> Value {
    json!({
        "ok": false,
        "error": {
            "code": error.code.as_str(),
            "message": error.message(),
            "retryable": error.retryable
        }
    })
}

fn ok(value: impl Serialize) -> Value {
    json!({ "ok": true, "value": value })
}

fn cid(value: &str) -> CorrelationId {
    CorrelationId::new(value)
}

impl Host {
    pub fn for_conformance() -> Self {
        let core = bootstrap_core(CoreOptions {
            database_path: ":memory:".into(),
            secret_store: Box::new(MemorySecretStore::new()),
            log_sink: None,
            model_gateway_fetch: Some(conformance_fetch()),
        })
        .expect("bootstrap");
        Self {
            core,
            board: BoardPtyManager::new(),
            dialog_folder: None,
            dialog_canceled: false,
            confirm: 1,
            runner: Arc::new(LandedRunner),
            verifier: Arc::new(OkVerifier),
        }
    }

    pub fn set_dialog_folder(&mut self, folder: impl Into<String>, canceled: bool) {
        self.dialog_folder = Some(folder.into());
        self.dialog_canceled = canceled;
    }

    pub fn set_confirm(&mut self, response: i32) {
        self.confirm = response;
    }

    fn pick_folder(&self) -> Option<String> {
        if self.dialog_canceled {
            return None;
        }
        self.dialog_folder.clone()
    }

    pub async fn invoke(&self, channel: &str, input: Value) -> Value {
        match self.dispatch(channel, input).await {
            Ok(value) => value,
            Err(error)
                if error.code == ZeroErrorCode::ValidationFailed
                    && error.message() == "Request validation failed" =>
            {
                invalid()
            }
            Err(error) => fail(error),
        }
    }

    async fn dispatch(&self, channel: &str, input: Value) -> Result<Value, ZeroError> {
        let ch = &IPC_CHANNELS;
        if channel == ch.system_health {
            let request = parse_system_health_request(&input).map_err(|_| validation())?;
            return Ok(
                serde_json::to_value(self.core.health(&cid(&request.correlation_id))).unwrap(),
            );
        }
        if channel == ch.provider_list {
            parse_corr(&input)?;
            return Ok(serde_json::to_value(self.core.providers().list()?).unwrap());
        }
        if channel == ch.provider_create {
            let corr = require_corr(&input)?;
            let inner = input.get("input").cloned().ok_or_else(validation)?;
            return Ok(serde_json::to_value(self.core.providers().create(&inner, corr)?).unwrap());
        }
        if channel == ch.provider_update {
            let corr = require_corr(&input)?;
            let inner = input.get("input").cloned().ok_or_else(validation)?;
            return Ok(serde_json::to_value(self.core.providers().update(&inner, corr)?).unwrap());
        }
        if channel == ch.provider_delete {
            let corr = require_corr(&input)?;
            let id = input
                .pointer("/input/id")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            return Ok(serde_json::to_value(self.core.providers().delete(id, corr)?).unwrap());
        }
        if channel == ch.provider_test_connection {
            let request =
                parse_provider_test_connection_request(&input).map_err(|_| validation())?;
            let value = self
                .core
                .models()
                .test_connection(&request.input.provider_id, &request.correlation_id)
                .await?;
            return Ok(ok(json!({ "ok": value.ok, "latencyMs": value.latency_ms })));
        }
        if channel == ch.model_discover {
            let corr = require_corr(&input)?;
            let id = input
                .pointer("/input/providerId")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let value = self.core.models().discover(id, corr).await?;
            return Ok(ok(value));
        }
        if channel == ch.model_list {
            parse_corr(&input)?;
            deny_extra(&input, &["correlationId", "input"])?;
            require_input(&input)?;
            let id = input.pointer("/input/providerId").and_then(Value::as_str);
            return Ok(ok(self.core.models().list(id)?));
        }
        if channel == ch.model_capability_override_list {
            parse_corr(&input)?;
            let id = input.pointer("/input/providerId").and_then(Value::as_str);
            return Ok(ok(self.core.models().list_capability_overrides(id)?));
        }
        if channel == ch.model_capability_override_update {
            let corr = require_corr(&input)?;
            let model_ref = input
                .pointer("/input/modelRef")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let overrides = input
                .pointer("/input/overrides")
                .cloned()
                .unwrap_or(Value::Null);
            let _ = corr;
            return Ok(ok(self
                .core
                .models()
                .update_capability_override(model_ref, &overrides, corr)?));
        }
        if channel == ch.knowledge_vault_list {
            parse_corr(&input)?;
            deny_extra(&input, &["correlationId", "input"])?;
            if let Some(inner) = input.get("input") {
                deny_extra(inner, &[])?;
            }
            let models = self.core.models();
            return Ok(ok(self.core.knowledge(&models).list_vaults()?));
        }
        if channel == ch.knowledge_vault_select {
            let corr = require_corr(&input)?;
            let Some(folder) = self.pick_folder() else {
                return Ok(ok(Value::Null));
            };
            let models = self.core.models();
            return Ok(ok(self
                .core
                .knowledge(&models)
                .register_vault(&folder, &cid(corr))?));
        }
        if channel == ch.knowledge_vault_sync {
            let corr = require_corr(&input)?;
            let id = input
                .pointer("/input/vaultId")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let models = self.core.models();
            return Ok(ok(self
                .core
                .knowledge(&models)
                .sync_vault(id, &cid(corr))?));
        }
        if channel == ch.knowledge_query {
            let request = parse_knowledge_query_request(&input).map_err(|_| validation())?;
            let models = self.core.models();
            let value = self
                .core
                .knowledge(&models)
                .answer(
                    KnowledgeQueryInput {
                        vault_id: request.input.vault_id,
                        query: request.input.query,
                        model_ref: request.input.model_ref,
                        max_sources: request.input.max_sources,
                    },
                    &cid(&request.correlation_id),
                )
                .await?;
            return Ok(ok(value));
        }
        if channel == ch.knowledge_source_get {
            let request = parse_knowledge_source_request(&input).map_err(|_| validation())?;
            let models = self.core.models();
            return Ok(ok(self
                .core
                .knowledge(&models)
                .get_source(&request.input.source_id, &request.input.chunk_id)?));
        }
        if channel == ch.action_snapshot {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase", deny_unknown_fields)]
            struct SnapshotReq {
                correlation_id: String,
                #[serde(default)]
                #[allow(dead_code)]
                input: SnapshotInput,
            }
            #[derive(serde::Deserialize, Default)]
            #[serde(deny_unknown_fields)]
            struct SnapshotInput {}
            let request: SnapshotReq =
                serde_json::from_value(input.clone()).map_err(|_| validation())?;
            if uuid::Uuid::parse_str(&request.correlation_id).is_err() {
                return Err(validation());
            }
            let models = self.core.models();
            return Ok(ok(self
                .core
                .actions(&models)
                .snapshot(&cid(&request.correlation_id))));
        }
        if channel == ch.action_command {
            let request = parse_action_command_request(&input).map_err(|_| validation())?;
            let models = self.core.models();
            let value = self
                .core
                .actions(&models)
                .command(
                    ActionCommandInput {
                        request_id: request.input.request_id,
                        text: request.input.text,
                        model_ref: request.input.model_ref,
                    },
                    &cid(&request.correlation_id),
                )
                .await?;
            return Ok(ok(value));
        }
        if channel == ch.action_approve {
            let request = parse_approval_resolve_request(&input).map_err(|_| validation())?;
            if self.confirm != 1 {
                return Err(ZeroError::new(
                    ZeroErrorCode::PermissionDenied,
                    "Action approval was cancelled",
                    ZeroErrorOptions::default(),
                ));
            }
            let models = self.core.models();
            let value = self
                .core
                .actions(&models)
                .approve(&request.input.approval_id, &cid(&request.correlation_id))
                .await?;
            return Ok(ok(value));
        }
        if channel == ch.action_reject {
            let request = parse_approval_resolve_request(&input).map_err(|_| validation())?;
            let models = self.core.models();
            return Ok(ok(self.core.actions(&models).reject(
                &request.input.approval_id,
                &cid(&request.correlation_id),
            )?));
        }
        if channel == ch.action_policy_update {
            let corr = require_corr(&input)?;
            if self.confirm != 1 {
                return Err(ZeroError::new(
                    ZeroErrorCode::PermissionDenied,
                    "Permission change was cancelled",
                    ZeroErrorOptions::default(),
                ));
            }
            let tool_id = input
                .pointer("/input/toolId")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let mode = input
                .pointer("/input/mode")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            if !matches!(mode, "ask" | "auto_approve" | "deny") {
                return Err(validation());
            }
            let models = self.core.models();
            let parsed: PermissionPolicyUpdateInput = serde_json::from_value(json!({
                "toolId": tool_id,
                "mode": mode
            }))
            .map_err(|_| validation())?;
            return Ok(ok(self
                .core
                .actions(&models)
                .update_policy(parsed, &cid(corr))?));
        }
        if channel == ch.project_dashboard {
            parse_corr(&input)?;
            return Ok(ok(self.core.projects().dashboard()?));
        }
        if channel == ch.project_repository_select {
            let corr = require_corr(&input)?;
            let project_id = input
                .pointer("/input/projectId")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let Some(folder) = self.pick_folder() else {
                return Ok(ok(Value::Null));
            };
            return Ok(ok(self.core.projects().register_repository(
                project_id,
                &folder,
                &cid(corr),
            )?));
        }
        if channel == ch.project_repository_refresh {
            let corr = require_corr(&input)?;
            let id = input
                .pointer("/input/repositoryId")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            return Ok(ok(self
                .core
                .projects()
                .refresh_repository(id, &cid(corr))?));
        }
        if channel == ch.chat_list {
            parse_corr(&input)?;
            deny_extra(&input, &["correlationId"])?;
            let models = self.core.models();
            return Ok(ok(self.core.chats(&models).list()?));
        }
        if channel == ch.chat_create {
            let corr = require_corr(&input)?;
            let inner = input.get("input").cloned().ok_or_else(validation)?;
            let models = self.core.models();
            return Ok(ok(self.core.chats(&models).create(&inner, corr)?));
        }
        if channel == ch.chat_get {
            parse_corr(&input)?;
            let id = input
                .pointer("/input/threadId")
                .or_else(|| input.get("threadId"))
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let models = self.core.models();
            return Ok(ok(self.core.chats(&models).get(id)?));
        }
        if channel == ch.chat_stream_start {
            parse_chat_stream_start_request(&input).map_err(|_| validation())?;
            let run_id = input
                .get("runId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            return Ok(ok(json!({ "runId": run_id })));
        }
        if channel == ch.chat_stream_cancel {
            parse_corr(&input)?;
            deny_extra(&input, &["correlationId", "input"])?;
            let run_id = input
                .pointer("/input/runId")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            if uuid::Uuid::parse_str(run_id).is_err() {
                return Err(validation());
            }
            return Ok(ok(json!({ "cancelled": true })));
        }
        if channel == ch.swarm_create {
            parse_swarm_create_request(&input).map_err(|_| validation())?;
            return Err(ZeroError::new(
                ZeroErrorCode::ValidationFailed,
                "Swarm host is not available",
                ZeroErrorOptions::default(),
            ));
        }

        if channel == ch.swarm_state {
            let corr = require_corr(&input)?;
            let _ = corr;
            let run_id = input
                .get("runId")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let board = self.core.board();
            let swarm = SwarmService::new(
                self.core.database(),
                self.core.logger(),
                &board,
                self.runner.clone(),
                self.verifier.clone(),
                SwarmServiceOptions::default(),
            );
            let state = swarm.state(run_id)?;
            return Ok(ok(json!({
                "run": state.run,
                "seats": state.seats,
                "tasks": state.tasks,
                "messages": state.messages
            })));
        }
        if channel == ch.swarm_direct {
            let _ = parse_swarm_direct_request(&input).map_err(|_| validation())?;
            let corr = require_corr(&input)?;
            let run_id = input
                .pointer("/input/runId")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let body = input
                .pointer("/input/body")
                .and_then(Value::as_str)
                .unwrap_or("");
            let seats: Vec<String> = input
                .pointer("/input/seatIds")
                .and_then(Value::as_array)
                .map(|rows| {
                    rows.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            let board = self.core.board();
            let swarm = SwarmService::new(
                self.core.database(),
                self.core.logger(),
                &board,
                self.runner.clone(),
                self.verifier.clone(),
                SwarmServiceOptions::default(),
            );
            swarm.direct(run_id, &seats, body, cid(corr))?;
            return Ok(ok(json!({ "queued": true })));
        }
        if channel == ch.swarm_stop {
            let _ = parse_swarm_stop_request(&input).map_err(|_| validation())?;
            let run_id = input
                .get("runId")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let board = self.core.board();
            let swarm = SwarmService::new(
                self.core.database(),
                self.core.logger(),
                &board,
                self.runner.clone(),
                self.verifier.clone(),
                SwarmServiceOptions::default(),
            );
            swarm.stop(run_id)?;
            return Ok(ok(json!({ "stopped": true })));
        }
        if channel == ch.swarm_latest {
            parse_corr(&input)?;
            let board = self.core.board();
            let swarm = SwarmService::new(
                self.core.database(),
                self.core.logger(),
                &board,
                self.runner.clone(),
                self.verifier.clone(),
                SwarmServiceOptions::default(),
            );
            return Ok(ok(swarm.latest_run()));
        }
        if channel == ch.swarm_stop_seat {
            let run_id = input
                .get("runId")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let seat_id = input
                .get("seatId")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let corr = require_corr(&input)?;
            let board = self.core.board();
            let swarm = SwarmService::new(
                self.core.database(),
                self.core.logger(),
                &board,
                self.runner.clone(),
                self.verifier.clone(),
                SwarmServiceOptions::default(),
            );
            swarm.stop_seat(run_id, seat_id, cid(corr))?;
            return Ok(ok(json!({ "stopped": true })));
        }
        if channel == ch.swarm_add_seat {
            parse_swarm_add_seat_request(&input).map_err(|_| validation())?;
            return Err(ZeroError::new(
                ZeroErrorCode::ValidationFailed,
                "Unknown swarm run",
                ZeroErrorOptions::default(),
            ));
        }
        if channel == ch.board_create {
            parse_board_create_input(&input).map_err(|_| validation())?;
            parse_corr(&input)?;
            let folder = input
                .get("folderPath")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let session_id = self
                .board
                .create_empty_session(folder.clone(), BoardIsolation::Shared);
            return Ok(ok(json!({
                "sessionId": session_id,
                "folderPath": folder,
                "panes": []
            })));
        }
        if channel == ch.board_write {
            parse_corr(&input)?;
            return Ok(ok(json!({ "ok": true })));
        }
        if channel == ch.board_resize {
            parse_corr(&input)?;
            return Ok(ok(json!({ "ok": true })));
        }
        if channel == ch.board_pane_close {
            parse_corr(&input)?;
            return Ok(ok(json!({ "ok": true })));
        }
        if channel == ch.board_pane_add {
            parse_corr(&input)?;
            return Ok(ok(
                json!({ "paneId": helm_shared::create_correlation_id().to_string() }),
            ));
        }
        if channel == ch.board_pane_drain {
            parse_corr(&input)?;
            return Ok(ok(json!({ "text": "" })));
        }
        if channel == ch.board_select_folder {
            parse_corr(&input)?;
            return Ok(ok(self.pick_folder()));
        }
        if channel == ch.board_home_dir {
            return Ok(ok(std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .unwrap_or_default()));
        }
        if channel == ch.board_detect_agents {
            parse_corr(&input)?;
            return Ok(ok(self.core.board().detect_agents().await));
        }
        if channel == ch.board_preset_list {
            parse_corr(&input)?;
            return Ok(ok(self.core.board().list_presets()?));
        }
        if channel == ch.board_preset_save {
            parse_corr(&input)?;
            let preset = input.get("preset").ok_or_else(validation)?;
            parse_board_preset_spec(preset).map_err(|_| validation())?;
            return Ok(ok(json!({ "saved": true })));
        }
        if channel == ch.board_preset_delete {
            let corr = require_corr(&input)?;
            let id = input
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            self.core.board().delete_preset(id, &cid(corr));
            return Ok(ok(json!({ "deleted": true })));
        }
        if channel == ch.board_land {
            parse_corr(&input)?;
            require_input(&input)?;
            return Ok(ok(json!({ "landed": false })));
        }
        if channel == ch.board_land_preview {
            parse_corr(&input)?;
            require_input(&input)?;
            return Ok(ok(json!({ "ok": true })));
        }
        if channel == ch.kanban_project_list {
            parse_corr(&input)?;
            return Ok(ok(self.core.board().list_projects()));
        }
        if channel == ch.kanban_project_create {
            let corr = require_corr(&input)?;
            let name = input
                .pointer("/input/name")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            return Ok(ok(self.core.board().create_project(name, &cid(corr))?));
        }
        if channel == ch.kanban_list {
            parse_corr(&input)?;
            let workspace = input
                .pointer("/input/workspace")
                .and_then(Value::as_str)
                .unwrap_or("");
            return Ok(ok(self.core.board().list_cards(workspace)));
        }
        if channel == ch.kanban_create {
            let corr = require_corr(&input)?;
            let workspace = input
                .pointer("/input/workspace")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let title = input
                .pointer("/input/title")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            return Ok(ok(self.core.board().create_card(
                workspace,
                title,
                &cid(corr),
                None,
            )?));
        }
        if channel == ch.kanban_move {
            let corr = require_corr(&input)?;
            let id = input
                .pointer("/input/id")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let column = input
                .pointer("/input/column")
                .cloned()
                .ok_or_else(validation)?;
            let column = serde_json::from_value(column).map_err(|_| validation())?;
            return Ok(ok(self.core.board().move_card(id, column, &cid(corr))?));
        }
        if channel == ch.kanban_update {
            let corr = require_corr(&input)?;
            let id = input
                .pointer("/input/id")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let title = input
                .pointer("/input/title")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            return Ok(ok(self.core.board().update_card(id, title, &cid(corr))?));
        }
        if channel == ch.kanban_delete {
            let corr = require_corr(&input)?;
            let id = input
                .pointer("/input/id")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            self.core.board().delete_card(id, &cid(corr))?;
            return Ok(ok(json!({ "deleted": true })));
        }
        if channel == ch.browser_command {
            parse_browser_command_request(&input).map_err(|_| validation())?;
            let inner = input.get("input").cloned().unwrap_or(Value::Null);
            match serde_json::from_value::<BrowserCommandInput>(inner) {
                Ok(BrowserCommandInput::Open { url, .. }) => {
                    if parse_preview_url(&url).is_none() {
                        return Err(validation());
                    }
                    return Err(ZeroError::new(
                        ZeroErrorCode::InternalError,
                        "The request could not be completed",
                        ZeroErrorOptions::default(),
                    ));
                }
                Ok(_) => {
                    return Ok(ok(json!({
                        "url": "",
                        "canGoBack": false,
                        "canGoForward": false
                    })));
                }
                Err(_) => return Err(validation()),
            }
        }
        if channel == ch.editor_pick {
            parse_corr(&input)?;
            if self.dialog_canceled {
                return Ok(ok(Value::Null));
            }
            if let Some(path) = &self.dialog_folder {
                return Ok(ok(read_editor_file(path, path)?));
            }
            return Ok(ok(Value::Null));
        }
        if channel == ch.editor_read {
            let request = parse_editor_read_request(&input).map_err(|_| validation())?;
            return Ok(ok(read_editor_file(
                &request.input.root,
                &request.input.path,
            )?));
        }
        if channel == ch.editor_list {
            let inner = input.get("input").cloned().ok_or_else(validation)?;
            let parsed = parse_editor_list_input(&inner).map_err(|_| validation())?;
            parse_corr(&input)?;
            let path = parsed.path.as_deref();
            return Ok(ok(list_editor_dir(
                &parsed.root,
                path,
                parsed.hidden.unwrap_or(false),
            )?));
        }
        if channel == ch.editor_git {
            parse_corr(&input)?;
            let root = input
                .pointer("/input/root")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let value = match LocalGitInspector.inspect(root) {
                Ok(snap) => {
                    let changes = list_git_changes(&snap.root_path).unwrap_or_default();
                    json!({
                        "rootPath": snap.root_path,
                        "directoryName": snap.directory_name,
                        "branch": snap.branch,
                        "headSha": snap.head_sha,
                        "dirtyCount": snap.dirty_count,
                        "aheadCount": snap.ahead_count,
                        "behindCount": snap.behind_count,
                        "commits": snap.commits,
                        "changes": changes
                    })
                }
                Err(_) => Value::Null,
            };
            return Ok(ok(value));
        }
        if channel == ch.editor_write {
            parse_corr(&input)?;
            let root = input
                .pointer("/input/root")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let path = input
                .pointer("/input/path")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let text = input
                .pointer("/input/text")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            return Ok(ok(write_editor_file(root, path, text)?));
        }
        if channel == ch.editor_create {
            parse_corr(&input)?;
            let root = input
                .pointer("/input/root")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let path = input
                .pointer("/input/path")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let kind: EditorKind = serde_json::from_value(
                input
                    .pointer("/input/kind")
                    .cloned()
                    .ok_or_else(validation)?,
            )
            .map_err(|_| validation())?;
            return Ok(ok(create_editor_entry(root, path, kind)?));
        }
        if channel == ch.editor_search {
            parse_corr(&input)?;
            let root = input
                .pointer("/input/root")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let query = input
                .pointer("/input/query")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            if query.is_empty() {
                return Err(validation());
            }
            let hidden = input
                .pointer("/input/hidden")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            return Ok(ok(search_editor_files(root, query, hidden)?));
        }
        if channel == ch.editor_git_stage {
            parse_corr(&input)?;
            let root = input
                .pointer("/input/root")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let path = input.pointer("/input/path").and_then(Value::as_str);
            let staged = input
                .pointer("/input/staged")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            stage_git_path(root, path, staged)?;
            let snap = LocalGitInspector.inspect(root)?;
            let changes = list_git_changes(&snap.root_path).unwrap_or_default();
            return Ok(ok(json!({
                "rootPath": snap.root_path,
                "directoryName": snap.directory_name,
                "branch": snap.branch,
                "headSha": snap.head_sha,
                "dirtyCount": snap.dirty_count,
                "aheadCount": snap.ahead_count,
                "behindCount": snap.behind_count,
                "commits": snap.commits,
                "changes": changes
            })));
        }
        if channel == ch.editor_git_commit {
            parse_corr(&input)?;
            let root = input
                .pointer("/input/root")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            let message = input
                .pointer("/input/message")
                .and_then(Value::as_str)
                .ok_or_else(validation)?;
            if message.trim().is_empty() {
                return Err(validation());
            }
            commit_git(root, message)?;
            let snap = LocalGitInspector.inspect(root)?;
            let changes = list_git_changes(&snap.root_path).unwrap_or_default();
            return Ok(ok(json!({
                "rootPath": snap.root_path,
                "directoryName": snap.directory_name,
                "branch": snap.branch,
                "headSha": snap.head_sha,
                "dirtyCount": snap.dirty_count,
                "aheadCount": snap.ahead_count,
                "behindCount": snap.behind_count,
                "commits": snap.commits,
                "changes": changes
            })));
        }
        if channel == ch.helm {
            let action = input.get("action").and_then(Value::as_str).unwrap_or("");
            let payload = input.get("payload").cloned().unwrap_or(Value::Null);
            let helm = self.core.helm();
            let value = match action {
                "listAgents" => serde_json::to_value(helm.list_agents()?).unwrap(),
                "createAgent" => serde_json::to_value(helm.create_agent(&payload)?).unwrap(),
                "listRoutines" => serde_json::to_value(helm.list_routines()?).unwrap(),
                "createRoutine" => serde_json::to_value(helm.create_routine(&payload)?).unwrap(),
                "listPlugins" => serde_json::to_value(helm.list_plugins()?).unwrap(),
                "connectPlugin" => serde_json::to_value(helm.connect_plugin(&payload)?).unwrap(),
                "listTasks" => {
                    let board = self.core.board();
                    let swarm = SwarmService::new(
                        self.core.database(),
                        self.core.logger(),
                        &board,
                        self.runner.clone(),
                        self.verifier.clone(),
                        SwarmServiceOptions::default(),
                    );
                    let tasks = match swarm.latest_run() {
                        Some(run) => swarm
                            .state(&run.id)
                            .map(|state| {
                                state
                                    .tasks
                                    .into_iter()
                                    .map(|task| {
                                        json!({
                                            "id": task.id,
                                            "title": task.title,
                                            "status": task.status
                                        })
                                    })
                                    .collect::<Vec<_>>()
                            })
                            .unwrap_or_default(),
                        None => Vec::new(),
                    };
                    json!(tasks)
                }
                _ => {
                    return Err(ZeroError::new(
                        ZeroErrorCode::InternalError,
                        "The request could not be completed",
                        ZeroErrorOptions::default(),
                    ))
                }
            };
            return Ok(ok(value));
        }
        Err(ZeroError::new(
            ZeroErrorCode::InternalError,
            format!("no request handler for {channel}"),
            ZeroErrorOptions::default(),
        ))
    }
}

fn validation() -> ZeroError {
    ZeroError::new(
        ZeroErrorCode::ValidationFailed,
        "Request validation failed",
        ZeroErrorOptions::default(),
    )
}

fn parse_corr(input: &Value) -> Result<(), ZeroError> {
    require_corr(input).map(|_| ())
}

fn require_corr(input: &Value) -> Result<&str, ZeroError> {
    let Some(value) = input.get("correlationId").and_then(Value::as_str) else {
        return Err(validation());
    };
    if uuid::Uuid::parse_str(value).is_err() {
        return Err(validation());
    }
    Ok(value)
}

fn deny_extra(input: &Value, allowed: &[&str]) -> Result<(), ZeroError> {
    let obj = input.as_object().ok_or_else(validation)?;
    for key in obj.keys() {
        if !allowed.contains(&key.as_str()) {
            return Err(validation());
        }
    }
    Ok(())
}

fn require_input(input: &Value) -> Result<&Value, ZeroError> {
    input.get("input").ok_or_else(validation)
}
