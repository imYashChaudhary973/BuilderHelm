import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { promisify } from 'node:util';

import type {
  ActionReceiptWrite,
  ApprovalRequestWrite,
  AuditEventWrite,
  StoredActionReceipt,
  StoredApprovalRequest,
  StoredProject,
  StoredProjectDecision,
  StoredTask,
  ActionRepository,
  ProjectRepositoryStore,
  ProjectDecisionWrite,
  ProjectWrite,
  TaskWrite,
} from '@zero/db';
import type { Logger } from '@zero/observability';
import {
  actionCommandInputSchema,
  actionCommandOutcomeSchema,
  actionReceiptSchema,
  actionSnapshotSchema,
  approvalRequestSchema,
  permissionPolicySchema,
  permissionPolicyUpdateInputSchema,
  projectDecisionSchema,
  projectSchema,
  projectStatusResultSchema,
  taskSchema,
  type ActionCommandInput,
  type ActionCommandOutcome,
  type ActionReceipt,
  type ActionSnapshot,
  type ApprovalRequest,
  type PermissionPolicy,
  type PermissionPolicyUpdateInput,
  type Project,
  type ProjectDecision,
  type ResourceRef,
  type Task,
  type WorkToolId,
} from '@zero/protocol/actions';
import type { JsonValue } from '@zero/protocol/json';
import type { ModelRequest } from '@zero/protocol/model';
import { createId, normalizeError, ZeroError, type CorrelationId } from '@zero/shared';
import type { PermissionEngine, ToolRegistry } from '@zero/tools';

import type { ModelService } from '../models/model-service.js';
import {
  normalizeWorkName,
  parseDeterministicAction,
  type ParsedActionIntent,
} from './intent-parser.js';

const approvalLifetimeMs = 10 * 60 * 1_000;
const defaultPolicyUpdatedAt = '1970-01-01T00:00:00.000Z';
const execFileAsync = promisify(execFile);

interface PlannedAction extends ParsedActionIntent {
  readonly requestId: string;
  readonly actorType: 'deterministic_intent' | 'model';
  readonly modelRef: string | null;
}

function parseJson(value: string): JsonValue {
  return JSON.parse(value) as JsonValue;
}

