use helm_shared::create_correlation_id;
use helm_tools::{create_work_tool_registry, PermissionEngine};
use serde_json::{json, Value};

fn id() -> String {
    create_correlation_id().to_string()
}

#[test]
fn validates_stable_tool_inputs_and_exposes_provider_safe_model_names() {
    let registry = create_work_tool_registry();
    let project_id = id();
    let parsed = registry
        .parse_input(
            "task.create",
            &json!({
                "projectId": project_id,
                "title": "Benchmark sync",
                "priority": "high",
            }),
        )
        .unwrap();
    assert_eq!(parsed["projectId"], project_id);
    assert_eq!(parsed["title"], "Benchmark sync");
    assert_eq!(parsed["priority"], "high");
    assert_eq!(parsed["dueAt"], Value::Null);
    let names: Vec<_> = registry
        .model_definitions()
        .into_iter()
        .map(|tool| tool.name)
        .collect();
    assert!(names.contains(&"task_create".into()));
    let err = registry
        .parse_input(
            "task.create",
            &json!({ "projectId": project_id, "title": "" }),
        )
        .unwrap_err();
    assert!(err.message().contains("arguments are invalid"));
}

#[test]
fn requires_explicit_approval_for_writes_unless_a_narrow_policy_allows_them() {
    let engine = PermissionEngine;
    assert_eq!(engine.evaluate("read", "ask", false, "none"), "allow");
    assert_eq!(
        engine.evaluate("reversible_write", "ask", false, "manual"),
        "require_approval"
    );
    assert_eq!(
        engine.evaluate("reversible_write", "auto_approve", false, "manual"),
        "allow"
    );
    assert_eq!(
        engine.evaluate("reversible_write", "deny", true, "automatic"),
        "deny"
    );
    assert_eq!(
        engine.evaluate("reversible_write", "auto_approve", false, "none"),
        "require_approval"
    );
    let err = engine
        .validate_policy("external_side_effect", "auto_approve", "none")
        .unwrap_err();
    assert!(err.message().contains("cannot be auto-approved"));
    let err = engine
        .validate_policy("reversible_write", "auto_approve", "none")
        .unwrap_err();
    assert!(err.message().contains("cannot be auto-approved"));
}

fn assert_tool(id: &str, model_name: &str) {
    let registry = create_work_tool_registry();
    let descriptor = registry.descriptor(id);
    assert_eq!(descriptor.id, id);
    assert_eq!(descriptor.model_name, model_name);
    let def = registry
        .model_definitions()
        .into_iter()
        .find(|tool| tool.name == model_name)
        .unwrap();
    assert_eq!(def.input_schema["type"], "object");
    assert_eq!(def.input_schema["additionalProperties"], false);
}

#[test]
fn project_create_schema_shape() {
    assert_tool("project.create", "project_create");
    let registry = create_work_tool_registry();
    let parsed = registry
        .parse_input("project.create", &json!({ "name": "Alpha" }))
        .unwrap();
    assert_eq!(parsed["name"], "Alpha");
    assert_eq!(parsed["description"], Value::Null);
}

#[test]
fn project_get_status_schema_shape() {
    assert_tool("project.get_status", "project_get_status");
    let registry = create_work_tool_registry();
    let project_id = id();
    let parsed = registry
        .parse_input("project.get_status", &json!({ "projectId": project_id }))
        .unwrap();
    assert_eq!(parsed["projectId"], project_id);
}

#[test]
fn project_add_decision_schema_shape() {
    assert_tool("project.add_decision", "project_add_decision");
    let registry = create_work_tool_registry();
    let parsed = registry
        .parse_input(
            "project.add_decision",
            &json!({ "projectId": id(), "title": "Ship locally" }),
        )
        .unwrap();
    assert_eq!(parsed["title"], "Ship locally");
    assert_eq!(parsed["detail"], Value::Null);
}

#[test]
fn task_list_schema_shape() {
    assert_tool("task.list", "task_list");
    let registry = create_work_tool_registry();
    let parsed = registry.parse_input("task.list", &json!({})).unwrap();
    assert!(parsed.get("projectId").is_none() || parsed["projectId"].is_null());
}

#[test]
fn task_create_schema_shape() {
    assert_tool("task.create", "task_create");
}

#[test]
fn task_update_schema_shape() {
    assert_tool("task.update", "task_update");
    let registry = create_work_tool_registry();
    let parsed = registry
        .parse_input(
            "task.update",
            &json!({ "taskId": id(), "title": "Renamed" }),
        )
        .unwrap();
    assert_eq!(parsed["title"], "Renamed");
    assert!(registry
        .parse_input("task.update", &json!({ "taskId": id() }))
        .is_err());
}
