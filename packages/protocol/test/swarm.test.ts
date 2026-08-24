import { describe, expect, it } from 'vitest';

import type { BoardAgentDetection } from '../src/board.js';
import {
  assignSwarmPanes,
  availableSwarmAgents,
  swarmBrief,
  swarmPaneCommand,
  swarmRoleTasks,
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
  it('uses only grok and opencode, grok first', () => {
    const agents = availableSwarmAgents([
      detection('shell', true),
      detection('claude', true),
      detection('codex', true),
      detection('gemini', true),
      detection('opencode', true),
      detection('grok', true),
    ]);
    expect(agents).toEqual(['grok', 'opencode']);
    expect(assignSwarmPanes(agents)).toEqual([
      { role: 'coordinator', agentId: 'grok' },
      { role: 'builder', agentId: 'opencode' },
      { role: 'scout', agentId: 'grok' },
      { role: 'reviewer', agentId: 'opencode' },
    ]);
  });

  it('returns no panes when no agent CLI is installed', () => {
    expect(assignSwarmPanes(availableSwarmAgents([detection('shell', true)]))).toEqual(
      [],
    );
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

describe('swarmPaneCommand', () => {
  it('quotes the prompt and pins OpenCode to ox-alpha', () => {
    expect(swarmPaneCommand('claude', "fix the 'login' form")).toBe(
      "claude 'fix the '\\''login'\\'' form'",
    );
    expect(swarmPaneCommand('opencode', 'review the diff')).toBe(
      "opencode --model openrouter/stealth/ox-alpha --prompt 'review the diff'",
    );
    expect(swarmPaneCommand('codex', 'x'.repeat(8_000)).length).toBeLessThanOrEqual(4_000);
  });
});
