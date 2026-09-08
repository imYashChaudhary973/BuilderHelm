import type { BuilderHelmDatabase } from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import type { ConnectorJob } from '@builderhelm/protocol/connections';
import {
  scheduleCreateInputSchema,
  scheduleRecordSchema,
  scheduleRunSchema,
  schedulesSnapshotSchema,
  scheduleTaskSchema,
  scheduleTriggerSchema,
  scheduleUpdateInputSchema,
  type ScheduleCreateInput,
  type ScheduleRecord,
  type ScheduleRun,
  type ScheduleSkipReason,
  type SchedulesSnapshot,
  type ScheduleTask,
  type ScheduleTrigger,
  type ScheduleUpdateInput,
} from '@builderhelm/protocol/schedules';
import { BuilderHelmError, createId, type CorrelationId } from '@builderhelm/shared';

import type { ConnectionService } from '../connections/connection-service.js';

const SLEEP_GAP_MS = 2 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

interface StoredSchedule extends Record<string, unknown> {
  id: string;
  name: string;
  state: string;
  lifetime: string;
  timezone: string;
  trigger_json: string;
  task_json: string;
  config_version: number;
  overlap_policy: string;
  budget_usd: number;
  remaining_budget_usd: number;
  notification: string;
  next_run_at: string | null;
  last_tick_at: string | null;
  created_at: string;
  updated_at: string;
}

interface StoredRun extends Record<string, unknown> {
  id: string;
  schedule_id: string;
  config_version: number;
  trigger_id: string;
  started_at: string;
  finished_at: string | null;
  outcome: string;
  skip_reason: string | null;
  connector_job_id: string | null;
  remote_job_id: string | null;
  notice: string | null;
  created_at: string;
}

interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function partsInZone(date: Date, timeZone: string): ZoneParts {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(formatted.map((part) => [part.type, part.value]));
  const weekday = WEEKDAYS.indexOf(map.weekday as (typeof WEEKDAYS)[number]);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekday === -1 ? 0 : weekday,
  };
}

export function zonedLocalToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  let date = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let i = 0; i < 3; i += 1) {
    const parts = partsInZone(date, timeZone);
    const got = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
    date = new Date(date.getTime() + (wanted - got));
  }
  return date;
}

function addDays(year: number, month: number, day: number, days: number): Date {
  return new Date(Date.UTC(year, month - 1, day + days));
}

export function nextTriggerAt(
  now: Date,
  timeZone: string,
  trigger: ScheduleTrigger,
): Date {
  if (trigger.kind === 'interval') {
    return new Date(now.getTime() + trigger.everyMinutes * 60_000);
  }
  const start = partsInZone(now, timeZone);
  for (let offset = 0; offset <= 14; offset += 1) {
    const day = addDays(start.year, start.month, start.day, offset);
    const year = day.getUTCFullYear();
    const month = day.getUTCMonth() + 1;
    const date = day.getUTCDate();
    const candidate = zonedLocalToUtc(
      timeZone,
      year,
      month,
      date,
      trigger.hour,
      trigger.minute,
    );
    const resolved = partsInZone(candidate, timeZone);
    if (resolved.hour !== trigger.hour || resolved.minute !== trigger.minute) {
      continue;
    }
    if (!trigger.weekdays.includes(resolved.weekday)) continue;
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  throw new BuilderHelmError('VALIDATION_FAILED', 'No next run in that timezone');
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new BuilderHelmError('VALIDATION_FAILED', 'Unknown timezone');
  }
}

function taskCost(task: ScheduleTask): number {
  return task.tool === 'apify.research' ? task.costLimitUsd : 0;
}

