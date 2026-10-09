import {
  migrations,
  openDatabase,
  runMigrations,
  SettingsRepository,
} from '@builderhelm/db';
import {
  agentThreadSchema,
  type AgentProfile,
  type AgentSessionEvent,
} from '@builderhelm/protocol';
import { expect, it } from 'vitest';
import { AgentManager } from '../src/main/acp/manager.js';
import { AgentThreads } from '../src/main/acp/threads.js';
import { PermissionRules } from '../src/main/acp/permission-rules.js';

const fixture = `
const readline=require('node:readline');
const send=v=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...v})+'\\n');
let model='default',mode='safe',effort='low';
const choices=values=>values.map(value=>({value,name:value}));
const options=()=>[
 {id:'mode',name:'Mode',category:'mode',currentValue:mode,options:choices(['safe','plan'])},
 {id:'effort',name:'Effort',category:'thought_level',currentValue:effort,options:choices(model==='chosen'?['low','high']:['low'])},
 {id:'model',name:'Model',category:'model',currentValue:model,options:choices(process.env.BH_MISSING_MODEL?['default']:['default','chosen'])}
];
readline.createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line),p=r.params;
 if(r.method==='initialize') send({id:r.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});
 if(r.method==='session/new'||r.method==='session/load') send({id:r.id,result:{sessionId:'context',configOptions:options()}});
 if(r.method==='session/set_config_option') {
  if(!process.env.BH_IGNORE_SELECTION) {
   if(p.configId==='model'){model=p.value;effort='low';}
   if(p.configId==='mode')mode=p.value;
   if(p.configId==='effort')effort=p.value;
  }
  send({id:r.id,result:{configOptions:options()}});
 }
 if(r.method==='session/prompt'){
  send({method:'session/update',params:{sessionId:'context',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify(p.prompt)}}}});
  send({id:r.id,result:{stopReason:'end_turn'}});
 }
});
`;

it('snapshots profile instructions and restores model, mode, and dependent effort across host restart', async () => {
  const db = openDatabase(':memory:');
  runMigrations(db, migrations);
  const settings = new SettingsRepository(db),
    threads = new AgentThreads(settings);
  const events: AgentSessionEvent[] = [];
  const agent = {
    id: 'fixture',
    label: 'Fixture',
    command: process.execPath,
    args: ['-e', fixture],
  };
  let profile: AgentProfile | null = {
    id: 'profile-fixture',
    name: 'Fixture',
    mark: 'diamond',
    agent,
    defaultCwd: '/tmp',
    launch: null,
    instructions: 'Reply with PROFILE_SENTINEL_41.',
    createdAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
  };
  const make = (env: Record<string, string> = {}) =>
    new AgentManager({
      threads,
      rules: new PermissionRules(settings),
      emit: (event) => events.push(event),
      resolveAgent: () => agent,
      resolveProfile: () => profile,
      resolveLaunch: () => ({ accountRef: null, env }),
    });
  const start = {
    agentId: agent.id,
    cwd: '/tmp',
    threadId: null,
    resumeSessionId: null,
    profileId: profile.id,
    launch: null,
  };
  const first = make();
  let resumed: AgentManager | undefined;
  try {
    const session = await first.start(start);
    await first.setConfigOption(session.sessionId, 'model', 'chosen');
    await first.setConfigOption(session.sessionId, 'mode', 'plan');
    await first.setConfigOption(session.sessionId, 'effort', 'high');
    await first.prompt(session.sessionId, [
      { type: 'text', text: 'What is the passphrase?' },
    ]);
    expect(events.find((event) => event.type === 'message.delta')).toMatchObject({
      text: expect.stringContaining('PROFILE_SENTINEL_41'),
    });
    expect(events.find((event) => event.type === 'message.user')).toMatchObject({
      text: 'What is the passphrase?',
    });
    expect(
      agentThreadSchema.safeParse(threads.get(session.threadId)?.thread).success,
    ).toBe(true);
    await first.closeAll();
    profile = null;
    resumed = make();
    const restored = await resumed.start({ ...start, threadId: session.threadId });
    expect(restored.configOptions.map((option) => [option.id, option.value])).toEqual([
      ['mode', 'plan'],
      ['effort', 'high'],
      ['model', 'chosen'],
    ]);
    await resumed.prompt(restored.sessionId, [{ type: 'text', text: 'Again?' }]);
    expect(events.filter((event) => event.type === 'message.delta').at(-1)).toMatchObject(
      { text: expect.stringContaining('PROFILE_SENTINEL_41') },
    );
    await resumed.closeAll();
    resumed = make({ BH_MISSING_MODEL: '1' });
    await expect(resumed.start({ ...start, threadId: session.threadId })).rejects.toThrow(
      /no longer available/,
    );
    expect(resumed.list()).toEqual([]);
    expect(
      threads
        .context(session.threadId)
        .configOptions.find((option) => option.id === 'model')?.value,
    ).toBe('chosen');
    await resumed.closeAll();
    resumed = make({ BH_IGNORE_SELECTION: '1' });
    await expect(resumed.start({ ...start, threadId: session.threadId })).rejects.toThrow(
      /did not apply/,
    );
    expect(resumed.list()).toEqual([]);
  } finally {
    await first.closeAll();
    await resumed?.closeAll();
    db.close();
  }
});
