import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrations, openDatabase, runMigrations } from '@builderhelm/db';
import { createLogger } from '@builderhelm/observability';
import { BuilderHelmError, createCorrelationId } from '@builderhelm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ConnectionService,
  type ConnectorTransport,
  type RemoteJobState,
} from '../src/connections/connection-service.js';
import { MemorySecretStore } from '../src/secrets/secret-store.js';
import { nextTriggerAt, ScheduleService } from '../src/schedules/schedule-service.js';

const databases: ReturnType<typeof openDatabase>[] = [];
const dirs: string[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

class FixtureTransport implements ConnectorTransport {
  started = 0;
  runStatus: RemoteJobState = { status: 'succeeded', datasetId: 'ds-1' };
  failAuth = false;
  items: unknown = [
    {
      id: 'post-1',
      url: 'https://x.com/a/status/1',
      author: 'a',
      text: 'hello',
      postedAt: '2026-09-01',
    },
  ];

  async test(): Promise<void> {
    if (this.failAuth) throw new BuilderHelmError('AUTH_FAILED', 'token expired');
  }

  async startRun(): Promise<{ remoteId: string }> {
    if (this.failAuth) throw new BuilderHelmError('AUTH_FAILED', 'token expired');
    this.started += 1;
    return { remoteId: `run-${this.started}` };
  }

  async getRun(): Promise<RemoteJobState> {
    return this.runStatus;
  }

  async getItems(): Promise<unknown> {
    return this.items;
  }
}

const profileId = 'profile-11111111-1111-1111-1111-111111111111';

function clock(start: Date) {
  let now = start;
  return {
    now: () => now,
    set: (next: Date) => {
      now = next;
    },
    addMs: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

async function setup(start = new Date('2026-09-09T12:00:00.000Z')) {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  const dir = mkdtempSync(join(tmpdir(), 'bh-sched-'));
  dirs.push(dir);
  const transport = new FixtureTransport();
  const connections = new ConnectionService(
    database,
    new MemorySecretStore(),
    createLogger(() => undefined),
    dir,
    transport,
  );
  await connections.connect(
    { kind: 'apify', token: 'apify-token-1' },
    createCorrelationId(),
  );
  const connection = connections.snapshot().connections[0]!;
  connections.grant({
    connectionId: connection.id,
    profileId,
    toolName: 'apify.research',
    enabled: true,
  });
  const time = clock(start);
  const schedules = new ScheduleService(
    database,
    connections,
    createLogger(() => undefined),
    () => time.now(),
  );
  return { schedules, transport, time, database, connections };
}

function researchTask() {
  return {
    tool: 'apify.research' as const,
    profileId,
    topic: 'builderhelm',
    limit: 5,
    costLimitUsd: 1,
    windowDays: 7,
  };
}

describe('ScheduleService', () => {
  it('states desktop-open lifetime and does not catch up paid work after sleep', async () => {
    const { schedules, transport, time } = await setup();
    const created = schedules.create(
      {
        name: 'daily research',
        timezone: 'UTC',
        trigger: { kind: 'interval', everyMinutes: 1 },
        task: researchTask(),
        budgetUsd: 10,
      },
      createCorrelationId(),
    );
    expect(created.lifetime).toBe('desktop-open');
    expect(schedules.snapshot().hostMustRemainRunning).toBe(true);
    time.addMs(60 * 60 * 1000);
    const snap = await schedules.tick(createCorrelationId());
    expect(transport.started).toBe(0);
    expect(snap.runs[0]?.skipReason).toBe('missed-paid');
    expect(snap.runs[0]?.outcome).toBe('skipped');
  });

  it('fires once, then ignores a duplicate due slot', async () => {
    const { schedules, transport, time, database } = await setup();
    const created = schedules.create(
      {
        name: 'interval research',
        timezone: 'UTC',
        trigger: { kind: 'interval', everyMinutes: 1 },
        task: researchTask(),
        budgetUsd: 10,
      },
      createCorrelationId(),
    );
    time.addMs(60_000);
    await schedules.tick(createCorrelationId());
    expect(transport.started).toBe(1);
    const due = created.nextRunAt;
    database.run(
      `UPDATE ade_schedules SET next_run_at = ?, last_tick_at = ? WHERE id = ?`,
      [due, time.now().toISOString(), created.id],
    );
    await schedules.tick(createCorrelationId());
    expect(transport.started).toBe(1);
    expect(
      schedules.snapshot().runs.filter((run) => run.outcome !== 'skipped').length,
    ).toBe(1);
  });

  it('skips overlap, quota, and expired accounts without starting paid work', async () => {
    const { schedules, transport, time } = await setup();
    transport.runStatus = { status: 'running' };
    schedules.create(
      {
        name: 'overlap',
        timezone: 'UTC',
        trigger: { kind: 'interval', everyMinutes: 1 },
        task: researchTask(),
        budgetUsd: 10,
      },
      createCorrelationId(),
    );
    time.addMs(60_000);
    await schedules.tick(createCorrelationId());
    expect(transport.started).toBe(1);
    time.addMs(60_000);
    const overlap = await schedules.tick(createCorrelationId());
    expect(transport.started).toBe(1);
    expect(overlap.runs.some((run) => run.skipReason === 'overlap')).toBe(true);

    const {
      schedules: quotaSchedules,
      transport: quotaTransport,
      time: quotaTime,
    } = await setup();
    quotaSchedules.create(
      {
        name: 'quota',
        timezone: 'UTC',
        trigger: { kind: 'interval', everyMinutes: 1 },
        task: researchTask(),
        budgetUsd: 0,
      },
      createCorrelationId(),
    );
    quotaTime.addMs(60_000);
    const quota = await quotaSchedules.tick(createCorrelationId());
    expect(quotaTransport.started).toBe(0);
    expect(quota.runs[0]?.skipReason).toBe('quota');

    const {
      schedules: authSchedules,
      transport: authTransport,
      time: authTime,
    } = await setup();
    authTransport.failAuth = true;
    authSchedules.create(
      {
        name: 'expired',
        timezone: 'UTC',
        trigger: { kind: 'interval', everyMinutes: 1 },
        task: researchTask(),
        budgetUsd: 10,
      },
      createCorrelationId(),
    );
    authTime.addMs(60_000);
    const expired = await authSchedules.tick(createCorrelationId());
    expect(authTransport.started).toBe(0);
    expect(expired.runs[0]?.skipReason).toBe('expired-account');
    expect(expired.runs[0]?.outcome).toBe('failed');
  });

  it('keeps a running run on the old config when the schedule is edited', async () => {
    const { schedules, transport, time } = await setup();
    transport.runStatus = { status: 'running' };
    const created = schedules.create(
      {
        name: 'v1',
        timezone: 'UTC',
        trigger: { kind: 'interval', everyMinutes: 1 },
        task: researchTask(),
        budgetUsd: 10,
      },
      createCorrelationId(),
    );
    time.addMs(60_000);
    await schedules.tick(createCorrelationId());
    const updated = schedules.update(
      {
        scheduleId: created.id,
        name: 'v2',
        timezone: 'UTC',
        trigger: { kind: 'interval', everyMinutes: 5 },
        task: { ...researchTask(), topic: 'other' },
        budgetUsd: 3,
      },
      createCorrelationId(),
    );
    expect(updated.configVersion).toBe(2);
    const running = schedules.snapshot().runs.find((run) => run.outcome === 'running');
    expect(running?.configVersion).toBe(1);
  });

  it('pauses, resumes without catch-up, and cancels without claiming remote death', async () => {
    const { schedules, transport, time } = await setup();
    transport.runStatus = { status: 'running' };
    const created = schedules.create(
      {
        name: 'pause',
        timezone: 'UTC',
        trigger: { kind: 'interval', everyMinutes: 1 },
        task: researchTask(),
        budgetUsd: 10,
      },
      createCorrelationId(),
    );
    schedules.pause(created.id, createCorrelationId());
    time.addMs(60_000);
    await schedules.tick(createCorrelationId());
    expect(transport.started).toBe(0);
    schedules.resume(created.id, createCorrelationId());
    await schedules.tick(createCorrelationId());
    expect(transport.started).toBe(0);
    time.addMs(60_000);
    await schedules.tick(createCorrelationId());
    expect(transport.started).toBe(1);
    const run = schedules.snapshot().runs.find((row) => row.outcome === 'running')!;
    const cancelled = await schedules.cancelRun(run.id, createCorrelationId());
    expect(cancelled.outcome).toBe('cancelled');
    expect(cancelled.notice).toMatch(/not confirmed/);
  });

  it('resumes observation of a saved remote job after host restart', async () => {
    const { schedules, transport, time } = await setup();
    transport.runStatus = { status: 'running' };
    schedules.create(
      {
        name: 'observe',
        timezone: 'UTC',
        trigger: { kind: 'interval', everyMinutes: 1 },
        task: researchTask(),
        budgetUsd: 10,
      },
      createCorrelationId(),
    );
    time.addMs(60_000);
    await schedules.tick(createCorrelationId());
    transport.runStatus = { status: 'succeeded', datasetId: 'ds-1' };
    const snap = await schedules.reconcile(createCorrelationId());
    expect(snap.runs[0]?.outcome).toBe('succeeded');
    expect(snap.runs[0]?.remoteJobId).toBe('run-1');
  });

  it('skips a DST spring-forward gap and still keys a fall-back hour once', () => {
    const gap = nextTriggerAt(new Date('2026-03-07T12:00:00.000Z'), 'America/New_York', {
      kind: 'daily',
      hour: 2,
      minute: 30,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    }).formatToParts(gap);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    expect(map.hour).toBe('02');
    expect(map.minute).toBe('30');
    expect(map.day).not.toBe('08');

    const first = nextTriggerAt(
      new Date('2026-11-01T05:00:00.000Z'),
      'America/New_York',
      { kind: 'daily', hour: 1, minute: 30, weekdays: [0, 1, 2, 3, 4, 5, 6] },
    );
    const second = nextTriggerAt(first, 'America/New_York', {
      kind: 'daily',
      hour: 1,
      minute: 30,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    expect(second.getTime()).toBeGreaterThan(first.getTime());
    expect(second.toISOString().slice(0, 10)).not.toBe(first.toISOString().slice(0, 10));
  });
});
