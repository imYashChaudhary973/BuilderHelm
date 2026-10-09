import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';

import type { SettingsRepository } from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import {
  ISOLATED_LOGIN_PROVIDER_IDS,
  QUOTA_PROVIDER_IDS,
  SYSTEM_ACCOUNT_ID,
  accountQuotaSchema,
  accountSnapshotSchema,
  quotaProviderIdSchema,
  type AccountHome,
  type AccountQuota,
  type AccountSnapshot,
  type AuthConflict,
  type IsolatedLoginProviderId,
  type QuotaProviderId,
} from '@builderhelm/protocol';
import {
  BuilderHelmError,
  createCorrelationId,
  createId,
  utcNow,
} from '@builderhelm/shared';
import { readGrokBilling, type GrokBilling } from './grok-usage.js';
import type { BoardService } from '../board/board-service.js';
import { readCodexRateLimits } from './codex-rate-limits.js';
import { parseClaudeRateLimits, parseCodexRateLimits } from './quota.js';

const HOMES_KEY = 'accounts.homes';
const ACTIVE_KEY = 'accounts.active';
// Keyed by account ref (`claude:<homeId>`). The older provider-wide
// `accounts.quota` key cannot be attributed to a login and is ignored.
const QUOTA_KEY = 'accounts.quotaByHome';
const HOOK_SYSTEM_KEY = 'accounts.claudeHookSystem';
const MAX_EXTRA_HOMES = 15;
const LABELS: Record<QuotaProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  grok: 'Grok',
  opencode: 'OpenCode',
};

const CONFIG_ENV: Record<IsolatedLoginProviderId, string> = {
  claude: 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
  grok: 'GROK_HOME',
};

const AUTH_MARKERS: Record<QuotaProviderId, readonly string[]> = {
  claude: ['.credentials.json', '.claude.json', '.config.json'],
  codex: ['auth.json'],
  grok: [join('logs', 'unified.jsonl')],
  opencode: ['auth.json'],
};

const SYSTEM_AUTH_ROOT: Record<QuotaProviderId, string> = {
  claude: process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
  codex: process.env.CODEX_HOME ?? join(homedir(), '.codex'),
  grok: process.env.GROK_HOME ?? join(homedir(), '.grok'),
  opencode: join(
    process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
    'opencode',
  ),
};

function isIsolated(provider: QuotaProviderId): provider is IsolatedLoginProviderId {
  return (ISOLATED_LOGIN_PROVIDER_IDS as readonly string[]).includes(provider);
}

/** True when `child` is `parent` or lies under it. Both must be resolved. */
function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** `provider:homeId`, e.g. `codex:system`. Null or malformed means "use active". */
export function parseAccountRef(
  ref: string | null,
): { provider: QuotaProviderId; id: string } | null {
  if (ref === null || ref.length === 0) return null;
  const colon = ref.indexOf(':');
  if (colon <= 0) return null;
  const parsed = quotaProviderIdSchema.safeParse(ref.slice(0, colon));
  const id = ref.slice(colon + 1);
  if (!parsed.success || id.length === 0 || id.length > 64) return null;
  return { provider: parsed.data, id };
}

/** True when a known credential file exists. Does not read it. */
function authMarkerExists(provider: QuotaProviderId, root: string): boolean {
  if (
    provider === 'claude' &&
    process.env.CLAUDE_CONFIG_DIR === undefined &&
    existsSync(join(homedir(), '.claude.json')) &&
    root === SYSTEM_AUTH_ROOT.claude
  ) {
    return true;
  }
  return AUTH_MARKERS[provider].some((marker) => existsSync(join(root, marker)));
}

export type CodexRateLimitReader = (
  executable: string,
  env: Record<string, string>,
) => Promise<unknown>;

interface StoredHome {
  readonly id: string;
  readonly label: string;
  readonly kind: 'managed' | 'attached';
  readonly configRoot: string;
  /** Kept for its history, but never used to start anything. */
  readonly disabled?: boolean;
}

