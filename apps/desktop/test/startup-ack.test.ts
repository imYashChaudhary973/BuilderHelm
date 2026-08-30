import { describe, expect, it } from 'vitest';

import {
  nextStartupAck,
  scanStartupChunk,
  startupFailure,
} from '../src/main/startup-ack.js';

describe('startup acks', () => {
  it('acks Claude trust and Codex update once each', () => {
    const seen = new Set<string>();
    const trust = nextStartupAck(
      'Quick safety check: Yes, I trust this folder',
      seen,
      'claude',
    );
    expect(trust).toEqual({ id: 'claude-trust', reply: '\r' });
    seen.add(trust!.id);
    expect(nextStartupAck('Yes, I trust this folder', seen, 'claude')).toBeNull();

    const update = nextStartupAck(
      '\u001b[33mUpdate available!\u001b[0m 0.149.0 -> 0.149.1',
      seen,
      'codex',
    );
    expect(update).toEqual({ id: 'codex-update', reply: '3\r' });
    seen.add(update!.id);
    expect(nextStartupAck('Update available!', seen, 'codex')).toBeNull();
  });

  it("never answers another agent's banner with menu keystrokes", () => {
    // Claude may print "Update available" as an inert notice while its own TUI
    // waits for input; typing Codex's menu answer there would select menu
    // item 3. Agent-scoped acks must skip it.
    expect(
      nextStartupAck('Update available! 2.1.1 -> 2.2.0', new Set(), 'claude'),
    ).toBeNull();
  });

  it('acks a trust prompt a TUI painted without spaces', () => {
    // Claude positions each word with cursor escapes rather than emitting
    // spaces, so the stripped stream reads `Yes,Itrustthisfolder`. A spaced
    // pattern never matched it and every fresh folder sat at the prompt.
    const painted =
      '\u001b[2m❯\u001b[0m\u001b[38;5;250m1.\u001b[0m\u001b[32mYes,\u001b[0m' +
      '\u001b[32mI\u001b[0m\u001b[32mtrust\u001b[0m\u001b[32mthis\u001b[0m\u001b[32mfolder\u001b[0m';
    expect(nextStartupAck(painted, new Set(), 'claude')).toEqual({
      id: 'claude-trust',
      reply: '\r',
    });
  });
  it('matches ANSI-wrapped prompts split across PTY chunks', () => {
    const first = scanStartupChunk(
      '',
      '\u001b[33mI trust this work',
      new Set(),
      'claude',
    );
    expect(first.ack).toBeNull();

    const second = scanStartupChunk(first.tail, 'space\u001b[0m', new Set(), 'claude');
    expect(second.ack).toEqual({ id: 'workspace-trust', reply: '\r' });

    const third = scanStartupChunk(second.tail, ' Please sig', new Set(), 'claude');
    expect(third.failure).toBeNull();
    expect(scanStartupChunk(third.tail, 'n in', new Set(), 'claude').failure).toBe(
      'auth',
    );
  });
});

describe('startup failures', () => {
  it('flags Claude session limit and ignores MCP warnings', () => {
    expect(startupFailure("You've hit your session limit · resets 5:50am")).toBe('quota');
    expect(startupFailure('2 MCP servers need authentication · run /mcp')).toBeNull();
  });
});
