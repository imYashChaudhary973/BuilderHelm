import { existsSync, realpathSync, statSync } from 'node:fs';

import type { SettingsRepository } from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import {
  QUOTA_PROVIDER_IDS,
  accountQuotaSchema,
  accountSetRootInputSchema,
  accountSnapshotSchema,
  boardAgentCatalogEntry,
  boardAgentIdSchema,
  type AccountQuota,
  type AccountSnapshot,
  type BoardAgentId,
  type QuotaProviderId,
} from '@builderhelm/protocol';
import { BuilderHelmError, utcNow, type CorrelationId } from '@builderhelm/shared';

import type { BoardService } from '../board/board-service.js';
import { readCodexRateLimits } from './codex-rate-limits.js';
import { parseClaudeRateLimits, parseCodexRateLimits } from './quota.js';

const ROOTS_KEY = 'accounts.roots';
const QUOTA_KEY = 'accounts.quota';

export type CodexRateLimitReader = (executable: string) => Promise<unknown>;

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

function parseStoredQuota(
  raw: string | undefined,
): Partial<Record<QuotaProviderId, AccountQuota>> {
  if (raw === undefined) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
    const next: Partial<Record<QuotaProviderId, AccountQuota>> = {};
    for (const id of QUOTA_PROVIDER_IDS) {
      const parsed = accountQuotaSchema.safeParse((value as Record<string, unknown>)[id]);
      if (parsed.success) next[id] = parsed.data;
    }
    return next;
  } catch {
    return {};
  }
}

/**
 * Subscription remaining for Claude, Codex, and Grok. No harness rows, no
 * billing scrape, no OAuth tokens in the database.
 */
export class AccountsService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly board: BoardService,
    private readonly logger: Logger,
    private readonly readCodex: CodexRateLimitReader = readCodexRateLimits,
  ) {}

  ingestClaude(payload: unknown): AccountQuota | null {
    const quota = parseClaudeRateLimits(payload, utcNow());
    if (quota === null) return null;
    this.writeQuota('claude', quota);
    return quota;
  }

  ingestCodex(payload: unknown): AccountQuota | null {
    const quota = parseCodexRateLimits(payload, utcNow());
    if (quota === null) return null;
    this.writeQuota('codex', quota);
    return quota;
  }

  async snapshot(live = false): Promise<AccountSnapshot> {
    const roots = this.roots();
    const detections = await this.board.detectAgents();
    const byId = new Map(detections.map((agent) => [agent.id, agent]));

    if (live) {
      const codex = byId.get('codex');
      if (codex?.available === true && codex.path !== null) {
        try {
          const parsed = parseCodexRateLimits(await this.readCodex(codex.path), utcNow());
          if (parsed !== null) this.writeQuota('codex', parsed);
        } catch {
          // Keep last stored Codex windows.
        }
      }
    }

    const quota = this.storedQuota();
    const agents = QUOTA_PROVIDER_IDS.map((id) => {
      const detected = byId.get(id);
      const entry = boardAgentCatalogEntry(id);
      return {
        id,
        label: entry.label,
        auth:
          detected?.available === true ? ('installed' as const) : ('missing' as const),
        path: detected?.path ?? null,
        capabilities: entry.capabilities,
        configDirEnv: entry.configDirEnv ?? null,
        configRoot: entry.configDirEnv === undefined ? null : (roots[id] ?? null),
        quota: quota[id] ?? null,
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
    this.settings.write(ROOTS_KEY, JSON.stringify(next), utcNow());
    this.logger.info({
      event: 'accounts.root_set',
      correlationId,
      data: { agentId: input.agentId, envName, cleared: input.configRoot === null },
    });
    return this.snapshot();
  }

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
        // stale root
      }
    }
    return env;
  }

  private writeQuota(id: QuotaProviderId, quota: AccountQuota): void {
    const next = { ...this.storedQuota(), [id]: quota };
    this.settings.write(QUOTA_KEY, JSON.stringify(next), utcNow());
  }

  private storedQuota(): Partial<Record<QuotaProviderId, AccountQuota>> {
    return parseStoredQuota(this.settings.read(QUOTA_KEY));
  }

  private roots(): Partial<Record<BoardAgentId, string>> {
    const raw = this.settings.read(ROOTS_KEY);
    if (raw === undefined) return {};
    return parseRoots(raw);
  }
}
