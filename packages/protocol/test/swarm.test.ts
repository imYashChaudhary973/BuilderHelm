import { describe, expect, it } from 'vitest';

import type { BoardAgentDetection } from '../src/board.js';
import {
  swarmCreateRequestSchema,
  swarmDirectRequestSchema,
  swarmRunSchema,
  swarmSeatSchema,
  swarmStopRequestSchema,
  swarmTaskSchema,
  swarmMessageSchema,
} from '../src/swarm.js';
import {
  assignSwarmPanes,
  availableSwarmAgents,
  swarmAddSeat,
  swarmBrief,
  swarmGraphHub,
  swarmGraphPoints,
  swarmSeatArgv,
  swarmPresetRoles,
  swarmRemoveSeat,
  swarmRoleTasks,
  swarmSeatLabel,
  swarmMemberStatus,
  swarmRunStatus,
  swarmStuckAction,
} from '../src/swarm.js';

function detection(
  id: BoardAgentDetection['id'],
  available: boolean,
): BoardAgentDetection {
  return { id, label: id, available, path: available ? `/bin/${id}` : null };
}

describe('swarm assignment', () => {
  it('uses every installed CLI and can fill a skiff preset', () => {
    const agents = availableSwarmAgents([
      detection('shell', true),
      detection('claude', true),
      detection('codex', false),
      detection('grok', true),
    ]);
    expect(agents).toEqual(['claude', 'grok']);
    expect(assignSwarmPanes(agents, swarmPresetRoles('skiff'))).toEqual([
      { role: 'coordinator', agentId: 'claude', auto: false },
      { role: 'builder', agentId: 'grok', auto: false },
      { role: 'scout', agentId: 'claude', auto: false },
    ]);
  });

  it('returns no panes when no agent CLI is installed', () => {
    expect(assignSwarmPanes(availableSwarmAgents([detection('shell', true)]))).toEqual(
      [],
    );
  });

  it('adds and removes seats without going past 12', () => {
    const start = assignSwarmPanes(['grok'], swarmPresetRoles('flagship'));
    expect(start).toHaveLength(12);
    expect(swarmAddSeat(start, 'builder', 'grok')).toHaveLength(12);
    const minus = swarmRemoveSeat(start, 'reviewer');
    expect(minus.filter((seat) => seat.role === 'reviewer')).toHaveLength(1);
    expect(swarmAddSeat(minus, 'builder', 'claude').at(-1)).toEqual({
      role: 'builder',
      agentId: 'claude',
      auto: false,
    });
  });
});

describe('swarm graph', () => {
  it('labels seats by role order and hubs on the coordinator', () => {
    const roles = swarmPresetRoles('cutter');
    expect(swarmSeatLabel(roles, 0)).toBe('Coordinator 1');
    expect(swarmSeatLabel(roles, 2)).toBe('Builder 2');
    expect(swarmGraphHub(roles)).toBe(0);
    const points = swarmGraphPoints(roles);
    expect(points).toHaveLength(5);
    expect(points[0]!.y).toBeGreaterThan(points[1]!.y);
  });
});

describe('swarm policy', () => {
  it('marks a silent running pane stuck and a timed-out run as budget', () => {
    expect(
      swarmMemberStatus({
        paneStatus: 'running',
        lastActivityAt: 0,
        now: 90_000,
        stuckAfterMs: 90_000,
      }),
    ).toBe('stuck');
    expect(
      swarmRunStatus({
        members: ['running', 'stuck', 'starting', 'running'],
        elapsedMs: 1_000,
        budgetMs: 20 * 60 * 1000,
        stopped: false,
      }),
    ).toBe('stuck');
    expect(
      swarmRunStatus({
        members: ['running', 'running', 'running', 'running'],
        elapsedMs: 20 * 60 * 1000,
        budgetMs: 20 * 60 * 1000,
        stopped: false,
      }),
    ).toBe('budget');
    expect(
      swarmRunStatus({
        members: ['exited', 'failed', 'exited', 'exited'],
        elapsedMs: 10,
        budgetMs: 20 * 60 * 1000,
        stopped: false,
      }),
    ).toBe('done');
  });

  it('keeps role briefs inside the pane write limit', () => {
    const brief = swarmBrief('builder', 'x'.repeat(8_000));
    expect(brief.length).toBeLessThanOrEqual(10_000);
    expect(brief).toContain('You are the builder');
  });

  it('nudges once, then stops a pane that stays silent', () => {
    expect(
      swarmStuckAction({
        status: 'stuck',
        nudgedAt: null,
        now: 90_000,
        stuckAfterMs: 90_000,
      }),
    ).toBe('nudge');
    expect(
      swarmStuckAction({
        status: 'stuck',
        nudgedAt: 90_000,
        now: 179_999,
        stuckAfterMs: 90_000,
      }),
    ).toBe('none');
    expect(
      swarmStuckAction({
        status: 'stuck',
        nudgedAt: 90_000,
        now: 180_000,
        stuckAfterMs: 90_000,
      }),
    ).toBe('stop');
    expect(
      swarmStuckAction({
        status: 'running',
        nudgedAt: null,
        now: 90_000,
        stuckAfterMs: 90_000,
      }),
    ).toBe('none');
  });
});

