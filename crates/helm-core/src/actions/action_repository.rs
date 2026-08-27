use helm_db::{AuditEventWrite, DbRow, ZeroDatabase};
use helm_shared::{ZeroError, ZeroErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error_convert::failed;

fn map_row<T: for<'de> Deserialize<'de>>(row: DbRow) -> T {
    serde_json::from_value(Value::Object(row)).expect("row")
}

const PROJECT_COLUMNS: &str = "
  id,
  name,
  normalized_name AS normalizedName,
  description,
  status,
  created_at AS createdAt,
  updated_at AS updatedAt
";
const TASK_COLUMNS: &str = "
  id,
  project_id AS projectId,
  title,
  normalized_title AS normalizedTitle,
  description,
  status,
  priority,
  due_at AS dueAt,
  source,
  created_at AS createdAt,
  updated_at AS updatedAt
";
const DECISION_COLUMNS: &str = "
  id,
  project_id AS projectId,
  title,
  detail,
  created_at AS createdAt
";
const APPROVAL_COLUMNS: &str = "
  id,
  request_id AS requestId,
  tool_id AS toolId,
  summary,
  arguments_json AS argumentsJson,
  risk_level AS riskLevel,
  affected_resources_json AS affectedResourcesJson,
  reversible,
  status,
  actor_type AS actorType,
  model_ref AS modelRef,
  correlation_id AS correlationId,
  expires_at AS expiresAt,
  resolved_at AS resolvedAt,
  created_at AS createdAt
";
const RECEIPT_COLUMNS: &str = "
  id,
  request_id AS requestId,
  correlation_id AS correlationId,
  actor_type AS actorType,
  actor_id AS actorId,
  model_ref AS modelRef,
  tool_id AS toolId,
  requested_action AS requestedAction,
  arguments_json AS argumentsJson,
  approval_state AS approvalState,
  result_json AS resultJson,
  affected_resources_json AS affectedResourcesJson,
  rollback_json AS rollbackJson,
  created_at AS createdAt
";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWrite {
    pub id: String,
    pub name: String,
    pub normalized_name: String,
    pub description: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

pub type StoredProject = ProjectWrite;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskWrite {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub normalized_title: String,
    pub description: Option<String>,
    pub status: String,
    pub priority: String,
    pub due_at: Option<String>,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
}

pub type StoredTask = TaskWrite;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDecisionWrite {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub detail: Option<String>,
    pub created_at: String,
}

pub type StoredProjectDecision = ProjectDecisionWrite;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionPolicyWrite {
    pub tool_id: String,
    pub mode: String,
    pub updated_at: String,
}

pub type StoredPermissionPolicy = PermissionPolicyWrite;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequestWrite {
    pub id: String,
    pub request_id: String,
    pub tool_id: String,
    pub summary: String,
    pub arguments_json: String,
    pub risk_level: String,
    pub affected_resources_json: String,
    pub reversible: bool,
    pub status: String,
    pub actor_type: String,
    pub model_ref: Option<String>,
    pub correlation_id: String,
    pub expires_at: String,
    pub resolved_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredApprovalRequest {
    pub id: String,
    pub request_id: String,
    pub tool_id: String,
    pub summary: String,
    pub arguments_json: String,
    pub risk_level: String,
    pub affected_resources_json: String,
    pub reversible: i64,
    pub status: String,
    pub actor_type: String,
    pub model_ref: Option<String>,
    pub correlation_id: String,
    pub expires_at: String,
    pub resolved_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionReceiptWrite {
    pub id: String,
    pub request_id: String,
    pub correlation_id: String,
    pub actor_type: String,
    pub actor_id: Option<String>,
    pub model_ref: Option<String>,
    pub tool_id: String,
    pub requested_action: String,
    pub arguments_json: String,
    pub approval_state: String,
    pub result_json: String,
    pub affected_resources_json: String,
    pub rollback_json: Option<String>,
    pub created_at: String,
}

pub type StoredActionReceipt = ActionReceiptWrite;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCounts {
    pub todo: i64,
    pub in_progress: i64,
    pub blocked: i64,
    pub done: i64,
    pub cancelled: i64,
}

pub struct MutationAudit {
    pub approval_id: Option<String>,
    pub approval_granted: Option<AuditEventWrite>,
    pub executed: AuditEventWrite,
}

pub struct ActionRepository<'a> {
    database: &'a ZeroDatabase,
}

impl<'a> ActionRepository<'a> {
    pub fn new(database: &'a ZeroDatabase) -> Self {
        Self { database }
    }

    pub fn list_projects(&self, limit: Option<i64>) -> Vec<StoredProject> {
        match limit {
            None => self
                .database
                .query_all(
                    &format!("SELECT {PROJECT_COLUMNS} FROM projects ORDER BY lower(name), id"),
                    &[],
                )
                .into_iter()
                .map(map_row)
                .collect(),
            Some(limit) => self
                .database
                .query_all(
                    &format!(
                        "SELECT {PROJECT_COLUMNS} FROM projects ORDER BY lower(name), id LIMIT ?"
                    ),
                    &[json!(limit)],
                )
                .into_iter()
                .map(map_row)
                .collect(),
        }
    }

    pub fn find_project_by_id(&self, id: &str) -> Option<StoredProject> {
        self.database
            .query_one(
                &format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE id = ?"),
                &[json!(id)],
            )
            .map(map_row)
    }

    pub fn find_project_by_normalized_name(&self, name: &str) -> Option<StoredProject> {
        self.database
            .query_one(
                &format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE normalized_name = ?"),
                &[json!(name)],
            )
            .map(map_row)
    }

    pub fn list_tasks(
        &self,
        project_id: Option<&str>,
        status: Option<&str>,
        limit: Option<i64>,
    ) -> Vec<StoredTask> {
        let mut conditions = Vec::new();
        let mut parameters = Vec::new();
        if let Some(project_id) = project_id {
            conditions.push("project_id = ?");
            parameters.push(json!(project_id));
        }
        if let Some(status) = status {
            conditions.push("status = ?");
            parameters.push(json!(status));
        }
        if let Some(limit) = limit {
            parameters.push(json!(limit));
        }
        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };
        let limit_clause = if limit.is_some() { "LIMIT ?" } else { "" };
        self.database
            .query_all(
                &format!(
                    "SELECT {TASK_COLUMNS} FROM tasks
       {where_clause}
       ORDER BY due_at IS NULL, due_at, created_at, id
       {limit_clause}"
                ),
                &parameters,
            )
            .into_iter()
            .map(map_row)
            .collect()
    }

    pub fn find_task_by_id(&self, id: &str) -> Option<StoredTask> {
        self.database
            .query_one(
                &format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?"),
                &[json!(id)],
            )
            .map(map_row)
    }

    pub fn find_tasks_by_normalized_title(&self, title: &str) -> Vec<StoredTask> {
        self.database
            .query_all(
                &format!("SELECT {TASK_COLUMNS} FROM tasks WHERE normalized_title = ? ORDER BY id"),
                &[json!(title)],
            )
            .into_iter()
            .map(map_row)
            .collect()
    }

    pub fn list_decisions(&self, project_id: &str) -> Vec<StoredProjectDecision> {
        self.list_decisions_limit(project_id, 20)
    }

    pub fn list_decisions_limit(&self, project_id: &str, limit: i64) -> Vec<StoredProjectDecision> {
        self.database
            .query_all(
                &format!(
                    "SELECT {DECISION_COLUMNS} FROM project_decisions
       WHERE project_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?"
                ),
                &[json!(project_id), json!(limit)],
            )
            .into_iter()
            .map(map_row)
            .collect()
    }

    pub fn task_counts(&self, project_id: &str) -> TaskCounts {
        self.database
            .query_one(
                "SELECT
          COALESCE(SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END), 0) AS todo,
          COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) AS inProgress,
          COALESCE(SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END), 0) AS blocked,
          COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS done,
          COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled
         FROM tasks WHERE project_id = ?",
                &[json!(project_id)],
            )
            .map(map_row)
            .unwrap_or(TaskCounts {
                todo: 0,
                in_progress: 0,
                blocked: 0,
                done: 0,
                cancelled: 0,
            })
    }

    pub fn list_policies(&self) -> Vec<StoredPermissionPolicy> {
        self.database
            .query_all(
                "SELECT tool_id AS toolId, mode, updated_at AS updatedAt
       FROM permission_policies ORDER BY tool_id",
                &[],
            )
            .into_iter()
            .map(map_row)
            .collect()
    }

    pub fn find_policy(&self, tool_id: &str) -> Option<StoredPermissionPolicy> {
        self.database
            .query_one(
                "SELECT tool_id AS toolId, mode, updated_at AS updatedAt
       FROM permission_policies WHERE tool_id = ?",
                &[json!(tool_id)],
            )
            .map(map_row)
    }

    pub fn upsert_policy(&self, policy: &PermissionPolicyWrite, audit: &AuditEventWrite) {
        self.database.transaction(|| {
            self.database.run(
                "INSERT INTO permission_policies (tool_id, mode, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(tool_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at",
                &[
                    json!(policy.tool_id),
                    json!(policy.mode),
                    json!(policy.updated_at),
                ],
            );
            self.insert_audit(audit);
        });
    }

    pub fn list_approvals(&self, status: Option<&str>) -> Vec<StoredApprovalRequest> {
        match status {
            None => self
                .database
                .query_all(
                    &format!(
                        "SELECT {APPROVAL_COLUMNS} FROM approval_requests
           ORDER BY created_at DESC, id DESC"
                    ),
                    &[],
                )
                .into_iter()
                .map(map_row)
                .collect(),
            Some(status) => self
                .database
                .query_all(
                    &format!(
                        "SELECT {APPROVAL_COLUMNS} FROM approval_requests
           WHERE status = ? ORDER BY created_at, id"
                    ),
                    &[json!(status)],
                )
                .into_iter()
                .map(map_row)
                .collect(),
        }
    }

    pub fn find_approval_by_id(&self, id: &str) -> Option<StoredApprovalRequest> {
        self.database
            .query_one(
                &format!("SELECT {APPROVAL_COLUMNS} FROM approval_requests WHERE id = ?"),
                &[json!(id)],
            )
            .map(map_row)
    }

    pub fn find_approval_by_request_id(&self, request_id: &str) -> Option<StoredApprovalRequest> {
        self.database
            .query_one(
                &format!("SELECT {APPROVAL_COLUMNS} FROM approval_requests WHERE request_id = ?"),
                &[json!(request_id)],
            )
            .map(map_row)
    }

    pub fn create_approval(&self, approval: &ApprovalRequestWrite, audits: &[AuditEventWrite]) {
        self.database.transaction(|| {
            self.database.run(
                "INSERT INTO approval_requests (
          id, request_id, tool_id, summary, arguments_json, risk_level,
          affected_resources_json, reversible, status, actor_type, model_ref,
          correlation_id, expires_at, resolved_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                &[
                    json!(approval.id),
                    json!(approval.request_id),
                    json!(approval.tool_id),
                    json!(approval.summary),
                    json!(approval.arguments_json),
                    json!(approval.risk_level),
                    json!(approval.affected_resources_json),
                    json!(i64::from(approval.reversible)),
                    json!(approval.status),
                    json!(approval.actor_type),
                    json!(approval.model_ref),
                    json!(approval.correlation_id),
                    json!(approval.expires_at),
                    json!(approval.resolved_at),
                    json!(approval.created_at),
                ],
            );
            for audit in audits {
                self.insert_audit(audit);
            }
        });
    }

    pub fn resolve_approval(
        &self,
        id: &str,
        next_status: &str,
        resolved_at: &str,
        audit: &AuditEventWrite,
    ) -> Result<StoredApprovalRequest, ZeroError> {
        self.database.transaction(|| {
            let current = self.find_approval_by_id(id).ok_or_else(|| {
                failed(
                    ZeroErrorCode::ValidationFailed,
                    "The approval request was not found",
                )
            })?;
            if current.status != "pending" {
                return Err(failed(
                    ZeroErrorCode::PermissionDenied,
                    "The approval request is no longer pending",
                ));
            }
            self.database.run(
                "UPDATE approval_requests SET status = ?, resolved_at = ? WHERE id = ?",
                &[json!(next_status), json!(resolved_at), json!(id)],
            );
            self.insert_audit(audit);
            Ok(StoredApprovalRequest {
                status: next_status.to_string(),
                resolved_at: Some(resolved_at.to_string()),
                ..current
            })
        })
    }

    pub fn list_receipts(&self, limit: Option<i64>) -> Vec<StoredActionReceipt> {
        let limit = limit.unwrap_or(100);
        self.database
            .query_all(
                &format!(
                    "SELECT {RECEIPT_COLUMNS} FROM action_receipts
       ORDER BY created_at DESC, id DESC LIMIT ?"
                ),
                &[json!(limit)],
            )
            .into_iter()
            .map(map_row)
            .collect()
    }

    pub fn find_receipt_by_request_id(&self, request_id: &str) -> Option<StoredActionReceipt> {
        self.database
            .query_one(
                &format!("SELECT {RECEIPT_COLUMNS} FROM action_receipts WHERE request_id = ?"),
                &[json!(request_id)],
            )
            .map(map_row)
    }

    pub fn record_audit(&self, audit: &AuditEventWrite) {
        self.insert_audit(audit);
    }

    pub fn create_project(
        &self,
        project: &ProjectWrite,
        receipt: &ActionReceiptWrite,
        audit: &MutationAudit,
    ) -> Result<StoredActionReceipt, ZeroError> {
        self.mutate(receipt, audit, || {
            self.database.run(
                "INSERT INTO projects (
          id, name, normalized_name, description, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)",
                &[
                    json!(project.id),
                    json!(project.name),
                    json!(project.normalized_name),
                    json!(project.description),
                    json!(project.status),
                    json!(project.created_at),
                    json!(project.updated_at),
                ],
            );
            Ok(())
        })
    }

    pub fn create_task(
        &self,
        task: &TaskWrite,
        receipt: &ActionReceiptWrite,
        audit: &MutationAudit,
    ) -> Result<StoredActionReceipt, ZeroError> {
        self.mutate(receipt, audit, || {
            if self.find_project_by_id(&task.project_id).is_none() {
                return Err(failed(
                    ZeroErrorCode::ValidationFailed,
                    "The target project was not found",
                ));
            }
            self.database.run(
                "INSERT INTO tasks (
          id, project_id, title, normalized_title, description, status,
          priority, due_at, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                &[
                    json!(task.id),
                    json!(task.project_id),
                    json!(task.title),
                    json!(task.normalized_title),
                    json!(task.description),
                    json!(task.status),
                    json!(task.priority),
                    json!(task.due_at),
                    json!(task.source),
                    json!(task.created_at),
                    json!(task.updated_at),
                ],
            );
            Ok(())
        })
    }

    pub fn update_task(
        &self,
        task: &TaskWrite,
        receipt: &ActionReceiptWrite,
        audit: &MutationAudit,
    ) -> Result<StoredActionReceipt, ZeroError> {
        self.mutate(receipt, audit, || {
            if self.find_task_by_id(&task.id).is_none() {
                return Err(failed(
                    ZeroErrorCode::ValidationFailed,
                    "The task was not found",
                ));
            }
            self.database.run(
                "UPDATE tasks SET
          title = ?, normalized_title = ?, description = ?, status = ?,
          priority = ?, due_at = ?, updated_at = ?
         WHERE id = ? AND project_id = ?",
                &[
                    json!(task.title),
                    json!(task.normalized_title),
                    json!(task.description),
                    json!(task.status),
                    json!(task.priority),
                    json!(task.due_at),
                    json!(task.updated_at),
                    json!(task.id),
                    json!(task.project_id),
                ],
            );
            Ok(())
        })
    }

    pub fn add_decision(
        &self,
        decision: &ProjectDecisionWrite,
        receipt: &ActionReceiptWrite,
        audit: &MutationAudit,
    ) -> Result<StoredActionReceipt, ZeroError> {
        self.mutate(receipt, audit, || {
            if self.find_project_by_id(&decision.project_id).is_none() {
                return Err(failed(
                    ZeroErrorCode::ValidationFailed,
                    "The target project was not found",
                ));
            }
            self.database.run(
                "INSERT INTO project_decisions (id, project_id, title, detail, created_at)
         VALUES (?, ?, ?, ?, ?)",
                &[
                    json!(decision.id),
                    json!(decision.project_id),
                    json!(decision.title),
                    json!(decision.detail),
                    json!(decision.created_at),
                ],
            );
            Ok(())
        })
    }

    fn mutate(
        &self,
        receipt: &ActionReceiptWrite,
        audit: &MutationAudit,
        operation: impl FnOnce() -> Result<(), ZeroError>,
    ) -> Result<StoredActionReceipt, ZeroError> {
        self.database.transaction(|| {
            if let Some(approval_id) = &audit.approval_id {
                let approval = self.find_approval_by_id(approval_id).ok_or_else(|| {
                    failed(
                        ZeroErrorCode::ValidationFailed,
                        "The approval request was not found",
                    )
                })?;
                if approval.status != "pending" {
                    return Err(failed(
                        ZeroErrorCode::PermissionDenied,
                        "The approval was already resolved",
                    ));
                }
                if approval.expires_at <= receipt.created_at {
                    return Err(failed(
                        ZeroErrorCode::PermissionDenied,
                        "The approval request expired",
                    ));
                }
                if approval.tool_id != receipt.tool_id
                    || approval.request_id != receipt.request_id
                    || approval.arguments_json != receipt.arguments_json
                {
                    return Err(failed(
                        ZeroErrorCode::PermissionDenied,
                        "The approved action does not match the requested execution",
                    ));
                }
                self.database.run(
                    "UPDATE approval_requests SET status = 'executed', resolved_at = ? WHERE id = ?",
                    &[json!(receipt.created_at), json!(approval.id)],
                );
                let Some(granted) = &audit.approval_granted else {
                    panic!("Approved execution requires a grant audit event");
                };
                self.insert_audit(granted);
            } else if audit.approval_granted.is_some() {
                panic!("Unapproved execution cannot record an approval grant");
            }
            operation()?;
            self.insert_receipt(receipt);
            self.insert_audit(&audit.executed);
            Ok(receipt.clone())
        })
    }

    fn insert_receipt(&self, receipt: &ActionReceiptWrite) {
        self.database.run(
            "INSERT INTO action_receipts (
        id, request_id, correlation_id, actor_type, actor_id, model_ref,
        tool_id, requested_action, arguments_json, approval_state,
        result_json, affected_resources_json, rollback_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            &[
                json!(receipt.id),
                json!(receipt.request_id),
                json!(receipt.correlation_id),
                json!(receipt.actor_type),
                json!(receipt.actor_id),
                json!(receipt.model_ref),
                json!(receipt.tool_id),
                json!(receipt.requested_action),
                json!(receipt.arguments_json),
                json!(receipt.approval_state),
                json!(receipt.result_json),
                json!(receipt.affected_resources_json),
                json!(receipt.rollback_json),
                json!(receipt.created_at),
            ],
        );
    }

    fn insert_audit(&self, audit: &AuditEventWrite) {
        self.database.run(
            "INSERT INTO audit_events (
        id, event_type, actor_type, actor_id, correlation_id, risk_level,
        resource_refs_json, before_json, after_json, approval_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            &[
                json!(audit.id),
                json!(audit.event_type),
                json!(audit.actor_type),
                json!(audit.actor_id),
                json!(audit.correlation_id),
                json!(audit.risk_level),
                json!(audit.resource_refs_json),
                json!(audit.before_json),
                json!(audit.after_json),
                json!(audit.approval_id),
                json!(audit.created_at),
            ],
        );
    }
}
