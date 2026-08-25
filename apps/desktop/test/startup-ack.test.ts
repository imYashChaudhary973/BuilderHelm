import { describe, expect, it } from 'vitest';

import { nextStartupAck, startupFailure, visibleText } from '../src/main/startup-ack.js';

describe('startup acks', () => {
  it('acks Claude trust and Codex update once each', () => {
    const seen = new Set<string>();
    const trust = nextStartupAck('Quick safety check: Yes, I trust this folder', seen);
    expect(trust).toEqual({ id: 'claude-trust', reply: '\r' });
    seen.add(trust!.id);
    expect(nextStartupAck('Yes, I trust this folder', seen)).toBeNull();

    const update = nextStartupAck(
      '\u001b[33mUpdate available!\u001b[0m 0.149.0 -> 0.149.1',
      seen,
    );
    expect(update).toEqual({ id: 'codex-update', reply: '3\r' });
    seen.add(update!.id);
    expect(nextStartupAck('Update available!', seen)).toBeNull();
  });

  it('strips ANSI so wrapped prompts still match', () => {
    expect(visibleText('\u001b[1mI trust this folder\u001b[0m')).toBe(
      'I trust this folder',
    );
  });
});

describe('startup failures', () => {
  it('flags Claude session limit and ignores MCP warnings', () => {
    expect(startupFailure("You've hit your session limit · resets 5:50am")).toBe('quota');
    expect(startupFailure('2 MCP servers need authentication · run /mcp')).toBeNull();
  });
});
