import { describe, expect, it } from 'vitest';
import { AcpConnection } from '../src/main/acp/connection.js';

it('keeps authentication errors actionable without persisting sensitive provider responses', async () => {
  const connection = new AcpConnection({
    command: process.execPath,
    args: [
      '-e',
      `process.stdin.on('data', (chunk) => { const request = JSON.parse(chunk.toString()); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'Unauthorized: secret-provider-cookie', data: { access_token: 'secret-provider-token' } } }) + '\\n'); });`,
    ],
    cwd: '/tmp',
    onExit() {},
    onTransportError() {},
  });
  try {
    const error = await connection
      .request('session/new', {})
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      message: expect.stringContaining('authentication required'),
    });
    expect(JSON.stringify(error)).not.toContain('secret-provider');
  } finally {
    await connection.close();
  }
});

describe('agent diagnostics', () => {
  it('does not forward raw stderr or malformed protocol data to the client', async () => {
    const errors: unknown[] = [];
    let exitMessage = '';
    const connection = new AcpConnection({
      command: process.execPath,
      args: [
        '-e',
        `process.stdout.write('secret-malformed-protocol\\n'); process.stderr.write('secret-provider-token'); setTimeout(() => process.exit(1), 20);`,
      ],
      cwd: '/tmp',
      onExit: (_code, message) => {
        exitMessage = message;
      },
      onTransportError: (error) => {
        errors.push(error);
      },
    });
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      expect(errors.length).toBeGreaterThan(0);
      expect(JSON.stringify(errors)).not.toContain('secret-malformed');
      expect(exitMessage).not.toContain('secret-provider');
      expect(exitMessage).toContain('diagnostics');
    } finally {
      await connection.close();
    }
  });
});

it('waits for forced exit and its final callback before close resolves', async () => {
  let exited = false;
  const connection = new AcpConnection({
    command: process.execPath,
    args: [
      '-e',
      `process.on('SIGTERM', () => {}); process.stdin.on('data', chunk => { const r = JSON.parse(chunk); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{}})+'\\n'); }); setInterval(() => {}, 1000);`,
    ],
    cwd: '/tmp',
    onExit: () => {
      exited = true;
    },
    onTransportError() {},
  });
  await connection.request('ready', {});
  await Promise.all([connection.close(20), connection.close(20)]);
  expect(exited).toBe(true);
});

it.skipIf(process.platform === 'win32')(
  'cleans an owned worker when its parent exits naturally',
  async () => {
    const connection = new AcpConnection({
      command: process.execPath,
      args: [
        '-e',
        `
      const {spawn}=require('node:child_process');
      const worker=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']});
      let ready=false,pending;
      const reply=r=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{pid:worker.pid}})+'\\n');
      worker.on('message',()=>{ready=true;if(pending)reply(pending)});
      process.stdin.on('data',chunk=>{const r=JSON.parse(chunk);if(r.method==='ready'){if(ready)reply(r);else pending=r;}else{reply(r);setTimeout(()=>process.exit(0),10)}});
    `,
      ],
      cwd: '/tmp',
      onExit() {},
      onTransportError() {},
    });
    try {
      const { pid } = (await connection.request('ready', {})) as { pid: number };
      await connection.request('finish', {});
      await expect
        .poll(() => {
          try {
            process.kill(pid, 0);
            return false;
          } catch {
            return true;
          }
        })
        .toBe(true);
    } finally {
      await connection.close();
    }
  },
);

it.each([
  ['quota exceeded with secret-provider-token', 'usage limit'],
  ['Unknown model secret-provider-token', 'model is unavailable'],
  ['Network error secret-provider-token', 'connection failed'],
  ['Unhandled secret-provider-token', 'local CLI'],
])(
  'classifies provider failures without exposing diagnostics: %s',
  async (message, hint) => {
    const connection = new AcpConnection({
      command: process.execPath,
      args: [
        '-e',
        `process.stdin.on('data',chunk => { const r=JSON.parse(chunk); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,error:{code:-32000,message:${JSON.stringify(message)},data:{access_token:'secret-provider-token'}}})+'\\n'); });`,
      ],
      cwd: '/tmp',
      onExit() {},
      onTransportError() {},
    });
    try {
      const error = await connection
        .request('session/prompt', {})
        .catch((error) => error);
      expect(error.message).toContain(hint);
      expect(JSON.stringify(error)).not.toContain('secret-provider');
    } finally {
      await connection.close();
    }
  },
);
