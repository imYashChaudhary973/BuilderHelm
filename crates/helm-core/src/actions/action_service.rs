// HUMAN REVIEW REQUIRED: permissions, approvals, model-driven execution

use helm_db::AuditEventWrite;
use helm_observability::{LogInput, Logger};
use helm_protocol::{
    ChatStreamEvent, DataClassification, MessageRole, ModelContentPart, ModelRequest,
    ToolDefinition, ZeroMessage,
};
use helm_shared::{create_id, utc_now, CorrelationId, ZeroError, ZeroErrorCode};
use helm_tools::{PermissionEngine, ToolRegistry};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use time::{Duration, OffsetDateTime, UtcOffset};

use super::action_repository::{
    ActionReceiptWrite, ActionRepository, ApprovalRequestWrite, MutationAudit,
    PermissionPolicyWrite, ProjectDecisionWrite, ProjectWrite, StoredActionReceipt,
    StoredApprovalRequest, StoredProject, StoredProjectDecision, StoredTask, TaskWrite,
};
use super::{normalize_work_name, parse_deterministic_action, ParsedActionIntent};
use crate::chat::ChatModelStreamer;
use crate::error_convert::failed;

const APPROVAL_LIFETIME_MS: i64 = 10 * 60 * 1_000;
const DEFAULT_POLICY_UPDATED_AT: &str = "1970-01-01T00:00:00.000Z";

