use std::collections::HashMap;

use helm_protocol::parse_task_update_input;
use helm_shared::{ZeroError, ZeroErrorCode, ZeroErrorOptions};
use serde::Deserialize;
use serde_json::{json, Value};
use tracing::debug;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolDescriptor {
    pub id: String,
    pub model_name: String,
    pub description: String,
    pub risk: &'static str,
    pub data_scopes: &'static [&'static str],
    pub timeout_ms: i64,
    pub idempotency: &'static str,
    pub rollback_support: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModelToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResourceRef {
    pub kind: &'static str,
    pub id: String,
    pub label: String,
}

struct ToolContract {
    descriptor: ToolDescriptor,
    input_schema: Value,
    parse_input: fn(&Value) -> Result<Value, ZeroError>,
    summarize: fn(&Value) -> String,
    resources: fn(&Value) -> Vec<ResourceRef>,
}

fn invalid_args() -> ZeroError {
    ZeroError::new(
        ZeroErrorCode::ToolSchemaInvalid,
        "The proposed tool arguments are invalid",
        ZeroErrorOptions::default(),
    )
}

fn require_uuid(value: &str) -> Result<(), ZeroError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| invalid_args())
}

fn trim_len(value: &str, min: usize, max: usize) -> Result<String, ZeroError> {
    let trimmed = value.trim().to_string();
    if trimmed.len() < min || trimmed.len() > max {
        Err(invalid_args())
    } else {
        Ok(trimmed)
    }
}

fn parse_project_create(input: &Value) -> Result<Value, ZeroError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Body {
        name: String,
        #[serde(default)]
        description: Option<String>,
    }
    let body: Body = serde_json::from_value(input.clone()).map_err(|_| invalid_args())?;
    let name = trim_len(&body.name, 1, 200)?;
    if let Some(description) = &body.description {
        if description.trim().len() > 4_000 {
            return Err(invalid_args());
        }
    }
    Ok(json!({ "name": name, "description": body.description }))
}

fn parse_project_status(input: &Value) -> Result<Value, ZeroError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Body {
        project_id: String,
    }
    let body: Body = serde_json::from_value(input.clone()).map_err(|_| invalid_args())?;
    require_uuid(&body.project_id)?;
    Ok(json!({ "projectId": body.project_id }))
}

fn parse_project_decision(input: &Value) -> Result<Value, ZeroError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Body {
        project_id: String,
        title: String,
        #[serde(default)]
        detail: Option<String>,
    }
    let body: Body = serde_json::from_value(input.clone()).map_err(|_| invalid_args())?;
    require_uuid(&body.project_id)?;
    let title = trim_len(&body.title, 1, 500)?;
    Ok(json!({ "projectId": body.project_id, "title": title, "detail": body.detail }))
}

fn parse_task_list(input: &Value) -> Result<Value, ZeroError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Body {
        #[serde(default)]
        project_id: Option<String>,
        #[serde(default)]
        status: Option<String>,
    }
    let body: Body = serde_json::from_value(input.clone()).map_err(|_| invalid_args())?;
    if let Some(project_id) = &body.project_id {
        require_uuid(project_id)?;
    }
    let mut out = serde_json::Map::new();
    if let Some(project_id) = body.project_id {
        out.insert("projectId".into(), Value::String(project_id));
    }
    if let Some(status) = body.status {
        out.insert("status".into(), Value::String(status));
    }
    Ok(Value::Object(out))
}

fn parse_task_create(input: &Value) -> Result<Value, ZeroError> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Body {
        project_id: String,
        title: String,
        #[serde(default)]
        description: Option<String>,
        #[serde(default = "medium")]
        priority: String,
        #[serde(default)]
        due_at: Option<String>,
    }
    fn medium() -> String {
        "medium".into()
    }
    let body: Body = serde_json::from_value(input.clone()).map_err(|_| invalid_args())?;
    require_uuid(&body.project_id)?;
    let title = trim_len(&body.title, 1, 500)?;
    if !matches!(body.priority.as_str(), "low" | "medium" | "high") {
        return Err(invalid_args());
    }
    Ok(json!({
        "projectId": body.project_id,
        "title": title,
        "description": body.description,
        "priority": body.priority,
        "dueAt": body.due_at,
    }))
}

fn parse_task_update(input: &Value) -> Result<Value, ZeroError> {
    parse_task_update_input(input).map_err(|_| invalid_args())?;
    Ok(input.clone())
}

fn object_schema(properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": false,
    })
}

