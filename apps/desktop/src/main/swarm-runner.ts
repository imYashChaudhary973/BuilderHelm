import {
  parseAgentUsage,
  swarmSeatArgv,
  type SwarmExecuteInput,
  type SwarmRunnerOutcome,
  type SwarmSeatRunner,
} from '@builderhelm/core';
import type { BoardIsolation } from '@builderhelm/protocol';
import { createCorrelationId, normalizeError } from '@builderhelm/shared';
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

  constructor(private readonly manager: BoardPtyManager) {}

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
      argv = swarmSeatArgv(input.seat.agentId, input.prompt, input.seat.mode);
    } catch (error) {
      return {
        status: 'failed',
        summary: normalizeError(error).message,
        tokensUsed: 0,
        costUsd: 0,
      };
    }

    const previous = this.paneBySeat.get(input.seat.id);
    if (previous !== undefined) {
      // Recycle the pane but keep the seat worktree: the next task for this
      // seat runs in the same directory, which may hold uncommitted work.
      await this.manager
        .disposePane({
          correlationId: createCorrelationId(),
          sessionId,
          paneId: previous,
        })
        .catch(() => undefined);
      this.paneBySeat.delete(input.seat.id);
    }

    try {
      const pane = await this.manager.addPane(
        sessionId,
        input.seat.agentId,
        undefined,
        argv,
        async () => ({ cwd: input.worktreePath, branch: input.branch }),
      );
      this.paneBySeat.set(input.seat.id, pane.paneId);
      const exit = await this.manager.waitForPaneExit(sessionId, pane.paneId);
      const usage = parseAgentUsage(input.seat.agentId, exit.output);
      return {
        status: exit.exitCode === 0 ? 'landed' : 'failed',
        summary:
          exit.exitCode === 0
            ? `${input.seat.agentId} finished the task`
            : `${input.seat.agentId} exited with code ${exit.exitCode}`,
        tokensUsed: usage.tokensUsed,
        costUsd: usage.costUsd,
      };
    } catch (error) {
      return {
        status: 'failed',
        summary: normalizeError(error).message,
        tokensUsed: 0,
        costUsd: 0,
      };
    }
  }

  release(runId: string): void {
    this.sessionByRun.delete(runId);
  }
}
