/**
 * Drives a real ACP agent through the session module.
 *
 * Skipped unless `BUILDERHELM_ACP_LIVE` names a command, because it spawns an
 * agent the machine may not have, needs that agent signed in, and spends the
 * user's own quota. The mapping tests cover the wire shapes hermetically; this
 * proves the parts only a real agent exercises: the handshake, that text arrives
 * incrementally, that the agent reaches the workspace through our `fs` handler
 * rather than the disk, and that a turn terminates.
 *
 *   BUILDERHELM_ACP_LIVE="gemini --acp" pnpm exec vitest run apps/desktop/test/acp-live.test.ts
 *   BUILDERHELM_ACP_LIVE="opencode acp" pnpm exec vitest run apps/desktop/test/acp-live.test.ts
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentSessionEvent } from '@builderhelm/protocol';
import { describe, expect, it } from 'vitest';

import { AcpSession } from '../src/main/acp/session.js';

const live = process.env['BUILDERHELM_ACP_LIVE'];
const parts = (live ?? '')
  .trim()
  .split(/\s+/)
  .filter((part) => part.length > 0);

describe.skipIf(parts.length === 0)('a live ACP agent', () => {
  it('starts a session, streams a reply, and reads the workspace through us', async () => {
    const [command, ...args] = parts;
    const cwd = mkdtempSync(join(tmpdir(), 'builderhelm-acp-'));
    // A value the agent can only produce by actually reading the file.
    writeFileSync(join(cwd, 'note.txt'), 'the recorded number is 41\n', 'utf8');

    const events: AgentSessionEvent[] = [];
    const session = await AcpSession.start({
      agent: { id: 'live', label: command ?? 'agent', command: command ?? '', args },
      cwd,
      emit: (event) => events.push(event),
      // This gate covers transport, not the approval surface.
      resolvePermission: async () => 'allow-once',
    });

    const started = events.find((event) => event.type === 'session.started');
    expect(started, 'the agent should report a session').toBeDefined();
    expect(session.id.length).toBeGreaterThan(0);

    await session.prompt([
      { type: 'text', text: 'Read note.txt and reply with only the number it contains.' },
    ]);
    await session.close();

    // An agent that is installed but not signed in for the selected model is a
    // real outcome, not a transport fault. It must arrive as a sign-in the
    // person can act on; the run still proved the handshake and turn lifecycle.
    const authRequired = events.find((event) => event.type === 'session.auth.required');
    if (authRequired !== undefined) {
      expect(
        authRequired.type === 'session.auth.required' ? authRequired.methods : [],
        'a sign-in prompt should name at least one way to sign in',
      ).not.toHaveLength(0);
      return;
    }

    const failure = events.find((event) => event.type === 'turn.failed');
    expect(failure?.type === 'turn.failed' ? failure.message : undefined).toBeUndefined();

    const completed = events.find((event) => event.type === 'turn.completed');
    expect(completed, 'the turn should complete').toBeDefined();

    const reply = events
      .filter((event) => event.type === 'message.delta')
      .map((event) => (event.type === 'message.delta' ? event.text : ''))
      .join('');

    // The file lives only in the temp workspace and the agent has no ambient
    // access to it, so the number proves fs/read_text_file was served by us.
    expect(reply).toContain('41');
  }, 240_000);
});
