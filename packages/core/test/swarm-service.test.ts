import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrations, openDatabase, runMigrations, type ZeroDatabase } from '@zero/db';
import type { Logger } from '@zero/observability';
import type { SwarmCreateInput } from '@zero/protocol';
import { createCorrelationId } from '@zero/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoardService } from '../src/board/board-service.js';
import { workspaceTargetsForFiles } from '../src/swarm/pnpm-verifier.js';
import {
  SwarmService,
  type SwarmExecuteInput,
  type SwarmRunnerOutcome,
  type SwarmSeatRunner,
  type SwarmTaskVerifier,
  type SwarmVerifyResult,
} from '../src/swarm/swarm-service.js';

const temporaryDirectories: string[] = [];
const databases: ZeroDatabase[] = [];
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'zero-swarm-git-'));
  temporaryDirectories.push(root, `${root}-worktrees`);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture User'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# Fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'start fixture'], { cwd: root });
  return root;
}

/** Commits one file per task so landing is real git work. */
function committingRunner(log: string[]): SwarmSeatRunner {
  return {
    async execute({
      task,
      worktreePath,
    }: SwarmExecuteInput): Promise<SwarmRunnerOutcome> {
      const file = `${task.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`;
      writeFileSync(join(worktreePath, file), `${task.title} attempt ${task.attempts}\n`);
      execFileSync('git', ['add', '-A'], { cwd: worktreePath });
      execFileSync('git', ['commit', '-m', task.title], { cwd: worktreePath });
      log.push(task.title);
      return {
        status: 'landed',
        summary: 'work committed',
        tokensUsed: 120,
        costUsd: 0.02,
      };
    },
  };
}

const passingVerifier: SwarmTaskVerifier = {
  async verify(): Promise<SwarmVerifyResult> {
    return { ok: true, detail: 'stub gate' };
  },
};

function setup(
  runner: SwarmSeatRunner,
  verifier: SwarmTaskVerifier = passingVerifier,
  options: ConstructorParameters<typeof SwarmService>[5] = {},
): { service: SwarmService; repo: string } {
  const repo = createRepository();
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  const board = new BoardService(database, logger);
  const service = new SwarmService(database, logger, board, runner, verifier, options);
  return { service, repo };
}

function createInput(repo: string, builders: number): SwarmCreateInput {
  return {
    name: 'Test Swarm',
    folderPath: repo,
    mission: 'ship the fixtures',
    launchMode: 'auto',
    presetId: 'skiff',
    skillIds: ['tdd'],
    seats: [
      { role: 'coordinator', agentId: 'claude' },
      ...Array.from(
        { length: builders },
        () => ({ role: 'builder', agentId: 'grok' }) as const,
      ),
    ],
  };
}