struct PlannedAction {
    request_id: String,
    tool_id: String,
    input: Value,
    actor_type: String,
    model_ref: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionCommandInput {
    pub request_id: String,
    pub text: String,
    pub model_ref: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ActionCommandOutcome {
    #[serde(rename = "approval_required")]
    ApprovalRequired {
        message: String,
        approval: ApprovalRequest,
    },
    Executed {
        message: String,
        receipt: ActionReceipt,
    },
    #[serde(rename = "read_result")]
    ReadResult {
        message: String,
        tool_id: String,
        result: Value,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: String,
    pub request_id: String,
    pub tool_id: String,
    pub summary: String,
    pub exact_arguments: Value,
    pub risk: String,
    pub affected_resources: Value,
    pub reversible: bool,
    pub status: String,
    pub actor_type: String,
    pub model_ref: Option<String>,
    pub expires_at: String,
    pub resolved_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionReceipt {
    pub id: String,
    pub request_id: String,
    pub correlation_id: String,
    pub actor_type: String,
    pub actor_id: Option<String>,
    pub model_ref: Option<String>,
    pub tool_id: String,
    pub requested_action: String,
    pub exact_arguments: Value,
    pub approval_state: String,
    pub result: Value,
    pub affected_resources: Value,
    pub rollback_information: Option<Value>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionPolicy {
    pub tool_id: String,
    pub mode: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionPolicyUpdateInput {
    pub tool_id: String,
    pub mode: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionSnapshot {
    pub projects: Vec<Value>,
    pub tasks: Vec<Value>,
    pub pending_approvals: Vec<ApprovalRequest>,
    pub receipts: Vec<ActionReceipt>,
    pub policies: Vec<PermissionPolicy>,
    pub tools: Vec<Value>,
}

pub struct ActionService<'a> {
    repository: ActionRepository<'a>,
    models: &'a dyn ChatModelStreamer,
    logger: &'a Logger,
    registry: ToolRegistry,
    permissions: PermissionEngine,
    clock: Box<dyn Fn() -> OffsetDateTime + 'a>,
}

impl<'a> ActionService<'a> {
    pub fn new(
        repository: ActionRepository<'a>,
        models: &'a dyn ChatModelStreamer,
        logger: &'a Logger,
        registry: ToolRegistry,
        permissions: PermissionEngine,
        clock: Option<Box<dyn Fn() -> OffsetDateTime + 'a>>,
    ) -> Self {
        Self {
            repository,
            models,
            logger,
            registry,
            permissions,
            clock: clock.unwrap_or_else(|| Box::new(OffsetDateTime::now_utc)),
        }
    }

    fn now(&self) -> OffsetDateTime {
        (self.clock)()
    }

    pub fn snapshot(&self, _correlation_id: &CorrelationId) -> ActionSnapshot {
        self.expire_approvals();
        let stored_policies: std::collections::HashMap<_, _> = self
            .repository
            .list_policies()
            .into_iter()
            .map(|policy| (policy.tool_id.clone(), policy))
            .collect();
        ActionSnapshot {
            projects: self
                .repository
                .list_projects(None)
                .into_iter()
                .map(|value| serde_json::to_value(to_project(&value)).unwrap())
                .collect(),
            tasks: self
                .repository
                .list_tasks(None, None, None)
                .into_iter()
                .map(|value| serde_json::to_value(to_task(&value)).unwrap())
                .collect(),
            pending_approvals: self
                .repository
                .list_approvals(Some("pending"))
                .into_iter()
                .map(|value| to_approval(&value))
                .collect(),
            receipts: self
                .repository
                .list_receipts(None)
                .into_iter()
                .map(|value| to_receipt(&value))
                .collect(),
            policies: self
                .registry
                .list()
                .into_iter()
                .map(|tool| {
                    let stored = stored_policies.get(&tool.id);
                    PermissionPolicy {
                        tool_id: tool.id,
                        mode: stored
                            .map(|value| value.mode.clone())
                            .unwrap_or_else(|| "ask".into()),
                        updated_at: stored
                            .map(|value| value.updated_at.clone())
                            .unwrap_or_else(|| DEFAULT_POLICY_UPDATED_AT.into()),
                    }
                })
                .collect(),
            tools: self
                .registry
                .list()
                .into_iter()
                .map(|tool| {
                    json!({
                        "id": tool.id,
                        "modelName": tool.model_name,
                        "description": tool.description,
                        "risk": tool.risk,
                        "dataScopes": tool.data_scopes,
                        "timeoutMs": tool.timeout_ms,
                        "idempotency": tool.idempotency,
                        "rollbackSupport": tool.rollback_support,
                    })
                })
                .collect(),
        }
    }

    pub async fn command(
        &self,
        raw_input: ActionCommandInput,
        correlation_id: &CorrelationId,
    ) -> Result<ActionCommandOutcome, ZeroError> {
        let input = raw_input;
        if let Some(prior) = self
            .repository
            .find_receipt_by_request_id(&input.request_id)
        {
            return Ok(self.executed_outcome(to_receipt(&prior)));
        }
        if let Some(prior) = self
            .repository
            .find_approval_by_request_id(&input.request_id)
        {
            if prior.status != "pending" {
                return Err(failed(
                    ZeroErrorCode::PermissionDenied,
                    "This action request was already resolved",
                ));
            }
            return Ok(ActionCommandOutcome::ApprovalRequired {
                message: "This action is waiting for your approval.".into(),
                approval: to_approval(&prior),
            });
        }
        let deterministic = parse_deterministic_action(&input.text, &self.repository, self.now());
        let proposed = match deterministic {
            None => self.propose_with_model(&input, correlation_id).await?,
            Some(ParsedActionIntent {
                tool_id,
                input: value,
            }) => PlannedAction {
                request_id: input.request_id.clone(),
                tool_id,
                input: value,
                actor_type: "deterministic_intent".into(),
                model_ref: None,
            },
        };
        let plan = PlannedAction {
            input: self
                .registry
                .parse_input(&proposed.tool_id, &proposed.input)?,
            ..proposed
        };
        self.propose(plan, correlation_id)
    }

    pub async fn approve(
        &self,
        approval_id: &str,
        _correlation_id: &CorrelationId,
    ) -> Result<ActionCommandOutcome, ZeroError> {
        let stored = self
            .repository
            .find_approval_by_id(approval_id)
            .ok_or_else(|| {
                failed(
                    ZeroErrorCode::ValidationFailed,
                    "The approval request was not found",
                )
            })?;
        let approval_correlation_id = stored.correlation_id.clone();
        let now = utc_now_from(self.now());
        if stored.status != "pending" {
            return Err(failed(
                ZeroErrorCode::PermissionDenied,
                "The approval request is no longer pending",
            ));
        }
        if stored.expires_at <= now {
            let approval = to_approval(&stored);
            self.repository.resolve_approval(
                &stored.id,
                "expired",
                &now,
                &audit(
                    "approval.expired",
                    "user",
                    None,
                    &approval_correlation_id,
                    &stored.risk_level,
                    &approval.affected_resources,
                    None,
                    None,
                    Some(&stored.id),
                    &now,
                ),
            )?;
            return Err(failed(
                ZeroErrorCode::PermissionDenied,
                "The approval request expired",
            ));
        }
        let tool_id = self.registry.resolve(&stored.tool_id)?;
        let descriptor = self.registry.descriptor(&tool_id);
        let policy = self.policy(&tool_id);
        let decision =
            self.permissions
                .evaluate(descriptor.risk, &policy, true, descriptor.rollback_support);
        if decision != "allow" {
            return Err(failed(
                ZeroErrorCode::PermissionDenied,
                "The current policy denies this tool",
            ));
        }
        let args: Value = serde_json::from_str(&stored.arguments_json).unwrap_or(Value::Null);
        let plan = PlannedAction {
            request_id: stored.request_id.clone(),
            tool_id: tool_id.clone(),
            input: self.registry.parse_input(&tool_id, &args)?,
            actor_type: if stored.actor_type == "model" {
                "model".into()
            } else {
                "deterministic_intent".into()
            },
            model_ref: stored.model_ref.clone(),
        };
        let cid = CorrelationIdLike(approval_correlation_id.clone());
        match self.execute_write(&plan, &cid.0, Some(&stored.id), "granted") {
            Ok(outcome) => Ok(outcome),
            Err(error) => {
                if self
                    .repository
                    .find_approval_by_id(&stored.id)
                    .is_some_and(|current| current.status == "pending")
                {
                    let _ = self.repository.resolve_approval(
                        &stored.id,
                        "failed",
                        &now,
                        &audit(
                            "agent.tool_failed",
                            &plan.actor_type,
                            Some(&actor_id(&plan)),
                            &approval_correlation_id,
                            descriptor.risk,
                            &to_approval(&stored).affected_resources,
                            None,
                            Some(&json!({ "code": error.code.as_str() })),
                            Some(&stored.id),
                            &now,
                        ),
                    );
                }
                Err(error)
            }
        }
    }

    pub fn reject(
        &self,
        approval_id: &str,
        _correlation_id: &CorrelationId,
    ) -> Result<ApprovalRequest, ZeroError> {
        let stored = self
            .repository
            .find_approval_by_id(approval_id)
            .ok_or_else(|| {
                failed(
                    ZeroErrorCode::ValidationFailed,
                    "The approval request was not found",
                )
            })?;
        let now = utc_now_from(self.now());
        let resolved = self.repository.resolve_approval(
            &stored.id,
            "denied",
            &now,
            &audit(
                "approval.denied",
                "user",
                None,
                &stored.correlation_id,
                &stored.risk_level,
                &to_approval(&stored).affected_resources,
                None,
                None,
                Some(&stored.id),
                &now,
            ),
        )?;
        Ok(to_approval(&resolved))
    }

    pub fn update_policy(
        &self,
        input: PermissionPolicyUpdateInput,
        correlation_id: &CorrelationId,
    ) -> Result<PermissionPolicy, ZeroError> {
        let descriptor = self.registry.descriptor(&input.tool_id);
        self.permissions.validate_policy(
            descriptor.risk,
            &input.mode,
            descriptor.rollback_support,
        )?;
        let before = self.repository.find_policy(&input.tool_id);
        let now = utc_now_from(self.now());
        let policy = PermissionPolicy {
            tool_id: input.tool_id.clone(),
            mode: input.mode.clone(),
            updated_at: now.clone(),
        };
        let before_json = before
            .as_ref()
            .map(|value| json!({ "toolId": value.tool_id, "mode": value.mode }));
        let after_json = json!({ "toolId": policy.tool_id, "mode": policy.mode });
        self.repository.upsert_policy(
            &PermissionPolicyWrite {
                tool_id: policy.tool_id.clone(),
                mode: policy.mode.clone(),
                updated_at: now.clone(),
            },
            &audit(
                "permission.policy_updated",
                "user",
                None,
                correlation_id.as_str(),
                descriptor.risk,
                &json!([]),
                before_json.as_ref(),
                Some(&after_json),
                None,
                &now,
            ),
        );
        Ok(policy)
    }

    async fn propose_with_model(
        &self,
        input: &ActionCommandInput,
        correlation_id: &CorrelationId,
    ) -> Result<PlannedAction, ZeroError> {
        let model_ref = input.model_ref.clone().ok_or_else(|| {
            failed(
                ZeroErrorCode::ValidationFailed,
                "Command not recognized. Try “Create project Project A” or “Add a high-priority task to Project A to benchmark sync tomorrow.”",
            )
        })?;
        let started_at = utc_now_from(self.now());
        self.repository.record_audit(&audit(
            "agent.model_invoked",
            "model",
            Some(&model_ref),
            correlation_id.as_str(),
            "read",
            &json!([]),
            None,
            Some(&json!({ "modelRef": model_ref, "purpose": "tool_proposal" })),
            None,
            &started_at,
        ));
        let catalog = json!({
            "projects": self.repository.list_projects(None).into_iter().take(100).map(|project| {
                json!({ "id": project.id, "name": project.name })
            }).collect::<Vec<_>>(),
            "tasks": self.repository.list_tasks(None, None, None).into_iter().take(200).map(|task| {
                json!({ "id": task.id, "projectId": task.project_id, "title": task.title })
            }).collect::<Vec<_>>(),
        });
        let request = ModelRequest {
            model_ref: model_ref.clone(),
            messages: vec![
                ZeroMessage {
                    id: new_id(),
                    role: MessageRole::System,
                    content: vec![ModelContentPart::Text {
                        text: [
                            "Translate the user request into exactly one supplied tool call.",
                            "Never invent project or task IDs; use only the catalog.",
                            "Do not claim an action executed. Zero independently validates and authorizes it.",
                            &format!("Local catalog: {catalog}"),
                        ]
                        .join(" "),
                    }],
                    created_at: utc_now_from(self.now()),
                },
                ZeroMessage {
                    id: new_id(),
                    role: MessageRole::User,
                    content: vec![ModelContentPart::Text {
                        text: input.text.clone(),
                    }],
                    created_at: utc_now_from(self.now()),
                },
            ],
            tools: Some(
                self.registry
                    .model_definitions()
                    .into_iter()
                    .map(|tool| ToolDefinition {
                        name: tool.name,
                        description: tool.description,
                        input_schema: tool.input_schema,
                    })
                    .collect(),
            ),
            response_schema: None,
            reasoning: None,
            data_classifications: vec![
                DataClassification::Personal,
                DataClassification::Sensitive,
                DataClassification::Health,
            ],
            max_output_tokens: None,
            stream: true,
        };
        match self
            .models
            .stream(request, correlation_id.as_str(), false)
            .await
        {
            Ok(events) => {
                let mut calls = Vec::new();
                let mut completed = false;
                for event in events {
                    match event {
                        ChatStreamEvent::ToolProposed { call } => {
                            calls.push((call.name, call.arguments));
                        }
                        ChatStreamEvent::Error { error } => {
                            let code = error
                                .code
                                .parse()
                                .unwrap_or(ZeroErrorCode::ModelUnavailable);
                            let err = ZeroError::new(
                                code,
                                error.message,
                                helm_shared::ZeroErrorOptions {
                                    retryable: error.retryable,
                                    ..Default::default()
                                },
                            );
                            self.fail_model(&model_ref, correlation_id, &err);
                            return Err(err);
                        }
                        ChatStreamEvent::Done { .. } => completed = true,
                        _ => {}
                    }
                }
                if !completed {
                    let err = failed(
                        ZeroErrorCode::ModelUnavailable,
                        "The action proposal ended early",
                    );
                    self.fail_model(&model_ref, correlation_id, &err);
                    return Err(err);
                }
                if calls.len() != 1 {
                    let err = failed(
                        ZeroErrorCode::ToolSchemaInvalid,
                        "The model must propose exactly one action at a time",
                    );
                    self.fail_model(&model_ref, correlation_id, &err);
                    return Err(err);
                }
                let (name, arguments) = calls.remove(0);
                let tool_id = match self.registry.resolve(&name) {
                    Ok(value) => value,
                    Err(error) => {
                        self.fail_model(&model_ref, correlation_id, &error);
                        return Err(error);
                    }
                };
                let parsed = match self.registry.parse_input(&tool_id, &arguments) {
                    Ok(value) => value,
                    Err(error) => {
                        self.fail_model(&model_ref, correlation_id, &error);
                        return Err(error);
                    }
                };
                self.repository.record_audit(&audit(
                    "agent.model_completed",
                    "model",
                    Some(&model_ref),
                    correlation_id.as_str(),
                    "read",
                    &json!([]),
                    None,
                    Some(&json!({ "modelRef": model_ref, "toolId": tool_id })),
                    None,
                    &utc_now_from(self.now()),
                ));
                Ok(PlannedAction {
                    request_id: input.request_id.clone(),
                    tool_id,
                    input: parsed,
                    actor_type: "model".into(),
                    model_ref: Some(model_ref),
                })
            }
            Err(error) => {
                self.fail_model(&model_ref, correlation_id, &error);
                Err(error)
            }
        }
    }

    fn fail_model(&self, model_ref: &str, correlation_id: &CorrelationId, error: &ZeroError) {
        self.repository.record_audit(&audit(
            "agent.model_failed",
            "model",
            Some(model_ref),
            correlation_id.as_str(),
            "read",
            &json!([]),
            None,
            Some(&json!({ "modelRef": model_ref, "code": error.code.as_str() })),
            None,
            &utc_now_from(self.now()),
        ));
    }

    fn propose(
        &self,
        plan: PlannedAction,
        correlation_id: &CorrelationId,
    ) -> Result<ActionCommandOutcome, ZeroError> {
        let descriptor = self.registry.descriptor(&plan.tool_id);
        let resources = self.resources(&plan);
        let now = utc_now_from(self.now());
        let permission = self.permissions.evaluate(
            descriptor.risk,
            &self.policy(&plan.tool_id),
            false,
            descriptor.rollback_support,
        );
        if permission != "require_approval" {
            self.repository.record_audit(&audit(
                "agent.tool_requested",
                &plan.actor_type,
                Some(&actor_id(&plan)),
                correlation_id.as_str(),
                descriptor.risk,
                &resources,
                None,
                Some(&json!({ "toolId": plan.tool_id })),
                None,
                &now,
            ));
        }
        if permission == "deny" {
            self.repository.record_audit(&audit(
                "agent.tool_denied",
                &plan.actor_type,
                Some(&actor_id(&plan)),
                correlation_id.as_str(),
                descriptor.risk,
                &resources,
                None,
                Some(&json!({ "toolId": plan.tool_id, "code": "PERMISSION_DENIED" })),
                None,
                &now,
            ));
            return Err(failed(
                ZeroErrorCode::PermissionDenied,
                "The permission policy denies this tool",
            ));
        }
        if permission == "require_approval" {
            let approval_id = new_id();
            let expires_at =
                utc_now_from(self.now() + Duration::milliseconds(APPROVAL_LIFETIME_MS));
            let approval = ApprovalRequest {
                id: approval_id.clone(),
                request_id: plan.request_id.clone(),
                tool_id: plan.tool_id.clone(),
                summary: self.registry.summarize(&plan.tool_id, &plan.input),
                exact_arguments: plan.input.clone(),
                risk: descriptor.risk.to_string(),
                affected_resources: resources.clone(),
                reversible: descriptor.rollback_support != "none",
                status: "pending".into(),
                actor_type: plan.actor_type.clone(),
                model_ref: plan.model_ref.clone(),
                expires_at: expires_at.clone(),
                resolved_at: None,
                created_at: now.clone(),
            };
            self.repository.create_approval(
                &ApprovalRequestWrite {
                    id: approval.id.clone(),
                    request_id: approval.request_id.clone(),
                    tool_id: approval.tool_id.clone(),
                    summary: approval.summary.clone(),
                    arguments_json: approval.exact_arguments.to_string(),
                    risk_level: approval.risk.clone(),
                    affected_resources_json: approval.affected_resources.to_string(),
                    reversible: approval.reversible,
                    status: approval.status.clone(),
                    actor_type: approval.actor_type.clone(),
                    model_ref: approval.model_ref.clone(),
                    correlation_id: correlation_id.to_string(),
                    expires_at: approval.expires_at.clone(),
                    resolved_at: None,
                    created_at: approval.created_at.clone(),
                },
                &[
                    audit(
                        "agent.tool_requested",
                        &plan.actor_type,
                        Some(&actor_id(&plan)),
                        correlation_id.as_str(),
                        descriptor.risk,
                        &resources,
                        None,
                        Some(&json!({ "toolId": plan.tool_id })),
                        Some(&approval.id),
                        &now,
                    ),
                    audit(
                        "approval.requested",
                        &plan.actor_type,
                        Some(&actor_id(&plan)),
                        correlation_id.as_str(),
                        descriptor.risk,
                        &resources,
                        None,
                        Some(&json!({ "toolId": plan.tool_id, "expiresAt": expires_at })),
                        Some(&approval.id),
                        &now,
                    ),
                ],
            );
            return Ok(ActionCommandOutcome::ApprovalRequired {
                message: "Review the exact action before it changes local data.".into(),
                approval,
            });
        }
        if descriptor.risk == "read" || descriptor.risk == "draft" {
            return self.execute_read(&plan, correlation_id);
        }
        self.execute_write(&plan, correlation_id.as_str(), None, "auto_approved")
    }

    fn execute_read(
        &self,
        plan: &PlannedAction,
        correlation_id: &CorrelationId,
    ) -> Result<ActionCommandOutcome, ZeroError> {
        let args = object(&plan.input)?;
        let (result, message) = if plan.tool_id == "task.list" {
            let project_id = args.get("projectId").and_then(Value::as_str);
            let status = args.get("status").and_then(Value::as_str);
            let tasks: Vec<Value> = self
                .repository
                .list_tasks(project_id, status, None)
                .into_iter()
                .map(|task| serde_json::to_value(to_task(&task)).unwrap())
                .collect();
            let count = tasks.len();
            let suffix = if count == 1 { "" } else { "s" };
            (Value::Array(tasks), format!("{count} task{suffix} found."))
        } else if plan.tool_id == "project.get_status" {
            let project_id = args
                .get("projectId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let project = self
                .repository
                .find_project_by_id(project_id)
                .ok_or_else(|| {
                    failed(ZeroErrorCode::ValidationFailed, "The project was not found")
                })?;
            let counts = self.repository.task_counts(project_id);
            let decisions: Vec<Value> = self
                .repository
                .list_decisions(project_id)
                .into_iter()
                .map(|decision| serde_json::to_value(to_decision(&decision)).unwrap())
                .collect();
            let result = json!({
                "project": to_project(&project),
                "taskCounts": {
                    "todo": counts.todo,
                    "inProgress": counts.in_progress,
                    "blocked": counts.blocked,
                    "done": counts.done,
                    "cancelled": counts.cancelled,
                },
                "recentDecisions": decisions,
            });
            (
                result,
                format!(
                    "{}: {} todo, {} in progress, {} blocked, {} done.",
                    project.name, counts.todo, counts.in_progress, counts.blocked, counts.done
                ),
            )
        } else {
            return Err(failed(
                ZeroErrorCode::ToolExecutionFailed,
                "This tool is not a read action",
            ));
        };
        let now = utc_now_from(self.now());
        let resources = self.resources(plan);
        self.repository.record_audit(&audit(
            "agent.tool_executed",
            &plan.actor_type,
            Some(&actor_id(plan)),
            correlation_id.as_str(),
            "read",
            &resources,
            None,
            Some(&json!({
                "toolId": plan.tool_id,
                "resultCount": if result.is_array() { result.as_array().map(|v| v.len()).unwrap_or(1) } else { 1 },
            })),
            None,
            &now,
        ));
        Ok(ActionCommandOutcome::ReadResult {
            message,
            tool_id: plan.tool_id.clone(),
            result,
        })
    }

    fn execute_write(
        &self,
        plan: &PlannedAction,
        correlation_id: &str,
        approval_id: Option<&str>,
        approval_state: &str,
    ) -> Result<ActionCommandOutcome, ZeroError> {
        let descriptor = self.registry.descriptor(&plan.tool_id);
        let args = object(&plan.input)?;
        let now = utc_now_from(self.now());
        let resources = self.resources(plan);
        let mut before = Value::Null;
        let (output, mutation, rollback) = if plan.tool_id == "project.create" {
            let name = args
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if self
                .repository
                .find_project_by_normalized_name(&normalize_work_name(&name))
                .is_some()
            {
                return Err(failed(
                    ZeroErrorCode::ValidationFailed,
                    "A project with this name already exists",
                ));
            }
            let project = ProjectWrite {
                id: plan.request_id.clone(),
                name: name.clone(),
                normalized_name: normalize_work_name(&name),
                description: args.get("description").and_then(|value| {
                    if value.is_null() {
                        None
                    } else {
                        value.as_str().map(str::to_string)
                    }
                }),
                status: "active".into(),
                created_at: now.clone(),
                updated_at: now.clone(),
            };
            let output = serde_json::to_value(to_project(&project)).unwrap();
            (
                output,
                Mutation::Project(project),
                Some(
                    json!({ "kind": "manual", "instruction": format!("Archive project {}", plan.request_id) }),
                ),
            )
        } else if plan.tool_id == "task.create" {
            let project_id = args
                .get("projectId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if self.repository.find_project_by_id(&project_id).is_none() {
                return Err(failed(
                    ZeroErrorCode::ValidationFailed,
                    "The target project was not found",
                ));
            }
            let title = args
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let task = TaskWrite {
                id: plan.request_id.clone(),
                project_id,
                title: title.clone(),
                normalized_title: normalize_work_name(&title),
                description: optional_string(args.get("description")),
                status: "todo".into(),
                priority: args
                    .get("priority")
                    .and_then(Value::as_str)
                    .unwrap_or("medium")
                    .to_string(),
                due_at: optional_string(args.get("dueAt")),
                source: "action_chat".into(),
                created_at: now.clone(),
                updated_at: now.clone(),
            };
            let output = serde_json::to_value(to_task(&task)).unwrap();
            (
                output,
                Mutation::TaskCreate(task),
                Some(
                    json!({ "kind": "manual", "instruction": format!("Cancel task {}", plan.request_id) }),
                ),
            )
        } else if plan.tool_id == "task.update" {
            let task_id = args
                .get("taskId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let current = self
                .repository
                .find_task_by_id(task_id)
                .ok_or_else(|| failed(ZeroErrorCode::ValidationFailed, "The task was not found"))?;
            before = serde_json::to_value(to_task(&current)).unwrap();
            let title = args
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or(&current.title)
                .to_string();
            let task = TaskWrite {
                id: current.id.clone(),
                project_id: current.project_id.clone(),
                title: title.clone(),
                normalized_title: normalize_work_name(&title),
                description: args
                    .get("description")
                    .map(|value| {
                        if value.is_null() {
                            None
                        } else {
                            value.as_str().map(str::to_string)
                        }
                    })
                    .unwrap_or_else(|| current.description.clone()),
                status: args
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or(&current.status)
                    .to_string(),
                priority: args
                    .get("priority")
                    .and_then(Value::as_str)
                    .unwrap_or(&current.priority)
                    .to_string(),
                due_at: args
                    .get("dueAt")
                    .map(|value| {
                        if value.is_null() {
                            None
                        } else {
                            value.as_str().map(str::to_string)
                        }
                    })
                    .unwrap_or_else(|| current.due_at.clone()),
                source: current.source.clone(),
                created_at: current.created_at.clone(),
                updated_at: now.clone(),
            };
            let output = serde_json::to_value(to_task(&task)).unwrap();
            (
                output,
                Mutation::TaskUpdate(task),
                Some(json!({
                    "toolId": "task.update",
                    "arguments": {
                        "taskId": current.id,
                        "title": current.title,
                        "description": current.description,
                        "status": current.status,
                        "priority": current.priority,
                        "dueAt": current.due_at,
                    }
                })),
            )
        } else if plan.tool_id == "project.add_decision" {
            let project_id = args
                .get("projectId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if self.repository.find_project_by_id(&project_id).is_none() {
                return Err(failed(
                    ZeroErrorCode::ValidationFailed,
                    "The target project was not found",
                ));
            }
            let decision = ProjectDecisionWrite {
                id: plan.request_id.clone(),
                project_id,
                title: args
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                detail: optional_string(args.get("detail")),
                created_at: now.clone(),
            };
            let output = serde_json::to_value(to_decision(&decision)).unwrap();
            (output, Mutation::Decision(decision), None)
        } else {
            return Err(failed(
                ZeroErrorCode::ToolExecutionFailed,
                "This tool is not a write action",
            ));
        };

        let receipt_write = ActionReceiptWrite {
            id: new_id(),
            request_id: plan.request_id.clone(),
            correlation_id: correlation_id.to_string(),
            actor_type: plan.actor_type.clone(),
            actor_id: Some(actor_id(plan)),
            model_ref: plan.model_ref.clone(),
            tool_id: plan.tool_id.clone(),
            requested_action: self.registry.summarize(&plan.tool_id, &plan.input),
            arguments_json: plan.input.to_string(),
            approval_state: approval_state.to_string(),
            result_json: output.to_string(),
            affected_resources_json: resources.to_string(),
            rollback_json: rollback.as_ref().map(Value::to_string),
            created_at: now.clone(),
        };
        let mutation_audit = MutationAudit {
            approval_id: approval_id.map(str::to_string),
            approval_granted: approval_id.map(|id| {
                audit(
                    "approval.granted",
                    "user",
                    None,
                    correlation_id,
                    descriptor.risk,
                    &resources,
                    None,
                    Some(&json!({ "toolId": plan.tool_id })),
                    Some(id),
                    &now,
                )
            }),
            executed: audit(
                "agent.tool_executed",
                &plan.actor_type,
                Some(&actor_id(plan)),
                correlation_id,
                descriptor.risk,
                &resources,
                if before.is_null() {
                    None
                } else {
                    Some(&before)
                },
                Some(&output),
                approval_id,
                &now,
            ),
        };
        let stored = match mutation {
            Mutation::Project(value) => {
                self.repository
                    .create_project(&value, &receipt_write, &mutation_audit)?
            }
            Mutation::TaskCreate(value) => {
                self.repository
                    .create_task(&value, &receipt_write, &mutation_audit)?
            }
            Mutation::TaskUpdate(value) => {
                self.repository
                    .update_task(&value, &receipt_write, &mutation_audit)?
            }
            Mutation::Decision(value) => {
                self.repository
                    .add_decision(&value, &receipt_write, &mutation_audit)?
            }
        };
        let receipt = to_receipt(&stored);
        self.logger.info(LogInput {
            event: "action.executed",
            correlation_id,
            data: Some(json!({
                "receiptId": receipt.id,
                "toolId": receipt.tool_id,
                "approvalState": receipt.approval_state,
            })),
        });
        Ok(self.executed_outcome(receipt))
    }

    fn resources(&self, plan: &PlannedAction) -> Value {
        let mut resources: Vec<Value> = self
            .registry
            .resources(&plan.tool_id, &plan.input)
            .into_iter()
            .map(|resource| {
                let label = if resource.kind == "project" {
                    self.repository
                        .find_project_by_id(&resource.id)
                        .map(|project| project.name)
                        .unwrap_or(resource.label)
                } else if resource.kind == "task" {
                    self.repository
                        .find_task_by_id(&resource.id)
                        .map(|task| task.title)
                        .unwrap_or(resource.label)
                } else {
                    resource.label
                };
                json!({ "type": resource.kind, "id": resource.id, "label": label })
            })
            .collect();
        let args = plan.input.as_object();
        if plan.tool_id == "project.create" {
            resources.push(json!({
                "type": "project",
                "id": plan.request_id,
                "label": args.and_then(|value| value.get("name")).and_then(Value::as_str).unwrap_or_default(),
            }));
        } else if plan.tool_id == "task.create" {
            resources.push(json!({
                "type": "task",
                "id": plan.request_id,
                "label": args.and_then(|value| value.get("title")).and_then(Value::as_str).unwrap_or_default(),
            }));
        } else if plan.tool_id == "project.add_decision" {
            resources.push(json!({
                "type": "decision",
                "id": plan.request_id,
                "label": args.and_then(|value| value.get("title")).and_then(Value::as_str).unwrap_or_default(),
            }));
        }
        Value::Array(resources)
    }

    fn policy(&self, tool_id: &str) -> String {
        match self.repository.find_policy(tool_id).map(|value| value.mode) {
            Some(mode) if mode == "auto_approve" || mode == "deny" => mode,
            _ => "ask".into(),
        }
    }

    fn executed_outcome(&self, receipt: ActionReceipt) -> ActionCommandOutcome {
        ActionCommandOutcome::Executed {
            message: format!(
                "{} completed. Receipt {} recorded.",
                receipt.requested_action,
                receipt.id.chars().take(8).collect::<String>()
            ),
            receipt,
        }
    }

    fn expire_approvals(&self) {
        let now = utc_now_from(self.now());
        for stored in self.repository.list_approvals(Some("pending")) {
            if stored.expires_at > now {
                continue;
            }
            if let Err(error) = self.repository.resolve_approval(
                &stored.id,
                "expired",
                &now,
                &audit(
                    "approval.expired",
                    "system",
                    None,
                    &stored.correlation_id,
                    &stored.risk_level,
                    &to_approval(&stored).affected_resources,
                    None,
                    None,
                    Some(&stored.id),
                    &now,
                ),
            ) {
                self.logger.warn(LogInput {
                    event: "approval.expiry_failed",
                    correlation_id: &stored.correlation_id,
                    data: Some(json!({ "approvalId": stored.id, "code": error.code.as_str() })),
                });
            }
        }
    }
}

enum Mutation {
    Project(ProjectWrite),
    TaskCreate(TaskWrite),
    TaskUpdate(TaskWrite),
    Decision(ProjectDecisionWrite),
}

struct CorrelationIdLike(String);

fn to_project(value: &StoredProject) -> Value {
    json!({
        "id": value.id,
        "name": value.name,
        "description": value.description,
        "status": value.status,
        "createdAt": value.created_at,
        "updatedAt": value.updated_at,
    })
}

fn to_task(value: &StoredTask) -> Value {
    json!({
        "id": value.id,
        "projectId": value.project_id,
        "title": value.title,
        "description": value.description,
        "status": value.status,
        "priority": value.priority,
        "dueAt": value.due_at,
        "source": value.source,
        "createdAt": value.created_at,
        "updatedAt": value.updated_at,
    })
}

fn to_decision(value: &StoredProjectDecision) -> Value {
    json!({
        "id": value.id,
        "projectId": value.project_id,
        "title": value.title,
        "detail": value.detail,
        "createdAt": value.created_at,
    })
}

fn to_approval(value: &StoredApprovalRequest) -> ApprovalRequest {
    ApprovalRequest {
        id: value.id.clone(),
        request_id: value.request_id.clone(),
        tool_id: value.tool_id.clone(),
        summary: value.summary.clone(),
        exact_arguments: serde_json::from_str(&value.arguments_json).unwrap_or(Value::Null),
        risk: value.risk_level.clone(),
        affected_resources: serde_json::from_str(&value.affected_resources_json)
            .unwrap_or(json!([])),
        reversible: value.reversible == 1,
        status: value.status.clone(),
        actor_type: value.actor_type.clone(),
        model_ref: value.model_ref.clone(),
        expires_at: value.expires_at.clone(),
        resolved_at: value.resolved_at.clone(),
        created_at: value.created_at.clone(),
    }
}

fn to_receipt(value: &StoredActionReceipt) -> ActionReceipt {
    ActionReceipt {
        id: value.id.clone(),
        request_id: value.request_id.clone(),
        correlation_id: value.correlation_id.clone(),
        actor_type: value.actor_type.clone(),
        actor_id: value.actor_id.clone(),
        model_ref: value.model_ref.clone(),
        tool_id: value.tool_id.clone(),
        requested_action: value.requested_action.clone(),
        exact_arguments: serde_json::from_str(&value.arguments_json).unwrap_or(Value::Null),
        approval_state: value.approval_state.clone(),
        result: serde_json::from_str(&value.result_json).unwrap_or(Value::Null),
        affected_resources: serde_json::from_str(&value.affected_resources_json)
            .unwrap_or(json!([])),
        rollback_information: value
            .rollback_json
            .as_ref()
            .and_then(|value| serde_json::from_str(value).ok()),
        created_at: value.created_at.clone(),
    }
}

#[allow(clippy::too_many_arguments)]
fn audit(
    event_type: &str,
    actor_type: &str,
    actor_id: Option<&str>,
    correlation_id: &str,
    risk_level: &str,
    resources: &Value,
    before: Option<&Value>,
    after: Option<&Value>,
    approval_id: Option<&str>,
    created_at: &str,
) -> AuditEventWrite {
    AuditEventWrite {
        id: new_id(),
        event_type: event_type.to_string(),
        actor_type: actor_type.to_string(),
        actor_id: actor_id.map(str::to_string),
        correlation_id: correlation_id.to_string(),
        risk_level: risk_level.to_string(),
        resource_refs_json: resources.to_string(),
        before_json: before
            .filter(|value| !value.is_null())
            .map(Value::to_string),
        after_json: after.filter(|value| !value.is_null()).map(Value::to_string),
        approval_id: approval_id.map(str::to_string),
        created_at: created_at.to_string(),
    }
}

fn actor_id(plan: &PlannedAction) -> String {
    if plan.actor_type == "model" {
        plan.model_ref
            .clone()
            .unwrap_or_else(|| "action.intent.local".into())
    } else {
        "action.intent.local".into()
    }
}

fn object(value: &Value) -> Result<&serde_json::Map<String, Value>, ZeroError> {
    value.as_object().ok_or_else(|| {
        failed(
            ZeroErrorCode::ToolSchemaInvalid,
            "Tool arguments must be an object",
        )
    })
}

fn optional_string(value: Option<&Value>) -> Option<String> {
    match value {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) => Some(value.clone()),
        Some(other) => Some(other.to_string()),
    }
}

fn utc_now_from(value: OffsetDateTime) -> String {
    let utc = value.to_offset(UtcOffset::UTC);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        utc.year(),
        u8::from(utc.month()),
        utc.day(),
        utc.hour(),
        utc.minute(),
        utc.second(),
        utc.millisecond()
    )
}

fn new_id() -> String {
    create_id(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_millis() as u64)
            .unwrap_or(0),
    )
    .to_string()
}

#[allow(dead_code)]
fn _keep_utc() {
    let _ = utc_now();
}