fn descriptors() -> [ToolContract; 6] {
    [
        ToolContract {
            descriptor: ToolDescriptor {
                id: "project.create".into(),
                model_name: "project_create".into(),
                description: "Create a new local project.".into(),
                risk: "reversible_write",
                data_scopes: &["projects"],
                timeout_ms: 2_000,
                idempotency: "request_id",
                rollback_support: "manual",
            },
            input_schema: object_schema(
                json!({
                    "name": { "type": "string" },
                    "description": { "type": ["string", "null"] },
                }),
                &["name"],
            ),
            parse_input: parse_project_create,
            summarize: |input| format!("Create project “{}”", input["name"].as_str().unwrap_or("")),
            resources: |_| vec![],
        },
        ToolContract {
            descriptor: ToolDescriptor {
                id: "project.get_status".into(),
                model_name: "project_get_status".into(),
                description: "Read a local project status with task counts and decisions.".into(),
                risk: "read",
                data_scopes: &["projects", "tasks"],
                timeout_ms: 2_000,
                idempotency: "none",
                rollback_support: "none",
            },
            input_schema: object_schema(
                json!({ "projectId": { "type": "string" } }),
                &["projectId"],
            ),
            parse_input: parse_project_status,
            summarize: |_| "Read project status".into(),
            resources: |input| {
                let id = input["projectId"].as_str().unwrap_or("").to_string();
                vec![ResourceRef {
                    kind: "project",
                    id: id.clone(),
                    label: id,
                }]
            },
        },
        ToolContract {
            descriptor: ToolDescriptor {
                id: "project.add_decision".into(),
                model_name: "project_add_decision".into(),
                description: "Add a durable decision to a local project.".into(),
                risk: "reversible_write",
                data_scopes: &["projects"],
                timeout_ms: 2_000,
                idempotency: "request_id",
                rollback_support: "none",
            },
            input_schema: object_schema(
                json!({
                    "projectId": { "type": "string" },
                    "title": { "type": "string" },
                    "detail": { "type": ["string", "null"] },
                }),
                &["projectId", "title"],
            ),
            parse_input: parse_project_decision,
            summarize: |input| {
                format!(
                    "Add project decision “{}”",
                    input["title"].as_str().unwrap_or("")
                )
            },
            resources: |input| {
                let id = input["projectId"].as_str().unwrap_or("").to_string();
                vec![ResourceRef {
                    kind: "project",
                    id: id.clone(),
                    label: id,
                }]
            },
        },
        ToolContract {
            descriptor: ToolDescriptor {
                id: "task.list".into(),
                model_name: "task_list".into(),
                description: "List local tasks, optionally filtered by project or status.".into(),
                risk: "read",
                data_scopes: &["tasks"],
                timeout_ms: 2_000,
                idempotency: "none",
                rollback_support: "none",
            },
            input_schema: object_schema(
                json!({
                    "projectId": { "type": "string" },
                    "status": { "type": "string" },
                }),
                &[],
            ),
            parse_input: parse_task_list,
            summarize: |_| "List tasks".into(),
            resources: |input| match input.get("projectId").and_then(Value::as_str) {
                Some(id) => vec![ResourceRef {
                    kind: "project",
                    id: id.to_string(),
                    label: id.to_string(),
                }],
                None => vec![],
            },
        },
        ToolContract {
            descriptor: ToolDescriptor {
                id: "task.create".into(),
                model_name: "task_create".into(),
                description: "Create a local task in an existing project.".into(),
                risk: "reversible_write",
                data_scopes: &["projects", "tasks"],
                timeout_ms: 2_000,
                idempotency: "request_id",
                rollback_support: "manual",
            },
            input_schema: object_schema(
                json!({
                    "projectId": { "type": "string" },
                    "title": { "type": "string" },
                    "description": { "type": ["string", "null"] },
                    "priority": { "type": "string" },
                    "dueAt": { "type": ["string", "null"] },
                }),
                &["projectId", "title"],
            ),
            parse_input: parse_task_create,
            summarize: |input| format!("Create task “{}”", input["title"].as_str().unwrap_or("")),
            resources: |input| {
                let id = input["projectId"].as_str().unwrap_or("").to_string();
                vec![ResourceRef {
                    kind: "project",
                    id: id.clone(),
                    label: id,
                }]
            },
        },
        ToolContract {
            descriptor: ToolDescriptor {
                id: "task.update".into(),
                model_name: "task_update".into(),
                description: "Update fields on one existing local task.".into(),
                risk: "reversible_write",
                data_scopes: &["tasks"],
                timeout_ms: 2_000,
                idempotency: "single_use_approval",
                rollback_support: "automatic",
            },
            input_schema: object_schema(
                json!({
                    "taskId": { "type": "string" },
                    "title": { "type": "string" },
                    "description": { "type": ["string", "null"] },
                    "status": { "type": "string" },
                    "priority": { "type": "string" },
                    "dueAt": { "type": ["string", "null"] },
                }),
                &["taskId"],
            ),
            parse_input: parse_task_update,
            summarize: |_| "Update task".into(),
            resources: |input| {
                let id = input["taskId"].as_str().unwrap_or("").to_string();
                vec![ResourceRef {
                    kind: "task",
                    id: id.clone(),
                    label: id,
                }]
            },
        },
    ]
}

