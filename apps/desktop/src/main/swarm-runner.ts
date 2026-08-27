import {
  parseAgentUsage,
  parseCliFailure,
  type SwarmExecuteInput,
  type SwarmRunnerOutcome,
  type SwarmSeatRunner,
} from '@zero/core';
import {
  SWARM_NUDGE,
  SWARM_STUCK_MS,
  swarmSeatArgv,
  swarmStuckAction,
  type BoardIsolation,
} from '@zero/protocol';
import { createCorrelationId, normalizeError } from '@zero/shared';
import type { WebContents } from 'electron';
import type { BoardPtyManager } from './board-pty-manager.js';

/**
 * Runs swarm tasks as real headless CLI invocations inside seat worktrees.
 * Each task gets a pane so the shipped terminal grid keeps working, and the
 * seat's previous pane is recycled so a long run never exhausts the grid.
 */
export class PtySwarmRunner implements SwarmSeatRunner {
  private readonly sessionByRun = new Map<string, string>();
  private readonly paneBySeat = new Map<string, string>();
  private readonly runBySeat = new Map<string, string>();

  constructor(
    private readonly manager: BoardPtyManager,
    private readonly resolveBinary: (agentId: string) => Promise<string> = async (id) =>
      id,
  ) {}
  /** Opens the board session that hosts a run's seat panes. */
  openSession(
    runId: string,
    folderPath: string,
    isolation: BoardIsolation,
    sender: WebContents,
  ): string {
    const sessionId = this.manager.createEmptySession(folderPath, isolation, sender);
    this.sessionByRun.set(runId, sessionId);
    return sessionId;
  }

  sessionFor(runId: string): string | undefined {
    return this.sessionByRun.get(runId);
  }

  async execute(input: SwarmExecuteInput): Promise<SwarmRunnerOutcome> {
    const sessionId = this.sessionByRun.get(input.run.id);
    if (sessionId === undefined) {
      return {
        status: 'failed',
        summary: 'swarm session is not open',
        tokensUsed: 0,
        costUsd: 0,
      };
    }

    let argv;
    try {
      const resolved = swarmSeatArgv(
        input.seat.agentId,
        input.prompt,
        input.seat.mode,
        input.model,
      );
      argv = { ...resolved, binary: await this.resolveBinary(input.seat.agentId) };
    } catch (error) {
      return {
        status: 'failed',
        summary: normalizeError(error).message,
        tokensUsed: 0,
        costUsd: 0,
      };
    }

    this.runBySeat.set(input.seat.id, input.run.id);
    await this.closeSeatPane(input.seat.id);

    try {
      const pane = await this.manager.addPane(
        sessionId,
        input.seat.agentId,
        undefined,
        argv,
        async () => ({ cwd: input.worktreePath, branch: input.branch }),
      );
      this.paneBySeat.set(input.seat.id, pane.paneId);
      input.onPane?.(pane.paneId);
      if (
        this.sessionByRun.get(input.run.id) === undefined ||
        this.runBySeat.get(input.seat.id) !== input.run.id
      ) {
        await this.closeSeatPane(input.seat.id);
        return {
          status: 'failed',
          summary: 'swarm stopped',
          tokensUsed: 0,
          costUsd: 0,
        };
      }
      const stopWatch = this.watchSilence(sessionId, pane.paneId, input.seat.id);
      try {
        const interactive = input.seat.agentId === 'grok';
        const exit = interactive
          ? await this.manager.waitForPaneDone(sessionId, pane.paneId, /SWARM_TASK_DONE/)
          : await this.manager.waitForPaneExit(sessionId, pane.paneId);
        const output = exit.output;
        const usage = parseAgentUsage(output);
        const detail = parseCliFailure(output);
        const landed = interactive
          ? 'done' in exit && exit.done
          : 'exitCode' in exit && exit.exitCode === 0;
        return {
          status: landed ? 'landed' : 'failed',
          summary: landed
            ? `${input.seat.agentId} finished the task`
            : detail.length > 0
              ? `${input.seat.agentId}: ${detail}`
              : `${input.seat.agentId} did not finish`,
          tokensUsed: usage.tokensUsed,
          costUsd: usage.costUsd,
          output: output.slice(-8_000),
        };
      } finally {
        stopWatch();
      }
    } catch (error) {
      return {
        status: 'failed',
        summary: normalizeError(error).message,
        tokensUsed: 0,
        costUsd: 0,
      };
    }
  }

  /** Kills every seat CLI for this run. closePane → pty.kill. */
  async release(runId: string): Promise<void> {
    const seats = [...this.runBySeat.entries()]
      .filter(([, seatRun]) => seatRun === runId)
      .map(([seatId]) => seatId);
    await Promise.all(seats.map((seatId) => this.stopSeat(seatId)));
    this.sessionByRun.delete(runId);
  }

  /** Kills the CLI for one seat. closePane → pty.kill. */
  async stopSeat(seatId: string): Promise<void> {
    await this.closeSeatPane(seatId);
    this.runBySeat.delete(seatId);
  }

  private watchSilence(sessionId: string, paneId: string, seatId: string): () => void {
    let nudgedAt: number | null = null;
    const timer = setInterval(() => {
      let last: number;
      try {
        last = this.manager.lastDataAt(sessionId, paneId);
      } catch {
        return;
      }
      const silent = Date.now() - last >= SWARM_STUCK_MS;
      const action = swarmStuckAction({
        status: silent ? 'stuck' : 'running',
        nudgedAt,
        now: Date.now(),
        stuckAfterMs: SWARM_STUCK_MS,
      });
      if (action === 'nudge') {
        nudgedAt = Date.now();
        void this.manager.write({
          correlationId: createCorrelationId(),
          sessionId,
          paneId,
          data: `${SWARM_NUDGE}\n`,
        });
        return;
      }
      if (action === 'stop') {
        void this.closeSeatPane(seatId);
        return;
      }
      if (!silent) nudgedAt = null;
    }, 1_000);
    return () => clearInterval(timer);
  }

  private async closeSeatPane(seatId: string): Promise<void> {
    const paneId = this.paneBySeat.get(seatId);
    const runId = this.runBySeat.get(seatId);
    const sessionId = runId === undefined ? undefined : this.sessionByRun.get(runId);
    this.paneBySeat.delete(seatId);
    if (paneId === undefined || sessionId === undefined) return;
    await this.manager
      .closePane({
        correlationId: createCorrelationId(),
        sessionId,
        paneId,
      })
      .catch(() => undefined);
  }
}
