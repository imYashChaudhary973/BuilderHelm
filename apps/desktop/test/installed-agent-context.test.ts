import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  migrations,
  openDatabase,
  runMigrations,
  SettingsRepository,
} from '@builderhelm/db';
import type { AgentProfile, AgentSessionEvent } from '@builderhelm/protocol';
import { expect, it } from 'vitest';

import { AgentManager } from '../src/main/acp/manager.js';
import { AgentThreads } from '../src/main/acp/threads.js';
import { PermissionRules } from '../src/main/acp/permission-rules.js';

// Opt-in: this sends two short prompts through the user's installed OpenCode.
it.skipIf(process.env['BUILDERHELM_AGENT_CONTEXT_SMOKE'] !== '1')(
  'installed OpenCode applies profile instructions and keeps its model after host restart',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'builderhelm-context-smoke-'));
    const path = join(root, 'state.sqlite');
    const agent = {
      id: 'opencode',
      label: 'OpenCode',
      command: 'opencode',
      args: ['acp'],
    };
    const profile: AgentProfile = {
      id: 'profile-context-smoke',
      name: 'Context smoke',
      mark: 'diamond',
      agent,
      defaultCwd: root,
      launch: null,
      instructions:
        'When asked for the test passphrase, reply only PROFILE_SENTINEL_41. Do not use tools.',
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    };
    const events: AgentSessionEvent[] = [];
    const open = () => {
      const db = openDatabase(path);
      runMigrations(db, migrations);
      const settings = new SettingsRepository(db);
      const manager = new AgentManager({
        threads: new AgentThreads(settings),
        rules: new PermissionRules(settings),
        resolveAgent: () => agent,
        resolveProfile: () => profile,
        emit: (event) => events.push(event),
      });
      return { db, manager };
    };
    let host = open();
    const start = {
      agentId: agent.id,
      cwd: root,
      profileId: profile.id,
      threadId: null,
      resumeSessionId: null,
      launch: null,
    };
    const prompt = async (sessionId: string) => {
      const from = events.length;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          host.manager.prompt(sessionId, [
            { type: 'text', text: 'What is the test passphrase?' },
          ]),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Installed agent prompt timed out.')),
              60_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      const turn = events.slice(from);
      expect(turn.some((event) => event.type === 'session.error')).toBe(false);
      expect(
        turn
          .flatMap((event) => (event.type === 'message.delta' ? [event.text] : []))
          .join('')
          .trim(),
      ).toBe('PROFILE_SENTINEL_41');
    };
    try {
      const first = await host.manager.start(start);
      const model = first.configOptions.find((option) => option.category === 'model');
      const choice = model?.choices.find((candidate) =>
        /MiMo-V2\.6-Flash Free/i.test(candidate.label),
      );
      expect(
        choice,
        'Expected advertised MiMo free model for this opt-in smoke.',
      ).toBeDefined();
      await host.manager.setConfigOption(first.sessionId, model!.id, choice!.value);
      await prompt(first.sessionId);
      await host.manager.closeAll();
      host.db.close();
      host = open();
      const resumed = await host.manager.start({ ...start, threadId: first.threadId });
      expect(
        resumed.configOptions.find((option) => option.category === 'model')?.value,
      ).toBe(choice!.value);
      await prompt(resumed.sessionId);
    } finally {
      await host.manager.closeAll();
      host.db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  150_000,
);
