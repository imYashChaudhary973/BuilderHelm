// The 12-pane Electron PTY baseline for the TypeScript runtime.
//
// This drives the real `BoardPtyManager` with the real `node-pty`, which loads
// under plain Node because it ships an N-API prebuild. What it does not use is
// Electron itself: the manager runs in the main process, and the only piece of
// Electron on this path is the final `webContents.send`. Spawn, per-chunk
// encoding and envelope parsing, write, resize, and kill are exercised for real.
//
// Skipped unless `HELM_PTY_BASELINE=1`, because it starts twelve interactive
// login shells and takes seconds. Run it with:
//
//     pnpm --filter @builderhelm/desktop baseline:pty
//
// Use this workload to catch terminal throughput and process-lifecycle regressions.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Real elapsed time is the measurement here, so this file waits on the clock
// on purpose. Fake timers cannot advance a shell writing bytes into a pty.
import { setTimeout as sleep } from 'node:timers/promises';

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', async () => {
  const { electronSession } = await import('./electron-mock.js');
  return {
    // Silence desk notifications: twelve panes exiting would raise twelve
    // toasts, and the notify path is not what the cutover moves.
    Notification: class {
      static isSupported(): boolean {
        return false;
      }
    },
    session: electronSession,
  };
});

import type { BoardPaneEventEnvelope } from '@builderhelm/protocol';
import type { WebContents } from 'electron';

import { BoardPtyManager } from '../src/main/board-pty-manager.js';

const PANES = 12;
const LINES = 2_000;
const LINE = '0123456789012345678901234567890123456789';
/**
 * Markers are written split and matched joined.
 *
 * A pty echoes back everything written to it, so a marker that appears
 * literally in the command line would be satisfied by that echo and the run
 * would "finish" before the shell executed anything. `__helm''_done__` is
 * echoed with the quotes and printed without them, so only real output can
 * match.
 */
const DONE_SPLIT = `__helm''_baseline_done__`;
const DONE = '__helm_baseline_done__';
const echoSplit = (index: number): string => `__helm''_echo_${String(index)}__`;
const echoJoined = (index: number): string => `__helm_echo_${String(index)}__`;
const CORRELATION_ID = '11111111-2222-4333-8444-555555555555';

interface PaneTiming {
  firstByteMs: number | null;
  /** Spawn until the pane's first command actually ran. Dominated by rc files. */
  readyMs: number | null;
  /** Round-trip once the shell is warm. This is the responsiveness number. */
  echoMs: number | null;
}

/** What one run of the workload measured. Printed, not asserted on. */
interface BaselineReport {
  readonly [metric: string]: number;
}

/** A stand-in for the renderer's WebContents that records what main sends. */
class RecordingSender {
  bytes = 0;
  sends = 0;
  readonly listeners: ((envelope: BoardPaneEventEnvelope) => void)[] = [];

  isDestroyed(): boolean {
    return false;
  }

  send(_channel: string, payload: unknown): void {
    this.sends += 1;
    // Unchecked: the manager schema-parsed this envelope one line earlier, and
    // re-parsing it here would charge the measurement for work the app never
    // does.
    const envelope = payload as BoardPaneEventEnvelope;
    if (envelope.event.type === 'data') this.bytes += envelope.event.data.length;
    for (const listener of this.listeners) listener(envelope);
  }
}