function toProject(value: StoredProject): Project {
  return projectSchema.parse({
    id: value.id,
    name: value.name,
    description: value.description,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

function toTask(value: StoredTask): Task {
  return taskSchema.parse({
    id: value.id,
    projectId: value.projectId,
    title: value.title,
    description: value.description,
    status: value.status,
    priority: value.priority,
    dueAt: value.dueAt,
    source: value.source,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

function toDecision(value: StoredProjectDecision): ProjectDecision {
  return projectDecisionSchema.parse(value);
}

function toApproval(value: StoredApprovalRequest): ApprovalRequest {
  return approvalRequestSchema.parse({
    id: value.id,
    requestId: value.requestId,
    toolId: value.toolId,
    summary: value.summary,
    exactArguments: parseJson(value.argumentsJson),
    risk: value.riskLevel,
    affectedResources: parseJson(value.affectedResourcesJson),
    reversible: value.reversible === 1,
    status: value.status,
    actorType: value.actorType,
    modelRef: value.modelRef,
    expiresAt: value.expiresAt,
    resolvedAt: value.resolvedAt,
    createdAt: value.createdAt,
  });
}

function toReceipt(value: StoredActionReceipt): ActionReceipt {
  return actionReceiptSchema.parse({
    id: value.id,
    requestId: value.requestId,
    correlationId: value.correlationId,
    actorType: value.actorType,
    actorId: value.actorId,
    modelRef: value.modelRef,
    toolId: value.toolId,
    requestedAction: value.requestedAction,
    exactArguments: parseJson(value.argumentsJson),
    approvalState: value.approvalState,
    result: parseJson(value.resultJson),
    affectedResources: parseJson(value.affectedResourcesJson),
    rollbackInformation:
      value.rollbackJson === null ? null : parseJson(value.rollbackJson),
    createdAt: value.createdAt,
  });
}

function audit(input: {
  readonly eventType: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly correlationId: CorrelationId;
  readonly riskLevel: string;
  readonly resources: readonly ResourceRef[];
  readonly before?: JsonValue | null;
  readonly after?: JsonValue | null;
  readonly approvalId?: string | null;
  readonly createdAt: string;
}): AuditEventWrite {
  return {
    id: createId(),
    eventType: input.eventType,
    actorType: input.actorType,
    actorId: input.actorId,
    correlationId: input.correlationId,
    riskLevel: input.riskLevel,
    resourceRefsJson: JSON.stringify(input.resources),
    beforeJson:
      input.before === undefined || input.before === null
        ? null
        : JSON.stringify(input.before),
    afterJson:
      input.after === undefined || input.after === null
        ? null
        : JSON.stringify(input.after),
    approvalId: input.approvalId ?? null,
    createdAt: input.createdAt,
  };
}

function actorId(plan: PlannedAction): string {
  return plan.actorType === 'model' && plan.modelRef !== null
    ? plan.modelRef
    : 'action.intent.local';
}

function object(value: JsonValue): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new ZeroError('TOOL_SCHEMA_INVALID', 'Tool arguments must be an object');
  }
  return value;
}

export class ActionService {
  constructor(
    private readonly repository: ActionRepository,
    private readonly models: ModelService,
    private readonly logger: Logger,
    private readonly registry: ToolRegistry,
    private readonly permissions: PermissionEngine,
    private readonly projectRepositories: ProjectRepositoryStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  snapshot(correlationId: CorrelationId): ActionSnapshot {
    // Snapshot callers cannot replace the immutable correlation stored with
    // pending approvals.
    void correlationId;
    this.expireApprovals();
    const storedPolicies = new Map(
      this.repository.listPolicies().map((policy) => [policy.toolId, policy]),
    );
    return actionSnapshotSchema.parse({
      projects: this.repository.listProjects().map(toProject),
      tasks: this.repository.listTasks().map(toTask),
      pendingApprovals: this.repository.listApprovals('pending').map(toApproval),
      receipts: this.repository.listReceipts().map(toReceipt),
      policies: this.registry.list().map((tool) => {
        const stored = storedPolicies.get(tool.id);
        return permissionPolicySchema.parse({
          toolId: tool.id,
          mode: stored?.mode ?? 'ask',
          updatedAt: stored?.updatedAt ?? defaultPolicyUpdatedAt,
        });
      }),
      tools: this.registry.list(),
    });
  }

  async command(
    rawInput: ActionCommandInput,
    correlationId: CorrelationId,
    signal: AbortSignal,
  ): Promise<ActionCommandOutcome> {
    const input = actionCommandInputSchema.parse(rawInput);
    const priorReceipt = this.repository.findReceiptByRequestId(input.requestId);
    if (priorReceipt !== undefined) return this.executedOutcome(toReceipt(priorReceipt));
    const priorApproval = this.repository.findApprovalByRequestId(input.requestId);
    if (priorApproval !== undefined) {
      if (priorApproval.status !== 'pending') {
        throw new ZeroError(
          'PERMISSION_DENIED',
          'This action request was already resolved',
        );
      }
      return actionCommandOutcomeSchema.parse({
        kind: 'approval_required',
        message: 'This action is waiting for your approval.',
        approval: toApproval(priorApproval),
      });
    }

    const deterministic = parseDeterministicAction(
      input.text,
      this.repository,
      this.clock(),
    );
    const proposedPlan: PlannedAction =
      deterministic === null
        ? await this.proposeWithModel(input, correlationId, signal)
        : {
            ...deterministic,
            requestId: input.requestId,
            actorType: 'deterministic_intent',
            modelRef: null,
          };
    const plan: PlannedAction = {
      ...proposedPlan,
      input: this.registry.parseInput(proposedPlan.toolId, proposedPlan.input),
    };
    return this.propose(plan, correlationId);
  }

  async approve(
    approvalId: string,
    correlationId: CorrelationId,
  ): Promise<ActionCommandOutcome> {
    // Resolution uses the correlation captured when the action was proposed.
    void correlationId;
    const stored = this.repository.findApprovalById(approvalId);
    if (stored === undefined) {
      throw new ZeroError('VALIDATION_FAILED', 'The approval request was not found');
    }
    const approvalCorrelationId = stored.correlationId as CorrelationId;
    const now = utcNowFrom(this.clock());
    if (stored.status !== 'pending') {
      throw new ZeroError(
        'PERMISSION_DENIED',
        'The approval request is no longer pending',
      );
    }
    if (stored.expiresAt <= now) {
      this.repository.resolveApproval(
        stored.id,
        'expired',
        now,
        audit({
          eventType: 'approval.expired',
          actorType: 'user',
          actorId: null,
          correlationId: approvalCorrelationId,
          riskLevel: stored.riskLevel,
          resources: approvalRequestSchema.parse(toApproval(stored)).affectedResources,
          approvalId: stored.id,
          createdAt: now,
        }),
      );
      throw new ZeroError('PERMISSION_DENIED', 'The approval request expired');
    }
    const toolId = this.registry.resolve(stored.toolId);
    const descriptor = this.registry.descriptor(toolId);
    const policy = this.policy(toolId);
    const decision = this.permissions.evaluate({
      risk: descriptor.risk,
      policy,
      explicitApproval: true,
      rollbackSupport: descriptor.rollbackSupport,
    });
    if (decision !== 'allow') {
      throw new ZeroError('PERMISSION_DENIED', 'The current policy denies this tool');
    }
    const plan: PlannedAction = {
      requestId: stored.requestId,
      toolId,
      input: this.registry.parseInput(toolId, parseJson(stored.argumentsJson)),
      actorType: stored.actorType === 'model' ? 'model' : 'deterministic_intent',
      modelRef: stored.modelRef,
    };
    try {
      if (plan.toolId === 'project.run_tests') {
        return await this.executeRunTests(
          plan,
          approvalCorrelationId,
          stored.id,
          'granted',
        );
      }
      return this.executeWrite(plan, approvalCorrelationId, stored.id, 'granted');
    } catch (error) {
      const normalized = normalizeError(error, 'TOOL_EXECUTION_FAILED');
      const current = this.repository.findApprovalById(stored.id);
      if (current?.status === 'pending') {
        this.repository.resolveApproval(
          stored.id,
          'failed',
          now,
          audit({
            eventType: 'agent.tool_failed',
            actorType: plan.actorType,
            actorId: actorId(plan),
            correlationId: approvalCorrelationId,
            riskLevel: descriptor.risk,
            resources: toApproval(stored).affectedResources,
            after: { code: normalized.code },
            approvalId: stored.id,
            createdAt: now,
          }),
        );
      }
      throw normalized;
    }
  }

  reject(approvalId: string, correlationId: CorrelationId): ApprovalRequest {
    // Resolution uses the correlation captured when the action was proposed.
    void correlationId;
    const stored = this.repository.findApprovalById(approvalId);
    if (stored === undefined) {
      throw new ZeroError('VALIDATION_FAILED', 'The approval request was not found');
    }
    const approvalCorrelationId = stored.correlationId as CorrelationId;
    const now = utcNowFrom(this.clock());
    return toApproval(
      this.repository.resolveApproval(
        stored.id,
        'denied',
        now,
        audit({
          eventType: 'approval.denied',
          actorType: 'user',
          actorId: null,
          correlationId: approvalCorrelationId,
          riskLevel: stored.riskLevel,
          resources: toApproval(stored).affectedResources,
          approvalId: stored.id,
          createdAt: now,
        }),
      ),
    );
  }

  updatePolicy(
    rawInput: PermissionPolicyUpdateInput,
    correlationId: CorrelationId,
  ): PermissionPolicy {
    const input = permissionPolicyUpdateInputSchema.parse(rawInput);
    const descriptor = this.registry.descriptor(input.toolId);
    this.permissions.validatePolicy(
      descriptor.risk,
      input.mode,
      descriptor.rollbackSupport,
    );
    const before = this.repository.findPolicy(input.toolId);
    const now = utcNowFrom(this.clock());
    const policy = permissionPolicySchema.parse({ ...input, updatedAt: now });
    this.repository.upsertPolicy(
      policy,
      audit({
        eventType: 'permission.policy_updated',
        actorType: 'user',
        actorId: null,
        correlationId,
        riskLevel: descriptor.risk,
        resources: [],
        before:
          before === undefined ? null : { toolId: before.toolId, mode: before.mode },
        after: { toolId: policy.toolId, mode: policy.mode },
        createdAt: now,
      }),
    );
    return policy;
  }

  private async proposeWithModel(
    input: ReturnType<typeof actionCommandInputSchema.parse>,
    correlationId: CorrelationId,
    signal: AbortSignal,
  ): Promise<PlannedAction> {
    if (input.modelRef === null) {
      throw new ZeroError(
        'VALIDATION_FAILED',
        'Command not recognized. Try “Create project Project A” or “Add a high-priority task to Project A to benchmark sync tomorrow.”',
      );
    }
    const modelRef = input.modelRef;
    const startedAt = utcNowFrom(this.clock());
    this.repository.recordAudit(
      audit({
        eventType: 'agent.model_invoked',
        actorType: 'model',
        actorId: modelRef,
        correlationId,
        riskLevel: 'read',
        resources: [],
        after: { modelRef, purpose: 'tool_proposal' },
        createdAt: startedAt,
      }),
    );
    const catalog = {
      projects: this.repository
        .listProjects()
        .slice(0, 100)
        .map((project) => ({ id: project.id, name: project.name })),
      tasks: this.repository
        .listTasks()
        .slice(0, 200)
        .map((task) => ({ id: task.id, projectId: task.projectId, title: task.title })),
    };
    const request: ModelRequest = {
      modelRef,
      messages: [
        {
          id: createId(),
          role: 'system',
          content: [
            {
              type: 'text',
              text: [
                'Translate the user request into exactly one supplied tool call.',
                'Never invent project or task IDs; use only the catalog.',
                'Do not claim an action executed. Zero independently validates and authorizes it.',
                `Local catalog: ${JSON.stringify(catalog)}`,
              ].join(' '),
            },
          ],
          createdAt: utcNowFrom(this.clock()),
        },
        {
          id: createId(),
          role: 'user',
          content: [{ type: 'text', text: input.text }],
          createdAt: utcNowFrom(this.clock()),
        },
      ],
      tools: this.registry.modelDefinitions(),
      // Project/task records do not yet carry sensitivity metadata. Fail
      // closed for remote egress while preserving local model fallback.
      dataClassifications: ['personal', 'sensitive', 'health'],
      stream: true,
    };
    try {
      const calls: Array<{ name: string; arguments: JsonValue }> = [];
      let completed = false;
      for await (const event of this.models.stream(request, correlationId, signal)) {
        if (event.type === 'tool.proposed') {
          calls.push({ name: event.call.name, arguments: event.call.arguments });
        } else if (event.type === 'error') {
          throw new ZeroError(event.error.code, event.error.message, {
            retryable: event.error.retryable,
          });
        } else if (event.type === 'done') {
          completed = true;
        }
      }
      if (!completed) {
        throw new ZeroError('MODEL_UNAVAILABLE', 'The action proposal ended early');
      }
      if (calls.length !== 1) {
        throw new ZeroError(
          'TOOL_SCHEMA_INVALID',
          'The model must propose exactly one action at a time',
        );
      }
      const call = calls[0]!;
      const toolId = this.registry.resolve(call.name);
      const plan: PlannedAction = {
        requestId: input.requestId,
        toolId,
        input: this.registry.parseInput(toolId, call.arguments),
        actorType: 'model',
        modelRef,
      };
      this.repository.recordAudit(
        audit({
          eventType: 'agent.model_completed',
          actorType: 'model',
          actorId: modelRef,
          correlationId,
          riskLevel: 'read',
          resources: [],
          after: { modelRef, toolId },
          createdAt: utcNowFrom(this.clock()),
        }),
      );
      return plan;
    } catch (error) {
      const normalized = normalizeError(error, 'MODEL_UNAVAILABLE');
      this.repository.recordAudit(
        audit({
          eventType: 'agent.model_failed',
          actorType: 'model',
          actorId: modelRef,
          correlationId,
          riskLevel: 'read',
          resources: [],
          after: { modelRef, code: normalized.code },
          createdAt: utcNowFrom(this.clock()),
        }),
      );
      throw normalized;
    }
  }

  private propose(
    plan: PlannedAction,
    correlationId: CorrelationId,
  ): ActionCommandOutcome {
    const descriptor = this.registry.descriptor(plan.toolId);
    const resources = this.resources(plan);
    const now = utcNowFrom(this.clock());
    const permission = this.permissions.evaluate({
      risk: descriptor.risk,
      policy: this.policy(plan.toolId),
      explicitApproval: false,
      rollbackSupport: descriptor.rollbackSupport,
    });
    if (permission !== 'require_approval') {
      this.repository.recordAudit(
        audit({
          eventType: 'agent.tool_requested',
          actorType: plan.actorType,
          actorId: actorId(plan),
          correlationId,
          riskLevel: descriptor.risk,
          resources,
          after: { toolId: plan.toolId },
          createdAt: now,
        }),
      );
    }
    if (permission === 'deny') {
      this.repository.recordAudit(
        audit({
          eventType: 'agent.tool_denied',
          actorType: plan.actorType,
          actorId: actorId(plan),
          correlationId,
          riskLevel: descriptor.risk,
          resources,
          after: { toolId: plan.toolId, code: 'PERMISSION_DENIED' },
          createdAt: now,
        }),
      );
      throw new ZeroError('PERMISSION_DENIED', 'The permission policy denies this tool');
    }
    if (permission === 'require_approval') {
      const approval = approvalRequestSchema.parse({
        id: createId(),
        requestId: plan.requestId,
        toolId: plan.toolId,
        summary: this.registry.summarize(plan.toolId, plan.input),
        exactArguments: plan.input,
        risk: descriptor.risk,
        affectedResources: resources,
        reversible: descriptor.rollbackSupport !== 'none',
        status: 'pending',
        actorType: plan.actorType,
        modelRef: plan.modelRef,
        expiresAt: new Date(this.clock().getTime() + approvalLifetimeMs).toISOString(),
        resolvedAt: null,
        createdAt: now,
      });
      const write: ApprovalRequestWrite = {
        id: approval.id,
        requestId: approval.requestId,
        toolId: approval.toolId,
        summary: approval.summary,
        argumentsJson: JSON.stringify(approval.exactArguments),
        riskLevel: approval.risk,
        affectedResourcesJson: JSON.stringify(approval.affectedResources),
        reversible: approval.reversible,
        status: approval.status,
        actorType: approval.actorType,
        modelRef: approval.modelRef,
        correlationId,
        expiresAt: approval.expiresAt,
        resolvedAt: null,
        createdAt: approval.createdAt,
      };
      this.repository.createApproval(write, [
        audit({
          eventType: 'agent.tool_requested',
          actorType: plan.actorType,
          actorId: actorId(plan),
          correlationId,
          riskLevel: descriptor.risk,
          resources,
          after: { toolId: plan.toolId },
          approvalId: approval.id,
          createdAt: now,
        }),
        audit({
          eventType: 'approval.requested',
          actorType: plan.actorType,
          actorId: actorId(plan),
          correlationId,
          riskLevel: descriptor.risk,
          resources,
          after: { toolId: plan.toolId, expiresAt: approval.expiresAt },
          approvalId: approval.id,
          createdAt: now,
        }),
      ]);
      return actionCommandOutcomeSchema.parse({
        kind: 'approval_required',
        message: 'Review the exact action before it changes local data.',
        approval,
      });
    }
    if (descriptor.risk === 'read' || descriptor.risk === 'draft') {
      return this.executeRead(plan, correlationId);
    }
    return this.executeWrite(plan, correlationId, null, 'auto_approved');
  }

  private executeRead(
    plan: PlannedAction,
    correlationId: CorrelationId,
  ): ActionCommandOutcome {
    const args = object(plan.input);
    let result: unknown;
    let message: string;
    if (plan.toolId === 'task.list') {
      result = this.repository
        .listTasks(
          typeof args.projectId === 'string' ? args.projectId : undefined,
          typeof args.status === 'string' ? args.status : undefined,
        )
        .map(toTask);
      message = `${(result as Task[]).length} task${(result as Task[]).length === 1 ? '' : 's'} found.`;
    } else if (plan.toolId === 'project.get_status') {
      const projectId = String(args.projectId);
      const project = this.repository.findProjectById(projectId);
      if (project === undefined) {
        throw new ZeroError('VALIDATION_FAILED', 'The project was not found');
      }
      result = projectStatusResultSchema.parse({
        project: toProject(project),
        taskCounts: this.repository.taskCounts(projectId),
        recentDecisions: this.repository.listDecisions(projectId).map(toDecision),
      });
      const counts = (result as ReturnType<typeof projectStatusResultSchema.parse>)
        .taskCounts;
      message = `${project.name}: ${counts.todo} todo, ${counts.inProgress} in progress, ${counts.blocked} blocked, ${counts.done} done.`;
    } else {
      throw new ZeroError('TOOL_EXECUTION_FAILED', 'This tool is not a read action');
    }
    const output = this.registry.parseOutput(plan.toolId, result);
    const now = utcNowFrom(this.clock());
    const resources = this.resources(plan);
    this.repository.recordAudit(
      audit({
        eventType: 'agent.tool_executed',
        actorType: plan.actorType,
        actorId: actorId(plan),
        correlationId,
        riskLevel: 'read',
        resources,
        after: {
          toolId: plan.toolId,
          resultCount: Array.isArray(output) ? output.length : 1,
        },
        createdAt: now,
      }),
    );
    return actionCommandOutcomeSchema.parse({
      kind: 'read_result',
      message,
      toolId: plan.toolId,
      result: output,
    });
  }

  private executeWrite(
    plan: PlannedAction,
    correlationId: CorrelationId,
    approvalId: string | null,
    approvalState: 'auto_approved' | 'granted',
  ): ActionCommandOutcome {
    const descriptor = this.registry.descriptor(plan.toolId);
    const args = object(plan.input);
    const now = utcNowFrom(this.clock());
    const resources = this.resources(plan);
    let before: JsonValue | null = null;
    let output: JsonValue;
    let rollback: JsonValue | null = null;
    let mutation:
      | { kind: 'project'; value: ProjectWrite }
      | { kind: 'task_create'; value: TaskWrite }
      | { kind: 'task_update'; value: TaskWrite }
      | { kind: 'decision'; value: ProjectDecisionWrite };

    if (plan.toolId === 'project.create') {
      const name = String(args.name);
      if (this.repository.findProjectByNormalizedName(normalizeWorkName(name))) {
        throw new ZeroError(
          'VALIDATION_FAILED',
          'A project with this name already exists',
        );
      }
      const project = projectSchema.parse({
        id: plan.requestId,
        name,
        description: args.description ?? null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
      output = this.registry.parseOutput(plan.toolId, project);
      mutation = {
        kind: 'project',
        value: { ...project, normalizedName: normalizeWorkName(project.name) },
      };
      rollback = { kind: 'manual', instruction: `Archive project ${project.id}` };
    } else if (plan.toolId === 'task.create') {
      const projectId = String(args.projectId);
      if (this.repository.findProjectById(projectId) === undefined) {
        throw new ZeroError('VALIDATION_FAILED', 'The target project was not found');
      }
      const task = taskSchema.parse({
        id: plan.requestId,
        projectId,
        title: args.title,
        description: args.description ?? null,
        status: 'todo',
        priority: args.priority,
        dueAt: args.dueAt ?? null,
        source: 'action_chat',
        createdAt: now,
        updatedAt: now,
      });
      output = this.registry.parseOutput(plan.toolId, task);
      mutation = {
        kind: 'task_create',
        value: { ...task, normalizedTitle: normalizeWorkName(task.title) },
      };
      rollback = { kind: 'manual', instruction: `Cancel task ${task.id}` };
    } else if (plan.toolId === 'task.update') {
      const current = this.repository.findTaskById(String(args.taskId));
      if (current === undefined) {
        throw new ZeroError('VALIDATION_FAILED', 'The task was not found');
      }
      before = toTask(current) as unknown as JsonValue;
      const task = taskSchema.parse({
        ...toTask(current),
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.status === undefined ? {} : { status: args.status }),
        ...(args.priority === undefined ? {} : { priority: args.priority }),
        ...(args.dueAt === undefined ? {} : { dueAt: args.dueAt }),
        updatedAt: now,
      });
      output = this.registry.parseOutput(plan.toolId, task);
      mutation = {
        kind: 'task_update',
        value: { ...task, normalizedTitle: normalizeWorkName(task.title) },
      };
      rollback = {
        toolId: 'task.update',
        arguments: {
          taskId: current.id,
          title: current.title,
          description: current.description,
          status: current.status,
          priority: current.priority,
          dueAt: current.dueAt,
        },
      };
    } else if (plan.toolId === 'project.add_decision') {
      const projectId = String(args.projectId);
      if (this.repository.findProjectById(projectId) === undefined) {
        throw new ZeroError('VALIDATION_FAILED', 'The target project was not found');
      }
      const decision = projectDecisionSchema.parse({
        id: plan.requestId,
        projectId,
        title: args.title,
        detail: args.detail ?? null,
        createdAt: now,
      });
      output = this.registry.parseOutput(plan.toolId, decision);
      mutation = { kind: 'decision', value: decision };
      rollback = null;
    } else {
      throw new ZeroError('TOOL_EXECUTION_FAILED', 'This tool is not a write action');
    }

    const receiptWrite: ActionReceiptWrite = {
      id: createId(),
      requestId: plan.requestId,
      correlationId,
      actorType: plan.actorType,
      actorId: actorId(plan),
      modelRef: plan.modelRef,
      toolId: plan.toolId,
      requestedAction: this.registry.summarize(plan.toolId, plan.input),
      argumentsJson: JSON.stringify(plan.input),
      approvalState,
      resultJson: JSON.stringify(output),
      affectedResourcesJson: JSON.stringify(resources),
      rollbackJson: rollback === null ? null : JSON.stringify(rollback),
      createdAt: now,
    };
    const mutationAudit = {
      approvalId,
      approvalGranted:
        approvalId === null
          ? null
          : audit({
              eventType: 'approval.granted',
              actorType: 'user',
              actorId: null,
              correlationId,
              riskLevel: descriptor.risk,
              resources,
              after: { toolId: plan.toolId },
              approvalId,
              createdAt: now,
            }),
      executed: audit({
        eventType: 'agent.tool_executed',
        actorType: plan.actorType,
        actorId: actorId(plan),
        correlationId,
        riskLevel: descriptor.risk,
        resources,
        before,
        after: output,
        approvalId,
        createdAt: now,
      }),
    };
    const stored =
      mutation.kind === 'project'
        ? this.repository.createProject(mutation.value, receiptWrite, mutationAudit)
        : mutation.kind === 'task_create'
          ? this.repository.createTask(mutation.value, receiptWrite, mutationAudit)
          : mutation.kind === 'task_update'
            ? this.repository.updateTask(mutation.value, receiptWrite, mutationAudit)
            : this.repository.addDecision(mutation.value, receiptWrite, mutationAudit);
    const receipt = toReceipt(stored);
    this.logger.info({
      event: 'action.executed',
      correlationId,
      data: {
        receiptId: receipt.id,
        toolId: receipt.toolId,
        approvalState: receipt.approvalState,
      },
    });
    return this.executedOutcome(receipt);
  }

  private async executeRunTests(
    plan: PlannedAction,
    correlationId: CorrelationId,
    approvalId: string | null,
    approvalState: 'auto_approved' | 'granted',
  ): Promise<ActionCommandOutcome> {
    const descriptor = this.registry.descriptor(plan.toolId);
    const projectId = String(object(plan.input).projectId);
    const storedRepo = this.projectRepositories.findByProjectId(projectId);
    if (storedRepo === undefined) {
      throw new ZeroError(
        'VALIDATION_FAILED',
        'The project has no registered repository',
      );
    }
    let resolvedRoot: string;
    try {
      resolvedRoot = realpathSync.native(storedRepo.rootPath);
    } catch (cause) {
      throw new ZeroError('PERMISSION_DENIED', 'The repository location changed', {
        cause,
      });
    }
    if (resolvedRoot !== storedRepo.rootPath) {
      throw new ZeroError('PERMISSION_DENIED', 'The repository location changed');
    }

    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    try {
      const result = await execFileAsync('node', ['--test'], {
        cwd: resolvedRoot,
        timeout: 15_000,
        maxBuffer: 2_000_000,
        windowsHide: true,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
      });
      stdout = result.stdout.slice(0, 8_000);
      stderr = result.stderr.slice(0, 8_000);
    } catch (error) {
      const failure = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
      if (typeof failure.code !== 'number') {
        throw new ZeroError(
          'TOOL_EXECUTION_FAILED',
          'The test runner failed to start',
          { cause: error },
        );
      }
      exitCode = failure.code;
      stdout = String(failure.stdout ?? '').slice(0, 8_000);
      stderr = String(failure.stderr ?? '').slice(0, 8_000);
    }

    const output = this.registry.parseOutput(plan.toolId, {
      exitCode,
      passed: exitCode === 0,
      stdout,
      stderr,
    });
    const now = utcNowFrom(this.clock());
    const resources = this.resources(plan);
    const receiptWrite: ActionReceiptWrite = {
      id: createId(),
      requestId: plan.requestId,
      correlationId,
      actorType: plan.actorType,
      actorId: actorId(plan),
      modelRef: plan.modelRef,
      toolId: plan.toolId,
      requestedAction: this.registry.summarize(plan.toolId, plan.input),
      argumentsJson: JSON.stringify(plan.input),
      approvalState,
      resultJson: JSON.stringify(output),
      affectedResourcesJson: JSON.stringify(resources),
      rollbackJson: null,
      createdAt: now,
    };
    const stored = this.repository.recordReceipt(receiptWrite, {
      approvalId,
      approvalGranted:
        approvalId === null
          ? null
          : audit({
              eventType: 'approval.granted',
              actorType: 'user',
              actorId: null,
              correlationId,
              riskLevel: descriptor.risk,
              resources,
              after: { toolId: plan.toolId },
              approvalId,
              createdAt: now,
            }),
      executed: audit({
        eventType: 'agent.tool_executed',
        actorType: plan.actorType,
        actorId: actorId(plan),
        correlationId,
        riskLevel: descriptor.risk,
        resources,
        after: output,
        approvalId,
        createdAt: now,
      }),
    });
    const receipt = toReceipt(stored);
    this.logger.info({
      event: 'action.executed',
      correlationId,
      data: {
        receiptId: receipt.id,
        toolId: receipt.toolId,
        approvalState: receipt.approvalState,
      },
    });
    return this.executedOutcome(receipt);
  }

  private resources(plan: PlannedAction): ResourceRef[] {
    const resources = this.registry.resources(plan.toolId, plan.input).map((resource) => {
      if (resource.type === 'project') {
        const project = this.repository.findProjectById(resource.id);
        return project === undefined ? resource : { ...resource, label: project.name };
      }
      if (resource.type === 'task') {
        const task = this.repository.findTaskById(resource.id);
        return task === undefined ? resource : { ...resource, label: task.title };
      }
      return resource;
    });
    const args = object(plan.input);
    if (plan.toolId === 'project.create') {
      resources.push({ type: 'project', id: plan.requestId, label: String(args.name) });
    } else if (plan.toolId === 'task.create') {
      resources.push({ type: 'task', id: plan.requestId, label: String(args.title) });
    } else if (plan.toolId === 'project.add_decision') {
      resources.push({ type: 'decision', id: plan.requestId, label: String(args.title) });
    }
    return resources;
  }

  private policy(toolId: WorkToolId): 'ask' | 'auto_approve' | 'deny' {
    const mode = this.repository.findPolicy(toolId)?.mode;
    return mode === 'auto_approve' || mode === 'deny' ? mode : 'ask';
  }

  private executedOutcome(receipt: ActionReceipt): ActionCommandOutcome {
    return actionCommandOutcomeSchema.parse({
      kind: 'executed',
      message: `${receipt.requestedAction} completed. Receipt ${receipt.id.slice(0, 8)} recorded.`,
      receipt,
    });
  }

  private expireApprovals(): void {
    const now = utcNowFrom(this.clock());
    for (const stored of this.repository.listApprovals('pending')) {
      if (stored.expiresAt > now) continue;
      try {
        this.repository.resolveApproval(
          stored.id,
          'expired',
          now,
          audit({
            eventType: 'approval.expired',
            actorType: 'system',
            actorId: null,
            correlationId: stored.correlationId as CorrelationId,
            riskLevel: stored.riskLevel,
            resources: toApproval(stored).affectedResources,
            approvalId: stored.id,
            createdAt: now,
          }),
        );
      } catch (error) {
        this.logger.warn({
          event: 'approval.expiry_failed',
          correlationId: stored.correlationId as CorrelationId,
          data: { approvalId: stored.id, code: normalizeError(error).code },
        });
      }
    }
  }
}

function utcNowFrom(value: Date): string {
  return value.toISOString();
}