function parseHomes(raw: string | undefined): Record<QuotaProviderId, StoredHome[]> {
  const empty: Record<QuotaProviderId, StoredHome[]> = {
    claude: [],
    codex: [],
    grok: [],
    opencode: [],
  };
  if (raw === undefined) return empty;
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return empty;
    const next = { ...empty };
    for (const id of ISOLATED_LOGIN_PROVIDER_IDS) {
      const list = (value as Record<string, unknown>)[id];
      if (!Array.isArray(list)) continue;
      next[id] = list.slice(0, MAX_EXTRA_HOMES).flatMap((entry): StoredHome[] => {
        if (entry === null || typeof entry !== 'object') return [];
        const row = entry as Record<string, unknown>;
        if (typeof row.id !== 'string' || row.id.length === 0 || row.id.length > 64) {
          return [];
        }
        if (typeof row.label !== 'string' || row.label.length === 0) return [];
        const configRoot =
          typeof row.configRoot === 'string' &&
          row.configRoot.length > 0 &&
          row.configRoot.length <= 4096 &&
          isAbsolute(row.configRoot)
            ? row.configRoot
            : null;
        if (row.id === SYSTEM_ACCOUNT_ID || configRoot === null) return [];
        // Homes stored before attach existed were all created by BuilderHelm.
        const kind = row.kind === 'attached' ? 'attached' : 'managed';
        const home: StoredHome = {
          id: row.id,
          label: row.label.slice(0, 80),
          kind,
          configRoot,
        };
        return [row.disabled === true ? { ...home, disabled: true } : home];
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
    opencode: SYSTEM_ACCOUNT_ID,
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

type QuotaMap = Record<string, AccountQuota>;

function parseQuota(raw: string | undefined): QuotaMap {
  if (raw === undefined) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
    const next: QuotaMap = {};
    for (const [ref, entry] of Object.entries(value as Record<string, unknown>)) {
      if (parseAccountRef(ref) === null) continue;
      const parsed = accountQuotaSchema.safeParse(entry);
      if (parsed.success) next[ref] = parsed.data;
    }
    return next;
  } catch {
    return {};
  }
}

/** Readings older than this are shown as stale. */
const STALE_MS: Record<AccountQuota['source'], number> = {
  statusline: 30 * 60_000,
  'app-server': 30 * 60_000,
  'billing-log': 6 * 60 * 60_000,
};
/** Codex app-server is spawned per login; read each at most this often. */
const CODEX_MIN_INTERVAL_MS = 60_000;

/**
 * Non-secret key for one provider account, shared by limits and usage so
 * the same account is recognised in both. Never a credential.
 */
export function identityKey(provider: string, identity: string): string {
  return `${provider}:${createHash('sha256').update(`${provider}:${identity}`).digest('hex').slice(0, 24)}`;
}

function grokQuota(billing: GrokBilling | null): AccountQuota | null {
  if (billing === null) return null;
  return {
    windows: [
      {
        id: 'credits',
        label: 'Credits',
        kind: 'monthly',
        scope: null,
        usedPercent: billing.usedPercent,
        resetsAt: billing.periodEnd,
      },
    ],
    source: 'billing-log',
    occurredAt: billing.fetchedAt ?? utcNow(),
    plan: billing.tier?.slice(0, 80) ?? null,
  };
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
  if (provider === 'opencode') return null;
  if (provider === 'grok') return readGrokEmail(configRoot);
  return readProviderEmail(provider, configRoot);
}

/** True when a login wrote anything into the home, even if not credentials yet. */
function directoryHasEntries(path: string): boolean {
  try {
    return readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

function grokBillingPayload(billing: GrokBilling | null): {
  usedPercent: number;
  periodEnd: string | null;
  tier: string | null;
  fetchedAt: string | null;
} | null {
  if (billing === null) return null;
  return {
    usedPercent: billing.usedPercent,
    periodEnd: billing.periodEnd,
    tier: billing.tier,
    fetchedAt: billing.fetchedAt,
  };
}

/** Allowlisted identity fields only; never returns tokens. */
export function readProviderEmail(
  provider: 'claude' | 'codex',
  configRoot: string | null,
): string | null {
  configRoot ??=
    provider === 'claude'
      ? (process.env.CLAUDE_CONFIG_DIR ?? null)
      : SYSTEM_AUTH_ROOT.codex;
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

/**
 * A stable, non-secret account id for usage attribution: Claude's
 * `oauthAccount.accountUuid` plus organization, or the ChatGPT account id (else `sub`) claimed in
 * Codex's id_token. Allowlisted claims only; never a token.
 */
export function readAccountIdentity(
  provider: QuotaProviderId,
  configRoot: string | null,
): string | null {
  configRoot ??=
    provider === 'claude'
      ? (process.env.CLAUDE_CONFIG_DIR ?? null)
      : SYSTEM_AUTH_ROOT[provider];
  try {
    if (provider === 'claude') {
      const paths =
        configRoot === null
          ? [join(homedir(), '.claude.json')]
          : [join(configRoot, '.claude.json'), join(configRoot, '.config.json')];
      for (const path of paths) {
        if (!existsSync(path)) continue;
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        const oauth = parsed.oauthAccount as Record<string, unknown> | undefined;
        const uuid = oauth?.accountUuid;
        const org = oauth?.organizationUuid;
        const id = /^[0-9a-f-]{8,64}$/i;
        // One person can hold seats in several organizations, each with its
        // own limits, so the organization is part of the identity.
        if (typeof uuid === 'string' && id.test(uuid)) {
          return typeof org === 'string' && id.test(org) ? `${uuid}:${org}` : uuid;
        }
      }
      return null;
    }
    if (provider === 'codex') {
      const authPath = join(configRoot ?? join(homedir(), '.codex'), 'auth.json');
      if (!existsSync(authPath)) return null;
      const parsed = JSON.parse(readFileSync(authPath, 'utf8')) as Record<
        string,
        unknown
      >;
      const tokens = parsed.tokens as Record<string, unknown> | undefined;
      const idToken = tokens?.id_token;
      if (typeof idToken !== 'string') return null;
      const part = idToken.split('.')[1];
      if (part === undefined) return null;
      const claims = JSON.parse(
        Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
          'utf8',
        ),
      ) as Record<string, unknown>;
      const auth = claims['https://api.openai.com/auth'] as
        Record<string, unknown> | undefined;
      const account = auth?.chatgpt_account_id ?? claims.sub;
      return typeof account === 'string' && account.length > 0 && account.length <= 128
        ? account
        : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** One login, with the folder its history lives in. */
export interface LoginLocation {
  readonly provider: QuotaProviderId;
  readonly accountRef: string;
  readonly label: string;
  /** The config/data folder; the system login resolves to the CLI default. */
  readonly root: string;
  readonly identity: string | null;
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
/** The generic name a home carries until its login identity lands. */
function isPendingLabel(provider: QuotaProviderId, label: string): boolean {
  return new RegExp(`^${LABELS[provider]} \\d+$`).test(label);
}

function singleLoginError(provider: QuotaProviderId): BuilderHelmError {
  return new BuilderHelmError(
    'VALIDATION_FAILED',
    `${LABELS[provider]} keeps its own provider logins. Run \`opencode auth login\` in a terminal.`,
  );
}

export class AccountsService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly board: BoardService,
    private readonly logger: Logger,
    private readonly accountsRoot: string,
    private readonly readCodex: CodexRateLimitReader = readCodexRateLimits,
  ) {}

  /** Latest failed limit read per account ref, with a message safe to show. */
  private readonly limitIssues = new Map<
    string,
    { state: 'error' | 'unavailable'; message: string }
  >();
  /** Epoch ms of the last Codex read per account ref. */
  private readonly codexReadAt = new Map<string, number>();

  hookSystemDefault(): boolean {
    return this.settings.read(HOOK_SYSTEM_KEY) === 'true';
  }

  setHookSystemDefault(enabled: boolean): void {
    this.settings.write(HOOK_SYSTEM_KEY, enabled ? 'true' : 'false', utcNow());
  }

  /**
   * A statusLine report from one Claude login. The hook command names the
   * login it was installed in, so the windows land on that account only.
   */
  ingestClaude(accountRef: string, payload: unknown): AccountQuota | null {
    const ref = parseAccountRef(accountRef);
    if (ref === null || ref.provider !== 'claude') return null;
    if (
      ref.id !== SYSTEM_ACCOUNT_ID &&
      !this.homes().claude.some((home) => home.id === ref.id)
    ) {
      return null;
    }
    const quota = parseClaudeRateLimits(payload, utcNow());
    if (quota === null) return null;
    this.writeQuota(`claude:${ref.id}`, quota);
    return quota;
  }

  cliEnv(): Record<string, string> {
    // System accounts inherit the native CLI environment. In particular,
    // setting CLAUDE_CONFIG_DIR to ~/.claude changes where Claude looks for
    // onboarding and keychain credentials, even though it is the default folder.
    const env: Record<string, string> = {};
    const homes = this.homes();
    const active = this.active();
    for (const id of ISOLATED_LOGIN_PROVIDER_IDS) {
      const home = homes[id].find((entry) => entry.id === active[id]);
      if (home === undefined || home.disabled === true || !existsSync(home.configRoot)) {
        continue;
      }
      try {
        if (statSync(home.configRoot).isDirectory())
          env[CONFIG_ENV[id]] = home.configRoot;
      } catch {
        // stale root
      }
    }
    return env;
  }

  /**
   * Child environment for a new run. `accountRef` selects one provider home;
   * other providers keep their active homes. Running processes keep the env
   * they were spawned with — this is only read at launch.
   */
  cliEnvFor(accountRef: string | null): Record<string, string> {
    const env = this.cliEnv();
    const selected = parseAccountRef(accountRef);
    if (selected === null || !isIsolated(selected.provider)) return env;
    const key = CONFIG_ENV[selected.provider];
    if (selected.id === SYSTEM_ACCOUNT_ID) {
      delete env[key];
      return env;
    }
    const home = this.homes()[selected.provider].find(
      (entry) => entry.id === selected.id,
    );
    if (home === undefined || home.disabled === true) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'The selected login is removed or disabled. Pick an enabled login.',
      );
    }
    let available = false;
    try {
      available = statSync(home.configRoot).isDirectory();
    } catch {
      /* unavailable */
    }
    if (!available) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'The selected login folder is unavailable. Restore it or pick another login.',
      );
    }
    env[key] = home.configRoot;
    return env;
  }

  /**
   * The login a new agent run uses and the environment that selects it. An
   * explicit ref must name a usable login: a removed or disabled one fails
   * the launch instead of quietly running on another account. With no ref,
   * the provider's active login is used and named in the result.
   */
  launchFor(
    provider: string,
    accountRef: string | null,
  ): { env: Record<string, string>; accountRef: string | null } {
    const known = quotaProviderIdSchema.safeParse(provider);
    if (!known.success) {
      if (accountRef !== null)
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          'This runtime cannot select a provider login.',
        );
      return { env: this.cliEnvFor(null), accountRef: null };
    }
    const id = known.data;
    if (accountRef !== null) {
      const selected = parseAccountRef(accountRef);
      if (selected === null || selected.provider !== id) {
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          `This agent is pinned to a login that is not a ${LABELS[id]} login. Pick another in the agent's settings.`,
        );
      }
      if (selected.id !== SYSTEM_ACCOUNT_ID) {
        const home = this.homes()[id].find((entry) => entry.id === selected.id);
        if (home === undefined) {
          throw new BuilderHelmError(
            'VALIDATION_FAILED',
            `The ${LABELS[id]} login this agent uses was removed. Pick another login before starting.`,
          );
        }
        if (home.disabled === true) {
          throw new BuilderHelmError(
            'VALIDATION_FAILED',
            `The ${LABELS[id]} login "${home.label}" is disabled. Enable it on Usage or pick another login.`,
          );
        }
      }
      return { env: this.cliEnvFor(accountRef), accountRef };
    }
    const active = this.active()[id];
    const home = this.homes()[id].find((entry) => entry.id === active);
    const ref =
      home === undefined || home.disabled === true
        ? `${id}:${SYSTEM_ACCOUNT_ID}`
        : `${id}:${active}`;
    return { env: this.cliEnvFor(ref), accountRef: ref };
  }

  /**
   * Credential locations that would both apply if a child inherited HOME and
   * a redirected config dir. Paths only — never file contents.
   */
  diagnoseAuth(): AuthConflict[] {
    const conflicts: AuthConflict[] = [];
    const homes = this.homes();
    for (const provider of QUOTA_PROVIDER_IDS) {
      const sources: AuthConflict['sources'] = [];
      const systemRoot = SYSTEM_AUTH_ROOT[provider];
      if (authMarkerExists(provider, systemRoot)) {
        sources.push({ kind: 'system-default', path: systemRoot });
      }
      for (const home of homes[provider]) {
        if (!existsSync(home.configRoot)) continue;
        if (!authMarkerExists(provider, home.configRoot)) continue;
        sources.push({ kind: 'isolated-home', path: home.configRoot });
      }
      if (sources.length >= 2) conflicts.push({ provider, sources });
    }
    return conflicts;
  }

  /**
   * Folders to hook, each with the login it reports for: homes BuilderHelm
   * created, plus folders the person already had (~/.claude and attached
   * homes) only when they opted in.
   */
  claudeHookTargets(): { configRoot: string; accountRef: string }[] {
    const homes = this.homes().claude;
    const target = (home: StoredHome) => ({
      configRoot: home.configRoot,
      accountRef: `claude:${home.id}`,
    });
    const managed = homes.filter((home) => home.kind === 'managed').map(target);
    if (!this.hookSystemDefault()) return managed;
    return [
      ...managed,
      {
        configRoot: SYSTEM_AUTH_ROOT.claude,
        accountRef: `claude:${SYSTEM_ACCOUNT_ID}`,
      },
      ...homes.filter((home) => home.kind === 'attached').map(target),
    ];
  }

  /** Claude folders BuilderHelm did not create; hooked only with consent. */
  claudeOwnedRoots(): string[] {
    const attached = this.homes()
      .claude.filter((home) => home.kind === 'attached')
      .map((home) => home.configRoot);
    return [SYSTEM_AUTH_ROOT.claude, ...attached];
  }

  /**
   * Every login with its history folder: each provider's system default plus
   * added and attached homes. Read-only; used to find usage history.
   */
  logins(): LoginLocation[] {
    const homes = this.homes();
    return QUOTA_PROVIDER_IDS.flatMap((provider) => {
      const systemEmail = homeEmail(provider, null);
      const system: LoginLocation = {
        provider,
        accountRef: `${provider}:${SYSTEM_ACCOUNT_ID}`,
        label: systemEmail ?? `${LABELS[provider]} (system)`,
        root: SYSTEM_AUTH_ROOT[provider],
        identity: readAccountIdentity(provider, null),
      };
      return [
        system,
        ...homes[provider].map((home) => ({
          provider,
          accountRef: `${provider}:${home.id}`,
          label: homeEmail(provider, home.configRoot) ?? home.label,
          root: home.configRoot,
          identity: readAccountIdentity(provider, home.configRoot),
        })),
      ];
    });
  }

  /** The folder behind a stored home; null for the system login or a missing id. */
  configRootOf(provider: QuotaProviderId, id: string): string | null {
    return this.homes()[provider].find((entry) => entry.id === id)?.configRoot ?? null;
  }
  async snapshot(live = false): Promise<AccountSnapshot> {
    if (live) {
      await this.refreshCodex();
    }
    const detections = await this.board.detectAgents();
    const byId = new Map(detections.map((agent) => [agent.id, agent]));
    const homes = this.homes();
    const active = this.active();
    const now = Date.now();
    const stored = this.storedQuota();
    const hooked = new Set(this.claudeHookTargets().map((target) => target.accountRef));
    const limitsOf = (
      provider: QuotaProviderId,
      homeId: string,
      configRoot: string | null,
      kind: AccountHome['kind'],
      email: string | null,
      billing: GrokBilling | null,
    ): Pick<AccountHome, 'quota' | 'limits' | 'accountKey'> => {
      const ref = `${provider}:${homeId}`;
      const identity =
        provider === 'grok' ? email : readAccountIdentity(provider, configRoot);
      const accountKey = identity === null ? null : identityKey(provider, identity);
      const raw = provider === 'grok' ? grokQuota(billing) : (stored[ref] ?? null);
      const quota = raw;
      const issue = this.limitIssues.get(ref);
      const limits = ((): AccountHome['limits'] => {
        if (provider === 'opencode') {
          return {
            state: 'unavailable',
            message:
              'Limits unavailable for this account: OpenCode uses each model provider’s own billing.',
          };
        }
        if (issue !== undefined && quota === null) return issue;
        if (quota !== null) {
          const age = now - new Date(quota.occurredAt).getTime();
          if (issue?.state === 'error') return { state: 'stale', message: issue.message };
          const expired = quota.windows.some(
            (window) =>
              window.resetsAt !== null && new Date(window.resetsAt).getTime() <= now,
          );
          return expired || age > STALE_MS[quota.source]
            ? { state: 'stale', message: null }
            : { state: 'ok', message: null };
        }
        if (kind === 'managed' && email === null) {
          return { state: 'unknown', message: 'Waiting for the login to finish.' };
        }
        if (provider === 'claude') {
          if (identity === null) {
            return {
              state: 'unavailable',
              message:
                'Limits unavailable for this account: no Claude subscription sign-in here (API-key logins have none).',
            };
          }
          return hooked.has(ref)
            ? {
                state: 'unknown',
                message:
                  'No reading yet. Appears after a Claude Code session runs in this login.',
              }
            : {
                state: 'unknown',
                message:
                  'Claude reports limits through its status line. Turn on the switch below to install it in this folder.',
              };
        }
        if (provider === 'codex') {
          return authMarkerExists('codex', configRoot ?? SYSTEM_AUTH_ROOT.codex)
            ? { state: 'unknown', message: 'No reading yet. Press Refresh.' }
            : { state: 'unavailable', message: 'Not signed in to Codex here.' };
        }
        return { state: 'unknown', message: 'Appears after the first Grok session.' };
      })();
      return { quota, limits, accountKey };
    };
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
      const systemBilling = id === 'grok' ? readGrokBilling(null) : null;
      const system: AccountHome = {
        id: SYSTEM_ACCOUNT_ID,
        label: systemEmail ?? 'System default',
        kind: 'system',
        disabled: false,
        configRoot: null,
        email: systemEmail,
        active: activeId === SYSTEM_ACCOUNT_ID,
        ...limitsOf(id, SYSTEM_ACCOUNT_ID, null, 'system', systemEmail, systemBilling),
        billing: grokBillingPayload(systemBilling),
      };
      const listed: AccountHome[] = [
        system,
        ...extra.map((home) => {
          const billing = id === 'grok' ? readGrokBilling(home.configRoot) : null;
          const email = homeEmail(id, home.configRoot);
          // Swap the generic pending name for the login email once it lands.
          // A name the person chose is kept.
          const label =
            email !== null && isPendingLabel(id, home.label) ? email : home.label;
          if (home.label !== label) {
            homes[id] = homes[id].map((entry) =>
              entry.id === home.id ? { ...entry, label } : entry,
            );
            relabeled = true;
          }
          return {
            id: home.id,
            label,
            kind: home.kind,
            disabled: home.disabled === true,
            configRoot: home.configRoot,
            email,
            active: home.id === activeId,
            ...limitsOf(id, home.id, home.configRoot, home.kind, email, billing),
            billing: grokBillingPayload(billing),
          };
        }),
      ];
      if (relabeled) this.writeHomes(homes);
      return {
        id,
        label: LABELS[id],
        installed: byId.get(id)?.available === true,
        multiAccount: isIsolated(id),
        homes: listed,
      };
    });
    return accountSnapshotSchema.parse({
      providers,
      occurredAt: utcNow(),
      hookSystemDefault: this.hookSystemDefault(),
      authConflicts: this.diagnoseAuth(),
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
    if (!isIsolated(id)) throw singleLoginError(id);
    // A double-click on Add Account must not mint two homes: reuse a pending
    // (generic-label) home instead.
    const pending = this.homes()[id].find((entry) => isPendingLabel(id, entry.label));
    if (pending !== undefined) {
      this.writeActive({ ...this.active(), [id]: pending.id });
      return this.snapshot();
    }
    if (this.homes()[id].length >= MAX_EXTRA_HOMES)
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'Up to 15 additional logins per provider are supported. Disconnect one before adding another.',
      );
    const homeId = createId();
    const configRoot = join(this.accountsRoot, id, homeId);
    mkdirSync(configRoot, { recursive: true });
    const homes = this.homes();
    homes[id] = [
      ...homes[id],
      {
        id: homeId,
        label: `${LABELS[id]} ${homes[id].length + 1}`,
        kind: 'managed',
        configRoot,
      },
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

  /**
   * Registers a login folder the person already has, such as
   * ~/.claude-work. BuilderHelm points the CLI at it but never deletes it.
   * Only a folder that already holds a login is accepted, so a typo cannot
   * make the CLI start writing into an unrelated folder.
   */
  async attach(provider: QuotaProviderId, path: string): Promise<AccountSnapshot> {
    const id = quotaProviderIdSchema.parse(provider);
    if (!isIsolated(id)) throw singleLoginError(id);
    if (!isAbsolute(path)) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Pick a folder by its full path');
    }
    let root: string;
    try {
      root = realpathSync(path);
      if (!statSync(root).isDirectory()) throw new Error('not a folder');
    } catch {
      throw new BuilderHelmError('VALIDATION_FAILED', 'That folder does not exist');
    }
    if (contains(root, resolved(homedir()))) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        `Pick the ${LABELS[id]} config folder itself, not your home folder or above it`,
      );
    }
    if (root === resolved(SYSTEM_AUTH_ROOT[id])) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'That folder is already the system default login',
      );
    }
    if (contains(resolved(this.accountsRoot), root)) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'BuilderHelm already manages that folder',
      );
    }
    const homes = this.homes();
    if (homes[id].some((home) => resolved(home.configRoot) === root)) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'That folder is already attached');
    }
    if (!authMarkerExists(id, root)) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        `No ${LABELS[id]} login in that folder. Sign in with ${CONFIG_ENV[id]} pointing at it first.`,
      );
    }
    if (homes[id].length >= MAX_EXTRA_HOMES)
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'Up to 15 additional logins per provider are supported. Disconnect one before attaching another.',
      );
    const label = (homeEmail(id, root) ?? basename(root)).slice(0, 80);
    homes[id] = [
      ...homes[id],
      { id: createId(), label, kind: 'attached', configRoot: root },
    ];
    this.writeHomes(homes);
    this.logger.info({
      event: 'accounts.attached',
      correlationId: createCorrelationId(),
      data: { provider: id },
    });
    return this.snapshot();
  }

  async rename(
    provider: QuotaProviderId,
    id: string,
    label: string,
  ): Promise<AccountSnapshot> {
    const name = label.trim().slice(0, 80);
    if (name.length === 0) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'A name is required');
    }
    if (isPendingLabel(provider, name)) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        `Names like "${LABELS[provider]} 2" are kept for logins still signing in`,
      );
    }
    const homes = this.homes();
    if (!homes[provider].some((entry) => entry.id === id)) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        id === SYSTEM_ACCOUNT_ID
          ? 'The system default login is named by its email'
          : 'That account is gone',
      );
    }
    homes[provider] = homes[provider].map((entry) =>
      entry.id === id ? { ...entry, label: name } : entry,
    );
    this.writeHomes(homes);
    return this.snapshot();
  }

  /**
   * The identity a login wrote into a home, or null while it is still pending.
   * Read-only: the caller polls this while the browser OAuth runs and only
   * confirms once it lands, so a slow login is not mistaken for a failed one.
   */
  accountEmail(provider: QuotaProviderId, id: string): string | null {
    const home = this.homes()[provider].find((entry) => entry.id === id);
    if (home === undefined) return null;
    return homeEmail(provider, home.configRoot);
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
      // The CLI may still be writing its credentials when the window closes, so
      // only a home the login never touched is dropped. A home with files stays
      // and snapshot() relabels it once the identity lands.
      if (home.kind === 'attached' || directoryHasEntries(home.configRoot)) {
        return this.snapshot();
      }
      homes[provider] = homes[provider].filter((entry) => entry.id !== id);
      this.writeHomes(homes);
      const active = this.active();
      if (active[provider] === id) {
        this.writeActive({ ...active, [provider]: SYSTEM_ACCOUNT_ID });
      }
      this.deleteManagedFolder(home);
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
    this.forgetQuota(`${provider}:${id}`);
    // Attached folders belong to the person: removing one only forgets it.
    this.deleteManagedFolder(current);
    return this.snapshot();
  }

  private deleteManagedFolder(home: StoredHome): void {
    if (home.kind !== 'managed' || !existsSync(home.configRoot)) return;
    const root = resolved(home.configRoot);
    const accounts = resolved(this.accountsRoot);
    // Strictly inside the accounts root, never the root itself or a sibling
    // that only shares its prefix.
    if (root === accounts || !contains(accounts, root)) return;
    rmSync(root, { recursive: true, force: true });
  }

  /**
   * A disabled login keeps its usage history and attached folder but cannot
   * be active or start runs. Disabling the active login makes the system
   * login active.
   */
  async setDisabled(
    provider: QuotaProviderId,
    id: string,
    disabled: boolean,
  ): Promise<AccountSnapshot> {
    if (id === SYSTEM_ACCOUNT_ID) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'The system default login stays enabled',
      );
    }
    const homes = this.homes();
    if (!homes[provider].some((entry) => entry.id === id)) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'That account is gone');
    }
    homes[provider] = homes[provider].map((entry) => {
      if (entry.id !== id) return entry;
      return { ...entry, disabled };
    });
    this.writeHomes(homes);
    const active = this.active();
    if (disabled && active[provider] === id) {
      this.writeActive({ ...active, [provider]: SYSTEM_ACCOUNT_ID });
    }
    return this.snapshot();
  }

  async setActive(provider: QuotaProviderId, id: string): Promise<AccountSnapshot> {
    const home = this.homes()[provider].find((entry) => entry.id === id);
    if (id !== SYSTEM_ACCOUNT_ID && home === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'That account is gone');
    }
    if (home?.disabled === true) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'Enable this login before using it',
      );
    }
    this.writeActive({ ...this.active(), [provider]: id });
    return this.snapshot();
  }

  /**
   * Asks Codex app-server for every login's windows, each under its own
   * CODEX_HOME. The CLI reads its own credentials; BuilderHelm never does.
   */
  private async refreshCodex(): Promise<void> {
    const detections = await this.board.detectAgents();
    const codex = detections.find((agent) => agent.id === 'codex');
    if (codex?.available !== true || codex.path === null) return;
    const executable = codex.path;
    const targets = [
      { id: SYSTEM_ACCOUNT_ID, configRoot: SYSTEM_AUTH_ROOT.codex },
      ...this.homes().codex,
    ].filter((home) => authMarkerExists('codex', home.configRoot));
    const now = Date.now();
    for (let offset = 0; offset < targets.length; offset += 2) {
      await Promise.all(
        targets.slice(offset, offset + 2).map(async (home) => {
          const ref = `codex:${home.id}`;
          const last = this.codexReadAt.get(ref);
          if (last !== undefined && now - last < CODEX_MIN_INTERVAL_MS) return;
          this.codexReadAt.set(ref, now);
          try {
            const live = parseCodexRateLimits(
              await this.readCodex(executable, { CODEX_HOME: home.configRoot }),
              utcNow(),
            );
            if (live === null) {
              this.limitIssues.set(ref, {
                state: 'unavailable',
                message:
                  'Limits unavailable for this account: Codex reported no subscription windows (API-key logins have none).',
              });
              return;
            }
            this.limitIssues.delete(ref);
            this.writeQuota(ref, live);
          } catch {
            // The raw error can carry account details; show a fixed message.
            this.limitIssues.set(ref, {
              state: 'error',
              message: 'Codex could not report limits for this login. Last reading kept.',
            });
          }
        }),
      );
    }
  }

  private writeQuota(ref: string, quota: AccountQuota): void {
    const next = { ...this.storedQuota(), [ref]: quota };
    this.settings.write(QUOTA_KEY, JSON.stringify(next), utcNow());
  }

  private forgetQuota(ref: string): void {
    const next = this.storedQuota();
    if (!(ref in next)) return;
    delete next[ref];
    this.settings.write(QUOTA_KEY, JSON.stringify(next), utcNow());
  }

  private writeHomes(homes: Record<QuotaProviderId, StoredHome[]>): void {
    this.settings.write(HOMES_KEY, JSON.stringify(homes), utcNow());
  }

  private writeActive(active: Record<QuotaProviderId, string>): void {
    this.settings.write(ACTIVE_KEY, JSON.stringify(active), utcNow());
  }

  private storedQuota(): QuotaMap {
    return parseQuota(this.settings.read(QUOTA_KEY));
  }

  private homes(): Record<QuotaProviderId, StoredHome[]> {
    return parseHomes(this.settings.read(HOMES_KEY));
  }

  private active(): Record<QuotaProviderId, string> {
    return parseActive(this.settings.read(ACTIVE_KEY));
  }
}