describe('SwarmService dispatch', () => {
  it('lands independent tasks and finishes the run', async () => {
    const log: string[] = [];
    const { service, repo } = setup(committingRunner(log));
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    service.addTask(
      run.id,
      { title: 'Alpha', files: ['packages/db/src/a.ts'] },
      createCorrelationId(),
    );
    service.addTask(
      run.id,
      { title: 'Beta', files: ['packages/db/src/b.ts'] },
      createCorrelationId(),
    );

    await service.pump(run.id);

    const state = service.state(run.id);
    expect(state.tasks.map((task) => task.status)).toEqual(['landed', 'landed']);
    expect(state.run.status).toBe('done');
    expect(state.tasks.every((task) => task.landedCommit !== null)).toBe(true);
    expect(log).toEqual(['Alpha', 'Beta']);
  });

  it('holds a dependent task until its dependency lands', async () => {
    const log: string[] = [];
    const { service, repo } = setup(committingRunner(log));
    const run = service.createRun(createInput(repo, 2), createCorrelationId());
    const first = service.addTask(
      run.id,
      { title: 'Base', files: ['packages/db/src/base.ts'] },
      createCorrelationId(),
    );
    service.addTask(
      run.id,
      { title: 'Dependent', files: ['packages/db/src/dep.ts'], dependsOn: [first.id] },
      createCorrelationId(),
    );

    await service.pump(run.id);

    expect(log).toEqual(['Base', 'Dependent']);
    expect(service.state(run.id).tasks.map((task) => task.status)).toEqual([
      'landed',
      'landed',
    ]);
  });

  it('retries a failing task once, then fails it and skips its dependents', async () => {
    const attempts: string[] = [];
    const runner: SwarmSeatRunner = {
      async execute({ task }) {
        attempts.push(task.title);
        return { status: 'failed', summary: 'agent gave up', tokensUsed: 10, costUsd: 0 };
      },
    };
    const { service, repo } = setup(runner);
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    const broken = service.addTask(
      run.id,
      { title: 'Broken', files: ['packages/db/src/broken.ts'] },
      createCorrelationId(),
    );
    service.addTask(
      run.id,
      { title: 'Downstream', files: ['packages/db/src/down.ts'], dependsOn: [broken.id] },
      createCorrelationId(),
    );

    await service.pump(run.id);

    const state = service.state(run.id);
    expect(attempts).toEqual(['Broken', 'Broken']);
    expect(state.tasks.map((task) => task.status)).toEqual(['failed', 'skipped']);
    expect(state.tasks[0]!.attempts).toBe(2);
    expect(state.run.status).toBe('failed');
  });

  it('refuses to land work that fails the verify gate', async () => {
    const { service, repo } = setup(committingRunner([]), {
      async verify(): Promise<SwarmVerifyResult> {
        return { ok: false, detail: 'typecheck failed' };
      },
    });
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    service.addTask(
      run.id,
      { title: 'Risky', files: ['packages/db/src/x.ts'] },
      createCorrelationId(),
    );

    await service.pump(run.id);

    const state = service.state(run.id);
    expect(state.tasks[0]!.status).toBe('failed');
    expect(state.tasks[0]!.landedCommit).toBeNull();
    expect(state.messages.some((message) => message.body.includes('verify gate'))).toBe(
      true,
    );
    const mainLog = execFileSync('git', ['log', '--oneline'], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(mainLog).not.toContain('Risky');
  });

  it('stops on budget exhaustion and resumes from the ledger', async () => {
    const log: string[] = [];
    const { service, repo } = setup(committingRunner(log), passingVerifier, {
      budgetMs: 60_000,
    });
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    service.addTask(
      run.id,
      { title: 'Slow', files: ['packages/db/src/slow.ts'] },
      createCorrelationId(),
    );

    service.stop(run.id);
    await service.pump(run.id);
    expect(service.state(run.id).run.status).toBe('stopped');
    expect(log).toEqual([]);

    await service.resume(run.id, createCorrelationId());

    const state = service.state(run.id);
    expect(log).toEqual(['Slow']);
    expect(state.tasks[0]!.status).toBe('landed');
    expect(state.run.status).toBe('done');
  });

  it('wraps up when the budget is already spent', async () => {
    const log: string[] = [];
    const { service, repo } = setup(committingRunner(log), passingVerifier, {
      budgetMs: 60_000,
    });
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    service.addTask(
      run.id,
      { title: 'TooLate', files: ['packages/db/src/l.ts'] },
      createCorrelationId(),
    );

    // Deterministic clock: the budget check reads Date.now(), never a timer.
    vi.useFakeTimers({ now: Date.now() + 120_000 });
    try {
      await service.pump(run.id);
    } finally {
      vi.useRealTimers();
    }

    expect(service.state(run.id).run.status).toBe('budget');
    expect(log).toEqual([]);
  });

  it('credits seat token and cost usage and queues directives', async () => {
    const { service, repo } = setup(committingRunner([]));
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    service.addTask(
      run.id,
      { title: 'Metered', files: ['packages/db/src/m.ts'] },
      createCorrelationId(),
    );
    await service.pump(run.id);

    const state = service.state(run.id);
    const builder = state.seats.find((seat) => seat.role === 'builder')!;
    expect(builder.tokensUsed).toBe(120);
    expect(builder.costUsd).toBeCloseTo(0.02);

    service.direct(run.id, [builder.id], 'wrap up now', createCorrelationId());
    expect(
      service
        .state(run.id)
        .messages.some(
          (message) => message.kind === 'directive' && message.body === 'wrap up now',
        ),
    ).toBe(true);
    expect(() =>
      service.direct(run.id, ['not-a-seat'], 'hello', createCorrelationId()),
    ).toThrow(/Unknown swarm seat/);
  });
});

describe('SwarmService restart recovery', () => {
  it('reconciles a run the app left running and resumes it', async () => {
    const log: string[] = [];
    const repo = createRepository();
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database, migrations);
    const board = new BoardService(database, logger);
    const build = () =>
      new SwarmService(database, logger, board, committingRunner(log), passingVerifier);

    // First "process": create the run and leave a task mid-flight.
    const first = build();
    const run = first.createRun(createInput(repo, 1), createCorrelationId());
    const task = first.addTask(
      run.id,
      { title: 'Interrupted', files: ['packages/db/src/i.ts'] },
      createCorrelationId(),
    );
    database.run('UPDATE swarm_tasks SET status = ? WHERE id = ?', [
      'in_progress',
      task.id,
    ]);

    // Second "process": the dispatcher is gone, so the run must reconcile.
    const second = build();
    expect(second.reconcileInterruptedRuns()).toBe(1);
    const reconciled = second.state(run.id);
    expect(reconciled.run.status).toBe('stopped');
    expect(reconciled.tasks[0]!.status).toBe('pending');

    await second.resume(run.id, createCorrelationId());
    const finished = second.state(run.id);
    expect(finished.tasks[0]!.status).toBe('landed');
    expect(finished.run.status).toBe('done');
    expect(second.latestRun()!.id).toBe(run.id);
  });

  it('retires seat worktrees when the run ends', async () => {
    const log: string[] = [];
    const { service, repo } = setup(committingRunner(log));
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    service.addTask(
      run.id,
      { title: 'Tidy', files: ['packages/db/src/t.ts'] },
      createCorrelationId(),
    );

    await service.pump(run.id);

    expect(service.state(run.id).run.status).toBe('done');
    const worktrees = execFileSync('git', ['worktree', 'list'], {
      cwd: repo,
      encoding: 'utf8',
    });
    // The fixture repo itself is named zero-swarm-git-*, so assert on the
    // sibling worktrees directory rather than the substring "swarm-".
    expect(worktrees).not.toContain('-worktrees/');
    expect(
      execFileSync('git', ['branch', '--list', 'exeum/*'], {
        cwd: repo,
        encoding: 'utf8',
      }).trim(),
    ).toBe('');
  });
});

