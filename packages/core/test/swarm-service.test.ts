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

function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setupLandSpy(runner: SwarmSeatRunner): {
  service: SwarmService;
  repo: string;
  lands: string[];
} {
  const repo = createRepository();
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  const board = new BoardService(database, logger);
  const lands: string[] = [];
  const original = board.landBranch.bind(board);
  board.landBranch = async (repoPath, branch, correlationId) => {
    lands.push(branch);
    return original(repoPath, branch, correlationId);
  };
  const service = new SwarmService(database, logger, board, runner, passingVerifier);
  return { service, repo, lands };
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

describe('SwarmService shared context', () => {
  it('puts the roster and landed work into later seat prompts', async () => {
    const prompts: string[] = [];
    const inner = committingRunner([]);
    const runner: SwarmSeatRunner = {
      async execute(input) {
        prompts.push(input.prompt);
        return inner.execute(input);
      },
    };
    const { service, repo } = setup(runner);
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    service.addTask(
      run.id,
      { title: 'Alpha', detail: 'write the fixture', files: ['src/a.ts'] },
      createCorrelationId(),
    );
    service.addTask(
      run.id,
      { title: 'Beta', files: ['src/b.ts'] },
      createCorrelationId(),
    );

    await service.pump(run.id);

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('Swarm roster:');
    expect(prompts[0]).toContain('builder/grok');
    expect(prompts[0]).not.toContain('Work already landed');
    expect(prompts[1]).toContain('Work already landed by other seats');
    expect(prompts[1]).toContain('Alpha');
    expect(prompts[1]).toContain('write the fixture');
  });

  it('gives a builder only the skills its role uses', async () => {
    const prompts: string[] = [];
    const inner = committingRunner([]);
    const runner: SwarmSeatRunner = {
      async execute(input) {
        prompts.push(input.prompt);
        return inner.execute(input);
      },
    };
    const { service, repo } = setup(runner);
    const run = service.createRun(
      { ...createInput(repo, 1), skillIds: ['tdd', 'review', 'security'] },
      createCorrelationId(),
    );
    service.addTask(
      run.id,
      { title: 'Wire', files: ['src/w.ts'] },
      createCorrelationId(),
    );

    await service.pump(run.id);

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Test-Driven');
    expect(prompts[0]).not.toContain('Code Review');
    expect(prompts[0]).not.toContain('Security');
  });
});

describe('SwarmService launch events and warm start', () => {
  it('warms builder worktrees before any task runs', async () => {
    const { service, repo } = setup(committingRunner([]));
    const run = service.createRun(createInput(repo, 2), createCorrelationId());

    await service.warmSeats(run.id);

    const warmed = service
      .state(run.id)
      .seats.filter((seat) => seat.role === 'builder' && seat.worktreePath !== null);
    expect(warmed).toHaveLength(2);
    const worktrees = execFileSync('git', ['worktree', 'list'], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(worktrees).toContain('-worktrees/');
  });

  it('emits run events on ledger changes and fails a run with a reason', () => {
    const { service, repo } = setup(committingRunner([]));
    const seen: string[] = [];
    const unsubscribe = service.onRunEvent((runId) => seen.push(runId));
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    service.addTask(
      run.id,
      { title: 'Noted', files: ['src/n.ts'] },
      createCorrelationId(),
    );
    service.failRun(run.id, 'planner could not read the repository');
    unsubscribe();
    service.stop(run.id);

    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.every((runId) => runId === run.id)).toBe(true);
    const state = service.state(run.id);
    expect(state.run.status).toBe('failed');
    expect(
      state.messages.some((message) => message.body.includes('planner could not read')),
    ).toBe(true);
    // No events after unsubscribe.
    const before = seen.length;
    service.direct(run.id, [state.seats[0]!.id], 'late', createCorrelationId());
    expect(seen.length).toBe(before);
  });

  it('emits when a seat becomes working and stores the pane id', async () => {
    const started = deferred();
    const gate = deferred();
    const paneId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const { service, repo } = setup({
      async execute(input) {
        input.onPane?.(paneId);
        started.resolve();
        await gate.promise;
        return { status: 'landed', summary: 'ok', tokensUsed: 1, costUsd: 0 };
      },
    });
    const seen: string[] = [];
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    service.onRunEvent((runId) => seen.push(runId));
    service.addTask(
      run.id,
      { title: 'Live', files: ['packages/db/src/l.ts'] },
      createCorrelationId(),
    );

    const pumping = service.pump(run.id);
    await started.promise;
    const live = service.state(run.id);
    const builder = live.seats.find((seat) => seat.role === 'builder')!;
    expect(builder.status).toBe('working');
    expect(builder.paneId).toBe(paneId);
    expect(seen.length).toBeGreaterThan(0);
    gate.resolve();
    await pumping;
  });

  it('starts a ready task while another is already in progress', async () => {
    const started = deferred();
    const gate = deferred();
    let running = 0;
    const repo = createRepository();
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database, migrations);
    const board = new BoardService(database, logger);
    const service = new SwarmService(
      database,
      logger,
      board,
      {
        async execute() {
          running += 1;
          if (running === 1) started.resolve();
          await gate.promise;
          return { status: 'landed', summary: 'ok', tokensUsed: 1, costUsd: 0 };
        },
      },
      passingVerifier,
    );
    const run = service.createRun(createInput(repo, 2), createCorrelationId());
    const first = service.addTask(
      run.id,
      { title: 'First', files: ['packages/db/src/f.ts'] },
      createCorrelationId(),
    );
    service.addTask(
      run.id,
      { title: 'Second', files: ['packages/db/src/s.ts'] },
      createCorrelationId(),
    );
    database.run('UPDATE swarm_tasks SET status = ? WHERE id = ?', [
      'in_progress',
      first.id,
    ]);

    const pumping = service.pump(run.id);
    await started.promise;
    expect(running).toBe(1);
    expect(
      service.state(run.id).tasks.find((task) => task.title === 'Second')!.status,
    ).toBe('in_progress');
    gate.resolve();
    await pumping;
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

  it('does not land a task when the run is stopped mid-execute', async () => {
    const started = deferred();
    const gate = deferred();
    const { service, repo, lands } = setupLandSpy({
      async execute() {
        started.resolve();
        await gate.promise;
        return { status: 'landed', summary: 'would land', tokensUsed: 1, costUsd: 0 };
      },
    });
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    service.addTask(
      run.id,
      { title: 'In flight', files: ['packages/db/src/s.ts'] },
      createCorrelationId(),
    );

    const pumping = service.pump(run.id);
    await started.promise;
    service.stop(run.id);
    gate.resolve();
    await pumping;

    const state = service.state(run.id);
    expect(lands).toEqual([]);
    expect(state.run.status).toBe('stopped');
    expect(state.tasks[0]!.status).toBe('pending');
    expect(state.tasks[0]!.landedCommit).toBeNull();
  });

  it('emits after stop so listeners can refresh', () => {
    const { service, repo } = setup(committingRunner([]));
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    const seen: string[] = [];
    service.onRunEvent((runId) => seen.push(runId));
    service.stop(run.id);
    expect(seen).toContain(run.id);
    expect(service.state(run.id).run.status).toBe('stopped');
  });

  it('does not land a task when the seat is stopped mid-execute', async () => {
    const started = deferred();
    const gate = deferred();
    const { service, repo, lands } = setupLandSpy({
      async execute() {
        started.resolve();
        await gate.promise;
        return { status: 'landed', summary: 'would land', tokensUsed: 1, costUsd: 0 };
      },
    });
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    const seat = service.state(run.id).seats.find((item) => item.role === 'builder')!;
    service.addTask(
      run.id,
      { title: 'In flight', files: ['packages/db/src/s.ts'] },
      createCorrelationId(),
    );

    const pumping = service.pump(run.id);
    await started.promise;
    service.stopSeat(run.id, seat.id, createCorrelationId());
    gate.resolve();
    await pumping;

    const state = service.state(run.id);
    expect(lands).toEqual([]);
    expect(state.seats.find((item) => item.id === seat.id)!.status).toBe('exited');
    expect(state.tasks[0]!.status).toBe('pending');
    expect(state.tasks[0]!.landedCommit).toBeNull();
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

    await service.pump(run.id);

    expect(service.state(run.id).tasks.map((task) => task.status)).toEqual([
      'landed',
      'landed',
    ]);
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

describe('SwarmService roles', () => {
  it('scouts before the first builder and feeds the report into builder prompts', async () => {
    const roles: string[] = [];
    const builderPrompts: string[] = [];
    const inner = committingRunner([]);
    const { service, repo } = setup({
      async execute(input) {
        roles.push(input.seat.role);
        if (input.seat.role === 'scout') {
          return {
            status: 'landed',
            summary: 'scouted',
            output: 'API lives in src/api.ts',
            tokensUsed: 3,
            costUsd: 0,
          };
        }
        builderPrompts.push(input.prompt);
        return inner.execute(input);
      },
    });
    const run = service.createRun(
      {
        ...createInput(repo, 1),
        seats: [
          { role: 'coordinator', agentId: 'claude' },
          { role: 'scout', agentId: 'grok' },
          { role: 'builder', agentId: 'grok' },
        ],
      },
      createCorrelationId(),
    );
    service.addTask(
      run.id,
      { title: 'Build', files: ['src/api.ts'] },
      createCorrelationId(),
    );

    await service.pump(run.id);

    expect(roles[0]).toBe('scout');
    expect(roles).toContain('builder');
    const state = service.state(run.id);
    expect(
      state.messages.find((message) => message.kind === 'seat_report')?.body,
    ).toContain('API lives in src/api.ts');
    expect(
      state.messages.findIndex((message) => message.kind === 'seat_report'),
    ).toBeLessThan(
      state.messages.findIndex((message) => message.body.includes('landed "Build"')),
    );
    expect(builderPrompts[0]).toContain('API lives in src/api.ts');
  });

  it('marks the coordinator working while it plans', async () => {
    const { service, repo } = setup(committingRunner([]));
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    let seen = '';
    await service.planTasks(
      run.id,
      {
        async plan() {
          seen = service
            .state(run.id)
            .seats.find((seat) => seat.role === 'coordinator')!.status;
          return [{ title: 'Only', detail: null, files: ['src/o.ts'], dependsOn: [] }];
        },
      },
      createCorrelationId(),
    );
    expect(seen).toBe('working');
    expect(
      service.state(run.id).seats.find((seat) => seat.role === 'coordinator')!.status,
    ).toBe('idle');
  });

  it('records a review verdict before land', async () => {
    const order: string[] = [];
    const repo = createRepository();
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database, migrations);
    const board = new BoardService(database, logger);
    const original = board.landBranch.bind(board);
    board.landBranch = async (repoPath, branch, correlationId) => {
      order.push('land');
      return original(repoPath, branch, correlationId);
    };
    const service = new SwarmService(
      database,
      logger,
      board,
      committingRunner([]),
      passingVerifier,
      {
        reviewer: {
          async review() {
            order.push('review');
            const reviewer = service
              .state(run.id)
              .seats.find((seat) => seat.role === 'reviewer');
            expect(reviewer?.status).toBe('working');
            return { verdict: 'approve' };
          },
        },
      },
    );
    const run = service.createRun(
      {
        ...createInput(repo, 1),
        seats: [
          { role: 'coordinator', agentId: 'claude' },
          { role: 'builder', agentId: 'grok' },
          { role: 'reviewer', agentId: 'claude' },
        ],
      },
      createCorrelationId(),
    );
    service.addTask(
      run.id,
      { title: 'Reviewed', files: ['packages/db/src/r.ts'] },
      createCorrelationId(),
    );

    await service.pump(run.id);

    expect(order).toEqual(['review', 'land']);
    expect(
      service
        .state(run.id)
        .messages.some((message) => message.body.includes('review approved')),
    ).toBe(true);
    expect(service.state(run.id).tasks[0]!.status).toBe('landed');
  });

  it('starts two file-disjoint tasks on two builders', async () => {
    const started = deferred();
    const gate = deferred();
    let running = 0;
    const { service, repo } = setup({
      async execute() {
        running += 1;
        if (running === 2) started.resolve();
        await gate.promise;
        return { status: 'landed', summary: 'ok', tokensUsed: 1, costUsd: 0 };
      },
    });
    const run = service.createRun(createInput(repo, 2), createCorrelationId());
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

    const pumping = service.pump(run.id);
    await started.promise;
    expect(running).toBe(2);
    gate.resolve();
    await pumping;
  });

  it('lands one branch at a time', async () => {
    const firstInside = deferred();
    const releaseFirst = deferred();
    const repo = createRepository();
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database, migrations);
    const board = new BoardService(database, logger);
    let inside = 0;
    let max = 0;
    const original = board.landBranch.bind(board);
    board.landBranch = async (repoPath, branch, correlationId) => {
      inside += 1;
      max = Math.max(max, inside);
      if (max === 1 && inside === 1) {
        firstInside.resolve();
        await releaseFirst.promise;
      }
      inside -= 1;
      return original(repoPath, branch, correlationId);
    };
    const service = new SwarmService(
      database,
      logger,
      board,
      committingRunner([]),
      passingVerifier,
    );
    const run = service.createRun(createInput(repo, 2), createCorrelationId());
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

    const pumping = service.pump(run.id);
    await firstInside.promise;
    await Promise.resolve();
    expect(max).toBe(1);
    releaseFirst.resolve();
    await pumping;

    expect(max).toBe(1);
    expect(service.state(run.id).tasks.every((task) => task.status === 'landed')).toBe(
      true,
    );
  });
});

describe('SwarmService mid-flight seats', () => {
  it('adds a seat on a running run', async () => {
    const { service, repo } = setup(committingRunner([]));
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    const before = service.state(run.id).seats.length;
    const seen: string[] = [];
    service.onRunEvent((id) => seen.push(id));

    const added = await service.addSeat(
      run.id,
      { role: 'builder', agentId: 'grok' },
      createCorrelationId(),
    );

    const state = service.state(run.id);
    expect(state.seats).toHaveLength(before + 1);
    expect(added.role).toBe('builder');
    expect(added.status === 'queued' || added.status === 'idle').toBe(true);
    expect(
      state.seats.some(
        (seat) =>
          seat.id === added.id &&
          seat.role === 'builder' &&
          (seat.status === 'queued' || seat.status === 'idle'),
      ),
    ).toBe(true);
    expect(state.messages.some((message) => message.body === 'Added builder seat')).toBe(
      true,
    );
    expect(seen).toContain(run.id);
  });

  it('refuses a thirteenth seat', async () => {
    const { service, repo } = setup(committingRunner([]));
    const run = service.createRun(createInput(repo, 11), createCorrelationId());
    expect(service.state(run.id).seats).toHaveLength(12);
    await expect(
      service.addSeat(
        run.id,
        { role: 'builder', agentId: 'grok' },
        createCorrelationId(),
      ),
    ).rejects.toThrow(/12 seats/);
  });

  it('refuses to add a seat when the run is not running', async () => {
    const { service, repo } = setup(committingRunner([]));
    const run = service.createRun(createInput(repo, 1), createCorrelationId());
    service.stop(run.id);
    await expect(
      service.addSeat(
        run.id,
        { role: 'builder', agentId: 'grok' },
        createCorrelationId(),
      ),
    ).rejects.toThrow(/not running/);
  });

  it('lets pump assign a pending task to an added builder', async () => {
    const log: string[] = [];
    const { service, repo } = setup(committingRunner(log));
    const run = service.createRun(createInput(repo, 0), createCorrelationId());
    service.addTask(
      run.id,
      { title: 'Late', files: ['packages/db/src/l.ts'] },
      createCorrelationId(),
    );
    await service.addSeat(
      run.id,
      { role: 'builder', agentId: 'grok' },
      createCorrelationId(),
    );
    await service.pump(run.id);
    expect(log).toEqual(['Late']);
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

describe('SwarmService leftover skips', () => {
  it('puts tagged mission files and edited skill directives in the prompt', async () => {
    const prompts: string[] = [];
    const { service, repo } = setup({
      async execute(input) {
        prompts.push(input.prompt);
        return { status: 'landed', summary: 'ok', tokensUsed: 0, costUsd: 0 };
      },
    });
    writeFileSync(join(repo, 'note.md'), 'context from disk\n');
    const run = service.createRun(
      {
        ...createInput(repo, 1),
        mission: 'ship it using @note.md',
        skillIds: ['tdd'],
        skillDirectives: { tdd: 'Write the test last, not first.' },
      },
      createCorrelationId(),
    );
    service.addTask(
      run.id,
      { title: 'Do it', files: ['note.md'] },
      createCorrelationId(),
    );
    await service.pump(run.id);
    expect(prompts.some((prompt) => prompt.includes('context from disk'))).toBe(true);
    expect(
      prompts.some((prompt) => prompt.includes('Write the test last, not first.')),
    ).toBe(true);
  });

  it('rejects tagged files outside the workspace', async () => {
    const prompts: string[] = [];
    const { service, repo } = setup({
      async execute(input) {
        prompts.push(input.prompt);
        return { status: 'landed', summary: 'ok', tokensUsed: 0, costUsd: 0 };
      },
    });
    const run = service.createRun(
      {
        ...createInput(repo, 1),
        mission: 'do not leak @/etc/passwd',
      },
      createCorrelationId(),
    );
    service.addTask(
      run.id,
      { title: 'Safe', files: ['README.md'] },
      createCorrelationId(),
    );
    await service.pump(run.id);
    expect(prompts.join('\n')).not.toContain('root:');
  });
});

describe('SwarmService planner collapse', () => {
  it('failRun after a thrown plan leaves zero tasks and a failed run', async () => {
    const { service, repo } = setup(committingRunner([]));
    const run = service.createRun(createInput(repo, 2), createCorrelationId());
    await expect(
      service.planTasks(
        run.id,
        {
          async plan() {
            throw new Error('agent returned no JSON object');
          },
        },
        createCorrelationId(),
      ),
    ).rejects.toThrow(/no JSON object/);
    service.failRun(run.id, 'agent returned no JSON object');
    const state = service.state(run.id);
    expect(state.tasks).toHaveLength(0);
    expect(state.run.status).toBe('failed');
    expect(
      state.seats.every((seat) => seat.status === 'queued' || seat.status === 'idle'),
    ).toBe(true);
    expect(
      state.messages.some((message) => message.body.includes('no JSON object')),
    ).toBe(true);
  });

  it('pump with no tasks marks the run failed immediately', async () => {
    const { service, repo } = setup(committingRunner([]));
    const run = service.createRun(createInput(repo, 2), createCorrelationId());
    await service.pump(run.id);
    const state = service.state(run.id);
    expect(state.tasks).toHaveLength(0);
    expect(state.run.status).toBe('failed');
    expect(
      state.messages.some((message) => message.body.includes('nothing landed')),
    ).toBe(true);
  });
});
