import { existsSync } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

import {
  readForeignDatabase,
  UsageRepository,
  type BuilderHelmDatabase,
  type UsageRecordRow,
  type UsageRecordWrite,
  type UsageSourceRow,
} from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import {
  usageReportSchema,
  type UsageCost,
  type UsageModelRow,
  type UsagePricingStatus,
  type UsageRange,
  type UsageReport,
  type UsageReportInput,
  type UsageRow,
  type UsageSourceStatus,
  type UsageTokens,
} from '@builderhelm/protocol';
import { createCorrelationId, utcNow } from '@builderhelm/shared';

import {
  identityKey,
  type AccountsService,
  type LoginLocation,
} from '../accounts/accounts-service.js';
import {
  EMPTY_CODEX_CURSOR,
  parseChatUsage,
  parseClaudeTranscript,
  parseCodexRollout,
  parseOpenCodeMessages,
  type CodexCursor,
  type OpenCodeMessageRow,
  type ParsedUsage,
  type SourceContext,
} from './adapters.js';
import { costOf, resolvePrice, type PricingService } from './pricing.js';

export const LOCAL_ENVIRONMENT = 'local';
/** Bytes read from one file per scan; the rest is read on the next scan. */
const MAX_READ_BYTES = 1024 * 1024;
const MIN_SCAN_INTERVAL_MS = 15_000;

/** A non-reversible key for one account; never a raw credential. */
export function accountKeyFor(login: LoginLocation): string {
  return login.identity === null
    ? identityKey(login.provider, `folder:${login.root}`)
    : identityKey(login.provider, login.identity);
}

function homeRelative(path: string): string {
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

async function jsonlFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 6) return [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await jsonlFiles(path, depth + 1)));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
  }
  return files;
}

function rangeStart(range: UsageRange, now: Date): Date | null {
  if (range === 'all') return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days = { today: 0, '7d': 6, '30d': 29, '90d': 89 }[range];
  start.setDate(start.getDate() - days);
  return start;
}

function localDay(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const PROVIDER_LABEL: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  api: 'BuilderHelm API chats',
  grok: 'Grok',
};

class Totals {
  uncachedInput = 0;
  cacheRead = 0;
  cacheWrite = 0;
  output = 0;
  reasoning = 0;
  records = 0;
  incomplete = 0;
  estimated = 0;
  categories = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  reported = 0;
  savings = 0;
  pricedTokens = 0;
  reportedTokens = 0;
  unpricedTokens = 0;
  note: string | null = null;
  pricedAs: string | null = null;
  rateSource: UsageModelRow['rateSource'] = null;

  add(record: UsageRecordRow, cost: ReturnType<typeof costOf>): void {
    const total =
      record.uncached_input_tokens +
      record.cache_read_tokens +
      record.cache_write_tokens +
      record.output_tokens;
    this.uncachedInput += record.uncached_input_tokens;
    this.cacheRead += record.cache_read_tokens;
    this.cacheWrite += record.cache_write_tokens;
    this.output += record.output_tokens;
    this.reasoning += record.reasoning_tokens ?? 0;
    this.records += 1;
    if (record.complete === 0) this.incomplete += 1;
    if (cost.price !== null && this.pricedAs === null) {
      this.pricedAs = cost.price.model;
      this.rateSource = {
        origin: cost.price.origin,
        label: cost.price.sourceLabel,
        asOf: cost.price.asOf,
      };
    }
    // A cost the provider reported wins over a calculated one.
    if (record.reported_cost_usd !== null) {
      this.reported += record.reported_cost_usd;
      this.reportedTokens += total;
      return;
    }
    if (!cost.priced) {
      this.unpricedTokens += total;
      this.note ??= cost.reason;
      return;
    }
    const { input, cacheRead, cacheWrite, output } = cost.categories;
    this.categories.input += input;
    this.categories.cacheRead += cacheRead;
    this.categories.cacheWrite += cacheWrite;
    this.categories.output += output;
    this.estimated += input + cacheRead + cacheWrite + output;
    this.savings += cost.cacheSavings;
    this.pricedTokens += total;
    this.note ??= cost.note;
  }