/** Private pane state, reachable for the orphan check without widening the API. */
interface ManagerInternals {
  readonly sessions: Map<string, { panes: Map<string, { pty: { pid: number } | null }> }>;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/** Poll until the predicate holds, or fail naming the condition that never came. */
async function waitFor(what: string, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error(`baseline gave up waiting for ${what}`);
}

/** Signal 0 asks the kernel "is this pid alive" without touching the process. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function report(rows: BaselineReport): void {
  const lines = Object.entries(rows).map(
    ([metric, value]) =>
      `  ${metric.padEnd(24)} ${Number.isInteger(value) ? String(value) : value.toFixed(2)}`,
  );
  process.stdout.write(`\n12-pane Electron PTY baseline\n${lines.join('\n')}\n\n`);
}

describe.skipIf(process.env['HELM_PTY_BASELINE'] !== '1')(
  'twelve-pane Electron PTY baseline',
  () => {
    it('records spawn, echo, throughput, cost, and orphan behaviour', async () => {
      const folder = mkdtempSync(join(tmpdir(), 'helm-pty-baseline-'));
      const manager = new BoardPtyManager();
      const sender = new RecordingSender();
      const timings = new Map<string, PaneTiming>();
      const buffers = new Map<string, string>();
      const pids: number[] = [];
      let started = 0;

      sender.listeners.push((envelope) => {
        const timing = timings.get(envelope.paneId);
        if (timing !== undefined && timing.firstByteMs === null) {
          timing.firstByteMs = performance.now() - started;
        }
        if (envelope.event.type !== 'data') return;
        const text = Buffer.from(envelope.event.data, 'base64').toString('utf8');
        buffers.set(envelope.paneId, (buffers.get(envelope.paneId) ?? '') + text);
      });

      try {
        // ---- spawn ------------------------------------------------------
        started = performance.now();
        const session = await manager.createSession(
          {
            correlationId: CORRELATION_ID,
            folderPath: folder,
            isolation: 'shared',
            paneCount: PANES,
            panes: Array.from({ length: PANES }, (_unused, slot) => ({
              slot,
              agentId: 'shell' as const,
            })),
          },
          () => Promise.resolve({ cwd: folder, branch: null }),
          sender as unknown as WebContents,
        );
        const spawnMs = performance.now() - started;
        expect(session.panes).toHaveLength(PANES);
        for (const pane of session.panes) {
          timings.set(pane.paneId, {
            firstByteMs: null,
            readyMs: null,
            echoMs: null,
          });
        }
        // Pane ordering must survive the spawn, whatever its concurrency.
        expect(session.panes.map((pane) => pane.slot)).toEqual(
          Array.from({ length: PANES }, (_unused, slot) => slot),
        );

        // ---- readiness: spawn until the shell runs a command ------------
        // The write lands in the pty buffer immediately, but an interactive
        // login shell only executes it after sourcing its rc files, so this
        // measures shell startup and not the transport. Keeping the two
        // apart matters: comparing rc time before and after the cutover
        // would say nothing about the engine.
        await Promise.all(
          session.panes.map(async (pane, index) => {
            await manager.write({
              correlationId: CORRELATION_ID,
              sessionId: session.sessionId,
              paneId: pane.paneId,
              data: `printf '%s\\n' ${echoSplit(index)}\n`,
            });
            await waitFor(`first command in pane ${String(index)}`, () =>
              (buffers.get(pane.paneId) ?? '').includes(echoJoined(index)),
            );
            const timing = timings.get(pane.paneId);
            if (timing !== undefined) timing.readyMs = performance.now() - started;
          }),
        );

        // ---- responsiveness: warm round-trip with twelve panes live -----
        await Promise.all(
          session.panes.map(async (pane, index) => {
            const marker = `warm_${String(index)}`;
            const sent = performance.now();
            await manager.write({
              correlationId: CORRELATION_ID,
              sessionId: session.sessionId,
              paneId: pane.paneId,
              data: `printf '%s\\n' war''m_${String(index)}\n`,
            });
            await waitFor(`warm round-trip in pane ${String(index)}`, () =>
              (buffers.get(pane.paneId) ?? '').includes(`${marker}\r\n`),
            );
            const timing = timings.get(pane.paneId);
            if (timing !== undefined) timing.echoMs = performance.now() - sent;
          }),
        );

        // ---- throughput and main-process cost --------------------------
        for (const paneId of buffers.keys()) buffers.set(paneId, '');
        sender.bytes = 0;
        sender.sends = 0;
        const cpuBefore = process.cpuUsage();
        const rssBefore = process.memoryUsage().rss;
        const burstStart = performance.now();
        await Promise.all(
          session.panes.map((pane) =>
            manager.write({
              correlationId: CORRELATION_ID,
              sessionId: session.sessionId,
              paneId: pane.paneId,
              data: `for i in $(seq 1 ${String(LINES)}); do printf '%s\\n' ${LINE}; done; printf '%s\\n' ${DONE_SPLIT}\n`,
            }),
          ),
        );
        await waitFor('every pane to finish its burst', () =>
          session.panes.every((pane) => (buffers.get(pane.paneId) ?? '').includes(DONE)),
        );
        const burstMs = performance.now() - burstStart;
        const cpu = process.cpuUsage(cpuBefore);
        const rssDelta = process.memoryUsage().rss - rssBefore;

        // ---- resize and drain ------------------------------------------
        const resizeStart = performance.now();
        await Promise.all(
          session.panes.map((pane) =>
            manager.resize({
              correlationId: CORRELATION_ID,
              sessionId: session.sessionId,
              paneId: pane.paneId,
              cols: 100,
              rows: 40,
            }),
          ),
        );
        const resizeMs = performance.now() - resizeStart;

        // `drainPane` is the pull path `helm-pty` already exposes, so record
        // its cost too or the engine-backed number has nothing to beat.
        const drainStart = performance.now();
        for (const pane of session.panes) {
          manager.drainPane({
            correlationId: CORRELATION_ID,
            sessionId: session.sessionId,
            paneId: pane.paneId,
          });
        }
        const drainMs = performance.now() - drainStart;

        // ---- orphan check ----------------------------------------------
        // Unchecked: pane state is private, which is right for production.
        // A benchmark should not widen the API to read twelve pids.
        const internals = manager as unknown as ManagerInternals;
        for (const pane of session.panes) {
          const pid = internals.sessions.get(session.sessionId)?.panes.get(pane.paneId)
            ?.pty?.pid;
          if (pid !== undefined) pids.push(pid);
        }
        expect(pids).toHaveLength(PANES);

        manager.dispose();
        await waitFor('every pane process to be reaped', () =>
          pids.every((pid) => !alive(pid)),
        );
        expect(pids.filter((pid) => alive(pid))).toEqual([]);

        const firstBytes = [...timings.values()]
          .map((timing) => timing.firstByteMs)
          .filter((value): value is number => value !== null);
        const echoes = [...timings.values()]
          .map((timing) => timing.echoMs)
          .filter((value): value is number => value !== null);
        const readies = [...timings.values()]
          .map((timing) => timing.readyMs)
          .filter((value): value is number => value !== null);
        // Expected is what the shells were told to print. Observed is what
        // actually arrived, and the two must agree or the run measured the
        // wrong thing - an input echo, a dead shell, a truncated burst.
        const expectedBytes = PANES * LINES * (LINE.length + 1);
        const observedBytes = [...buffers.values()].reduce(
          (total, text) => total + Buffer.byteLength(text, 'utf8'),
          0,
        );
        const burstMiB = observedBytes / 1024 / 1024;

        report({
          panes: PANES,
          spawnMs,
          spawnPerPaneMs: spawnMs / PANES,
          firstByteMedianMs: median(firstBytes),
          firstByteMaxMs: Math.max(...firstBytes),
          readyMedianMs: median(readies),
          readyMaxMs: Math.max(...readies),
          echoMedianMs: median(echoes),
          echoMaxMs: Math.max(...echoes),
          burstMs,
          expectedBytes,
          observedBytes,
          base64BytesToRenderer: sender.bytes,
          sendsToRenderer: sender.sends,
          throughputMiBPerSec: burstMiB / (burstMs / 1000),
          cpuMsPerMiB: (cpu.user + cpu.system) / 1000 / burstMiB,
          cpuUserMs: cpu.user / 1000,
          cpuSystemMs: cpu.system / 1000,
          rssDeltaMiB: rssDelta / 1024 / 1024,
          resizeMs,
          drainMs,
        });

        // No machine-specific performance threshold: this records a
        // baseline, and a timing gate here would just be a flaky test.
        // These assertions guard the measurement itself instead.
        expect(echoes).toHaveLength(PANES);
        // The first version of this harness matched the pty's echo of its
        // own input and "passed" in 46ms having moved 2KB. Requiring the
        // observed bytes to land near what the shells were told to print is
        // what makes that failure loud.
        expect(observedBytes).toBeGreaterThan(expectedBytes * 0.9);
        expect(sender.sends).toBeGreaterThan(PANES * 10);
      } finally {
        manager.dispose();
        rmSync(folder, { recursive: true, force: true });
      }
    }, 180_000);
  },
);
