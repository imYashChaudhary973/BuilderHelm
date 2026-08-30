export interface StartupAck {
  readonly id: string;
  /**
   * Phrase as it reads on screen. Matched with all whitespace removed: a TUI
   * positions each word with cursor escapes instead of emitting spaces, so
   * Claude's trust prompt arrives as `Yes,Itrustthisfolder` once the escapes
   * are stripped and a spaced pattern never matches.
   */
  readonly phrase: string;
  readonly reply: string;
  /**
   * Agents whose startup output may legitimately contain this banner. The
   * reply is keystrokes in the target CLI's own menu, so cross-agent matches
   * would type wrong digits into a TUI that never showed the prompt.
   */
  readonly agents?: readonly string[];
}

export const STARTUP_ACKS: readonly StartupAck[] = [
  { id: 'claude-trust', phrase: 'I trust this folder', reply: '\r' },
  // Answers Codex's numbered update menu; harmless for other agents, which
  // may print the same words as an inert notice while awaiting real input.
  { id: 'codex-update', phrase: 'Update available', reply: '3\r', agents: ['codex'] },
  { id: 'workspace-trust', phrase: 'trust this workspace', reply: '\r' },
  { id: 'directory-trust', phrase: 'trust this directory', reply: '\r' },
];

const STARTUP_FAILS: readonly { id: string; phrases: readonly string[] }[] = [
  { id: 'quota', phrases: ['session limit', 'usage limit', 'rate limit'] },
  {
    id: 'auth',
    phrases: ['not logged in', 'please log in', 'please sign in', 'invalid api key'],
  },
];

const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

/** Comparison form: no escapes, no whitespace, one case. */
function squash(value: string): string {
  return value.replace(ansi, '').replace(/\s+/g, '').toLowerCase();
}

const startupScanOverlapChars = 256;

export interface StartupScan {
  readonly tail: string;
  readonly ack: { id: string; reply: string } | null;
  readonly failure: string | null;
}

function findStartupAck(
  squashed: string,
  already: ReadonlySet<string>,
  agentId: string,
): { id: string; reply: string } | null {
  for (const ack of STARTUP_ACKS) {
    if (already.has(ack.id)) continue;
    if (ack.agents !== undefined && !ack.agents.includes(agentId)) continue;
    if (squashed.includes(squash(ack.phrase))) return { id: ack.id, reply: ack.reply };
  }
  return null;
}

function findStartupFailure(squashed: string): string | null {
  for (const fail of STARTUP_FAILS) {
    for (const phrase of fail.phrases) {
      if (squashed.includes(squash(phrase))) return fail.id;
    }
  }
  return null;
}

/**
 * Scans only new PTY output plus enough raw overlap to catch a prompt or ANSI
 * sequence split across chunks. The retained terminal snapshot is much larger
 * and must not be reprocessed for every byte.
 */
export function scanStartupChunk(
  previousTail: string,
  chunk: string,
  already: ReadonlySet<string>,
  agentId: string,
): StartupScan {
  const raw = previousTail + chunk;
  const squashed = squash(raw);
  return {
    tail: raw.slice(-startupScanOverlapChars),
    ack: findStartupAck(squashed, already, agentId),
    failure: findStartupFailure(squashed),
  };
}

export function nextStartupAck(
  output: string,
  already: ReadonlySet<string>,
  agentId: string,
): { id: string; reply: string } | null {
  return findStartupAck(squash(output), already, agentId);
}

export function startupFailure(output: string): string | null {
  return findStartupFailure(squash(output));
}