function civilKey(date: Date, timeZone: string): string {
  const parts = partsInZone(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function triggerId(schedule: ScheduleRecord, due: Date): string {
  const slot =
    schedule.trigger.kind === 'daily'
      ? civilKey(due, schedule.timezone)
      : due.toISOString();
  return `${schedule.id}:${schedule.configVersion}:${slot}`;
}

export class ScheduleService {
  constructor(
    private readonly database: BuilderHelmDatabase,
    private readonly connections: ConnectionService,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  snapshot(): SchedulesSnapshot {
    const schedules = this.database
      .queryAll<StoredSchedule>('SELECT * FROM ade_schedules ORDER BY created_at ASC')
      .map((row) => this.toSchedule(row));
    const runs = this.database
      .queryAll<StoredRun>(
        'SELECT * FROM ade_schedule_runs ORDER BY started_at DESC LIMIT 100',
      )
      .map((row) => this.toRun(row));
    return schedulesSnapshotSchema.parse({
      lifetime: 'desktop-open',
      hostMustRemainRunning: true,
      schedules,
      runs,
    });
  }

  create(input: ScheduleCreateInput, correlationId: CorrelationId): ScheduleRecord {
    const parsed = scheduleCreateInputSchema.parse(input);
    assertTimeZone(parsed.timezone);
    const now = this.now();
    const iso = now.toISOString();
    const next = nextTriggerAt(now, parsed.timezone, parsed.trigger);
    const row = scheduleRecordSchema.parse({
      id: createId(),
      name: parsed.name,
      state: 'active',
      lifetime: 'desktop-open',
      timezone: parsed.timezone,
      trigger: parsed.trigger,
      task: parsed.task,
      configVersion: 1,
      overlapPolicy: 'skip',
      budgetUsd: parsed.budgetUsd,
      remainingBudgetUsd: parsed.budgetUsd,
      notification: 'in-app',
      nextRunAt: next.toISOString(),
      lastTickAt: iso,
      createdAt: iso,
      updatedAt: iso,
    });
    this.database.run(
      `INSERT INTO ade_schedules (
         id, name, state, lifetime, timezone, trigger_json, task_json,
         config_version, overlap_policy, budget_usd, remaining_budget_usd,
         notification, next_run_at, last_tick_at, created_at, updated_at
       ) VALUES (?, ?, 'active', 'desktop-open', ?, ?, ?, 1, 'skip', ?, ?,
         'in-app', ?, ?, ?, ?)`,
      [
        row.id,
        row.name,
        row.timezone,
        JSON.stringify(row.trigger),
        JSON.stringify(row.task),
        row.budgetUsd,
        row.remainingBudgetUsd,
        row.nextRunAt,
        row.lastTickAt,
        row.createdAt,
        row.updatedAt,
      ],
    );
    this.logger.info({
      event: 'schedule.created',
      correlationId,
      data: { scheduleId: row.id, nextRunAt: row.nextRunAt },
    });
    return row;
  }

  update(input: ScheduleUpdateInput, correlationId: CorrelationId): ScheduleRecord {
    const parsed = scheduleUpdateInputSchema.parse(input);
    assertTimeZone(parsed.timezone);
    const current = this.requireSchedule(parsed.scheduleId);
    const now = this.now();
    const iso = now.toISOString();
    const next = nextTriggerAt(now, parsed.timezone, parsed.trigger);
    this.database.run(
      `UPDATE ade_schedules SET name = ?, timezone = ?, trigger_json = ?,
         task_json = ?, config_version = ?, budget_usd = ?, remaining_budget_usd = ?,
         next_run_at = ?, last_tick_at = ?, updated_at = ? WHERE id = ?`,
      [
        parsed.name,
        parsed.timezone,
        JSON.stringify(parsed.trigger),
        JSON.stringify(parsed.task),
        current.configVersion + 1,
        parsed.budgetUsd,
        parsed.budgetUsd,
        next.toISOString(),
        iso,
        iso,
        current.id,
      ],
    );
    this.logger.info({
      event: 'schedule.updated',
      correlationId,
      data: { scheduleId: current.id, configVersion: current.configVersion + 1 },
    });
    return this.requireSchedule(current.id);
  }

  pause(scheduleId: string, correlationId: CorrelationId): ScheduleRecord {
    this.setState(scheduleId, 'paused', correlationId);
    return this.requireSchedule(scheduleId);
  }

  resume(scheduleId: string, correlationId: CorrelationId): ScheduleRecord {
    const current = this.requireSchedule(scheduleId);
    const now = this.now();
    const iso = now.toISOString();
    const next = nextTriggerAt(now, current.timezone, current.trigger);
    this.database.run(
      `UPDATE ade_schedules SET state = 'active', next_run_at = ?, last_tick_at = ?,
         updated_at = ? WHERE id = ?`,
      [next.toISOString(), iso, iso, scheduleId],
    );
    this.logger.info({
      event: 'schedule.resumed',
      correlationId,
      data: { scheduleId, nextRunAt: next.toISOString() },
    });
    return this.requireSchedule(scheduleId);
  }

  async cancelRun(runId: string, correlationId: CorrelationId): Promise<ScheduleRun> {
    const run = this.requireRun(runId);
    if (run.outcome !== 'running') return run;
    let notice = 'Cancelled locally';
    let remoteJobId = run.remoteJobId;
    if (run.connectorJobId !== null) {
      const job = await this.connections.cancelLocal(run.connectorJobId, correlationId);
      remoteJobId = job.remoteJobId;
      notice =
        job.remoteJobId === null
          ? 'Cancelled locally before the provider accepted the job'
          : 'Cancelled locally; remote termination was not confirmed';
    }
    this.finish(run.id, 'cancelled', null, notice, run.connectorJobId, remoteJobId);
    this.logger.info({
      event: 'schedule.cancelled',
      correlationId,
      data: { runId: run.id, remoteConfirmed: false },
    });
    return this.requireRun(run.id);
  }

  async reconcile(correlationId: CorrelationId): Promise<SchedulesSnapshot> {
    const running = this.database.queryAll<StoredRun>(
      `SELECT * FROM ade_schedule_runs WHERE outcome = 'running'`,
    );
    for (const row of running) {
      await this.observeRun(this.toRun(row), correlationId, 'host-restart');
    }
    return this.snapshot();
  }

  async tick(correlationId: CorrelationId): Promise<SchedulesSnapshot> {
    await this.reconcileRunning(correlationId);
    const now = this.now();
    const schedules = this.database
      .queryAll<StoredSchedule>('SELECT * FROM ade_schedules ORDER BY created_at ASC')
      .map((row) => this.toSchedule(row));
    for (const schedule of schedules) {
      await this.tickOne(schedule, now, correlationId);
    }
    return this.snapshot();
  }

  private async reconcileRunning(correlationId: CorrelationId): Promise<void> {
    const running = this.database.queryAll<StoredRun>(
      `SELECT * FROM ade_schedule_runs WHERE outcome = 'running'`,
    );
    for (const row of running) {
      await this.observeRun(this.toRun(row), correlationId, null);
    }
  }

  private async observeRun(
    run: ScheduleRun,
    correlationId: CorrelationId,
    restartReason: 'host-restart' | null,
  ): Promise<void> {
    if (run.connectorJobId === null) {
      this.finish(
        run.id,
        'outcomeUnknown',
        restartReason,
        'Interrupted; remote termination was not confirmed',
      );
      return;
    }
    try {
      const job = await this.connections.observe(run.connectorJobId, correlationId);
      this.applyJob(run, job);
    } catch {
      this.finish(
        run.id,
        'outcomeUnknown',
        restartReason,
        'Remote job status could not be confirmed',
        run.connectorJobId,
        run.remoteJobId,
      );
    }
  }

  private applyJob(run: ScheduleRun, job: ConnectorJob): void {
    if (job.status === 'running') {
      this.database.run(
        `UPDATE ade_schedule_runs SET connector_job_id = ?, remote_job_id = ?
           WHERE id = ?`,
        [job.id, job.remoteJobId, run.id],
      );
      return;
    }
    const outcome =
      job.status === 'succeeded' ||
      job.status === 'failed' ||
      job.status === 'cancelled' ||
      job.status === 'outcomeUnknown'
        ? job.status
        : 'outcomeUnknown';
    this.finish(run.id, outcome, null, job.report, job.id, job.remoteJobId);
    if (outcome === 'succeeded') {
      this.consumeBudget(run.scheduleId, run.configVersion);
    }
  }

  private consumeBudget(scheduleId: string, configVersion: number): void {
    const schedule = this.requireSchedule(scheduleId);
    if (schedule.configVersion !== configVersion) return;
    const next = Math.max(0, schedule.remainingBudgetUsd - taskCost(schedule.task));
    this.database.run(
      `UPDATE ade_schedules SET remaining_budget_usd = ?, updated_at = ? WHERE id = ?`,
      [next, this.now().toISOString(), scheduleId],
    );
  }

  private async tickOne(
    schedule: ScheduleRecord,
    now: Date,
    correlationId: CorrelationId,
  ): Promise<void> {
    const woke =
      schedule.lastTickAt !== null &&
      now.getTime() - Date.parse(schedule.lastTickAt) > SLEEP_GAP_MS;
    const iso = now.toISOString();
    this.database.run(
      `UPDATE ade_schedules SET last_tick_at = ?, updated_at = ? WHERE id = ?`,
      [iso, iso, schedule.id],
    );
    if (schedule.state !== 'active') return;
    if (schedule.nextRunAt === null || Date.parse(schedule.nextRunAt) > now.getTime()) {
      return;
    }
    const due = new Date(schedule.nextRunAt);
    const id = triggerId(schedule, due);
    if (this.findRun(id) !== undefined) {
      this.advance(schedule, now);
      return;
    }
    const overlapping = this.database.queryOne<StoredRun>(
      `SELECT * FROM ade_schedule_runs WHERE schedule_id = ? AND outcome = 'running'`,
      [schedule.id],
    );
    if (overlapping !== undefined) {
      this.insertSkip(schedule, id, 'overlap', now);
      this.advance(schedule, now);
      this.logSkip(correlationId, schedule.id, 'overlap');
      return;
    }
    if (woke) {
      this.insertSkip(schedule, id, 'missed-paid', now);
      this.advance(schedule, now);
      this.logSkip(correlationId, schedule.id, 'missed-paid');
      return;
    }
    if (schedule.remainingBudgetUsd < taskCost(schedule.task)) {
      this.insertSkip(schedule, id, 'quota', now);
      this.advance(schedule, now);
      this.logSkip(correlationId, schedule.id, 'quota');
      return;
    }
    await this.fire(schedule, id, now, correlationId);
    this.advance(schedule, now);
  }

  private async fire(
    schedule: ScheduleRecord,
    trigger: string,
    now: Date,
    correlationId: CorrelationId,
  ): Promise<void> {
    const iso = now.toISOString();
    const runId = createId();
    this.database.run(
      `INSERT INTO ade_schedule_runs (
         id, schedule_id, config_version, trigger_id, started_at, finished_at,
         outcome, skip_reason, connector_job_id, remote_job_id, notice, created_at
       ) VALUES (?, ?, ?, ?, ?, NULL, 'running', NULL, NULL, NULL, NULL, ?)`,
      [runId, schedule.id, schedule.configVersion, trigger, iso, iso],
    );
    try {
      const job = await this.startTask(schedule, runId, now, correlationId);
      const run = this.requireRun(runId);
      this.applyJob(run, job);
      this.logger.info({
        event: 'schedule.fired',
        correlationId,
        data: { scheduleId: schedule.id, runId, jobId: job.id, status: job.status },
      });
    } catch (error) {
      const classified = this.classify(error);
      this.finish(runId, classified.outcome, classified.reason, classified.notice);
      this.logger.info({
        event: classified.outcome === 'failed' ? 'schedule.failed' : 'schedule.skipped',
        correlationId,
        data: { scheduleId: schedule.id, runId, reason: classified.reason },
      });
    }
  }

  private async startTask(
    schedule: ScheduleRecord,
    requestId: string,
    now: Date,
    correlationId: CorrelationId,
  ): Promise<ConnectorJob> {
    const task = schedule.task;
    if (task.tool === 'apify.research') {
      const until = now.toISOString().slice(0, 10);
      const since = new Date(now.getTime() - task.windowDays * 86_400_000)
        .toISOString()
        .slice(0, 10);
      return this.connections.research(
        {
          requestId,
          profileId: task.profileId,
          topic: task.topic,
          since,
          until,
          limit: task.limit,
          costLimitUsd: task.costLimitUsd,
          approved: true,
        },
        correlationId,
      );
    }
    return this.connections.publish(
      {
        requestId,
        profileId: task.profileId,
        text: task.text,
        account: task.account,
        approved: true,
      },
      correlationId,
    );
  }

  private classify(error: unknown): {
    outcome: ScheduleRun['outcome'];
    reason: ScheduleSkipReason | null;
    notice: string;
  } {
    const err = error instanceof BuilderHelmError ? error : null;
    const message = err?.message ?? (error instanceof Error ? error.message : 'failed');
    if (err?.code === 'AUTH_FAILED' || /credential|token|auth/i.test(message)) {
      return {
        outcome: 'failed',
        reason: 'expired-account',
        notice: message.slice(0, 500),
      };
    }
    if (err?.code === 'PERMISSION_DENIED' && /grant|schema/i.test(message)) {
      return { outcome: 'needs_approval', reason: null, notice: message.slice(0, 500) };
    }
    return { outcome: 'failed', reason: null, notice: message.slice(0, 500) };
  }

  private insertSkip(
    schedule: ScheduleRecord,
    trigger: string,
    reason: ScheduleSkipReason,
    now: Date,
  ): void {
    const iso = now.toISOString();
    this.database.run(
      `INSERT INTO ade_schedule_runs (
         id, schedule_id, config_version, trigger_id, started_at, finished_at,
         outcome, skip_reason, connector_job_id, remote_job_id, notice, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'skipped', ?, NULL, NULL, ?, ?)`,
      [
        createId(),
        schedule.id,
        schedule.configVersion,
        trigger,
        iso,
        iso,
        reason,
        reason,
        iso,
      ],
    );
  }

  private advance(schedule: ScheduleRecord, now: Date): void {
    const next = nextTriggerAt(now, schedule.timezone, schedule.trigger);
    this.database.run(
      `UPDATE ade_schedules SET next_run_at = ?, updated_at = ? WHERE id = ?`,
      [next.toISOString(), now.toISOString(), schedule.id],
    );
  }

  private finish(
    runId: string,
    outcome: ScheduleRun['outcome'],
    skipReason: ScheduleSkipReason | null,
    notice: string | null,
    connectorJobId?: string | null,
    remoteJobId?: string | null,
  ): void {
    const iso = this.now().toISOString();
    this.database.run(
      `UPDATE ade_schedule_runs SET outcome = ?, skip_reason = ?, notice = ?,
         finished_at = ?, connector_job_id = COALESCE(?, connector_job_id),
         remote_job_id = COALESCE(?, remote_job_id) WHERE id = ?`,
      [
        outcome,
        skipReason,
        notice,
        iso,
        connectorJobId ?? null,
        remoteJobId ?? null,
        runId,
      ],
    );
  }

  private setState(
    scheduleId: string,
    state: 'active' | 'paused',
    correlationId: CorrelationId,
  ): void {
    this.requireSchedule(scheduleId);
    const iso = this.now().toISOString();
    this.database.run(`UPDATE ade_schedules SET state = ?, updated_at = ? WHERE id = ?`, [
      state,
      iso,
      scheduleId,
    ]);
    this.logger.info({
      event: state === 'paused' ? 'schedule.paused' : 'schedule.resumed',
      correlationId,
      data: { scheduleId },
    });
  }

  private logSkip(
    correlationId: CorrelationId,
    scheduleId: string,
    reason: ScheduleSkipReason,
  ): void {
    this.logger.info({
      event: 'schedule.skipped',
      correlationId,
      data: { scheduleId, reason },
    });
  }

  private requireSchedule(id: string): ScheduleRecord {
    const row = this.database.queryOne<StoredSchedule>(
      'SELECT * FROM ade_schedules WHERE id = ?',
      [id],
    );
    if (row === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'That schedule was not found');
    }
    return this.toSchedule(row);
  }

  private requireRun(id: string): ScheduleRun {
    const row = this.database.queryOne<StoredRun>(
      'SELECT * FROM ade_schedule_runs WHERE id = ?',
      [id],
    );
    if (row === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'That run was not found');
    }
    return this.toRun(row);
  }

  private findRun(triggerIdValue: string): ScheduleRun | undefined {
    const row = this.database.queryOne<StoredRun>(
      'SELECT * FROM ade_schedule_runs WHERE trigger_id = ?',
      [triggerIdValue],
    );
    return row === undefined ? undefined : this.toRun(row);
  }

  private toSchedule(row: StoredSchedule): ScheduleRecord {
    return scheduleRecordSchema.parse({
      id: row.id,
      name: row.name,
      state: row.state,
      lifetime: row.lifetime,
      timezone: row.timezone,
      trigger: scheduleTriggerSchema.parse(JSON.parse(row.trigger_json) as unknown),
      task: scheduleTaskSchema.parse(JSON.parse(row.task_json) as unknown),
      configVersion: row.config_version,
      overlapPolicy: row.overlap_policy,
      budgetUsd: row.budget_usd,
      remainingBudgetUsd: row.remaining_budget_usd,
      notification: row.notification,
      nextRunAt: row.next_run_at,
      lastTickAt: row.last_tick_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  private toRun(row: StoredRun): ScheduleRun {
    return scheduleRunSchema.parse({
      id: row.id,
      scheduleId: row.schedule_id,
      configVersion: row.config_version,
      triggerId: row.trigger_id,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      outcome: row.outcome,
      skipReason: row.skip_reason,
      connectorJobId: row.connector_job_id,
      remoteJobId: row.remote_job_id,
      notice: row.notice,
      createdAt: row.created_at,
    });
  }
}
