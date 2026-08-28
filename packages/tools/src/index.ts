import {
  projectAddDecisionInputSchema,
  projectCreateInputSchema,
  projectDecisionSchema,
  projectGetStatusInputSchema,
  projectSchema,
  projectStatusResultSchema,
  taskCreateInputSchema,
  taskListInputSchema,
  taskSchema,
  taskUpdateInputSchema,
  toolDescriptorSchema,
  type PermissionLevel,
  type PermissionPolicyMode,
  type ResourceRef,
  type ToolDescriptor,
  type WorkToolId,
} from '@builderhelm/protocol/actions';
import type { JsonValue } from '@builderhelm/protocol/json';
import type { ToolDefinition as ModelToolDefinition } from '@builderhelm/protocol/model';
import { BuilderHelmError } from '@builderhelm/shared';
import { z } from 'zod';

interface ToolContract {
  readonly descriptor: ToolDescriptor;
  readonly inputSchema: z.ZodType;
  readonly outputSchema: z.ZodType;
  summarize(input: never): string;
  resources(input: never): ResourceRef[];
}

function contract<Input>(value: {
  readonly descriptor: ToolDescriptor;
  readonly inputSchema: z.ZodType<Input>;
  readonly outputSchema: z.ZodType;
  summarize(input: Input): string;
  resources(input: Input): ResourceRef[];
}): ToolContract {
  return value as ToolContract;
}

const descriptors = {
  projectCreate: toolDescriptorSchema.parse({
    id: 'project.create',
    modelName: 'project_create',
    description: 'Create a new local project.',
    risk: 'reversible_write',
    dataScopes: ['projects'],
    timeoutMs: 2_000,
    idempotency: 'request_id',
    rollbackSupport: 'manual',
  }),
  projectStatus: toolDescriptorSchema.parse({
    id: 'project.get_status',
    modelName: 'project_get_status',
    description: 'Read a local project status with task counts and decisions.',
    risk: 'read',
    dataScopes: ['projects', 'tasks'],
    timeoutMs: 2_000,
    idempotency: 'none',
    rollbackSupport: 'none',
  }),
  projectDecision: toolDescriptorSchema.parse({
    id: 'project.add_decision',
    modelName: 'project_add_decision',
    description: 'Add a durable decision to a local project.',
    risk: 'reversible_write',
    dataScopes: ['projects'],
    timeoutMs: 2_000,
    idempotency: 'request_id',
    rollbackSupport: 'none',
  }),
  taskList: toolDescriptorSchema.parse({
    id: 'task.list',
    modelName: 'task_list',
    description: 'List local tasks, optionally filtered by project or status.',
    risk: 'read',
    dataScopes: ['tasks'],
    timeoutMs: 2_000,
    idempotency: 'none',
    rollbackSupport: 'none',
  }),
  taskCreate: toolDescriptorSchema.parse({
    id: 'task.create',
    modelName: 'task_create',
    description: 'Create a local task in an existing project.',
    risk: 'reversible_write',
    dataScopes: ['projects', 'tasks'],
    timeoutMs: 2_000,
    idempotency: 'request_id',
    rollbackSupport: 'manual',
  }),
  taskUpdate: toolDescriptorSchema.parse({
    id: 'task.update',
    modelName: 'task_update',
    description: 'Update fields on one existing local task.',
    risk: 'reversible_write',
    dataScopes: ['tasks'],
    timeoutMs: 2_000,
    idempotency: 'single_use_approval',
    rollbackSupport: 'automatic',
  }),
} as const;

export function createWorkToolRegistry(): ToolRegistry {
  return new ToolRegistry([
    contract({
      descriptor: descriptors.projectCreate,
      inputSchema: projectCreateInputSchema,
      outputSchema: projectSchema,
      summarize: (input) => `Create project “${input.name}”`,
      resources: () => [],
    }),
    contract({
      descriptor: descriptors.projectStatus,
      inputSchema: projectGetStatusInputSchema,
      outputSchema: projectStatusResultSchema,
      summarize: () => 'Read project status',
      resources: (input) => [
        { type: 'project', id: input.projectId, label: input.projectId },
      ],
    }),
    contract({
      descriptor: descriptors.projectDecision,
      inputSchema: projectAddDecisionInputSchema,
      outputSchema: projectDecisionSchema,
      summarize: (input) => `Add project decision “${input.title}”`,
      resources: (input) => [
        { type: 'project', id: input.projectId, label: input.projectId },
      ],
    }),
    contract({
      descriptor: descriptors.taskList,
      inputSchema: taskListInputSchema,
      outputSchema: z.array(taskSchema),
      summarize: () => 'List tasks',
      resources: (input) =>
        input.projectId === undefined
          ? []
          : [{ type: 'project', id: input.projectId, label: input.projectId }],
    }),
    contract({
      descriptor: descriptors.taskCreate,
      inputSchema: taskCreateInputSchema,
      outputSchema: taskSchema,
      summarize: (input) => `Create task “${input.title}”`,
      resources: (input) => [
        { type: 'project', id: input.projectId, label: input.projectId },
      ],
    }),
    contract({
      descriptor: descriptors.taskUpdate,
      inputSchema: taskUpdateInputSchema,
      outputSchema: taskSchema,
      summarize: () => 'Update task',
      resources: (input) => [{ type: 'task', id: input.taskId, label: input.taskId }],
    }),
  ]);
}