pub struct ToolRegistry {
    by_id: HashMap<String, ToolContract>,
    by_model_name: HashMap<String, String>,
}

impl ToolRegistry {
    fn new(contracts: impl IntoIterator<Item = ToolContract>) -> Self {
        let mut by_id = HashMap::new();
        let mut by_model_name = HashMap::new();
        for value in contracts {
            if by_id.contains_key(&value.descriptor.id)
                || by_model_name.contains_key(&value.descriptor.model_name)
            {
                panic!("Duplicate tool registration: {}", value.descriptor.id);
            }
            by_model_name.insert(
                value.descriptor.model_name.clone(),
                value.descriptor.id.clone(),
            );
            by_id.insert(value.descriptor.id.clone(), value);
        }
        Self {
            by_id,
            by_model_name,
        }
    }

    fn require(&self, id: &str) -> &ToolContract {
        self.by_id.get(id).unwrap_or_else(|| {
            panic!(
                "{}",
                ZeroError::new(
                    ZeroErrorCode::ToolSchemaInvalid,
                    "The requested tool is not registered",
                    ZeroErrorOptions::default(),
                )
            )
        })
    }

    pub fn resolve(&self, name: &str) -> Result<String, ZeroError> {
        if let Some(id) = self.by_model_name.get(name) {
            return Ok(id.clone());
        }
        if self.by_id.contains_key(name) {
            return Ok(name.to_string());
        }
        Err(ZeroError::new(
            ZeroErrorCode::ToolSchemaInvalid,
            "The proposed tool is not registered",
            ZeroErrorOptions::default(),
        ))
    }

    pub fn list(&self) -> Vec<ToolDescriptor> {
        self.by_id
            .values()
            .map(|value| value.descriptor.clone())
            .collect()
    }

    pub fn descriptor(&self, id: &str) -> ToolDescriptor {
        self.require(id).descriptor.clone()
    }

    pub fn parse_input(&self, id: &str, input: &Value) -> Result<Value, ZeroError> {
        let _span = tracing::debug_span!("tools.parse_input", tool = id).entered();
        debug!(tool = id, "parse_input");
        (self.require(id).parse_input)(input)
    }

    pub fn summarize(&self, id: &str, input: &Value) -> String {
        (self.require(id).summarize)(input)
    }

    pub fn resources(&self, id: &str, input: &Value) -> Vec<ResourceRef> {
        (self.require(id).resources)(input)
    }

    pub fn model_definitions(&self) -> Vec<ModelToolDefinition> {
        let mut tools: Vec<_> = self
            .by_id
            .values()
            .map(|value| ModelToolDefinition {
                name: value.descriptor.model_name.clone(),
                description: value.descriptor.description.clone(),
                input_schema: value.input_schema.clone(),
            })
            .collect();
        tools.sort_by(|a, b| a.name.cmp(&b.name));
        tools
    }
}

pub fn create_work_tool_registry() -> ToolRegistry {
    ToolRegistry::new(descriptors())
}

pub struct PermissionEngine;

impl PermissionEngine {
    pub fn evaluate(
        &self,
        risk: &str,
        policy: &str,
        explicit_approval: bool,
        rollback_support: &str,
    ) -> &'static str {
        let _span = tracing::debug_span!("tools.permission_evaluate", risk, policy).entered();
        if policy == "deny" {
            return "deny";
        }
        if risk == "read" || risk == "draft" {
            return "allow";
        }
        if explicit_approval {
            return "allow";
        }
        if risk == "reversible_write" && policy == "auto_approve" && rollback_support != "none" {
            return "allow";
        }
        "require_approval"
    }

    pub fn validate_policy(
        &self,
        risk: &str,
        mode: &str,
        rollback_support: &str,
    ) -> Result<(), ZeroError> {
        if mode == "auto_approve"
            && (risk == "external_side_effect"
                || risk == "destructive_sensitive"
                || rollback_support == "none")
        {
            return Err(ZeroError::new(
                ZeroErrorCode::PermissionDenied,
                "This tool cannot be auto-approved",
                ZeroErrorOptions::default(),
            ));
        }
        Ok(())
    }
}