describe('SwarmService failure containment', () => {
  it('fails a task whose worktree cannot be created instead of retrying forever', async () => {
    // A folder that is not a git repository: worktree creation throws before
    // the task ever runs, which used to loop because attempts never counted.
    const root = mkdtempSync(join(tmpdir(), 'zero-swarm-plain-'));
    temporaryDirectories.push(root, `${root}-worktrees`);
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database, migrations);
    const board = new BoardService(database, logger);
    let executions = 0;
    const service = new SwarmService(
      database,
      logger,
      board,
      {
        async execute() {
          executions += 1;
          return {
            status: 'landed',
            summary: 'never reached',
            tokensUsed: 0,
            costUsd: 0,
          };
        },
      },
      passingVerifier,
    );
    const run = service.createRun(createInput(root, 1), createCorrelationId());
    service.addTask(
      run.id,
      { title: 'Doomed', files: ['src/a.ts'] },
      createCorrelationId(),
    );

    await service.pump(run.id);

    const state = service.state(run.id);
    expect(state.tasks[0]!.status).toBe('failed');
    expect(state.tasks[0]!.attempts).toBe(2);
    expect(executions).toBe(0);
    expect(state.run.status).toBe('failed');
  });

  it('retires a seat so the dispatcher stops assigning to it', async () => {
    const log: string[] = [];
    const { service, repo } = setup(committingRunner(log));
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    const seat = service.state(run.id).seats.find((item) => item.role === 'builder')!;

    service.stopSeat(run.id, seat.id, createCorrelationId());
    service.addTask(
      run.id,
      { title: 'Unassigned', files: ['src/x.ts'] },
      createCorrelationId(),
    );
    await service.pump(run.id);

    const state = service.state(run.id);
    expect(state.seats.find((item) => item.id === seat.id)!.status).toBe('exited');
    expect(log).toEqual([]);
    expect(state.tasks[0]!.status).toBe('pending');
    expect(() => service.stopSeat(run.id, 'not-a-seat', createCorrelationId())).toThrow(
      /Unknown swarm seat/,
    );
  });
});

