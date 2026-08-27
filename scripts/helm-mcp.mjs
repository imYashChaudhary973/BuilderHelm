#!/usr/bin/env node
/**
 * Local MCP: list BuilderHelm swarm tasks from SQLite.
 * ZERO_DATABASE_PATH must point at the desktop sqlite file.
 */
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

function tasks() {
  const db = process.env.ZERO_DATABASE_PATH;
  if (db === undefined || db.length === 0) {
    return { error: 'Set ZERO_DATABASE_PATH to the BuilderHelm sqlite file' };
  }
  const result = spawnSync(
    'sqlite3',
    ['-json', db, 'SELECT id, title, status FROM swarm_tasks ORDER BY created_at'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    return { error: result.stderr || 'sqlite3 failed' };
  }
  return { tasks: JSON.parse(result.stdout || '[]') };
}

function reply(id, result) {
  const body = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n${body}`);
}

const rl = createInterface({ input: process.stdin });
let buf = '';
rl.on('line', (line) => {
  buf += `${line}\n`;
  const match = buf.match(/\{[\s\S]*\}\s*$/);
  if (match === null) return;
  let msg;
  try {
    msg = JSON.parse(match[0]);
  } catch {
    return;
  }
  buf = '';
  if (msg.method === 'initialize') {
    reply(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'builderhelm', version: '0.0.0' },
    });
    return;
  }
  if (msg.method === 'tools/list') {
    reply(msg.id, {
      tools: [
        {
          name: 'list_tasks',
          description: 'List swarm tasks from the local BuilderHelm ledger',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    });
    return;
  }
  if (msg.method === 'tools/call' && msg.params?.name === 'list_tasks') {
    reply(msg.id, { content: [{ type: 'text', text: JSON.stringify(tasks()) }] });
  }
});
