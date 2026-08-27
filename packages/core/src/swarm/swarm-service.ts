import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { SwarmRepository, type ZeroDatabase } from '@zero/db';
import type { Logger } from '@zero/observability';
import {
  SWARM_BUDGET_MS,
  SWARM_SKILLS,
  taggedMissionPaths,
  swarmPlanBudget,
  swarmRunSchema,
  swarmSeatSchema,
  swarmStateSchema,
  swarmTaskSchema,
  type SwarmCreateInput,
  type SwarmMessageKind,
  type SwarmRunRecord,
  type SwarmSeatRecord,
  type SwarmState,
  type SwarmTaskRecord,
} from '@zero/protocol';
import {
  createCorrelationId,
  normalizeError,
  utcNow,
  ZeroError,
  type CorrelationId,
} from '@zero/shared';

import type { BoardService } from '../board/board-service.js';
import { buildRepoSnapshot, type SwarmPlanner } from './swarm-planning.js';
import type { SwarmReviewer } from './swarm-reviewer.js';
import { buildSeatPrompt } from './swarm-prompt.js';

const execFileAsync = promisify(execFile);

export interface SwarmRunnerOutcome {
  readonly status: 'landed' | 'failed';
  readonly summary: string;
  readonly tokensUsed: number;
  readonly costUsd: number;
  /** Raw CLI text. Scout reports use this as the context pack. */
  readonly output?: string;
}

export interface SwarmExecuteInput {
  readonly run: SwarmRunRecord;
  readonly seat: SwarmSeatRecord;
  readonly task: SwarmTaskRecord;
  readonly worktreePath: string;
  readonly branch: string;
  readonly directives: readonly string[];
  readonly prompt: string;
  readonly model?: string;
  readonly onPane?: (paneId: string) => void;
}

/** Adapters run one task on one seat. Implementations must always resolve. */
export interface SwarmSeatRunner {
  execute(input: SwarmExecuteInput): Promise<SwarmRunnerOutcome>;
}

export interface SwarmVerifyInput {
  readonly run: SwarmRunRecord;
  readonly task: SwarmTaskRecord;
  readonly worktreePath: string;
  readonly branch: string;
}

export interface SwarmVerifyResult {
  readonly ok: boolean;
  readonly detail: string;
}

/** Deterministic gate. No agent grades its own work. */
export interface SwarmTaskVerifier {
  verify(input: SwarmVerifyInput): Promise<SwarmVerifyResult>;
}

export interface SwarmTaskSpec {
  readonly title: string;
  readonly detail?: string | null;
  readonly files: readonly string[];
  readonly dependsOn?: readonly string[];
}

export interface SwarmServiceOptions {
  /** Wall clock a run may consume before it wraps up. */
  readonly budgetMs?: number;
  /** Optional second pair of eyes between the verify gate and the land queue. */
  readonly reviewer?: SwarmReviewer;
}

/** Announces that a run's ledger changed, so hosts can push to the UI. */
export type SwarmRunEventListener = (runId: string) => void;

/** One execution plus one retry. */
const MAX_ATTEMPTS = 2;

/** Skills each role actually uses; a seat sees its own standing directives. */
const ROLE_SKILLS: Record<string, readonly string[]> = {
  coordinator: ['review', 'ci', 'errors', 'commits'],
  builder: ['commits', 'tdd', 'monorepo', 'types', 'lint', 'errors', 'migrations'],
  scout: ['monorepo', 'perf', 'privacy'],
  reviewer: ['review', 'security', 'a11y', 'dry', 'docs', 'types'],
};

function roleSkills(run: SwarmRunRecord, role: string) {
  const allowed = new Set(ROLE_SKILLS[role] ?? []);
  return SWARM_SKILLS.filter(
    (skill) => run.skillIds.includes(skill.id) && allowed.has(skill.id),
  ).map((skill) => ({
    title: skill.title,
    directive: run.skillDirectives[skill.id] ?? skill.directive,
  }));
}
const DIRECTIVES_CONSUMED = 'directives consumed:';