describe('SwarmService review gate and planning', () => {
  it('sends a task back when the reviewer asks for a fix', async () => {
    const log: string[] = [];
    const reviews: string[] = [];
    const { service, repo } = setup(committingRunner(log), passingVerifier, {
      reviewer: {
        async review({ taskTitle, diff }) {
          reviews.push(taskTitle);
          expect(diff).toContain('reviewed-work');
          return { verdict: 'fix', issues: ['missing a test'] };
        },
      },
    });
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    service.addTask(
      run.id,
      { title: 'reviewed work', files: ['packages/db/src/r.ts'] },
      createCorrelationId(),
    );

    await service.pump(run.id);

    const state = service.state(run.id);
    expect(reviews).toEqual(['reviewed work', 'reviewed work']);
    expect(state.tasks[0]!.status).toBe('failed');
    expect(state.tasks[0]!.landedCommit).toBeNull();
    expect(
      state.messages.some((message) => message.body.includes('missing a test')),
    ).toBe(true);
  });

  it('lands when the reviewer approves', async () => {
    const { service, repo } = setup(committingRunner([]), passingVerifier, {
      reviewer: {
        async review() {
          return { verdict: 'approve' };
        },
      },
    });
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    service.addTask(
      run.id,
      { title: 'approved work', files: ['packages/db/src/ok.ts'] },
      createCorrelationId(),
    );

    await service.pump(run.id);

    expect(service.state(run.id).tasks[0]!.status).toBe('landed');
  });

  it('hands queued directives to the next invocation exactly once', async () => {
    const seen: string[][] = [];
    const runner: SwarmSeatRunner = {
      async execute({ task, worktreePath, directives }) {
        seen.push([...directives]);
        writeFileSync(join(worktreePath, `${seen.length}.md`), task.title);
        execFileSync('git', ['add', '-A'], { cwd: worktreePath });
        execFileSync('git', ['commit', '-m', task.title], { cwd: worktreePath });
        return { status: 'landed', summary: 'ok', tokensUsed: 1, costUsd: 0 };
      },
    };
    const { service, repo } = setup(runner);
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    const seat = service.state(run.id).seats.find((item) => item.role === 'builder')!;
    service.addTask(
      run.id,
      { title: 'first', files: ['packages/db/src/1.ts'] },
      createCorrelationId(),
    );
    service.direct(run.id, [seat.id], 'prefer small commits', createCorrelationId());
    service.addTask(
      run.id,
      { title: 'second', files: ['packages/db/src/2.ts'] },
      createCorrelationId(),
    );

    // One seat runs both tasks in order: the first consumes the directive,
    // the second must not see it again.
    await service.pump(run.id);

    expect(seen).toEqual([['prefer small commits'], []]);
  });

  it('creates tasks from a plan with dependencies resolved to ids', async () => {
    const { service, repo } = setup(committingRunner([]));
    const run = service.createRun(createInput(repo, 1), createCorrelationId());

    const created = await service.planTasks(
      run.id,
      {
        async plan({ mission, maxTasks }) {
          expect(mission).toBe('ship the fixtures');
          expect(maxTasks).toBe(3);
          return [
            {
              title: 'Base',
              detail: null,
              files: ['packages/db/src/base.ts'],
              dependsOn: [],
            },
            {
              title: 'Follow up',
              detail: 'after base',
              files: ['packages/db/src/follow.ts'],
              dependsOn: [0],
            },
          ];
        },
      },
      createCorrelationId(),
    );

    expect(created).toHaveLength(2);
    expect(created[1]!.dependsOn).toEqual([created[0]!.id]);
    const state = service.state(run.id);
    expect(state.tasks).toHaveLength(2);
    expect(state.messages.some((message) => message.kind === 'coordinator_note')).toBe(
      true,
    );
  });
});

describe('workspaceTargetsForFiles', () => {
  it('maps owned files to workspace directories', () => {
    expect(
      workspaceTargetsForFiles([
        'packages/db/src/a.ts',
        'packages/db/src/b.ts',
        'apps/desktop/src/main/x.ts',
        'README.md',
        'docs/STATUS.md',
      ]),
    ).toEqual(['apps/desktop', 'packages/db']);
  });

  it('returns nothing when no workspace package is touched', () => {
    expect(workspaceTargetsForFiles(['README.md', 'scripts/worktree-add'])).toEqual([]);
  });
});
