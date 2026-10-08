import {
  migrations,
  openDatabase,
  runMigrations,
  UsageRepository,
  type BuilderHelmDatabase,
  type ChatUsageRow,
} from '@builderhelm/db';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EMPTY_CODEX_CURSOR,
  parseChatUsage,
  parseClaudeTranscript,
  parseCodexRollout,
  parseOpenCodeSessions,
  type SourceContext,
} from '../src/usage/adapters.js';

const context: SourceContext = {
  accountKey: 'acct-a',
  accountRef: 'claude:system',
  environment: 'local',
  sourceId: 'src-1',
};

function claudeLine(
  id: string,
  requestId: string,
  usage: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: 'assistant',
    requestId,
    sessionId: 'session-1',
    cwd: '/Users/me/Developer/BuilderHelm',
    timestamp: '2026-10-08T10:00:00.000Z',
    message: { id, model: 'claude-opus-5-5', usage },
    ...extra,
  });
}

const CLAUDE_USAGE = {
  input_tokens: 2,
  cache_creation_input_tokens: 17_449,
  cache_read_input_tokens: 9_725,
  output_tokens: 244,
  output_tokens_details: { thinking_tokens: 66 },
  cache_creation: { ephemeral_1h_input_tokens: 17_449, ephemeral_5m_input_tokens: 0 },
  service_tier: 'standard',
  speed: 'standard',
  inference_geo: 'not_available',
};

describe('Claude transcript adapter', () => {
  it('keeps one record per response though Claude writes it once per content block', () => {
    const chunk = [
      claudeLine('msg_1', 'req_1', CLAUDE_USAGE),
      claudeLine('msg_1', 'req_1', CLAUDE_USAGE),
      claudeLine('msg_1', 'req_1', CLAUDE_USAGE),
      '{not json',
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      claudeLine('msg_x', 'req_x', { input_tokens: 0, output_tokens: 0 }, {}),
    ].join('\n');
    const parsed = parseClaudeTranscript(chunk, context);
    const keys = new Set(parsed.records.map((record) => record.event_key));
    expect(keys).toEqual(new Set(['claude:msg_1:req_1']));
    expect(parsed.skipped).toBe(1);
    expect(parsed.records[0]).toMatchObject({
      uncached_input_tokens: 2,
      cache_read_tokens: 9_725,
      cache_write_tokens: 17_449,
      cache_write_1h_tokens: 17_449,
      output_tokens: 244,
      reasoning_tokens: 66,
      speed: 'standard',
      inference_geo: null,
      session_label: 'BuilderHelm',
      complete: true,
    });
  });

  it('skips synthetic placeholder turns', () => {
    const parsed = parseClaudeTranscript(
      JSON.stringify({
        type: 'assistant',
        requestId: 'r',
        timestamp: '2026-10-08T10:00:00.000Z',
        message: {
          id: 'm',
          model: '<synthetic>',
          usage: { input_tokens: 5, output_tokens: 1 },
        },
      }),
      context,
    );
    expect(parsed.records).toHaveLength(0);
  });
});

function codexLine(type: string, payload: Record<string, unknown>, at: string): string {
  return JSON.stringify({ timestamp: at, type, payload });
}

function tokenCount(at: string, total: number, last: Record<string, number>): string {
  return codexLine(
    'event_msg',
    {
      type: 'token_count',
      info: { total_token_usage: { total_tokens: total }, last_token_usage: last },
    },
    at,
  );
}