describe('swarmRoleTasks', () => {
  const PREFIX = {
    coordinator: 'Coordinate:',
    builder: 'Build:',
    scout: 'Scout:',
    reviewer: 'Review:',
  } as const;

  it('returns four tasks that mention a non-empty job', () => {
    const job = 'ship the swarm pane';
    const tasks = swarmRoleTasks(job);
    expect(Object.keys(tasks)).toEqual(['coordinator', 'builder', 'scout', 'reviewer']);
    expect(new Set(Object.values(tasks)).size).toBe(4);
    for (const role of ['coordinator', 'builder', 'scout', 'reviewer'] as const) {
      const task = tasks[role];
      expect(task.trim()).toBe(task);
      expect(task.length).toBeGreaterThanOrEqual(1);
      expect(task.length).toBeLessThanOrEqual(500);
      expect(task).toContain(job);
      expect(task.startsWith(PREFIX[role])).toBe(true);
    }
  });

  it('returns four generic tasks for whitespace jobs', () => {
    for (const job of ['', '   ']) {
      const tasks = swarmRoleTasks(job);
      expect(Object.keys(tasks)).toEqual(['coordinator', 'builder', 'scout', 'reviewer']);
      expect(new Set(Object.values(tasks)).size).toBe(4);
      for (const role of ['coordinator', 'builder', 'scout', 'reviewer'] as const) {
        const task = tasks[role];
        expect(task.trim().length).toBeGreaterThanOrEqual(1);
        expect(task.length).toBeLessThanOrEqual(500);
        expect(task.startsWith(PREFIX[role])).toBe(true);
      }
    }
  });

  it('embeds the first 200 chars of a trimmed job', () => {
    const job = `  ${'x'.repeat(300)}  `;
    const clipped = 'x'.repeat(200);
    const tasks = swarmRoleTasks(job);
    expect(new Set(Object.values(tasks)).size).toBe(4);
    for (const task of Object.values(tasks)) {
      expect(task).toContain(clipped);
      expect(task).not.toContain('x'.repeat(201));
    }
  });
});

describe('swarmSeatArgv', () => {
  it('maps every mode to verified claude flags', () => {
    expect(swarmSeatArgv('claude', 'fix the login form', 'safe')).toEqual({
      binary: 'claude',
      args: ['-p', 'fix the login form', '--permission-mode', 'dontAsk'],
    });
    expect(swarmSeatArgv('claude', 'fix it', 'auto')).toEqual({
      binary: 'claude',
      args: ['-p', 'fix it', '--permission-mode', 'acceptEdits'],
    });
    expect(swarmSeatArgv('claude', 'fix it', 'full')).toEqual({
      binary: 'claude',
      args: ['-p', 'fix it', '--dangerously-skip-permissions'],
    });
  });

  it('maps codex exec sandbox and gemini approval modes', () => {
    expect(swarmSeatArgv('codex', 'ship', 'auto')).toEqual({
      binary: 'codex',
      args: ['exec', '--sandbox', 'workspace-write', '--approve-for-me', 'ship'],
    });
    expect(swarmSeatArgv('gemini', 'ship', 'full')).toEqual({
      binary: 'gemini',
      args: ['-p', 'ship', '--skip-trust', '--approval-mode', 'yolo'],
    });
    expect(
      swarmSeatArgv('gemini', 'ship', 'auto').args.filter(
        (arg) => arg === '--skip-trust',
      ),
    ).toHaveLength(1);
  });

  it('passes long prompts through argv without shell quoting', () => {
    const prompt = `${'x'.repeat(8_000)} 'quoted' "double" $HOME \\n`;
    const { binary, args } = swarmSeatArgv('grok', prompt, 'auto');
    expect(binary).toBe('grok');
    expect(args).toEqual(['-p', prompt.trim(), '--permission-mode', 'acceptEdits']);
  });

  it('fails closed for CLIs without a verified headless command or mode', () => {
    expect(() => swarmSeatArgv('kiro', 'job', 'auto')).toThrow(/no verified headless/);
    expect(() => swarmSeatArgv('cursor', 'job', 'auto')).toThrow(/no verified headless/);
    expect(() => swarmSeatArgv('custom', 'job', 'auto')).toThrow(/no verified headless/);
    expect(() => swarmSeatArgv('opencode', 'job', 'safe')).toThrow(
      /does not support safe/,
    );
    expect(() => swarmSeatArgv('pi', 'job', 'full')).toThrow(/does not support full/);
    expect(() => swarmSeatArgv('claude', '   ', 'auto')).toThrow(/must not be empty/);
  });
});

