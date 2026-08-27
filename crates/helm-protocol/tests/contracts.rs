use helm_protocol::{
    create_event, grid_for_count, parse_action_command_request, parse_approval_resolve_request,
    parse_board_pane_spec, parse_create_provider_input, parse_editor_git_ipc_response,
    parse_editor_list_input, parse_editor_list_ipc_response, parse_editor_pick_ipc_response,
    parse_editor_read_input, parse_editor_read_ipc_response, parse_editor_read_request,
    parse_knowledge_query_request, parse_knowledge_source_request,
    parse_model_capability_override_update_request, parse_model_list_ipc_response,
    parse_preview_url, parse_provider_test_connection_request, parse_system_health_request,
    parse_system_health_response, parse_zero_event, BoardAgentId, CreateEventInput,
    EditorIpcResult, IpcResult, BOARD_AGENT_CATALOG,
};
use helm_shared::create_correlation_id;
use serde_json::json;

#[test]
fn creates_a_validated_event_with_correlation_metadata() {
    let event = create_event(CreateEventInput {
        kind: "core.started",
        correlation_id: &create_correlation_id(),
        payload: json!({ "migrated": true }),
        actor: None,
        causation_id: None,
    })
    .unwrap();
    let value = serde_json::to_value(&event).unwrap();
    assert!(parse_zero_event(&value).is_ok());
}
#[test]
fn rejects_malformed_renderer_arguments() {
    assert!(parse_system_health_request(&json!({ "correlationId": "../../etc/passwd" })).is_err());
}

#[test]
fn rejects_privileged_details_in_a_health_response() {
    assert!(parse_system_health_response(&json!({
        "status": "ok",
        "database": "ready",
        "occurredAt": "2026-08-09T12:00:00.000Z",
        "correlationId": create_correlation_id().as_str(),
        "databasePath": "/Users/example/private.sqlite",
    }))
    .is_err());
}

#[test]
fn validates_provider_operations_and_sanitized_ipc_failures() {
    let provider_id = create_correlation_id();
    let parsed = parse_provider_test_connection_request(&json!({
        "correlationId": create_correlation_id().as_str(),
        "input": { "providerId": provider_id.as_str() },
    }))
    .unwrap();
    assert_eq!(parsed.input.provider_id, provider_id.as_str());
    assert!(parse_provider_test_connection_request(&json!({
        "correlationId": create_correlation_id().as_str(),
        "input": { "providerId": provider_id.as_str(), "apiKey": "must-not-cross" },
    }))
    .is_err());
    let ipc = parse_model_list_ipc_response(&json!({
        "ok": false,
        "error": {
            "code": "AUTH_FAILED",
            "message": "Provider authentication failed",
            "retryable": false,
        },
    }))
    .unwrap();
    match ipc {
        IpcResult::Err { error, .. } => assert_eq!(error.code, "AUTH_FAILED"),
        _ => panic!("expected error"),
    }
}

#[test]
fn requires_explicit_remote_routing_while_allowing_credential_free_local_ollama() {
    let common = json!({
        "label": "Provider",
        "headers": [],
        "privacy": { "allowPersonal": true, "allowSensitive": false, "allowHealth": false },
        "enabled": true,
    });
    let mut remote = common.clone();
    remote["protocol"] = json!("openai-compatible");
    remote["baseUrl"] = json!(null);
    remote["apiKey"] = json!("secret");
    assert!(parse_create_provider_input(&remote).is_err());
    let mut ollama = common.clone();
    ollama["protocol"] = json!("ollama");
    ollama["baseUrl"] = json!(null);
    ollama["apiKey"] = json!("");
    let parsed = parse_create_provider_input(&ollama).unwrap();
    assert_eq!(parsed.protocol, helm_protocol::ProviderProtocol::Ollama);
    assert_eq!(parsed.api_key, "");
    let mut openai = common;
    openai["protocol"] = json!("openai");
    openai["baseUrl"] = json!(null);
    openai["apiKey"] = json!("");
    assert!(parse_create_provider_input(&openai).is_err());
}

#[test]
fn accepts_only_known_per_model_capability_override_fields() {
    let request = json!({
        "correlationId": create_correlation_id().as_str(),
        "input": {
            "modelRef": format!("{}:model", create_correlation_id()),
            "overrides": { "toolCalling": true, "contextWindow": 32768 },
        },
    });
    assert!(parse_model_capability_override_update_request(&request).is_ok());
    let mut extra = request.clone();
    extra["input"]["overrides"] = json!({ "apiKey": "must-not-cross" });
    assert!(parse_model_capability_override_update_request(&extra).is_err());
}

#[test]
fn keeps_knowledge_paths_out_of_renderer_controlled_query_and_source_inputs() {
    let correlation_id = create_correlation_id();
    let vault_id = create_correlation_id();
    let source_id = create_correlation_id();
    let chunk_id = create_correlation_id();
    assert!(parse_knowledge_query_request(&json!({
        "correlationId": correlation_id.as_str(),
        "input": {
            "vaultId": vault_id.as_str(),
            "modelRef": format!("{}:model", create_correlation_id()),
            "query": "Why architecture B?",
            "rootPath": "/Users/private/vault",
        },
    }))
    .is_err());
    let source = parse_knowledge_source_request(&json!({
        "correlationId": correlation_id.as_str(),
        "input": { "sourceId": source_id.as_str(), "chunkId": chunk_id.as_str() },
    }))
    .unwrap();
    assert_eq!(source.input.source_id, source_id.as_str());
    assert!(parse_knowledge_source_request(&json!({
        "correlationId": correlation_id.as_str(),
        "input": {
            "sourceId": source_id.as_str(),
            "chunkId": chunk_id.as_str(),
            "notePath": "../../outside.md",
        },
    }))
    .is_err());
}

