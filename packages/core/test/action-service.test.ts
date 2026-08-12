import { ActionRepository, migrations, openDatabase, runMigrations } from '@zero/db';
import { createLogger } from '@zero/observability';
import type { ModelRequest } from '@zero/protocol/model';
import { createCorrelationId, createId } from '@zero/shared';
import { createWorkToolRegistry, PermissionEngine } from '@zero/tools';
import { afterEach, describe, expect, it } from 'vitest';

import { ActionService } from '../src/actions/action-service.js';
import type { ModelService } from '../src/models/model-service.js';

const databases: ReturnType<typeof openDatabase>[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

function fixture(modelCalls: Array<{ name: string; arguments: unknown }> = []) {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  const repository = new ActionRepository(database);
  let captured: ModelRequest | undefined;
  const models = {
    async *stream(request: ModelRequest) {
      captured = request;
      for (const [index, call] of modelCalls.entries()) {
        yield {
          type: 'tool.proposed' as const,
          call: {
            id: `call-${index}`,
            name: call.name,
            arguments: call.arguments,
          },
        };
      }
      yield { type: 'done' as const, finishReason: 'tool_calls' as const };
    },
  } as unknown as ModelService;
  let now = new Date('2026-08-11T04:30:00.000Z');
  const logs: string[] = [];
  const service = new ActionService(
    repository,
    models,
    createLogger((line) => logs.push(line)),
    createWorkToolRegistry(),
    new PermissionEngine(),
    () => new Date(now),
  );
  return {
    database,
    repository,
    service,
    logs,
    captured: () => captured,
    setNow: (value: string) => {
      now = new Date(value);
    },
  };
}

async function createProject(test: ReturnType<typeof fixture>, name = 'Project A') {
  const proposed = await test.service.command(
    { requestId: createId(), text: `Create project ${name}`, modelRef: null },
    createCorrelationId(),
    new AbortController().signal,
  );
  expect(proposed.kind).toBe('approval_required');
  if (proposed.kind !== 'approval_required') throw new Error('Expected approval');
  const executed = await test.service.approve(
    proposed.approval.id,
    createCorrelationId(),
  );
  expect(executed.kind).toBe('executed');
  return test.repository.listProjects()[0]!;
}

describe('action service', () => {
  it('creates one task after one explicit approval and records an immutable receipt', async () => {
    const test = fixture();
    const project = await createProject(test);
    const requestId = createId();
    const proposed = await test.service.command(
      {
        requestId,
        text: 'Add a high-priority task to Project A to benchmark the sync layer tomorrow.',
        modelRef: null,
      },
      createCorrelationId(),
      new AbortController().signal,
    );

    expect(proposed).toMatchObject({
      kind: 'approval_required',
      approval: {
        requestId,
        toolId: 'task.create',
        exactArguments: {
          projectId: project.id,
          title: 'benchmark the sync layer',
          priority: 'high',
        },
        risk: 'reversible_write',
        reversible: true,
      },
    });
    if (proposed.kind !== 'approval_required') throw new Error('Expected approval');
    expect(() =>
      test.database.run(
        'UPDATE approval_requests SET arguments_json = \'{"taskId":"replacement"}\' WHERE id = ?',
        [proposed.approval.id],
      ),
    ).toThrow();
    const executed = await test.service.approve(
      proposed.approval.id,
      createCorrelationId(),
    );

    expect(executed).toMatchObject({
      kind: 'executed',
      receipt: {
        requestId,
        toolId: 'task.create',
        approvalState: 'granted',
        result: { title: 'benchmark the sync layer', priority: 'high' },
      },
    });
    expect(test.repository.listTasks()).toHaveLength(1);
    await expect(
      test.service.approve(proposed.approval.id, createCorrelationId()),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(test.repository.listTasks()).toHaveLength(1);
    expect(() =>
      test.database.run('DELETE FROM action_receipts WHERE request_id = ?', [requestId]),
    ).toThrow('append-only');
    expect(() =>
      test.database.run(
        "UPDATE approval_requests SET status = 'pending', resolved_at = NULL WHERE id = ?",
        [proposed.approval.id],
      ),
    ).toThrow('only resolve once');
    const auditEvents = test.database.queryAll<{ eventType: string }>(
      `SELECT event_type AS eventType
       FROM audit_events
       WHERE approval_id = ?
       ORDER BY created_at, id`,
      [proposed.approval.id],
    );
    expect(auditEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        'agent.tool_requested',
        'approval.requested',
        'approval.granted',
        'agent.tool_executed',
      ]),
    );
    expect(test.logs.join('\n')).not.toContain('benchmark the sync layer');
  });

  it('updates an existing task through approval and records rollback arguments', async () => {
    const test = fixture();
    await createProject(test);
    const create = await test.service.command(
      {
        requestId: createId(),
        text: 'Add a task to Project A to validate rollback tomorrow.',
        modelRef: null,
      },
      createCorrelationId(),
      new AbortController().signal,
    );
    if (create.kind !== 'approval_required') throw new Error('Expected approval');
    await test.service.approve(create.approval.id, createCorrelationId());

    const updateCorrelationId = createCorrelationId();
    const update = await test.service.command(
      {
        requestId: createId(),
        text: 'Mark "validate rollback" complete',
        modelRef: null,
      },
      updateCorrelationId,
      new AbortController().signal,
    );
    expect(update).toMatchObject({
      kind: 'approval_required',
      approval: { toolId: 'task.update', exactArguments: { status: 'done' } },
    });
    if (update.kind !== 'approval_required') throw new Error('Expected approval');
    const executed = await test.service.approve(
      update.approval.id,
      createCorrelationId(),
    );

    expect(executed).toMatchObject({
      kind: 'executed',
      receipt: {
        correlationId: updateCorrelationId,
        toolId: 'task.update',
        result: { status: 'done' },
        rollbackInformation: {
          toolId: 'task.update',
          arguments: { status: 'todo' },
        },
      },
    });
    expect(test.repository.listTasks()[0]?.status).toBe('done');
  });

  it('supports project status, task list, and project decision tools', async () => {
    const test = fixture();
    await createProject(test);

    const status = await test.service.command(
      { requestId: createId(), text: 'Show status of Project A', modelRef: null },
      createCorrelationId(),
      new AbortController().signal,
    );
    expect(status).toMatchObject({
      kind: 'read_result',
      toolId: 'project.get_status',
      result: { taskCounts: { todo: 0, done: 0 } },
    });

    const tasks = await test.service.command(
      { requestId: createId(), text: 'List tasks for Project A', modelRef: null },
      createCorrelationId(),
      new AbortController().signal,
    );
    expect(tasks).toMatchObject({ kind: 'read_result', toolId: 'task.list', result: [] });

    const decision = await test.service.command(
      {
        requestId: createId(),
        text: 'Add a decision to Project A that keep receipts local',
        modelRef: null,
      },
      createCorrelationId(),
      new AbortController().signal,
    );
    expect(decision).toMatchObject({
      kind: 'approval_required',
      approval: { toolId: 'project.add_decision', reversible: false },
    });
    if (decision.kind !== 'approval_required') throw new Error('Expected approval');
    const executedDecision = await test.service.approve(
      decision.approval.id,
      createCorrelationId(),
    );
    expect(executedDecision).toMatchObject({
      kind: 'executed',
      receipt: { rollbackInformation: null },
    });
    expect(
      test.repository.listDecisions(test.repository.listProjects()[0]!.id),
    ).toHaveLength(1);
  });

  it('supports narrow per-tool auto-approval and deny policies', async () => {
    const test = fixture();
    await createProject(test);
    test.service.updatePolicy(
      { toolId: 'task.create', mode: 'auto_approve' },
      createCorrelationId(),
    );
    const executed = await test.service.command(
      {
        requestId: createId(),
        text: 'Add a low-priority task to Project A to write tests today.',
        modelRef: null,
      },
      createCorrelationId(),
      new AbortController().signal,
    );
    expect(executed).toMatchObject({
      kind: 'executed',
      receipt: { approvalState: 'auto_approved', toolId: 'task.create' },
    });

    test.service.updatePolicy(
      { toolId: 'task.create', mode: 'deny' },
      createCorrelationId(),
    );
    await expect(
      test.service.command(
        {
          requestId: createId(),
          text: 'Add a task to Project A to ship unsafe change tomorrow.',
          modelRef: null,
        },
        createCorrelationId(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(test.repository.listTasks()).toHaveLength(1);
  });

  it('uses an optional tool-capable model only when deterministic parsing cannot resolve', async () => {
    const test = fixture([
      {
        name: 'project_create',
        arguments: { name: 'Model Project', description: null },
      },
    ]);
    const modelRef = `${createId()}:tool-model`;
    const proposed = await test.service.command(
      {
        requestId: createId(),
        text: 'Please establish a workspace called Model Project',
        modelRef,
      },
      createCorrelationId(),
      new AbortController().signal,
    );

    expect(proposed).toMatchObject({
      kind: 'approval_required',
      approval: { actorType: 'model', modelRef, toolId: 'project.create' },
    });
    expect(test.captured()?.dataClassifications).toEqual([
      'personal',
      'sensitive',
      'health',
    ]);
    expect(test.captured()?.tools?.map((tool) => tool.name)).toContain('project_create');
    expect(
      test.database
        .queryAll<{ eventType: string }>(
          `SELECT event_type AS eventType FROM audit_events ORDER BY created_at, id`,
        )
        .map((event) => event.eventType),
    ).toEqual(expect.arrayContaining(['agent.model_invoked', 'agent.model_completed']));
  });

  it('expires pending approvals and never executes their saved arguments', async () => {
    const test = fixture();
    const proposed = await test.service.command(
      { requestId: createId(), text: 'Create project Expiring', modelRef: null },
      createCorrelationId(),
      new AbortController().signal,
    );
    if (proposed.kind !== 'approval_required') throw new Error('Expected approval');
    test.setNow('2026-08-11T05:00:01.000Z');

    await expect(
      test.service.approve(proposed.approval.id, createCorrelationId()),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(test.repository.listProjects()).toEqual([]);
    expect(test.repository.findApprovalById(proposed.approval.id)?.status).toBe(
      'expired',
    );
  });

  it('rejects multiple model tool proposals without creating approvals', async () => {
    const test = fixture([
      { name: 'project_create', arguments: { name: 'One' } },
      { name: 'project_create', arguments: { name: 'Two' } },
    ]);
    await expect(
      test.service.command(
        {
          requestId: createId(),
          text: 'Create two projects',
          modelRef: `${createId()}:tool-model`,
        },
        createCorrelationId(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'TOOL_SCHEMA_INVALID' });
    expect(test.repository.listApprovals()).toEqual([]);
    expect(
      test.database
        .queryAll<{ eventType: string }>(
          `SELECT event_type AS eventType FROM audit_events ORDER BY created_at, id`,
        )
        .map((event) => event.eventType),
    ).toEqual(expect.arrayContaining(['agent.model_invoked', 'agent.model_failed']));
  });
});
