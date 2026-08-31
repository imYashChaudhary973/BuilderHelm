import { existsSync, realpathSync, statSync } from 'node:fs';

import type { SettingsRepository, SwarmRepository } from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import {
  accountSetRootInputSchema,
  accountSnapshotSchema,
  boardAgentCatalogEntry,
  boardAgentIdSchema,
  type AccountSnapshot,
  type BoardAgentId,
} from '@builderhelm/protocol';
import { BuilderHelmError, utcNow, type CorrelationId } from '@builderhelm/shared';

import type { BoardService } from '../board/board-service.js';

const SETTINGS_KEY = 'accounts.roots';

function parseRoots(raw: string): Partial<Record<BoardAgentId, string>> {
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
    const next: Partial<Record<BoardAgentId, string>> = {};
    for (const [key, path] of Object.entries(value as Record<string, unknown>)) {
      const id = boardAgentIdSchema.safeParse(key);
      if (
        !id.success ||
        typeof path !== 'string' ||
        path.length === 0 ||
        path.length > 4_096
      ) {
        continue;
      }
      if (boardAgentCatalogEntry(id.data).configDirEnv === undefined) continue;
      next[id.data] = path;
    }
    return next;
  } catch {
    return {};
  }
}
function directory(path: string): string {
  try {
    const resolved = realpathSync(path);
    if (statSync(resolved).isDirectory()) return resolved;
  } catch {
    // fall through
  }
  throw new BuilderHelmError('VALIDATION_FAILED', 'That folder is gone');
}

/**
 * Installed-CLI snapshot plus isolated config roots for CLIs that document one.
 * Usage figures come from Swarm seat reports, never from billing pages.
 */
export class AccountsService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly swarm: SwarmRepository,
    private readonly board: BoardService,
    private readonly logger: Logger,
  ) {}

  async snapshot(): Promise<AccountSnapshot> {
    const roots = this.roots();
    const usage = new Map(
      this.swarm.listAgentUsage().map((row) => [row.agentId, row] as const),
    );
    const agents = (await this.board.detectAgents()).map((agent) => {
      const configDirEnv = boardAgentCatalogEntry(agent.id).configDirEnv ?? null;
      const reported = usage.get(agent.id);
      return {
        id: agent.id,
        label: agent.label,
        auth:
          agent.id === 'shell' || agent.id === 'custom'
            ? ('builtin' as const)
            : agent.available
              ? ('installed' as const)
              : ('missing' as const),
        path: agent.path,
        capabilities: agent.capabilities,
        configDirEnv,
        configRoot: configDirEnv === null ? null : (roots[agent.id] ?? null),
        usage:
          agent.capabilities.usageReporting && reported !== undefined
            ? {
                tokensUsed: reported.tokensUsed,
                costUsd: reported.costUsd,
                source: 'swarm' as const,
                occurredAt: reported.occurredAt,
              }
            : null,
      };
    });
    return accountSnapshotSchema.parse({ agents, occurredAt: utcNow() });
  }

  async setRoot(
    agentId: BoardAgentId,
    configRoot: string | null,
    correlationId: CorrelationId,
  ): Promise<AccountSnapshot> {
    const input = accountSetRootInputSchema.parse({ agentId, configRoot });
    const envName = boardAgentCatalogEntry(input.agentId).configDirEnv;
    if (envName === undefined) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'This CLI has no supported config-root switch',
      );
    }
    const next = { ...this.roots() };
    if (input.configRoot === null) delete next[input.agentId];
    else next[input.agentId] = directory(input.configRoot);
    this.settings.write(SETTINGS_KEY, JSON.stringify(next), utcNow());
    this.logger.info({
      event: 'accounts.root_set',
      correlationId,
      data: { agentId: input.agentId, envName, cleared: input.configRoot === null },
    });
    return this.snapshot();
  }

  /** Env vars for Space/Swarm PTY launches. Missing folders are omitted. */
  cliEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [agentId, path] of Object.entries(this.roots())) {
      const id = boardAgentIdSchema.safeParse(agentId);
      if (!id.success) continue;
      const envName = boardAgentCatalogEntry(id.data).configDirEnv;
      if (envName === undefined || !existsSync(path)) continue;
      try {
        if (statSync(path).isDirectory()) env[envName] = path;
      } catch {
        // stale root: skip rather than block a launch
      }
    }
    return env;
  }

  private roots(): Partial<Record<BoardAgentId, string>> {
    const raw = this.settings.read(SETTINGS_KEY);
    if (raw === undefined) return {};
    return parseRoots(raw);
  }
}