  tokens(): UsageTokens {
    return {
      uncachedInput: this.uncachedInput,
      cacheRead: this.cacheRead,
      cacheWrite: this.cacheWrite,
      output: this.output,
      reasoning: this.reasoning,
      total: this.uncachedInput + this.cacheRead + this.cacheWrite + this.output,
      records: this.records,
      incompleteRecords: this.incomplete,
    };
  }

  cost(): UsageCost {
    const priced = this.pricedTokens > 0;
    return {
      estimatedUsd: priced ? this.estimated : null,
      categories: priced ? { ...this.categories } : null,
      reportedUsd: this.reportedTokens > 0 ? this.reported : null,
      cacheSavingsUsd: priced ? this.savings : null,
      pricedTokens: this.pricedTokens,
      unpricedTokens: this.unpricedTokens,
    };
  }

  pricing(): UsagePricingStatus {
    if (this.records === 0) return 'none';
    const known = this.pricedTokens + this.reportedTokens;
    if (this.unpricedTokens === 0) return this.pricedTokens === 0 ? 'reported' : 'priced';
    return known === 0 ? 'unpriced' : 'partial';
  }

  row(key: string, label: string, detail: string | null): UsageRow {
    return {
      key: key.slice(0, 300),
      label: label.slice(0, 300),
      detail: detail?.slice(0, 300) ?? null,
      tokens: this.tokens(),
      cost: this.cost(),
      pricing: this.pricing(),
    };
  }
}

function group<K extends string>(map: Map<K, Totals>, key: K): Totals {
  let totals = map.get(key);
  if (totals === undefined) {
    totals = new Totals();
    map.set(key, totals);
  }
  return totals;
}

/**
 * Reads usage history from every login's local CLI data and BuilderHelm's
 * own chats into the ledger, and builds reports from it. Scans are
 * incremental: files resume at their stored offset and databases at their
 * stored cursor, so a refresh reads only what is new.
 */
export class UsageService {
  private readonly ledger: UsageRepository;
  private scanning: Promise<void> | null = null;
  private lastScanAt: number | null = null;
  private lastError: string | null = null;

  constructor(
    database: BuilderHelmDatabase,
    private readonly accounts: Pick<AccountsService, 'logins'>,
    private readonly pricing: PricingService,
    private readonly logger: Logger,
    private readonly openCodeDataDir: string = join(
      process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'),
      'opencode',
    ),
  ) {
    this.ledger = new UsageRepository(database);
  }

  /** One scan at a time; a request inside the minimum interval reuses the last. */
  async scan(force = false): Promise<void> {
    if (this.scanning !== null) return this.scanning;
    if (
      !force &&
      this.lastScanAt !== null &&
      Date.now() - this.lastScanAt < MIN_SCAN_INTERVAL_MS
    ) {
      return;
    }
    this.scanning = this.runScan().finally(() => {
      this.scanning = null;
      this.lastScanAt = Date.now();
    });
    return this.scanning;
  }

  private async runScan(): Promise<void> {
    const seen = new Set<string>();
    const labeled = new Set<string>();
    const now = utcNow();
    this.lastError = null;
    try {
      for (const login of this.accounts.logins()) {
        const accountKey = accountKeyFor(login);
        if (!labeled.has(accountKey)) {
          this.ledger.saveAccount(accountKey, login.provider, login.label, now);
          labeled.add(accountKey);
        }
        const context = (sourceId: string): SourceContext => ({
          accountKey,
          accountRef: login.accountRef,
          environment: LOCAL_ENVIRONMENT,
          sourceId,
        });
        if (login.provider === 'claude') {
          for (const file of await jsonlFiles(join(login.root, 'projects'))) {
            await this.scanFile(file, 'claude', login, context, (chunk, ctx) =>
              parseClaudeTranscript(chunk, ctx),
            );
            seen.add(`file:${file}`);
          }
        } else if (login.provider === 'codex') {
          for (const folder of ['sessions', 'archived_sessions']) {
            for (const file of await jsonlFiles(join(login.root, folder))) {
              await this.scanFile(file, 'codex', login, context, (chunk, ctx, cursor) =>
                parseCodexRollout(chunk, ctx, {
                  ...EMPTY_CODEX_CURSOR,
                  ...(cursor as Partial<CodexCursor>),
                }),
              );
              seen.add(`file:${file}`);
            }
          }
        } else if (login.provider === 'opencode') {
          const id = await this.scanOpenCode(context, accountKey, login);
          if (id !== null) seen.add(id);
        }
      }
      await this.scanChats(now);
      seen.add('builderhelm-chat');
      this.ledger.markMissing(seen, now);
    } catch (error) {
      this.lastError = 'The usage scan stopped early. Already-read history is kept.';
      this.logger.warn({
        event: 'usage.scan_failed',
        correlationId: createCorrelationId(),
        data: { reason: error instanceof Error ? error.name : 'unknown' },
      });
    }
  }

