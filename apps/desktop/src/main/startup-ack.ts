export interface StartupAck {
  readonly id: string;
  readonly match: RegExp;
  readonly reply: string;
}

export const STARTUP_ACKS: readonly StartupAck[] = [
  { id: 'claude-trust', match: /I trust this folder/i, reply: '\r' },
  { id: 'codex-update', match: /Update available/i, reply: '3\r' },
  { id: 'workspace-trust', match: /trust this (workspace|directory)/i, reply: '\r' },
];

const STARTUP_FAILS: readonly { id: string; match: RegExp }[] = [
  { id: 'quota', match: /session limit|usage limit|rate limit/i },
  { id: 'auth', match: /not logged in|please (log|sign) in|invalid api key/i },
];


const ansi = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function visibleText(output: string): string {
  return output.replace(ansi, '');
}

export function nextStartupAck(
  output: string,
  already: ReadonlySet<string>,
): { id: string; reply: string } | null {
  const text = visibleText(output);
  for (const ack of STARTUP_ACKS) {
    if (already.has(ack.id)) continue;
    if (ack.match.test(text)) return { id: ack.id, reply: ack.reply };
  }
  return null;
}

export function startupFailure(output: string): string | null {
  const text = visibleText(output);
  for (const fail of STARTUP_FAILS) {
    if (fail.match.test(text)) return fail.id;
  }
  return null;
}

