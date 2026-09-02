import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { SettingsRepository } from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import {
  QUOTA_PROVIDER_IDS,
  SYSTEM_ACCOUNT_ID,
  accountQuotaSchema,
  accountSnapshotSchema,
  quotaProviderIdSchema,
  type AccountHome,
  type AccountQuota,
  type AccountSnapshot,
  type QuotaProviderId,
  type QuotaWindow,
} from '@builderhelm/protocol';
import {
  BuilderHelmError,
  createCorrelationId,
  createId,
  utcNow,
} from '@builderhelm/shared';
import { readClaudeOAuthUsage } from './claude-oauth-usage.js';
import { readGrokBilling, type GrokBilling } from './grok-usage.js';
import type { BoardService } from '../board/board-service.js';
import { readCodexRateLimits } from './codex-rate-limits.js';
import {
  parseClaudeOAuthUsage,
  parseClaudeRateLimits,
  parseCodexRateLimits,
} from './quota.js';

const HOMES_KEY = 'accounts.homes';
const ACTIVE_KEY = 'accounts.active';
const QUOTA_KEY = 'accounts.quota';
const HOOK_SYSTEM_KEY = 'accounts.claudeHookSystem';
const LABELS: Record<QuotaProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  grok: 'Grok',
};

const CONFIG_ENV: Record<QuotaProviderId, string> = {
  claude: 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
  grok: 'GROK_HOME',
};

export type CodexRateLimitReader = (
  executable: string,
  env: Record<string, string>,
) => Promise<unknown>;

interface StoredHome {
  readonly id: string;
  readonly label: string;
  readonly configRoot: string | null;
}

function parseHomes(raw: string | undefined): Record<QuotaProviderId, StoredHome[]> {
  const empty: Record<QuotaProviderId, StoredHome[]> = {
    claude: [],
    codex: [],
    grok: [],
  };
  if (raw === undefined) return empty;
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return empty;
    const next = { ...empty };
    for (const id of QUOTA_PROVIDER_IDS) {
      const list = (value as Record<string, unknown>)[id];
      if (!Array.isArray(list)) continue;
      next[id] = list.flatMap((entry): StoredHome[] => {
        if (entry === null || typeof entry !== 'object') return [];
        const row = entry as Record<string, unknown>;
        if (typeof row.id !== 'string' || row.id.length === 0 || row.id.length > 64) {
          return [];
        }
        if (typeof row.label !== 'string' || row.label.length === 0) return [];
        const configRoot =
          typeof row.configRoot === 'string' && row.configRoot.length > 0
            ? row.configRoot
            : null;
        if (row.id === SYSTEM_ACCOUNT_ID) {
          return [{ id: row.id, label: row.label, configRoot: null }];
        }
        if (configRoot === null) return [];
        return [{ id: row.id, label: row.label.slice(0, 80), configRoot }];
      });
    }
    return next;
  } catch {
    return empty;
  }
}

function parseActive(raw: string | undefined): Record<QuotaProviderId, string> {
  const next: Record<QuotaProviderId, string> = {
    claude: SYSTEM_ACCOUNT_ID,
    codex: SYSTEM_ACCOUNT_ID,
    grok: SYSTEM_ACCOUNT_ID,
  };
  if (raw === undefined) return next;
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return next;
    for (const id of QUOTA_PROVIDER_IDS) {
      const current = (value as Record<string, unknown>)[id];
      if (typeof current === 'string' && current.length > 0 && current.length <= 64) {
        next[id] = current;
      }
    }
    return next;
  } catch {
    return next;
  }
}