describe('Codex rollout adapter', () => {
  it('reads each model call once, splitting cached input and keeping reasoning inside output', () => {
    const chunk = [
      codexLine(
        'session_meta',
        { id: 'thread-1', cwd: '/w/app' },
        '2026-10-08T10:00:00Z',
      ),
      codexLine('turn_context', { model: 'gpt-6-sol' }, '2026-10-08T10:00:01Z'),
      tokenCount('2026-10-08T10:00:02Z', 1_500, {
        input_tokens: 1_000,
        cached_input_tokens: 400,
        output_tokens: 500,
        reasoning_output_tokens: 120,
        total_tokens: 1_500,
      }),
      // Codex repeats an unchanged running total; it is not a new call.
      tokenCount('2026-10-08T10:00:03Z', 1_500, {
        input_tokens: 1_000,
        cached_input_tokens: 400,
        output_tokens: 500,
        total_tokens: 1_500,
      }),
      tokenCount('2026-10-08T10:00:04Z', 2_000, {
        input_tokens: 300,
        cached_input_tokens: 0,
        output_tokens: 200,
        total_tokens: 500,
      }),
    ].join('\n');
    const parsed = parseCodexRollout(chunk, context, EMPTY_CODEX_CURSOR);
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]).toMatchObject({
      model_id: 'gpt-6-sol',
      session_id: 'thread-1',
      session_label: 'app',
      uncached_input_tokens: 600,
      cache_read_tokens: 400,
      cache_write_tokens: 0,
      output_tokens: 500,
      reasoning_tokens: 120,
      speed: null,
      complete: false,
    });
    expect(parsed.cursor).toMatchObject({ model: 'gpt-6-sol', lastTotal: 2_000 });
  });

  it('gives a forked rollout the same keys as the history it copied', () => {
    const history = tokenCount('2026-10-08T10:00:02Z', 900, {
      input_tokens: 800,
      output_tokens: 100,
      total_tokens: 900,
    });
    const original = parseCodexRollout(history, context, EMPTY_CODEX_CURSOR);
    const fork = parseCodexRollout(
      [
        codexLine('session_meta', { id: 'thread-2' }, '2026-10-08T11:00:00Z'),
        history,
      ].join('\n'),
      { ...context, sourceId: 'src-2' },
      EMPTY_CODEX_CURSOR,
    );
    expect(fork.records[0]?.event_key).toBe(original.records[0]?.event_key);
  });
});

describe('OpenCode adapter', () => {
  it('folds separately reported reasoning into output and keeps the reported cost', () => {
    const parsed = parseOpenCodeSessions(
      [
        {
          id: 'ses_1',
          title: 'Fix login',
          directory: '/w/app',
          model: '{"providerID":"anthropic","modelID":"claude-sonnet-5-5"}',
          cost: 0.42,
          tokens_input: 1_000,
          tokens_output: 300,
          tokens_reasoning: 50,
          tokens_cache_read: 2_000,
          tokens_cache_write: 100,
          time_updated: Date.parse('2026-10-08T10:00:00Z'),
        },
      ],
      { ...context, accountRef: null },
    );
    expect(parsed.records[0]).toMatchObject({
      model_id: 'claude-sonnet-5-5',
      output_tokens: 350,
      reasoning_tokens: 50,
      reported_cost_usd: 0.42,
    });
  });
});

describe('BuilderHelm chat adapter', () => {
  const row = (protocol: string): ChatUsageRow => ({
    id: `u-${protocol}`,
    thread_id: 't',
    provider_id: 'p',
    model_ref: 'p:model-x',
    input_tokens: 1_000,
    output_tokens: 200,
    cached_input_tokens: 300,
    reasoning_tokens: 40,
    created_at: '2026-10-08T10:00:00.000Z',
    protocol,
    provider_label: 'P',
    thread_title: null,
  });

  it('reads input per protocol so cached tokens are never counted twice', () => {
    const [anthropic, openai] = parseChatUsage(
      [row('anthropic'), row('openai')],
      'local',
      'chat',
    ).records;
    expect(anthropic).toMatchObject({
      uncached_input_tokens: 1_000,
      cache_read_tokens: 300,
    });
    expect(openai).toMatchObject({ uncached_input_tokens: 700, cache_read_tokens: 300 });
    expect(anthropic?.model_id).toBe('model-x');
  });
});

describe('usage ledger', () => {
  const databases: BuilderHelmDatabase[] = [];
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it('stores an event once whichever source or folder it was read through', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    runMigrations(database, migrations);
    const ledger = new UsageRepository(database);
    const records = parseClaudeTranscript(
      claudeLine('m', 'r', CLAUDE_USAGE),
      context,
    ).records;
    expect(ledger.upsert(records, '2026-10-08T10:00:00.000Z')).toBe(1);
    // The same account seen through a second folder or environment.
    const copy = parseClaudeTranscript(claudeLine('m', 'r', CLAUDE_USAGE), {
      ...context,
      environment: 'other-mac',
      sourceId: 'src-2',
    }).records;
    expect(ledger.upsert(copy, '2026-10-08T10:00:01.000Z')).toBe(0);
    expect(ledger.list(null)).toHaveLength(1);
  });
});
