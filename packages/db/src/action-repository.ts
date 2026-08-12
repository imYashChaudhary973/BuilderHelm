import { ZeroError } from '@zero/shared';

import type { ZeroDatabase } from './database.js';
import type { AuditEventWrite } from './provider-repository.js';

export interface ProjectWrite {
  readonly id: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly description: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredProject extends Record<string, unknown> {
  id: string;
  name: string;
  normalizedName: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskWrite {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly description: string | null;
  readonly status: string;
  readonly priority: string;
  readonly dueAt: string | null;
  readonly source: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredTask extends Record<string, unknown> {
  id: string;
  projectId: string;
  title: string;
  normalizedTitle: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDecisionWrite {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly detail: string | null;
  readonly createdAt: string;
}

export interface StoredProjectDecision extends Record<string, unknown> {
  id: string;
  projectId: string;
  title: string;
  detail: string | null;
  createdAt: string;
}

export interface PermissionPolicyWrite {
  readonly toolId: string;
  readonly mode: string;
  readonly updatedAt: string;
}

export interface StoredPermissionPolicy extends Record<string, unknown> {
  toolId: string;
  mode: string;
  updatedAt: string;
}

export interface ApprovalRequestWrite {
  readonly id: string;
  readonly requestId: string;
  readonly toolId: string;
  readonly summary: string;
  readonly argumentsJson: string;
  readonly riskLevel: string;
  readonly affectedResourcesJson: string;
  readonly reversible: boolean;
  readonly status: string;
  readonly actorType: string;
  readonly modelRef: string | null;
  readonly correlationId: string;
  readonly expiresAt: string;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

export interface StoredApprovalRequest extends Record<string, unknown> {
  id: string;
  requestId: string;
  toolId: string;
  summary: string;
  argumentsJson: string;
  riskLevel: string;
  affectedResourcesJson: string;
  reversible: number;
  status: string;
  actorType: string;
  modelRef: string | null;
  correlationId: string;
  expiresAt: string;
  resolvedAt: string | null;
  createdAt: string;
}

export interface ActionReceiptWrite {
  readonly id: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly modelRef: string | null;
  readonly toolId: string;
  readonly requestedAction: string;
  readonly argumentsJson: string;
  readonly approvalState: string;
  readonly resultJson: string;
  readonly affectedResourcesJson: string;
  readonly rollbackJson: string | null;
  readonly createdAt: string;
}

export interface StoredActionReceipt extends Record<string, unknown> {
  id: string;
  requestId: string;
  correlationId: string;
  actorType: string;
  actorId: string | null;
  modelRef: string | null;
  toolId: string;
  requestedAction: string;
  argumentsJson: string;
  approvalState: string;
  resultJson: string;
  affectedResourcesJson: string;
  rollbackJson: string | null;
  createdAt: string;
}

export interface TaskCounts extends Record<string, unknown> {
  todo: number;
  inProgress: number;
  blocked: number;
  done: number;
  cancelled: number;
}

interface MutationAudit {
  readonly approvalId: string | null;
  readonly approvalGranted: AuditEventWrite | null;
  readonly executed: AuditEventWrite;
}

const projectColumns = `
  id,
  name,
  normalized_name AS normalizedName,
  description,
  status,
  created_at AS createdAt,
  updated_at AS updatedAt
`;
const taskColumns = `
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
`;
const decisionColumns = `
  id,
  project_id AS projectId,
  title,
  detail,
  created_at AS createdAt
`;
const approvalColumns = `
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
`;
const receiptColumns = `
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
`;

export class ActionRepository {
  constructor(private readonly database: ZeroDatabase) {}

  listProjects(): StoredProject[] {
    return this.database.queryAll<StoredProject>(
      `SELECT ${projectColumns} FROM projects ORDER BY lower(name), id`,
    );
  }

  findProjectById(id: string): StoredProject | undefined {
    return this.database.queryOne<StoredProject>(
      `SELECT ${projectColumns} FROM projects WHERE id = ?`,
      [id],
    );
  }

  findProjectByNormalizedName(name: string): StoredProject | undefined {
    return this.database.queryOne<StoredProject>(
      `SELECT ${projectColumns} FROM projects WHERE normalized_name = ?`,
      [name],
    );
  }

  listTasks(projectId?: string, status?: string): StoredTask[] {
    if (projectId !== undefined && status !== undefined) {
      return this.database.queryAll<StoredTask>(
        `SELECT ${taskColumns} FROM tasks
         WHERE project_id = ? AND status = ?
         ORDER BY due_at IS NULL, due_at, created_at, id`,
        [projectId, status],
      );
    }
    if (projectId !== undefined) {
      return this.database.queryAll<StoredTask>(
        `SELECT ${taskColumns} FROM tasks
         WHERE project_id = ?
         ORDER BY due_at IS NULL, due_at, created_at, id`,
        [projectId],
      );
    }
    if (status !== undefined) {
      return this.database.queryAll<StoredTask>(
        `SELECT ${taskColumns} FROM tasks
         WHERE status = ?
         ORDER BY due_at IS NULL, due_at, created_at, id`,
        [status],
      );
    }
    return this.database.queryAll<StoredTask>(
      `SELECT ${taskColumns} FROM tasks
       ORDER BY due_at IS NULL, due_at, created_at, id`,
    );
  }

  findTaskById(id: string): StoredTask | undefined {
    return this.database.queryOne<StoredTask>(
      `SELECT ${taskColumns} FROM tasks WHERE id = ?`,
      [id],
    );
  }

  findTasksByNormalizedTitle(title: string): StoredTask[] {
    return this.database.queryAll<StoredTask>(
      `SELECT ${taskColumns} FROM tasks WHERE normalized_title = ? ORDER BY id`,
      [title],
    );
  }

  listDecisions(projectId: string, limit = 20): StoredProjectDecision[] {
    return this.database.queryAll<StoredProjectDecision>(
      `SELECT ${decisionColumns} FROM project_decisions
       WHERE project_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [projectId, limit],
    );
  }

  taskCounts(projectId: string): TaskCounts {
    return (
      this.database.queryOne<TaskCounts>(
        `SELECT
          COALESCE(SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END), 0) AS todo,
          COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) AS inProgress,
          COALESCE(SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END), 0) AS blocked,
          COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS done,
          COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled
         FROM tasks WHERE project_id = ?`,
        [projectId],
      ) ?? { todo: 0, inProgress: 0, blocked: 0, done: 0, cancelled: 0 }
    );
  }

  listPolicies(): StoredPermissionPolicy[] {
    return this.database.queryAll<StoredPermissionPolicy>(
      `SELECT tool_id AS toolId, mode, updated_at AS updatedAt
       FROM permission_policies ORDER BY tool_id`,
    );
  }

  findPolicy(toolId: string): StoredPermissionPolicy | undefined {
    return this.database.queryOne<StoredPermissionPolicy>(
      `SELECT tool_id AS toolId, mode, updated_at AS updatedAt
       FROM permission_policies WHERE tool_id = ?`,
      [toolId],
    );
  }

  upsertPolicy(policy: PermissionPolicyWrite, audit: AuditEventWrite): void {
    this.database.transaction(() => {
      this.database.run(
        `INSERT INTO permission_policies (tool_id, mode, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(tool_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`,
        [policy.toolId, policy.mode, policy.updatedAt],
      );
      this.insertAudit(audit);
    });
  }

  listApprovals(status?: string): StoredApprovalRequest[] {
    return status === undefined
      ? this.database.queryAll<StoredApprovalRequest>(
          `SELECT ${approvalColumns} FROM approval_requests
           ORDER BY created_at DESC, id DESC`,
        )
      : this.database.queryAll<StoredApprovalRequest>(
          `SELECT ${approvalColumns} FROM approval_requests
           WHERE status = ? ORDER BY created_at, id`,
          [status],
        );
  }

  findApprovalById(id: string): StoredApprovalRequest | undefined {
    return this.database.queryOne<StoredApprovalRequest>(
      `SELECT ${approvalColumns} FROM approval_requests WHERE id = ?`,
      [id],
    );
  }

  findApprovalByRequestId(requestId: string): StoredApprovalRequest | undefined {
    return this.database.queryOne<StoredApprovalRequest>(
      `SELECT ${approvalColumns} FROM approval_requests WHERE request_id = ?`,
      [requestId],
    );
  }

  createApproval(
    approval: ApprovalRequestWrite,
    audits: readonly AuditEventWrite[],
  ): void {
    this.database.transaction(() => {
      this.database.run(
        `INSERT INTO approval_requests (
          id, request_id, tool_id, summary, arguments_json, risk_level,
          affected_resources_json, reversible, status, actor_type, model_ref,
          correlation_id, expires_at, resolved_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          approval.id,
          approval.requestId,
          approval.toolId,
          approval.summary,
          approval.argumentsJson,
          approval.riskLevel,
          approval.affectedResourcesJson,
          Number(approval.reversible),
          approval.status,
          approval.actorType,
          approval.modelRef,
          approval.correlationId,
          approval.expiresAt,
          approval.resolvedAt,
          approval.createdAt,
        ],
      );
      for (const audit of audits) this.insertAudit(audit);
    });
  }

  resolveApproval(
    id: string,
    nextStatus: 'denied' | 'expired' | 'failed',
    resolvedAt: string,
    audit: AuditEventWrite,
  ): StoredApprovalRequest {
    return this.database.transaction(() => {
      const current = this.findApprovalById(id);
      if (current === undefined) {
        throw new ZeroError('VALIDATION_FAILED', 'The approval request was not found');
      }
      if (current.status !== 'pending') {
        throw new ZeroError(
          'PERMISSION_DENIED',
          'The approval request is no longer pending',
        );
      }
      this.database.run(
        `UPDATE approval_requests SET status = ?, resolved_at = ? WHERE id = ?`,
        [nextStatus, resolvedAt, id],
      );
      this.insertAudit(audit);
      return { ...current, status: nextStatus, resolvedAt };
    });
  }

  listReceipts(limit = 100): StoredActionReceipt[] {
    return this.database.queryAll<StoredActionReceipt>(
      `SELECT ${receiptColumns} FROM action_receipts
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      [limit],
    );
  }

  findReceiptByRequestId(requestId: string): StoredActionReceipt | undefined {
    return this.database.queryOne<StoredActionReceipt>(
      `SELECT ${receiptColumns} FROM action_receipts WHERE request_id = ?`,
      [requestId],
    );
  }

  recordAudit(audit: AuditEventWrite): void {
    this.insertAudit(audit);
  }

  createProject(
    project: ProjectWrite,
    receipt: ActionReceiptWrite,
    audit: MutationAudit,
  ): StoredActionReceipt {
    return this.mutate(receipt, audit, () => {
      this.database.run(
        `INSERT INTO projects (
          id, name, normalized_name, description, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          project.id,
          project.name,
          project.normalizedName,
          project.description,
          project.status,
          project.createdAt,
          project.updatedAt,
        ],
      );
    });
  }