describe('swarm persistence schemas', () => {
  const baseRun = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Swarm One',
    folderPath: '/tmp/repo',
    mission: 'ship the feature',
    launchMode: 'auto',
    presetId: 'skiff',
    skillIds: ['tdd'],
    boardSessionId: null,
    status: 'running',
    startedAt: '2026-08-25T10:00:00.000Z',
    endedAt: null,
    budgetMs: 20 * 60 * 1000,
  } as const;

  it('round-trips a run, seat, task, and message', () => {
    expect(swarmRunSchema.parse(baseRun)).toEqual(baseRun);
    const seat = {
      id: '00000000-0000-4000-8000-000000000002',
      runId: baseRun.id,
      role: 'builder',
      agentId: 'grok',
      mode: 'auto',
      paneId: null,
      worktreePath: null,
      branch: null,
      status: 'queued',
      tokensUsed: 0,
      costUsd: 0,
    };
    expect(swarmSeatSchema.parse(seat)).toEqual(seat);
    const task = {
      id: '00000000-0000-4000-8000-000000000003',
      runId: baseRun.id,
      seatId: null,
      title: 'Implement X',
      detail: null,
      files: ['src/x.ts'],
      status: 'pending',
      dependsOn: [],
      attempts: 0,
      landedCommit: null,
      createdAt: '2026-08-25T10:00:00.000Z',
      updatedAt: '2026-08-25T10:00:00.000Z',
    };
    expect(swarmTaskSchema.parse(task)).toEqual(task);
    const message = {
      id: '00000000-0000-4000-8000-000000000004',
      runId: baseRun.id,
      seatId: null,
      kind: 'directive',
      body: 'wrap up',
      createdAt: '2026-08-25T10:01:00.000Z',
    };
    expect(swarmMessageSchema.parse(message)).toEqual(message);
  });

  it('rejects unknown statuses, modes, and non-uuid ids', () => {
    expect(() => swarmRunSchema.parse({ ...baseRun, status: 'bogus' })).toThrow();
    expect(() => swarmRunSchema.parse({ ...baseRun, launchMode: 'yolo' })).toThrow();
    expect(() => swarmRunSchema.parse({ ...baseRun, id: 'not-a-uuid' })).toThrow();
    expect(() =>
      swarmTaskSchema.parse({
        id: '00000000-0000-4000-8000-000000000003',
        runId: baseRun.id,
        seatId: null,
        title: 'X',
        detail: null,
        files: [],
        status: 'bogus',
        dependsOn: [],
        attempts: 0,
        landedCommit: null,
        createdAt: '2026-08-25T10:00:00.000Z',
        updatedAt: '2026-08-25T10:00:00.000Z',
      }),
    ).toThrow();
  });

  it('validates create, direct, task-update, and stop requests', () => {
    const correlationId = '00000000-0000-4000-8000-000000000005';
    expect(
      swarmCreateRequestSchema.parse({
        correlationId,
        input: {
          name: 'Swarm One',
          folderPath: '/tmp/repo',
          mission: 'ship it',
          launchMode: 'auto',
          presetId: 'skiff',
          skillIds: [],
          seats: [{ role: 'coordinator', agentId: 'claude' }],
        },
      }),
    ).toBeTypeOf('object');
    expect(() =>
      swarmCreateRequestSchema.parse({
        correlationId,
        input: {
          name: '',
          folderPath: '/tmp/repo',
          mission: 'ship it',
          launchMode: 'auto',
          presetId: 'skiff',
          skillIds: [],
          seats: [],
        },
      }),
    ).toThrow();
    expect(() =>
      swarmDirectRequestSchema.parse({
        correlationId,
        input: { runId: baseRun.id, seatIds: [], body: 'go' },
      }),
    ).toThrow();
    expect(() =>
      swarmStopRequestSchema.parse({ correlationId, runId: 'nope' }),
    ).toThrow();
  });
});