#[test]
fn does_not_let_the_renderer_choose_a_tool_or_replace_approved_arguments() {
    let correlation_id = create_correlation_id();
    assert!(parse_action_command_request(&json!({
        "correlationId": correlation_id.as_str(),
        "input": {
            "requestId": create_correlation_id().as_str(),
            "text": "List tasks",
            "modelRef": null,
            "toolId": "task.create",
        },
    }))
    .is_err());
    assert!(parse_approval_resolve_request(&json!({
        "correlationId": correlation_id.as_str(),
        "input": {
            "approvalId": create_correlation_id().as_str(),
            "exactArguments": { "title": "Replacement" },
        },
    }))
    .is_err());
}

#[test]
fn allows_a_login_shell_without_a_command_and_rejects_empty_custom_panes() {
    assert_eq!(
        parse_board_pane_spec(&json!({ "slot": 0, "agentId": "shell" }))
            .unwrap()
            .agent_id,
        BoardAgentId::Shell
    );
    assert_eq!(
        parse_board_pane_spec(&json!({ "slot": 0, "agentId": "kiro" }))
            .unwrap()
            .agent_id,
        BoardAgentId::Kiro
    );
    assert_eq!(
        BOARD_AGENT_CATALOG
            .iter()
            .find(|entry| entry.id == BoardAgentId::Kiro)
            .unwrap()
            .command,
        "kiro-cli"
    );
    assert!(parse_board_pane_spec(&json!({ "slot": 0, "agentId": "custom" })).is_err());
}

#[test]
fn lays_out_extra_terminals_across_a_row_instead_of_a_leftover_column() {
    assert_eq!(grid_for_count(2), (2, 1));
    assert_eq!(grid_for_count(6), (3, 2));
    assert_eq!(grid_for_count(7), (4, 2));
}

#[test]
fn allows_http_s_and_localhost_rejects_file_and_javascript() {
    assert_eq!(
        parse_preview_url("localhost:3000").as_deref(),
        Some("http://localhost:3000/")
    );
    assert_eq!(
        parse_preview_url("https://example.com/app").as_deref(),
        Some("https://example.com/app")
    );
    assert!(parse_preview_url("file:///etc/passwd").is_none());
    assert!(parse_preview_url("javascript:alert(1)").is_none());
    assert!(parse_preview_url("http://user:pass@host/").is_none());
}

#[test]
fn rejects_an_empty_path() {
    assert!(parse_editor_read_input(&json!({ "path": "" })).is_err());
    assert!(parse_editor_read_request(&json!({
        "correlationId": create_correlation_id().as_str(),
        "input": { "path": "" },
    }))
    .is_err());
}

#[test]
fn requires_a_workspace_root_on_read() {
    assert!(parse_editor_read_input(&json!({ "path": "/tmp/app/a.ts" })).is_err());
    let parsed = parse_editor_read_request(&json!({
        "correlationId": create_correlation_id().as_str(),
        "input": { "root": "/tmp/app", "path": "/tmp/app/note.txt" },
    }))
    .unwrap();
    assert_eq!(parsed.input.root, "/tmp/app");
    let pick = parse_editor_pick_ipc_response(&json!({ "ok": true, "value": null })).unwrap();
    match pick {
        EditorIpcResult::Ok { value, .. } => assert!(value.is_none()),
        _ => panic!("expected ok"),
    }
}

#[test]
fn requires_path_name_and_text_on_a_successful_read() {
    assert!(parse_editor_read_ipc_response(&json!({
        "ok": true,
        "value": { "path": "/tmp/a.txt", "name": "a.txt" },
    }))
    .is_err());
    let parsed = parse_editor_read_ipc_response(&json!({
        "ok": true,
        "value": { "path": "/tmp/a.txt", "name": "a.txt", "text": "hi" },
    }))
    .unwrap();
    match parsed {
        EditorIpcResult::Ok { value, .. } => assert_eq!(value.text, "hi"),
        _ => panic!("expected ok"),
    }
}

#[test]
fn requires_a_workspace_root() {
    assert!(parse_editor_list_input(&json!({})).is_err());
    assert_eq!(
        parse_editor_list_input(&json!({ "root": "/tmp/app" }))
            .unwrap()
            .root,
        "/tmp/app"
    );
}

#[test]
fn accepts_a_file_tree_and_a_missing_git_repo() {
    let listed = parse_editor_list_ipc_response(&json!({
        "ok": true,
        "value": [{ "path": "/tmp/app/src", "name": "src", "kind": "dir" }],
    }))
    .unwrap();
    match listed {
        EditorIpcResult::Ok { value, .. } => {
            assert_eq!(value[0].kind, helm_protocol::EditorKind::Dir)
        }
        _ => panic!("expected ok"),
    }
    let git = parse_editor_git_ipc_response(&json!({ "ok": true, "value": null })).unwrap();
    match git {
        EditorIpcResult::Ok { value, .. } => assert!(value.is_none()),
        _ => panic!("expected ok"),
    }
}