function parseQuota(
  raw: string | undefined,
): Partial<Record<QuotaProviderId, AccountQuota>> {
  if (raw === undefined) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
    const next: Partial<Record<QuotaProviderId, AccountQuota>> = {};
    const now = Date.now();
    for (const id of QUOTA_PROVIDER_IDS) {
      const parsed = accountQuotaSchema.safeParse((value as Record<string, unknown>)[id]);
      if (!parsed.success) continue;
      const quota = parsed.data;
      // A window whose reset time has passed is a snapshot of a finished
      // window, not a current limit. Showing it invents a fake limit.
      const live = (window: QuotaWindow | null): QuotaWindow | null =>
        window !== null &&
        (window.resetsAt === null || new Date(window.resetsAt).getTime() > now)
          ? window
          : null;
      const pruned: AccountQuota = {
        ...quota,
        fiveHour: live(quota.fiveHour),
        sevenDay: live(quota.sevenDay),
      };
      if (pruned.fiveHour !== null || pruned.sevenDay !== null) next[id] = pruned;
    }
    return next;
  } catch {
    return {};
  }
}

/** Allowlisted key only. Never returns tokens. */
export function readGrokEmail(configRoot: string | null): string | null {
  const file = join(configRoot ?? join(homedir(), '.grok'), 'auth.json');
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const email = findEmail(parsed);
    if (
      email === null ||
      email.length < 3 ||
      email.length > 200 ||
      !email.includes('@')
    ) {
      return null;
    }
    return email;
  } catch {
    return null;
  }
}

function homeEmail(provider: QuotaProviderId, configRoot: string | null): string | null {
  if (provider === 'grok') return readGrokEmail(configRoot);
  return readProviderEmail(provider, configRoot);
}

function grokBillingPayload(billing: GrokBilling | null): {
  usedPercent: number;
  periodEnd: string | null;
  tier: string | null;
} | null {
  if (billing === null) return null;
  return {
    usedPercent: billing.usedPercent,
    periodEnd: billing.periodEnd,
    tier: billing.tier,
  };
}

/** Allowlisted identity fields only; never returns tokens. */
export function readProviderEmail(
  provider: 'claude' | 'codex',
  configRoot: string | null,
): string | null {
  if (provider === 'claude') {
    // .claude.json lives in the HOME dir for the system login, and inside the
    // config dir for isolated homes. Both shapes carry oauthAccount.emailAddress.
    const claudeJsonPaths: string[] = [];
    if (configRoot === null) claudeJsonPaths.push(join(homedir(), '.claude.json'));
    else {
      claudeJsonPaths.push(join(configRoot, '.claude.json'));
      claudeJsonPaths.push(join(configRoot, '.config.json'));
    }
    for (const path of claudeJsonPaths) {
      if (existsSync(path)) {
        try {
          const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
          const oauth = (parsed as Record<string, unknown>).oauthAccount;
          if (typeof oauth === 'object' && oauth !== null) {
            const email = (oauth as Record<string, unknown>).emailAddress;
            if (typeof email === 'string' && email.includes('@')) return email;
          }
        } catch {
          // fall through
        }
      }
    }
    const credPath =
      configRoot === null
        ? join(homedir(), '.claude', '.credentials.json')
        : join(configRoot, '.credentials.json');
    if (existsSync(credPath)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(credPath, 'utf8'));
        const oauth = (parsed as Record<string, unknown>).claudeAiOauth;
        if (typeof oauth === 'object' && oauth !== null) {
          const email = (oauth as Record<string, unknown>).email;
          if (typeof email === 'string' && email.includes('@')) return email;
        }
      } catch {
        // fall through
      }
    }
    return null;
  }
  // Codex: decode the id_token JWT payload (email claim). Token itself never returned.
  const authPath =
    configRoot === null
      ? join(homedir(), '.codex', 'auth.json')
      : join(configRoot, 'auth.json');
  if (!existsSync(authPath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(authPath, 'utf8'));
    const tokens = (parsed as Record<string, unknown>).tokens;
    const idToken =
      typeof tokens === 'object' && tokens !== null
        ? (tokens as Record<string, unknown>).id_token
        : undefined;
    if (typeof idToken !== 'string') return null;
    const parts = idToken.split('.');
    const payloadPart = parts[1];
    if (payloadPart === undefined) return null;
    const payload = JSON.parse(
      Buffer.from(payloadPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
        'utf8',
      ),
    ) as Record<string, unknown>;
    const email = payload.email;
    return typeof email === 'string' && email.includes('@') ? email : null;
  } catch {
    return null;
  }
}