  createTask(
    task: TaskWrite,
    receipt: ActionReceiptWrite,
    audit: MutationAudit,
  ): StoredActionReceipt {
    return this.mutate(receipt, audit, () => {
      if (this.findProjectById(task.projectId) === undefined) {
        throw new ZeroError('VALIDATION_FAILED', 'The target project was not found');
      }
      this.database.run(
        `INSERT INTO tasks (
          id, project_id, title, normalized_title, description, status,
          priority, due_at, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          task.id,
          task.projectId,
          task.title,
          task.normalizedTitle,
          task.description,
          task.status,
          task.priority,
          task.dueAt,
          task.source,
          task.createdAt,
          task.updatedAt,
        ],
      );
    });
  }

  updateTask(
    task: TaskWrite,
    receipt: ActionReceiptWrite,
    audit: MutationAudit,
  ): StoredActionReceipt {
    return this.mutate(receipt, audit, () => {
      if (this.findTaskById(task.id) === undefined) {
        throw new ZeroError('VALIDATION_FAILED', 'The task was not found');
      }
      this.database.run(
        `UPDATE tasks SET
          title = ?, normalized_title = ?, description = ?, status = ?,
          priority = ?, due_at = ?, updated_at = ?
         WHERE id = ? AND project_id = ?`,
        [
          task.title,
          task.normalizedTitle,
          task.description,
          task.status,
          task.priority,
          task.dueAt,
          task.updatedAt,
          task.id,
          task.projectId,
        ],
      );
    });
  }

  addDecision(
    decision: ProjectDecisionWrite,
    receipt: ActionReceiptWrite,
    audit: MutationAudit,
  ): StoredActionReceipt {
    return this.mutate(receipt, audit, () => {
      if (this.findProjectById(decision.projectId) === undefined) {
        throw new ZeroError('VALIDATION_FAILED', 'The target project was not found');
      }
      this.database.run(
        `INSERT INTO project_decisions (id, project_id, title, detail, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          decision.id,
          decision.projectId,
          decision.title,
          decision.detail,
          decision.createdAt,
        ],
      );
    });
  }