  private async persist(
    records: readonly UsageRecordWrite[],
    at: string,
    replace = false,
  ): Promise<void> {
    // Short transactions keep the background writer from blocking app writes.
    for (let offset = 0; offset < records.length; offset += 64) {
      this.ledger.upsert(records.slice(offset, offset + 64), at, replace);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  private async scanFile(
    path: string,
    provider: 'claude' | 'codex',
    login: LoginLocation,
    context: (sourceId: string) => SourceContext,
    parse: (
      chunk: string,
      context: SourceContext,
      cursor: Record<string, unknown>,
    ) => ParsedUsage & { cursor?: unknown },
  ): Promise<void> {
    const id = `file:${path}`;
    const previous = this.ledger.source(id);
    const base: UsageSourceRow = previous ?? {
      id,
      provider,
      kind: provider === 'claude' ? 'claude-transcript' : 'codex-rollout',
      account_ref: login.accountRef,
      account_key: context(id).accountKey,
      location: homeRelative(path),
      file_identity: null,
      size: 0,
      mtime_ms: 0,
      read_offset: 0,
      cursor_json: '{}',
      state: 'ok',
      records: 0,
      skipped: 0,
      message: null,
      last_scan_at: null,
    };
    const at = utcNow();
    try {
      const info = await stat(path);
      const identity = `${info.dev}:${info.ino}`;
      // A replaced or truncated file is read again from the start; the
      // ledger's event keys keep the events it already holds from doubling.
      const restart = base.file_identity !== identity || info.size < base.read_offset;
      const offset = restart ? 0 : base.read_offset;
      let cursor: Record<string, unknown> = restart ? {} : JSON.parse(base.cursor_json);
      if (
        !restart &&
        info.size === offset &&
        Math.floor(info.mtimeMs) === base.mtime_ms
      ) {
        return;
      }
      const length = Math.min(info.size - offset, MAX_READ_BYTES);
      const buffer = Buffer.alloc(length);
      const handle = await open(path, 'r');
      try {
        await handle.read(buffer, 0, length, offset);
      } finally {
        await handle.close();
      }
      // Only whole lines; a line still being written is read next time.
      const end = buffer.lastIndexOf(0x0a) + 1;
      const parsed = parse(buffer.subarray(0, end).toString('utf8'), context(id), cursor);
      if (parsed.cursor !== undefined) cursor = parsed.cursor as Record<string, unknown>;
      await this.persist(parsed.records, at);
      const partial = offset + end < info.size;
      this.ledger.saveSource({
        ...base,
        account_ref: login.accountRef,
        account_key: context(id).accountKey,
        file_identity: identity,
        size: info.size,
        mtime_ms: Math.floor(info.mtimeMs),
        read_offset: offset + end,
        cursor_json: JSON.stringify(cursor),
        state: partial || parsed.skipped > 0 ? 'partial' : 'ok',
        records: this.ledger.countForSource(id),
        skipped: (restart ? 0 : base.skipped) + parsed.skipped,
        message: partial
          ? end === 0 && length === MAX_READ_BYTES
            ? 'A transcript line exceeds the scan limit and cannot be read'
            : 'Remaining history is read on the next refresh'
          : parsed.skipped > 0
            ? 'Some transcript records could not be read'
            : null,
        last_scan_at: at,
      });
    } catch {
      this.ledger.saveSource({
        ...base,
        state: 'failed',
        message: 'This file could not be read',
        last_scan_at: at,
      });
    }
    // Let terminals and IPC run between files.
    await new Promise((resolve) => setImmediate(resolve));
  }

  private async scanOpenCode(
    context: (sourceId: string) => SourceContext,
    accountKey: string,
    login: LoginLocation,
  ): Promise<string | null> {
    const path = join(this.openCodeDataDir, 'opencode.db');
    if (!existsSync(path)) return null;
    const id = `opencode:${path}`;
    const previous = this.ledger.source(id);
    const cursor = previous === undefined ? {} : JSON.parse(previous.cursor_json);
    const messageFormat = cursor.format === 'messages-v1';
    const after =
      messageFormat && typeof cursor.lastUpdated === 'number' ? cursor.lastUpdated : 0;
    const at = utcNow();
    const base: UsageSourceRow = {
      id,
      provider: 'opencode',
      kind: 'opencode-db',
      account_ref: login.accountRef,
      account_key: accountKey,
      location: homeRelative(path),
      file_identity: null,
      size: 0,
      mtime_ms: 0,
      read_offset: 0,
      cursor_json: JSON.stringify({ lastUpdated: after }),
      state: 'ok',
      records: previous?.records ?? 0,
      skipped: previous?.skipped ?? 0,
      message: null,
      last_scan_at: at,
    };
    try {
      // Only the usage columns; OpenCode's database also holds credentials.
      const tables = new Set(
        readForeignDatabase<{ name: string }>(
          path,
          "SELECT name FROM sqlite_master WHERE type = 'table'",
        ).map((row) => row.name),
      );
      const messageTable = tables.has('session_message') ? 'session_message' : 'message';
      const sessionTable = tables.has('session_v2') ? 'session_v2' : 'session';
      const lastId =
        messageFormat && typeof cursor.lastId === 'string' ? cursor.lastId : '';
      // Extract usage fields only: prompts, tool output, and credentials stay
      // in OpenCode's database. Table names come from the fixed list above.
      const rows = readForeignDatabase<OpenCodeMessageRow>(
        path,
        `SELECT m.id, m.session_id, s.title, s.directory, m.time_created, m.time_updated,
                COALESCE(json_extract(m.data, '$.model.id'), json_extract(m.data, '$.model.modelID'), json_extract(m.data, '$.modelID')) AS model_id,
                json_extract(m.data, '$.cost') AS cost,
                json_extract(m.data, '$.tokens.input') AS tokens_input,
                json_extract(m.data, '$.tokens.output') AS tokens_output,
                json_extract(m.data, '$.tokens.reasoning') AS tokens_reasoning,
                json_extract(m.data, '$.tokens.cache.read') AS tokens_cache_read,
                json_extract(m.data, '$.tokens.cache.write') AS tokens_cache_write
           FROM ${messageTable} m JOIN ${sessionTable} s ON s.id = m.session_id
          WHERE (m.time_updated > ? OR (m.time_updated = ? AND m.id > ?))
            AND COALESCE(json_extract(m.data, '$.role'), json_extract(m.data, '$.type'), ${messageTable === 'session_message' ? 'm.type' : "'unknown'"}) = 'assistant'
          ORDER BY m.time_updated, m.id LIMIT 5000`,
        [after, after, lastId],
      );
      const parsed = parseOpenCodeMessages(rows, context(id));
      if (!messageFormat) this.ledger.removeSessionTotals(id);
      await this.persist(parsed.records, at, true);
      const last = rows.at(-1);
      const full = rows.length === 5000;
      // Re-read the final timestamp bucket to catch later updates at that
      // same timestamp. Event identities replace records without inflating.
      this.ledger.saveSource({
        ...base,
        cursor_json: JSON.stringify({
          lastUpdated:
            last === undefined
              ? after
              : full
                ? last.time_updated
                : Math.max(0, last.time_updated - 1),
          lastId: full ? (last?.id ?? '') : '',
          format: 'messages-v1',
        }),
        state: full || parsed.skipped > 0 ? 'partial' : 'ok',
        message: full
          ? 'More history is read on the next refresh'
          : parsed.skipped > 0
            ? 'Some message usage could not be read'
            : null,
        records: this.ledger.countForSource(id),
        skipped: parsed.skipped,
      });
    } catch {
      this.ledger.saveSource({
        ...base,
        state: 'failed',
        message: 'OpenCode’s database could not be read (it may be a different version)',
      });
    }
    return id;
  }

  private async scanChats(at: string): Promise<void> {
    const id = 'builderhelm-chat';
    const previous = this.ledger.source(id);
    const cursor = previous === undefined ? {} : JSON.parse(previous.cursor_json);
    const after = typeof cursor.lastCreated === 'string' ? cursor.lastCreated : null;
    const rows = this.ledger.chatUsage(after);
    const parsed = parseChatUsage(rows, LOCAL_ENVIRONMENT, id);
    for (const row of rows) {
      this.ledger.saveAccount(
        `api:${row.provider_id}`,
        'api',
        row.provider_label ?? row.provider_id,
        at,
      );
    }
    await this.persist(parsed.records, at);
    this.ledger.saveSource({
      id,
      provider: 'api',
      kind: 'builderhelm-chat',
      account_ref: null,
      account_key: null,
      location: null,
      file_identity: null,
      size: 0,
      mtime_ms: 0,
      read_offset: 0,
      cursor_json: JSON.stringify({ lastCreated: rows.at(-1)?.created_at ?? after }),
      state: 'ok',
      records: this.ledger.countForSource(id),
      skipped: 0,
      message: null,
      last_scan_at: at,
    });
  }

  async report(input: UsageReportInput): Promise<UsageReport> {
    if (input.rescan === true) await this.scan(true);
    else await this.scan();
    const now = new Date();
    const from = rangeStart(input.range, now);
    const table = this.pricing.table();
    const aliases = this.pricing.aliases();
    const labels = new Map(
      this.ledger.accounts().map((row) => [row.account_key, row.label] as const),
    );

    const totals = new Totals();
    const byProvider = new Map<string, Totals>();
    const byAccount = new Map<string, Totals>();
    const byModel = new Map<string, Totals>();
    const byDay = new Map<string, Totals>();
    const bySession = new Map<string, Totals>();
    const sessionLabels = new Map<string, string>();
    let cursor: { at: string; key: string } | null = null;
    for (;;) {
      const records = this.ledger.page(
        from?.toISOString() ?? null,
        input.environment,
        cursor,
      );
      if (records.length === 0) break;
      for (const record of records) {
        const cost = costOf(
          {
            modelId: record.model_id,
            uncachedInput: record.uncached_input_tokens,
            cacheRead: record.cache_read_tokens,
            cacheWrite: record.cache_write_tokens,
            cacheWrite1h: record.cache_write_1h_tokens,
            output: record.output_tokens,
            speed:
              record.speed === 'fast'
                ? 'fast'
                : record.speed === 'standard'
                  ? 'standard'
                  : null,
            inferenceGeo: record.inference_geo,
          },
          resolvePrice(record.model_id, table, aliases),
        );
        totals.add(record, cost);
        group(byProvider, record.provider).add(record, cost);
        group(byAccount, record.account_key).add(record, cost);
        group(byModel, `${record.provider}\u0000${record.model_id ?? ''}`).add(
          record,
          cost,
        );
        group(byDay, localDay(record.occurred_at)).add(record, cost);
        if (record.session_id !== null) {
          const key = `${record.provider}\u0000${record.session_id}`;
          group(bySession, key).add(record, cost);
          if (record.session_label !== null) sessionLabels.set(key, record.session_label);
        }
      }
      const last = records.at(-1)!;
      cursor = { at: last.occurred_at, key: last.event_key };
      await new Promise((resolve) => setImmediate(resolve));
    }

    const byTokens = (a: [string, Totals], b: [string, Totals]): number =>
      b[1].tokens().total - a[1].tokens().total;
    const environments = this.ledger.environments().map((id) => ({
      id,
      label: id === LOCAL_ENVIRONMENT ? `This device (${hostname()})` : id,
    }));

    const report: UsageReport = {
      range: input.range,
      environment: input.environment,
      from: from?.toISOString() ?? null,
      to: now.toISOString(),
      environments:
        environments.length === 0
          ? [{ id: LOCAL_ENVIRONMENT, label: `This device (${hostname()})` }]
          : environments,
      totals: totals.row('total', 'All usage', null),
      byProvider: [...byProvider]
        .sort(byTokens)
        .map(([key, value]) => value.row(key, PROVIDER_LABEL[key] ?? key, null)),
      byAccount: [...byAccount]
        .sort(byTokens)
        .slice(0, 256)
        .map(([key, value]) => {
          const provider = key.slice(0, key.indexOf(':'));
          return value.row(
            key,
            labels.get(key) ?? 'Unknown account',
            PROVIDER_LABEL[provider] ?? provider,
          );
        }),
      byModel: [...byModel]
        .sort(byTokens)
        .slice(0, 512)
        .map(([key, value]) => {
          const [provider = '', model = ''] = key.split('\u0000');
          return {
            ...value.row(
              key,
              model.length > 0 ? model : 'Unknown model',
              PROVIDER_LABEL[provider] ?? provider,
            ),
            pricedAs: value.pricedAs,
            rateSource: value.rateSource,
            pricingNote: value.note,
          };
        }),
      byDay: [...byDay]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, value]) => value.row(key, key, null)),
      bySession: [...bySession]
        .sort(byTokens)
        .slice(0, 50)
        .map(([key, value]) => {
          const [provider = '', session = ''] = key.split('\u0000');
          return value.row(
            key,
            sessionLabels.get(key) ?? session.slice(0, 12),
            PROVIDER_LABEL[provider] ?? provider,
          );
        }),
      sources: this.sourceStatuses(labels),
      pricing: {
        refreshedAt: this.pricing.state().refreshedAt,
        bundledAsOf: this.pricing.state().bundledAsOf,
      },
      scan: {
        lastScanAt:
          this.lastScanAt === null ? null : new Date(this.lastScanAt).toISOString(),
        error: this.lastError,
      },
      generatedAt: now.toISOString(),
    };
    return usageReportSchema.parse(report);
  }

  private sourceStatuses(labels: ReadonlyMap<string, string>): UsageSourceStatus[] {
    const rows: UsageSourceStatus[] = this.ledger
      .sources()
      .slice(0, 1_990)
      .map((row) => ({
        id: row.id.slice(0, 600),
        provider: row.provider,
        kind: row.kind,
        accountLabel:
          row.account_key === null ? null : (labels.get(row.account_key) ?? null),
        location: row.location,
        state:
          row.state === 'ok' || row.state === 'partial' || row.state === 'failed'
            ? row.state
            : 'missing',
        records: row.records,
        skipped: row.skipped,
        lastScanAt: row.last_scan_at,
        message: row.message,
      }));
    for (const login of this.accounts.logins()) {
      if (
        login.provider === 'grok' ||
        rows.some(
          (row) => row.accountLabel === login.label && row.provider === login.provider,
        )
      )
        continue;
      const source = this.ledger
        .sources()
        .find((row) => row.account_ref === login.accountRef);
      if (source !== undefined) continue;
      rows.push({
        id: `history:${login.accountRef}`,
        provider: login.provider,
        kind: 'history',
        accountLabel: login.label,
        location: homeRelative(login.root),
        state: 'missing',
        records: 0,
        skipped: 0,
        lastScanAt:
          this.lastScanAt === null ? null : new Date(this.lastScanAt).toISOString(),
        message: 'No readable local usage history found for this login.',
      });
    }
    // Providers whose CLI keeps no token history BuilderHelm can read.
    rows.push({
      id: 'grok',
      provider: 'grok',
      kind: 'none',
      accountLabel: null,
      location: null,
      state: 'unavailable',
      records: 0,
      skipped: 0,
      lastScanAt: null,
      message: 'Grok CLI keeps no token history BuilderHelm can read',
    });
    rows.push({
      id: 'unsupported-runtimes',
      provider: 'other',
      kind: 'none',
      accountLabel: null,
      location: null,
      state: 'unavailable',
      records: 0,
      skipped: 0,
      lastScanAt: null,
      message:
        'Historical usage from Gemini, Kimi, Pi/OMP, Cursor/Copilot, plain shell, and custom commands is not included by these adapters.',
    });
    return rows;
  }
}