function findEmail(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findEmail(entry);
      if (found !== null) return found;
    }
    return null;
  }
  if (value === null || typeof value !== 'object') return null;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'email' && typeof entry === 'string') return entry;
    const nested = findEmail(entry);
    if (nested !== null) return nested;
  }
  return null;
}
export class AccountsService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly board: BoardService,
    private readonly logger: Logger,
    private readonly accountsRoot: string,
    private readonly readCodex: CodexRateLimitReader = readCodexRateLimits,
    private readonly readClaudeUsage: (
      configRoot: string | null,
    ) => Promise<unknown | null> = readClaudeOAuthUsage,
  ) {}

  /** Epoch ms of the last successful OAuth usage fetch; null before the first. */
  private lastClaudeFetch: number | null = null;
  /** Epoch ms timestamp while a fetch is in flight; null when idle. */
  private lastClaudeFetchStarted: number | null = null;

  hookSystemDefault(): boolean {
    return this.settings.read(HOOK_SYSTEM_KEY) === 'true';
  }

  setHookSystemDefault(enabled: boolean): void {
    this.settings.write(HOOK_SYSTEM_KEY, enabled ? 'true' : 'false', utcNow());
  }

  ingestClaude(payload: unknown): AccountQuota | null {
    const quota = parseClaudeRateLimits(payload, utcNow());
    if (quota === null) return null;
    this.writeQuota('claude', quota);
    return quota;
  }

  cliEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const homes = this.homes();
    const active = this.active();
    for (const id of QUOTA_PROVIDER_IDS) {
      const home = homes[id].find((entry) => entry.id === active[id]);
      if (home?.configRoot === undefined || home.configRoot === null) continue;
      if (!existsSync(home.configRoot)) continue;
      try {
        if (statSync(home.configRoot).isDirectory())
          env[CONFIG_ENV[id]] = home.configRoot;
      } catch {
        // stale root
      }
    }
    return env;
  }

  /** Roots to hook: BuilderHelm homes, plus ~/.claude when opted in. */
  claudeHookRoots(): string[] {
    const homes = this.homes()
      .claude.map((home) => home.configRoot)
      .filter((root): root is string => root !== null);
    return this.hookSystemDefault() ? [...homes, join(homedir(), '.claude')] : homes;
  }
  async snapshot(live = false): Promise<AccountSnapshot> {
    if (live) {
      await Promise.all([this.refreshCodex(), this.refreshClaude(), this.refreshGrok()]);
    }
    const detections = await this.board.detectAgents();
    const byId = new Map(detections.map((agent) => [agent.id, agent]));
    const homes = this.homes();
    const active = this.active();
    const quota = this.storedQuota();
    let relabeled = false;
    const providers = QUOTA_PROVIDER_IDS.map((id) => {
      const extra = homes[id];
      const activeId =
        extra.some((home) => home.id === active[id]) || active[id] === SYSTEM_ACCOUNT_ID
          ? active[id]
          : SYSTEM_ACCOUNT_ID;
      // Every row is labeled by its account email so it is obvious which login
      // each usage figure belongs to. The system row reads ~/.grok's log.
      const systemEmail = homeEmail(id, null);
      const system: AccountHome = {
        id: SYSTEM_ACCOUNT_ID,
        label: systemEmail ?? 'System default',
        configRoot: null,
        email: systemEmail,
        active: activeId === SYSTEM_ACCOUNT_ID,
        billing: id === 'grok' ? grokBillingPayload(readGrokBilling(null)) : null,
      };
      const listed: AccountHome[] = [
        system,
        ...extra.map((home) => {
          const billing =
            id === 'grok' && home.configRoot !== null
              ? readGrokBilling(home.configRoot)
              : null;
          const email = homeEmail(id, home.configRoot);
          // Persist the resolved email as the label so the stored list stops
          // carrying stale generic names after a login completes.
          const label = email ?? home.label;
          if (email !== null && home.label !== label) {
            homes[id] = homes[id].map((entry) =>
              entry.id === home.id ? { ...entry, label } : entry,
            );
            relabeled = true;
          }
          return {
            id: home.id,
            label,
            configRoot: home.configRoot,
            email,
            active: home.id === activeId,
            billing: grokBillingPayload(billing),
          };
        }),
      ];
      if (relabeled) this.writeHomes(homes);
      return {
        id,
        label: LABELS[id],
        installed: byId.get(id)?.available === true,
        quota: quota[id] ?? null,
        homes: listed,
      };
    });
    return accountSnapshotSchema.parse({
      providers,
      occurredAt: utcNow(),
      hookSystemDefault: this.hookSystemDefault(),
    });
  }

  /**
   * Creates an isolated home and returns it pending login. The renderer opens a
   * pane with the provider's login command and this home's env; the user signs
   * in there (never inside BuilderHelm). Call confirmLogin afterwards to label
   * the account with the provider identity, or it is rolled back.
   */
  async add(provider: QuotaProviderId): Promise<AccountSnapshot> {
    const id = quotaProviderIdSchema.parse(provider);
    // A double-click on Add Account must not mint two homes: reuse a pending
    // (generic-label) home created in the last minute instead.
    const pendingPattern = new RegExp(`^${LABELS[id]} \\d+$`);
    const pending = this.homes()[id].find((entry) => pendingPattern.test(entry.label));
    if (pending !== undefined) {
      this.writeActive({ ...this.active(), [id]: pending.id });
      return this.snapshot();
    }
    const homeId = createId();
    const configRoot = join(this.accountsRoot, id, homeId);
    mkdirSync(configRoot, { recursive: true });
    const homes = this.homes();
    homes[id] = [
      ...homes[id],
      { id: homeId, label: `${LABELS[id]} ${homes[id].length + 1}`, configRoot },
    ];
    this.writeHomes(homes);
    this.writeActive({ ...this.active(), [id]: homeId });
    this.logger.info({
      event: 'accounts.added',
      correlationId: createCorrelationId(),
      data: { provider: id },
    });
    return this.snapshot();
  }

  /** Rolls an un-logged-in home back; keeps a signed-in one. */
  async confirmLogin(provider: QuotaProviderId, id: string): Promise<AccountSnapshot> {
    const homes = this.homes();
    const home = homes[provider].find((entry) => entry.id === id);
    if (home === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'That account is gone');
    }
    const email = homeEmail(provider, home.configRoot);
    if (email === null) {
      // Not signed in yet: drop the empty home so the list stays honest.
      homes[provider] = homes[provider].filter((entry) => entry.id !== id);
      this.writeHomes(homes);
      const active = this.active();
      if (active[provider] === id) {
        this.writeActive({ ...active, [provider]: SYSTEM_ACCOUNT_ID });
      }
      if (home.configRoot !== null && existsSync(home.configRoot)) {
        rmSync(home.configRoot, { recursive: true, force: true });
      }
      return this.snapshot();
    }
    const labelled: Record<QuotaProviderId, StoredHome[]> = {
      ...homes,
      [provider]: homes[provider].map((entry) =>
        entry.id === id ? { ...entry, label: email } : entry,
      ),
    };
    this.writeHomes(labelled);
    return this.snapshot();
  }

  async remove(provider: QuotaProviderId, id: string): Promise<AccountSnapshot> {
    if (id === SYSTEM_ACCOUNT_ID) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'The system default login stays');
    }
    const homes = this.homes();
    const current = homes[provider].find((home) => home.id === id);
    if (current === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'That account is gone');
    }
    homes[provider] = homes[provider].filter((home) => home.id !== id);
    this.writeHomes(homes);
    const active = this.active();
    if (active[provider] === id) {
      this.writeActive({ ...active, [provider]: SYSTEM_ACCOUNT_ID });
    }
    if (
      current.configRoot !== null &&
      current.configRoot.startsWith(this.accountsRoot) &&
      existsSync(current.configRoot)
    ) {
      rmSync(current.configRoot, { recursive: true, force: true });
    }
    return this.snapshot();
  }

  async setActive(provider: QuotaProviderId, id: string): Promise<AccountSnapshot> {
    if (
      id !== SYSTEM_ACCOUNT_ID &&
      !this.homes()[provider].some((home) => home.id === id)
    ) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'That account is gone');
    }
    this.writeActive({ ...this.active(), [provider]: id });
    return this.snapshot();
  }

  private async refreshCodex(): Promise<void> {
    const detections = await this.board.detectAgents();
    const codex = detections.find((agent) => agent.id === 'codex');
    if (codex?.available !== true || codex.path === null) return;
    const env = this.cliEnv();
    try {
      const live = parseCodexRateLimits(
        await this.readCodex(
          codex.path,
          env.CODEX_HOME ? { CODEX_HOME: env.CODEX_HOME } : {},
        ),
        utcNow(),
      );
      if (live !== null) this.writeQuota('codex', live);
    } catch {
      // Keep last stored windows.
    }
  }

  private async refreshClaude(): Promise<void> {
    // The OAuth endpoint rate-limits polling (Orca saw 429s); one call per
    // 30s window is enough for a live meter and keeps the endpoint happy.
    if (this.lastClaudeFetchStarted !== null) return;
    if (this.lastClaudeFetch !== null && Date.now() - this.lastClaudeFetch < 30_000) {
      return;
    }
    this.lastClaudeFetchStarted = Date.now();
    try {
      const root = this.cliEnv().CLAUDE_CONFIG_DIR ?? null;
      const live = parseClaudeOAuthUsage(await this.readClaudeUsage(root), utcNow());
      if (live !== null) this.writeQuota('claude', live);
    } catch {
      // Keep last stored windows.
    } finally {
      this.lastClaudeFetchStarted = null;
      this.lastClaudeFetch = Date.now();
    }
  }

  /**
   * The Grok CLI logs its billing config on interactive session starts. A one-shot
   * prompt in the home keeps the CLI's auth fresh; the billing entry itself lands
   * in the home log after the account's first interactive session, which the
   * billing parser picks up.
   */
  private async refreshGrok(): Promise<void> {
    const grokHomes = this.homes().grok;
    await Promise.all(
      grokHomes
        .filter((home) => home.configRoot !== null)
        .map(async (home) => {
          const configRoot = home.configRoot;
          if (configRoot === null) return;
          if (readGrokBilling(configRoot) !== null) return; // fresh already
          await new Promise<void>((resolve) => {
            const child = spawn('grok', ['-p', 'ok'], {
              env: { ...process.env, GROK_HOME: configRoot },
              stdio: 'ignore',
            });
            const timer = setTimeout(() => {
              child.kill();
              resolve();
            }, 45_000);
            child.on('exit', () => {
              clearTimeout(timer);
              resolve();
            });
            child.on('error', () => {
              clearTimeout(timer);
              resolve();
            });
          });
        }),
    );
  }

  private writeQuota(id: QuotaProviderId, quota: AccountQuota): void {
    const next = { ...this.storedQuota(), [id]: quota };
    this.settings.write(QUOTA_KEY, JSON.stringify(next), utcNow());
  }

  private writeHomes(homes: Record<QuotaProviderId, StoredHome[]>): void {
    this.settings.write(HOMES_KEY, JSON.stringify(homes), utcNow());
  }

  private writeActive(active: Record<QuotaProviderId, string>): void {
    this.settings.write(ACTIVE_KEY, JSON.stringify(active), utcNow());
  }

  private storedQuota(): Partial<Record<QuotaProviderId, AccountQuota>> {
    return parseQuota(this.settings.read(QUOTA_KEY));
  }

  private homes(): Record<QuotaProviderId, StoredHome[]> {
    return parseHomes(this.settings.read(HOMES_KEY));
  }

  private active(): Record<QuotaProviderId, string> {
    return parseActive(this.settings.read(ACTIVE_KEY));
  }
}