  private mutate(
    receipt: ActionReceiptWrite,
    audit: MutationAudit,
    operation: () => void,
  ): StoredActionReceipt {
    return this.database.transaction(() => {
      if (audit.approvalId !== null) {
        const approval = this.findApprovalById(audit.approvalId);
        if (approval === undefined) {
          throw new ZeroError('VALIDATION_FAILED', 'The approval request was not found');
        }
        if (approval.status !== 'pending') {
          throw new ZeroError('PERMISSION_DENIED', 'The approval was already resolved');
        }
        if (approval.expiresAt <= receipt.createdAt) {
          throw new ZeroError('PERMISSION_DENIED', 'The approval request expired');
        }
        if (
          approval.toolId !== receipt.toolId ||
          approval.requestId !== receipt.requestId ||
          approval.argumentsJson !== receipt.argumentsJson
        ) {
          throw new ZeroError(
            'PERMISSION_DENIED',
            'The approved action does not match the requested execution',
          );
        }
        this.database.run(
          `UPDATE approval_requests SET status = 'executed', resolved_at = ? WHERE id = ?`,
          [receipt.createdAt, approval.id],
        );
        if (audit.approvalGranted === null) {
          throw new TypeError('Approved execution requires a grant audit event');
        }
        this.insertAudit(audit.approvalGranted);
      } else if (audit.approvalGranted !== null) {
        throw new TypeError('Unapproved execution cannot record an approval grant');
      }

      operation();
      this.insertReceipt(receipt);
      this.insertAudit(audit.executed);
      return { ...receipt };
    });
  }

  private insertReceipt(receipt: ActionReceiptWrite): void {
    this.database.run(
      `INSERT INTO action_receipts (
        id, request_id, correlation_id, actor_type, actor_id, model_ref,
        tool_id, requested_action, arguments_json, approval_state,
        result_json, affected_resources_json, rollback_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receipt.id,
        receipt.requestId,
        receipt.correlationId,
        receipt.actorType,
        receipt.actorId,
        receipt.modelRef,
        receipt.toolId,
        receipt.requestedAction,
        receipt.argumentsJson,
        receipt.approvalState,
        receipt.resultJson,
        receipt.affectedResourcesJson,
        receipt.rollbackJson,
        receipt.createdAt,
      ],
    );
  }

  private insertAudit(audit: AuditEventWrite): void {
    this.database.run(
      `INSERT INTO audit_events (
        id, event_type, actor_type, actor_id, correlation_id, risk_level,
        resource_refs_json, before_json, after_json, approval_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        audit.id,
        audit.eventType,
        audit.actorType,
        audit.actorId,
        audit.correlationId,
        audit.riskLevel,
        audit.resourceRefsJson,
        audit.beforeJson,
        audit.afterJson,
        audit.approvalId,
        audit.createdAt,
      ],
    );
  }
}