function resolveUnder(folderPath: string, tagged: string): string | null {
  const abs = resolve(folderPath, tagged);
  const rel = relative(folderPath, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return abs;
}

/**
 * Deterministic swarm orchestrator. Owns the ledger, dependency gating, work
 * stealing across free builder seats, retry, the verify gate, the sequential
 * land queue, and the budget clock. Running agents and verifying builds are
 * injected adapters, so the loop is testable without a single real CLI.
 */
export class SwarmService {
  private readonly repository: SwarmRepository;
  private readonly pumping = new Set<string>();
  private landQueue: Promise<void> = Promise.resolve();
  private readonly budgetMs: number;
  private readonly reviewer: SwarmReviewer | undefined;
  private readonly listeners = new Set<SwarmRunEventListener>();
  private readonly seatModels = new Map<string, string>();

  constructor(
    database: ZeroDatabase,
    private readonly logger: Logger,
    private readonly board: BoardService,
    private readonly runner: SwarmSeatRunner,
    private readonly verifier: SwarmTaskVerifier,
    options: SwarmServiceOptions = {},
  ) {
    this.repository = new SwarmRepository(database);
    this.budgetMs = options.budgetMs ?? SWARM_BUDGET_MS;
    this.reviewer = options.reviewer;
  }

  createRun(input: SwarmCreateInput, correlationId: CorrelationId): SwarmRunRecord {
    const runId = randomUUID();
    const run = swarmRunSchema.parse({
      id: runId,
      name: input.name,
      folderPath: input.folderPath,
      mission: input.mission,
      launchMode: input.launchMode,
      presetId: input.presetId,
      skillIds: [...input.skillIds],
      skillDirectives: { ...(input.skillDirectives ?? {}) },
      boardSessionId: null,
      status: 'running',
      startedAt: utcNow(),
      endedAt: null,
      budgetMs: this.budgetMs,
    });
    const seats = input.seats.map((seat) =>
      swarmSeatSchema.parse({
        id: randomUUID(),
        runId,
        role: seat.role,
        agentId: seat.agentId,
        mode: input.launchMode,
        paneId: null,
        worktreePath: null,
        branch: null,
        status: 'queued',
        tokensUsed: 0,
        costUsd: 0,
      }),
    );
    for (const [index, assignment] of input.seats.entries()) {
      const model = assignment.model?.trim();
      const seat = seats[index];
      if (model !== undefined && model.length > 0 && seat !== undefined) {
        this.seatModels.set(seat.id, model);
      }
    }
    this.repository.createRun(run, seats);
    this.logger.info({
      event: 'swarm.run_created',
      correlationId,
      data: { runId, seats: seats.length, presetId: input.presetId },
    });
    return run;
  }

  /** Subscribes to ledger changes; returns an unsubscribe function. */
  onRunEvent(listener: SwarmRunEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(runId: string): void {
    for (const listener of this.listeners) listener(runId);
  }

  /**
   * Creates builder worktrees up front so the first tasks start warm instead
   * of paying worktree creation after the planner finishes.
   */
  async warmSeats(runId: string): Promise<void> {
    const run = this.requireRun(runId);
    const seats = this.repository
      .listSeats(runId)
      .map((row) => swarmSeatSchema.parse(row))
      .filter((seat) => seat.role === 'builder' && seat.worktreePath === null);
    await Promise.all(
      seats.map(async (seat) => {
        try {
          this.repository.updateSeat(await this.ensureWorktree(run, seat));
          this.emit(runId);
        } catch {
          // The dispatcher surfaces real failures when the task runs.
        }
      }),
    );
  }

  /** Ends a run that cannot proceed, with the reason in the ledger. */
  failRun(runId: string, reason: string): void {
    const run = this.requireRun(runId);
    if (run.status !== 'running') return;
    this.repository.updateRun(runId, 'failed', utcNow());
    this.appendMessage(runId, null, 'system', `Swarm failed: ${reason}`.slice(0, 4_000));
    this.emit(runId);
  }

  /** Appends a system note to the ledger (launch notices, operator context). */
  note(runId: string, body: string): void {
    this.requireRun(runId);
    this.appendMessage(runId, null, 'system', body.slice(0, 4_000));
  }

  /**
   * No dispatcher survives a process restart, so any run still marked running
   * at startup is stopped and its in-flight tasks return to pending. That
   * makes the run resumable instead of stuck forever.
   */
  reconcileInterruptedRuns(): number {
    let reconciled = 0;
    for (const row of this.repository.listRuns(200)) {
      if (row.status !== 'running') continue;
      this.repository.updateRun(row.id, 'stopped', utcNow());
      for (const taskRow of this.repository.listTasks(row.id)) {
        const task = swarmTaskSchema.parse(taskRow);
        if (task.status !== 'in_progress') continue;
        this.repository.updateTask({ ...task, status: 'pending', updatedAt: utcNow() });
      }
      for (const seatRow of this.repository.listSeats(row.id)) {
        const seat = swarmSeatSchema.parse(seatRow);
        if (seat.status !== 'working') continue;
        this.repository.updateSeat({ ...seat, status: 'idle' });
      }
      this.appendMessage(
        row.id,
        null,
        'system',
        'App restarted while this swarm was running; it is stopped and resumable',
      );
      reconciled += 1;
    }
    return reconciled;
  }

  /** The newest run, so a reopened window can adopt a swarm in flight. */
  latestRun(): SwarmRunRecord | null {
    const row = this.repository.listRuns(1).at(0);
    return row === undefined ? null : swarmRunSchema.parse(row);
  }

  attachBoardSession(runId: string, boardSessionId: string): void {
    this.requireRun(runId);
    this.repository.setBoardSession(runId, boardSessionId);
  }

  addTask(
    runId: string,
    spec: SwarmTaskSpec,
    correlationId: CorrelationId,
  ): SwarmTaskRecord {
    this.requireRun(runId);
    const now = utcNow();
    const task = swarmTaskSchema.parse({
      id: randomUUID(),
      runId,
      seatId: null,
      title: spec.title,
      detail: spec.detail ?? null,
      files: [...spec.files],
      status: 'pending',
      dependsOn: [...(spec.dependsOn ?? [])],
      attempts: 0,
      landedCommit: null,
      createdAt: now,
      updatedAt: now,
    });
    this.repository.insertTask(task);
    this.emit(runId);
    this.logger.info({
      event: 'swarm.task_added',
      correlationId,
      data: { runId, taskId: task.id },
    });
    return task;
  }

  /** Queues a directive. Seats consume it on their next invocation. */
  direct(
    runId: string,
    seatIds: readonly string[],
    body: string,
    correlationId: CorrelationId,
  ): void {
    this.requireRun(runId);
    const known = new Set(this.repository.listSeats(runId).map((seat) => seat.id));
    for (const seatId of seatIds) {
      if (!known.has(seatId)) {
        throw new ZeroError('VALIDATION_FAILED', 'Unknown swarm seat');
      }
    }
    for (const seatId of seatIds) {
      this.appendMessage(runId, seatId, 'directive', body);
    }
    this.logger.info({
      event: 'swarm.directive_queued',
      correlationId,
      data: { runId, seats: seatIds.length },
    });
  }

  /** Retires one seat: it finishes nothing further and takes no new tasks. */
  stopSeat(runId: string, seatId: string, correlationId: CorrelationId): void {
    this.requireRun(runId);
    const seat = this.repository.getSeat(seatId);
    if (seat === undefined || seat.runId !== runId) {
      throw new ZeroError('VALIDATION_FAILED', 'Unknown swarm seat');
    }
    this.repository.updateSeat({
      ...swarmSeatSchema.parse(seat),
      status: 'exited',
    });
    this.appendMessage(runId, seatId, 'system', 'Seat retired by the operator');
    this.logger.info({
      event: 'swarm.seat_stopped',
      correlationId,
      data: { runId, seatId },
    });
    this.emit(runId);
  }

  async addSeat(
    runId: string,
    input: {
      readonly role: SwarmSeatRecord['role'];
      readonly agentId: SwarmSeatRecord['agentId'];
    },
    correlationId: CorrelationId,
  ): Promise<SwarmSeatRecord> {
    const run = this.requireRun(runId);
    if (run.status !== 'running') {
      throw new ZeroError('VALIDATION_FAILED', 'Swarm is not running');
    }
    if (this.repository.listSeats(runId).length >= 12) {
      throw new ZeroError('VALIDATION_FAILED', 'Swarm already has 12 seats');
    }
    let seat = swarmSeatSchema.parse({
      id: randomUUID(),
      runId,
      role: input.role,
      agentId: input.agentId,
      mode: run.launchMode,
      paneId: null,
      worktreePath: null,
      branch: null,
      status: 'queued',
      tokensUsed: 0,
      costUsd: 0,
    });
    this.repository.addSeat(seat);
    if (seat.role === 'builder') {
      try {
        seat = await this.ensureWorktree(run, seat);
        this.repository.updateSeat(seat);
      } catch {
        // The dispatcher surfaces real failures when the task runs.
      }
    }
    this.appendMessage(runId, seat.id, 'system', `Added ${seat.role} seat`);
    this.logger.info({
      event: 'swarm.seat_added',
      correlationId,
      data: { runId, seatId: seat.id, role: seat.role },
    });
    this.emit(runId);
    return seat;
  }

  stop(runId: string): void {
    const run = this.requireRun(runId);
    if (run.status !== 'running') return;
    this.repository.updateRun(runId, 'stopped', utcNow());
    this.appendMessage(runId, null, 'system', 'Swarm stopped by user');
    this.emit(runId);
  }

  async resume(runId: string, correlationId: CorrelationId): Promise<void> {
    const run = this.requireRun(runId);
    if (run.status !== 'stopped' && run.status !== 'budget') {
      throw new ZeroError(
        'VALIDATION_FAILED',
        'Only a stopped or budget-cut swarm can resume',
      );
    }
    this.repository.updateRun(runId, 'running', null);
    for (const row of this.repository.listTasks(runId)) {
      const task = swarmTaskSchema.parse(row);
      if (task.status === 'in_progress') {
        this.repository.updateTask({ ...task, status: 'pending', updatedAt: utcNow() });
      }
    }
    this.appendMessage(runId, null, 'system', 'Swarm resumed');
    this.logger.info({ event: 'swarm.resumed', correlationId, data: { runId } });
    await this.pump(runId);
  }

  state(runId: string): SwarmState {
    const run = this.requireRun(runId);
    return swarmStateSchema.parse({
      run,
      seats: this.repository.listSeats(runId),
      tasks: this.repository.listTasks(runId),
      messages: this.repository.listMessages(runId, 500),
    });
  }

  /**
   * The dispatcher. Runs until the queue drains, the budget expires, or the
   * run stops. Any free builder seat takes the next unblocked task.
   */
  async pump(runId: string): Promise<void> {
    if (this.pumping.has(runId)) return;
    this.pumping.add(runId);
    let idleRounds = 0;
    try {
      await this.runScout(runId);
      for (;;) {
        const run = this.repository.getRun(runId);
        if (run === undefined || run.status !== 'running') return;
        const typedRun = swarmRunSchema.parse(run);
        const startedMs = Date.parse(typedRun.startedAt);
        if (Date.now() - startedMs > typedRun.budgetMs) {
          this.repository.updateRun(runId, 'budget', utcNow());
          this.appendMessage(runId, null, 'system', 'Budget spent; swarm wrapped up');
          return;
        }

        this.skipTasksBehindDeadDeps(runId);
        const tasks = this.repository
          .listTasks(runId)
          .map((row) => swarmTaskSchema.parse(row));
        const pending = tasks.filter((task) => task.status === 'pending');
        if (pending.length === 0) {
          if (tasks.some((task) => task.status === 'in_progress')) return;
          const landed = tasks.some((task) => task.status === 'landed');
          const failed = tasks.some((task) => task.status === 'failed');
          this.repository.updateRun(runId, landed ? 'done' : 'failed', utcNow());
          await this.retireWorktrees(typedRun);
          this.appendMessage(
            runId,
            null,
            'system',
            landed && !failed
              ? 'Swarm finished; every task landed'
              : landed
                ? 'Swarm finished with failed tasks'
                : 'Swarm finished; nothing landed',
          );
          return;
        }

        const landedIds = new Set(
          tasks.filter((task) => task.status === 'landed').map((task) => task.id),
        );
        const ready = pending.filter((task) =>
          task.dependsOn.every((dep) => landedIds.has(dep)),
        );
        if (ready.length === 0) return;

        const free = this.repository
          .listSeats(runId)
          .map((row) => swarmSeatSchema.parse(row))
          .filter(
            (seat) =>
              seat.role === 'builder' &&
              (seat.status === 'idle' || seat.status === 'queued'),
          );
        if (free.length === 0) return;

        const batch = ready.slice(0, free.length);
        const before = this.repository
          .listTasks(runId)
          .map((row) => `${row.id}:${row.status}:${row.attempts}`)
          .join('|');
        await Promise.all(
          batch.map((task, index) => this.executeOnSeat(typedRun, free[index]!, task)),
        );
        const after = this.repository
          .listTasks(runId)
          .map((row) => `${row.id}:${row.status}:${row.attempts}`)
          .join('|');
        idleRounds = before === after ? idleRounds + 1 : 0;
        if (idleRounds >= 2) {
          this.repository.updateRun(runId, 'failed', utcNow());
          this.appendMessage(
            runId,
            null,
            'system',
            'Swarm stopped: the queue stopped making progress',
          );
          return;
        }
      }
    } finally {
      this.pumping.delete(runId);
    }
  }

  private async executeOnSeat(
    run: SwarmRunRecord,
    seat: SwarmSeatRecord,
    task: SwarmTaskRecord,
  ): Promise<void> {
    // The attempt is counted before any step can fail: a worktree that cannot
    // be created must burn an attempt, never retry forever.
    const active: SwarmTaskRecord = {
      ...task,
      seatId: seat.id,
      status: 'in_progress',
      attempts: task.attempts + 1,
      updatedAt: utcNow(),
    };
    this.repository.updateTask(active);
    let current = seat;
    try {
      current = await this.ensureWorktree(run, seat);
      const worktreePath = current.worktreePath;
      const branch = current.branch;
      if (worktreePath === null || branch === null) {
        throw new ZeroError('VALIDATION_FAILED', 'Seat has no worktree');
      }
      current = { ...current, status: 'working' };
      this.repository.updateSeat(current);
      const directives = this.pendingDirectives(run.id, current.id);
      const pack = this.contextPack(run.id);
      const model = this.seatModels.get(current.id);
      const outcome = await this.runner.execute({
        run,
        seat: current,
        task: active,
        worktreePath,
        branch,
        directives,
        prompt: buildSeatPrompt({
          role: current.role,
          mission: run.mission,
          skills: roleSkills(run, current.role),
          swarmDigest: this.swarmDigest(run.id),
          ...(pack === undefined ? {} : { contextPack: pack }),
          task: { title: active.title, detail: active.detail, files: active.files },
          directives,
        }),
        ...(model === undefined ? {} : { model }),
        onPane: (paneId) => {
          const latest = this.repository.getSeat(current.id);
          if (latest === undefined) return;
          this.repository.updateSeat({ ...swarmSeatSchema.parse(latest), paneId });
          this.emit(run.id);
        },
      });
      if (directives.length > 0) {
        this.appendMessage(
          run.id,
          current.id,
          'system',
          `${DIRECTIVES_CONSUMED} ${directives.length}`,
        );
      }
      const credited = this.repository.getSeat(current.id);
      if (credited !== undefined) {
        const latest = swarmSeatSchema.parse(credited);
        this.repository.updateSeat({
          ...latest,
          status: latest.status === 'exited' ? 'exited' : 'idle',
          tokensUsed: latest.tokensUsed + outcome.tokensUsed,
          costUsd: latest.costUsd + outcome.costUsd,
        });
        this.emit(run.id);
      }

      if (this.shouldAbort(run.id, current.id)) {
        this.abandonInFlight(active);
        return;
      }
      const ahead =
        outcome.status === 'failed'
          ? await this.branchHasCommits(run.folderPath, worktreePath)
          : false;
      if (outcome.status === 'failed' && !ahead) {
        this.recordFailure(active, outcome.summary);
        return;
      }
      if (ahead) {
        this.appendMessage(
          run.id,
          current.id,
          'system',
          `${current.agentId} exited non-zero but left commits; continuing to verify`,
        );
      }

      const verification = await this.verifier.verify({
        run,
        task: active,
        worktreePath,
        branch,
      });
      if (!verification.ok) {
        this.recordFailure(active, `verify gate: ${verification.detail}`);
        return;
      }

      if (this.reviewer !== undefined) {
        const reviewerSeat = this.repository
          .listSeats(run.id)
          .map((row) => swarmSeatSchema.parse(row))
          .find((seat) => seat.role === 'reviewer' && seat.status !== 'exited');
        if (reviewerSeat !== undefined) {
          this.repository.updateSeat({ ...reviewerSeat, status: 'working' });
          this.emit(run.id);
        }
        try {
          const verdict = await this.reviewer.review({
            taskTitle: active.title,
            files: active.files,
            diff: await this.diffAgainstBase(run.folderPath, branch),
            cwd: run.folderPath,
          });
          this.appendMessage(
            run.id,
            reviewerSeat?.id ?? null,
            'task_event',
            verdict.verdict === 'approve'
              ? `review approved "${active.title}"`
              : `review: ${(verdict.issues ?? ['changes requested']).join('; ')}`,
          );
          if (verdict.verdict === 'fix') {
            this.recordFailure(
              active,
              `review: ${(verdict.issues ?? ['changes requested']).join('; ')}`,
            );
            return;
          }
        } finally {
          if (reviewerSeat !== undefined) {
            const latest = this.repository.getSeat(reviewerSeat.id);
            if (latest !== undefined && latest.status !== 'exited') {
              this.repository.updateSeat({
                ...swarmSeatSchema.parse(latest),
                status: 'idle',
              });
              this.emit(run.id);
            }
          }
        }
      }

      if (this.shouldAbort(run.id, current.id)) {
        this.abandonInFlight(active);
        return;
      }
      const landed = await this.landExclusive(run.folderPath, branch);
      this.repository.updateTask({
        ...active,
        status: 'landed',
        landedCommit: landed.head,
        updatedAt: utcNow(),
      });
      this.emit(run.id);
      this.appendMessage(
        run.id,
        current.id,
        'task_event',
        `landed "${active.title}" at ${landed.head.slice(0, 7)}`,
      );
    } catch (error) {
      this.recordFailure(active, normalizeError(error).message);
    } finally {
      const latest = this.repository.getSeat(current.id);
      if (latest !== undefined && latest.status === 'working') {
        this.repository.updateSeat({ ...swarmSeatSchema.parse(latest), status: 'idle' });
      }
    }
  }

  /** Retry once, then give up on the task without stalling the swarm. */
  private recordFailure(task: SwarmTaskRecord, reason: string): void {
    const retry = task.attempts < MAX_ATTEMPTS;
    this.repository.updateTask({
      ...task,
      status: retry ? 'pending' : 'failed',
      updatedAt: utcNow(),
    });
    this.appendMessage(
      task.runId,
      task.seatId,
      'task_event',
      `${retry ? 'retrying' : 'failed'} "${task.title}": ${reason}`,
    );
  }

  /** Stop or a retired seat must not verify or land. */
  private shouldAbort(runId: string, seatId: string): boolean {
    const run = this.repository.getRun(runId);
    if (run === undefined || run.status !== 'running') return true;
    const seat = this.repository.getSeat(seatId);
    return seat === undefined || seat.status === 'exited';
  }

  private abandonInFlight(task: SwarmTaskRecord): void {
    this.repository.updateTask({
      ...task,
      status: 'pending',
      updatedAt: utcNow(),
    });
    this.appendMessage(
      task.runId,
      task.seatId,
      'task_event',
      `stopped "${task.title}" before land`,
    );
  }

  private skipTasksBehindDeadDeps(runId: string): void {
    for (;;) {
      const tasks = this.repository
        .listTasks(runId)
        .map((row) => swarmTaskSchema.parse(row));
      const dead = new Set(
        tasks
          .filter((task) => task.status === 'failed' || task.status === 'skipped')
          .map((task) => task.id),
      );
      const doomed = tasks.filter(
        (task) =>
          task.status === 'pending' && task.dependsOn.some((dep) => dead.has(dep)),
      );
      if (doomed.length === 0) return;
      for (const task of doomed) {
        this.repository.updateTask({ ...task, status: 'skipped', updatedAt: utcNow() });
        this.appendMessage(
          runId,
          null,
          'task_event',
          `skipped "${task.title}": a dependency never landed`,
        );
      }
    }
  }

  private async ensureWorktree(
    run: SwarmRunRecord,
    seat: SwarmSeatRecord,
  ): Promise<SwarmSeatRecord> {
    if (seat.worktreePath !== null && seat.branch !== null) {
      const base = await this.board.readBranch(run.folderPath);
      if (base !== null) {
        try {
          await execFileAsync('git', ['merge', '--no-edit', base], {
            cwd: seat.worktreePath,
            timeout: 30_000,
          });
          return seat;
        } catch {
          await execFileAsync('git', ['merge', '--abort'], {
            cwd: seat.worktreePath,
          }).catch(() => undefined);
          await execFileAsync(
            'git',
            ['worktree', 'remove', '--force', seat.worktreePath],
            { cwd: run.folderPath, timeout: 15_000 },
          ).catch(() => undefined);
        }
      } else {
        return seat;
      }
    }
    const worktree = await this.board.createWorktree(
      run.folderPath,
      `swarm-${run.id.slice(0, 8)}-${seat.id.slice(0, 4)}`,
      createCorrelationId(),
    );
    return swarmSeatSchema.parse({
      ...seat,
      worktreePath: worktree.path,
      branch: worktree.branch,
    });
  }

  private async branchHasCommits(
    folderPath: string,
    worktreePath: string,
  ): Promise<boolean> {
    const base = await this.board.readBranch(folderPath);
    if (base === null) return false;
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['rev-list', '--count', `${base}..HEAD`],
        { cwd: worktreePath, timeout: 15_000 },
      );
      return Number(stdout.trim()) > 0;
    } catch {
      return false;
    }
  }

  /** Directives queued for this seat (or broadcast) since its last invocation. */
  private pendingDirectives(runId: string, seatId: string): string[] {
    const messages = this.repository.listMessages(runId, 500);
    let cutoff = '';
    for (const message of messages) {
      if (
        message.seatId === seatId &&
        message.kind === 'system' &&
        message.body.startsWith(DIRECTIVES_CONSUMED) &&
        message.createdAt > cutoff
      ) {
        cutoff = message.createdAt;
      }
    }
    return messages
      .filter(
        (message) =>
          message.kind === 'directive' &&
          (message.seatId === seatId || message.seatId === null) &&
          message.createdAt > cutoff,
      )
      .map((message) => message.body);
  }

  private async diffAgainstBase(repoPath: string, branch: string): Promise<string> {
    const base = await this.board.readBranch(repoPath);
    if (base === null) return '';
    const { stdout } = await execFileAsync('git', ['diff', `${base}...${branch}`], {
      cwd: repoPath,
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  }

  /**
   * Decomposes the mission into a task DAG with exclusive file ownership. One
   * structured model call, capped by the preset's task budget.
   */
  async planTasks(
    runId: string,
    planner: SwarmPlanner,
    correlationId: CorrelationId,
  ): Promise<SwarmTaskRecord[]> {
    const run = this.requireRun(runId);
    if (run.status !== 'running') return [];
    const queen = this.repository
      .listSeats(runId)
      .map((row) => swarmSeatSchema.parse(row))
      .find((seat) => seat.role === 'coordinator' && seat.status !== 'exited');
    if (queen !== undefined) {
      this.repository.updateSeat({ ...queen, status: 'working' });
      this.emit(runId);
    }
    try {
      const snapshot = await buildRepoSnapshot(run.folderPath);
      const planned = await planner.plan({
        mission: run.mission,
        snapshot,
        maxTasks: swarmPlanBudget(run.presetId),
        roster: this.repository
          .listSeats(runId)
          .map((seat) => `${seat.role}/${seat.agentId}`)
          .join(', '),
      });
      if (this.requireRun(runId).status !== 'running') return [];
      const created: SwarmTaskRecord[] = [];
      for (const task of planned) {
        const dependsOn = task.dependsOn
          .map((index) => created[index]?.id)
          .filter((id): id is string => id !== undefined);
        created.push(
          this.addTask(
            runId,
            {
              title: task.title,
              detail: task.detail,
              files: task.files,
              dependsOn,
            },
            correlationId,
          ),
        );
      }
      this.appendMessage(
        runId,
        queen?.id ?? null,
        'coordinator_note',
        `planned ${created.length} task(s) from the mission`,
      );
      return created;
    } finally {
      if (queen !== undefined) {
        const latest = this.repository.getSeat(queen.id);
        if (latest !== undefined && latest.status !== 'exited') {
          this.repository.updateSeat({
            ...swarmSeatSchema.parse(latest),
            status: 'idle',
          });
          this.emit(runId);
        }
      }
    }
  }

  /**
   * Compact shared context (Cognition's shared-trace fix): the roster and a
   * one-line summary of every landed task, so seats' implicit decisions
   * converge instead of diverging.
   */
  private swarmDigest(runId: string): string {
    const seats = this.repository.listSeats(runId);
    const roster = seats.map((seat) => `${seat.role}/${seat.agentId}`).join(', ');
    const landed = this.repository
      .listTasks(runId)
      .filter((task) => task.status === 'landed')
      .map(
        (task) =>
          `- ${task.title}${
            task.landedCommit === null ? '' : ` (${task.landedCommit.slice(0, 7)})`
          }: ${task.detail === null ? 'landed' : task.detail.slice(0, 160)}`,
      );
    if (landed.length === 0) return `Swarm roster: ${roster}.`;
    return [
      `Swarm roster: ${roster}.`,
      'Work already landed by other seats (do not redo or contradict it):',
      ...landed.slice(-12),
    ].join('\n');
  }

  private contextPack(runId: string): string | undefined {
    const run = this.repository.getRun(runId);
    const files =
      run === undefined ? undefined : this.fileContext(swarmRunSchema.parse(run));
    const reports = this.repository
      .listMessages(runId, 500)
      .filter((message) => message.kind === 'seat_report');
    const last = reports.at(-1);
    const scout = last === undefined || last.body.length === 0 ? undefined : last.body;
    const parts = [files, scout].filter((item): item is string => item !== undefined);
    return parts.length === 0 ? undefined : parts.join('\n\n');
  }

  private fileContext(run: SwarmRunRecord): string | undefined {
    const chunks: string[] = [];
    for (const tagged of taggedMissionPaths(run.mission).slice(0, 8)) {
      const abs = resolveUnder(run.folderPath, tagged);
      if (abs === null) continue;
      try {
        chunks.push(`@${tagged}\n${readFileSync(abs, 'utf8').slice(0, 8_000)}`);
      } catch {
        // Missing or unreadable tags stay out of the pack.
      }
    }
    return chunks.length === 0 ? undefined : chunks.join('\n\n');
  }

  private async landExclusive(
    folderPath: string,
    branch: string,
  ): Promise<{ readonly landed: true; readonly head: string }> {
    const previous = this.landQueue;
    let release = (): void => undefined;
    this.landQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.board.landBranch(folderPath, branch, createCorrelationId());
    } finally {
      release();
    }
  }

  private async runScout(runId: string): Promise<void> {
    const row = this.repository.getRun(runId);
    if (row === undefined || row.status !== 'running') return;
    const run = swarmRunSchema.parse(row);
    const scout = this.repository
      .listSeats(runId)
      .map((seat) => swarmSeatSchema.parse(seat))
      .find(
        (seat) =>
          seat.role === 'scout' && (seat.status === 'queued' || seat.status === 'idle'),
      );
    if (scout === undefined) return;
    this.repository.updateSeat({ ...scout, status: 'working' });
    this.emit(runId);
    try {
      const branch = (await this.board.readBranch(run.folderPath)) ?? 'HEAD';
      const scoutModel = this.seatModels.get(scout.id);
      const outcome = await this.runner.execute({
        run,
        seat: { ...scout, status: 'working' },
        task: {
          id: randomUUID(),
          runId,
          seatId: scout.id,
          title: 'Scout the repository',
          detail: 'Read-only map for the builders. Do not edit files.',
          files: [],
          status: 'in_progress',
          attempts: 1,
          dependsOn: [],
          landedCommit: null,
          createdAt: utcNow(),
          updatedAt: utcNow(),
        },
        worktreePath: run.folderPath,
        branch,
        directives: [],
        prompt: buildSeatPrompt({
          role: 'scout',
          mission: run.mission,
          skills: roleSkills(run, 'scout'),
          task: {
            title: 'Scout the repository',
            detail: 'Read-only map for the builders. Do not edit files.',
            files: [],
          },
          directives: [],
        }),
        ...(scoutModel === undefined ? {} : { model: scoutModel }),
        onPane: (paneId) => {
          const latest = this.repository.getSeat(scout.id);
          if (latest === undefined) return;
          this.repository.updateSeat({ ...swarmSeatSchema.parse(latest), paneId });
          this.emit(runId);
        },
      });
      const credited = this.repository.getSeat(scout.id);
      if (credited !== undefined) {
        const latest = swarmSeatSchema.parse(credited);
        this.repository.updateSeat({
          ...latest,
          status: latest.status === 'exited' ? 'exited' : 'idle',
          tokensUsed: latest.tokensUsed + outcome.tokensUsed,
          costUsd: latest.costUsd + outcome.costUsd,
        });
      }
      const body = (outcome.output ?? outcome.summary).trim();
      this.appendMessage(
        runId,
        scout.id,
        'seat_report',
        body.length > 0 ? body.slice(0, 4_000) : 'Scout finished with an empty report',
      );
    } catch (error) {
      this.appendMessage(
        runId,
        scout.id,
        'system',
        `Scout failed: ${normalizeError(error).message}`,
      );
    } finally {
      const latest = this.repository.getSeat(scout.id);
      if (latest !== undefined && latest.status === 'working') {
        this.repository.updateSeat({ ...swarmSeatSchema.parse(latest), status: 'idle' });
      }
      this.emit(runId);
    }
  }

  private async retireWorktrees(run: SwarmRunRecord): Promise<void> {
    const base = await this.board.readBranch(run.folderPath);
    for (const row of this.repository.listSeats(run.id)) {
      const seat = swarmSeatSchema.parse(row);
      if (seat.worktreePath === null || seat.branch === null) continue;
      try {
        if (base !== null) {
          const { stdout } = await execFileAsync(
            'git',
            ['rev-list', '--count', `${base}..${seat.branch}`],
            { cwd: run.folderPath, timeout: 15_000 },
          );
          if (Number(stdout.trim()) > 0) {
            this.appendMessage(
              run.id,
              seat.id,
              'system',
              `kept ${seat.branch}: it still holds unlanded commits`,
            );
            continue;
          }
        }
        await execFileAsync('git', ['worktree', 'remove', '--force', seat.worktreePath], {
          cwd: run.folderPath,
          timeout: 30_000,
        });
        await execFileAsync('git', ['branch', '-D', seat.branch], {
          cwd: run.folderPath,
          timeout: 15_000,
        });
        this.repository.updateSeat({ ...seat, worktreePath: null, branch: null });
      } catch (error) {
        this.appendMessage(
          run.id,
          seat.id,
          'system',
          `could not retire ${seat.branch}: ${normalizeError(error).message}`,
        );
      }
    }
  }

  private appendMessage(
    runId: string,
    seatId: string | null,
    kind: SwarmMessageKind,
    body: string,
  ): void {
    this.repository.appendMessage({
      id: randomUUID(),
      runId,
      seatId,
      kind,
      body: body.slice(0, 4_000),
      createdAt: utcNow(),
    });
    this.emit(runId);
  }

  private requireRun(runId: string): SwarmRunRecord {
    const run = this.repository.getRun(runId);
    if (run === undefined) {
      throw new ZeroError('VALIDATION_FAILED', 'Unknown swarm run');
    }
    return swarmRunSchema.parse(run);
  }
}