export class ToolRegistry {
  private readonly byId = new Map<WorkToolId, ToolContract>();
  private readonly byModelName = new Map<string, ToolContract>();

  constructor(contracts: readonly ToolContract[]) {
    for (const value of contracts) {
      if (
        this.byId.has(value.descriptor.id) ||
        this.byModelName.has(value.descriptor.modelName)
      ) {
        throw new TypeError(`Duplicate tool registration: ${value.descriptor.id}`);
      }
      this.byId.set(value.descriptor.id, value);
      this.byModelName.set(value.descriptor.modelName, value);
    }
  }

  list(): ToolDescriptor[] {
    return [...this.byId.values()].map((value) => value.descriptor);
  }

  resolve(name: string): WorkToolId {
    const value = this.byModelName.get(name) ?? this.byId.get(name as WorkToolId);
    if (value === undefined) {
      throw new BuilderHelmError(
        'TOOL_SCHEMA_INVALID',
        'The proposed tool is not registered',
      );
    }
    return value.descriptor.id;
  }

  descriptor(id: WorkToolId): ToolDescriptor {
    return this.require(id).descriptor;
  }

  parseInput(id: WorkToolId, input: unknown): JsonValue {
    const parsed = this.require(id).inputSchema.safeParse(input);
    if (!parsed.success) {
      throw new BuilderHelmError(
        'TOOL_SCHEMA_INVALID',
        'The proposed tool arguments are invalid',
      );
    }
    return JSON.parse(JSON.stringify(parsed.data)) as JsonValue;
  }

  parseOutput(id: WorkToolId, output: unknown): JsonValue {
    const parsed = this.require(id).outputSchema.safeParse(output);
    if (!parsed.success) {
      throw new BuilderHelmError(
        'TOOL_EXECUTION_FAILED',
        'The tool returned an invalid result',
      );
    }
    return JSON.parse(JSON.stringify(parsed.data)) as JsonValue;
  }

  summarize(id: WorkToolId, input: JsonValue): string {
    return this.require(id).summarize(input as never);
  }

  resources(id: WorkToolId, input: JsonValue): ResourceRef[] {
    return this.require(id).resources(input as never);
  }

  modelDefinitions(): ModelToolDefinition[] {
    return [...this.byId.values()].map((value) => ({
      name: value.descriptor.modelName,
      description: value.descriptor.description,
      inputSchema: JSON.parse(
        JSON.stringify(z.toJSONSchema(value.inputSchema)),
      ) as JsonValue,
    }));
  }

  private require(id: WorkToolId): ToolContract {
    const value = this.byId.get(id);
    if (value === undefined) {
      throw new BuilderHelmError(
        'TOOL_SCHEMA_INVALID',
        'The requested tool is not registered',
      );
    }
    return value;
  }
}

export type PermissionDecision = 'allow' | 'require_approval' | 'deny';

export class PermissionEngine {
  evaluate(input: {
    readonly risk: PermissionLevel;
    readonly policy: PermissionPolicyMode;
    readonly explicitApproval: boolean;
    readonly rollbackSupport: ToolDescriptor['rollbackSupport'];
  }): PermissionDecision {
    if (input.policy === 'deny') return 'deny';
    if (input.risk === 'read' || input.risk === 'draft') return 'allow';
    if (input.explicitApproval) return 'allow';
    if (
      input.risk === 'reversible_write' &&
      input.policy === 'auto_approve' &&
      input.rollbackSupport !== 'none'
    ) {
      return 'allow';
    }
    return 'require_approval';
  }

  validatePolicy(
    risk: PermissionLevel,
    mode: PermissionPolicyMode,
    rollbackSupport: ToolDescriptor['rollbackSupport'],
  ): void {
    if (
      mode === 'auto_approve' &&
      (risk === 'external_side_effect' ||
        risk === 'destructive_sensitive' ||
        rollbackSupport === 'none')
    ) {
      throw new BuilderHelmError(
        'PERMISSION_DENIED',
        'This tool cannot be auto-approved',
      );
    }
  }
}
