export interface AgentUsage {
  readonly tokensUsed: number;
  readonly costUsd: number;
}

interface UsageCandidate {
  readonly tokens: number;
  readonly cost: number;
}

function readCandidate(value: unknown): UsageCandidate {
  if (typeof value !== 'object' || value === null) return { tokens: 0, cost: 0 };
  const row = value as Record<string, unknown>;
  const usage =
    typeof row.usage === 'object' && row.usage !== null
      ? (row.usage as Record<string, unknown>)
      : row;
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const output = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
  const total = Number(usage.total_tokens ?? 0);
  const cached = Number(usage.cache_read_input_tokens ?? 0);
  const tokens = total > 0 ? total : input + output + cached;
  const cost = Number(row.total_cost_usd ?? row.cost_usd ?? usage.total_cost_usd ?? 0);
  return {
    tokens: Number.isFinite(tokens) ? tokens : 0,
    cost: Number.isFinite(cost) ? cost : 0,
  };
}

/**
 * Reads token and cost totals out of agent CLI output. Claude's `--output-format
 * json` reports `total_cost_usd` plus a usage block; codex `--json` streams
 * usage events. Unparseable output meters as zero rather than throwing, so a
 * chatty agent never fails a task it actually completed.
 */
export function parseAgentUsage(stdout: string): AgentUsage {
  let tokens = 0;
  let cost = 0;
  for (const line of stdout.split('\n')) {
    const text = line.trim();
    if (!text.startsWith('{') || !text.endsWith('}')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const candidate = readCandidate(parsed);
    tokens = Math.max(tokens, candidate.tokens);
    cost = Math.max(cost, candidate.cost);
  }
  return { tokensUsed: Math.round(tokens), costUsd: cost };
}
