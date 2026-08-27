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

/** Last useful error line from a CLI (402, type:error JSON, or tail). */
export function parseCliFailure(output: string): string {
  const esc = String.fromCharCode(27);
  const text = output.replace(new RegExp(`${esc}\\[[0-9;?]*[ -/]*[@-~]`, 'g'), '');
  if (/402|Payment Required|usage balance exhausted/i.test(text)) {
    return 'Grok usage balance exhausted (402)';
  }
  const start = text.lastIndexOf('{');
  if (start >= 0) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start));
      if (typeof parsed === 'object' && parsed !== null) {
        const row = parsed as Record<string, unknown>;
        if (row.type === 'error' || row.http_status === 402) {
          const message = row.message;
          if (typeof message === 'string' && message.length > 0) {
            return message.slice(0, 240);
          }
        }
      }
    } catch {
      // fall through to tail
    }
  }
  const tail = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-3)
    .join(' ');
  return tail.slice(0, 240);
}
