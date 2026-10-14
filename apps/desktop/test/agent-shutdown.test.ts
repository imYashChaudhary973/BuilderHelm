import {
  migrations,
  openDatabase,
  runMigrations,
  SettingsRepository,
} from '@builderhelm/db';
import type { AgentSessionEvent } from '@builderhelm/protocol';
import { expect, it } from 'vitest';

import { AgentManager } from '../src/main/acp/manager.js';
import { AgentThreads } from '../src/main/acp/threads.js';
import { PermissionRules } from '../src/main/acp/permission-rules.js';

// A real owned child: it delays termination and can leave a prompt or approval
// unanswered. No provider or user data is involved.
const fixture = `
const readline = require('node:readline');
process.on('SIGTERM', () => setTimeout(() => process.exit(0), 50));
const send = value => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\\n');
readline.createInterface({input:process.stdin}).on('line', line => {
 const r=JSON.parse(line);
 if(r.method==='initialize') send({id:r.id,result:{protocolVersion:1,agentCapabilities:{}}});
 if(r.method==='session/new') send({id:r.id,result:{sessionId:'fixture'}});
 if(r.method==='session/prompt') {
   send({method:'session/update',params:{sessionId:'fixture',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'partial'}}}});
   if(r.params.prompt[0].text==='approval') send({id:100,method:'session/request_permission',params:{sessionId:'fixture',toolCall:{toolCallId:'tool',title:'Run',kind:'execute',status:'pending'},options:[{optionId:'allow',name:'Allow',kind:'allow_once'},{optionId:'deny',name:'Deny',kind:'reject_once'}]}});
 }
});
setInterval(() => {}, 1000);
`;

it.each(['idle', 'streaming', 'approval'])(
  'drains %s sessions before durable state closes',
  async (scenario) => {
    const db = openDatabase(':memory:');
    runMigrations(db, migrations);
    const settings = new SettingsRepository(db);
    const threads = new AgentThreads(settings);
    const events: AgentSessionEvent[] = [];
    const agent = {
      id: 'fixture',
      label: 'Fixture',
      command: process.execPath,
      args: ['-e', fixture],
    };
    const manager = new AgentManager({
      emit: (event) => events.push(event),
      threads,
      rules: new PermissionRules(settings),
      resolveAgent: () => agent,
      resolveProfile: () => null,
    });
    let databaseClosed = false;
    try {
      const session = await manager.start({
        agentId: agent.id,
        cwd: '/tmp',
        threadId: null,
        resumeSessionId: null,
        profileId: null,
        launch: null,
      });
      const prompt =
        scenario === 'idle'
          ? Promise.resolve()
          : manager.prompt(session.sessionId, [{ type: 'text', text: scenario }]);
      if (scenario !== 'idle')
        await expect
          .poll(() =>
            events.some(
              (event) =>
                event.type ===
                (scenario === 'approval' ? 'permission.requested' : 'message.delta'),
            ),
          )
          .toBe(true);
      await manager.closeAll();
      await prompt;
      expect(
        threads.events(session.threadId).some((event) => event.type === 'session.exited'),
      ).toBe(true);
      const count = events.length;
      db.close();
      databaseClosed = true;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(events).toHaveLength(count);
      await expect(
        manager.start({
          agentId: agent.id,
          cwd: '/tmp',
          threadId: null,
          resumeSessionId: null,
          profileId: null,
          launch: null,
        }),
      ).rejects.toThrow(/shutting down/);
    } finally {
      await manager.closeAll();
      if (!databaseClosed) db.close();
    }
  },
);

it('closes a process whose handshake is still starting', async () => {
  const rows = new Map<string, string>();
  const store = {
    read: (key: string) => rows.get(key),
    write: (key: string, value: string) => {
      rows.set(key, value);
    },
  };
  const manager = new AgentManager({
    emit() {},
    threads: new AgentThreads(store),
    rules: new PermissionRules(store),
    resolveProfile: () => null,
    resolveAgent: () => ({
      id: 'starting',
      label: 'Starting',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {},1000)'],
    }),
  });
  const starting = manager.start({
    agentId: 'starting',
    cwd: '/tmp',
    threadId: null,
    resumeSessionId: null,
    profileId: null,
    launch: null,
  });
  const rejected = expect(starting).rejects.toThrow();
  await manager.closeAll();
  await rejected;
  expect(manager.list()).toEqual([]);
});
