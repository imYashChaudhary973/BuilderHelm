import assert from 'node:assert/strict';
import { setTimeout, clearTimeout, setInterval, clearInterval } from 'node:timers';
import { log } from 'node:console';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { migrations } from '../../../packages/db/dist/migrations/index.js';

const entry = resolve('out/main/usage-worker.js');
if (!existsSync(entry))
  throw new Error('Build the desktop app before running smoke:usage.');
const root = mkdtempSync(join(tmpdir(), 'builderhelm-usage-smoke-'));
const databasePath = join(root, 'test.sqlite');
const sqlite = new DatabaseSync(databasePath);
sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 100;');
const database = {
  execute: (sql) => sqlite.exec(sql),
  run: (sql, values = []) => sqlite.prepare(sql).run(...values),
  queryAll: (sql, values = []) => sqlite.prepare(sql).all(...values),
  queryOne: (sql, values = []) => sqlite.prepare(sql).get(...values),
};
for (const migration of migrations) migration.up(database);
const line = (id, model = 'claude-opus-5-5') =>
  JSON.stringify({
    type: 'assistant',
    requestId: `r-${id}`,
    sessionId: 's',
    timestamp: new Date().toISOString(),
    message: {
      id,
      model,
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        speed: 'standard',
      },
    },
  }) + '\n';
const first = line('one');
const logins = ['a', 'copy'].map((name) => {
  const home = join(root, name);
  mkdirSync(join(home, 'projects'), { recursive: true });
  writeFileSync(join(home, 'projects', 's.jsonl'), first);
  return {
    provider: 'claude',
    accountRef: `claude:${name}`,
    label: name,
    root: home,
    identity: 'fixture-account',
  };
});
let worker;
function request() {
  const id = randomUUID();
  return new Promise((resolveMessage, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Usage worker did not finish')),
      20_000,
    );
    const done = (message) => {
      if (message.id !== id) return;
      clearTimeout(timeout);
      worker.off('error', fail);
      resolveMessage(message);
    };
    const fail = (error) => {
      clearTimeout(timeout);
      worker.off('message', done);
      reject(error);
    };
    worker.once('message', done);
    worker.once('error', fail);
    worker.postMessage({
      id,
      input: { range: 'all', environment: null, rescan: true },
      logins,
    });
  });
}
try {
  worker = new Worker(entry, { workerData: { databasePath } });
  let response = await request();
  assert.equal(response.ok, true);
  assert.equal(response.value.totals.tokens.total, 1200);
  assert.equal(response.value.totals.tokens.records, 1);
  appendFileSync(
    join(logins[0].root, 'projects', 's.jsonl'),
    line('two', 'unknown-fixture-model'),
  );
  response = await request();
  assert.equal(response.value.totals.tokens.records, 2);
  assert.equal(response.value.totals.cost.unpricedTokens, 1200);
  await worker.terminate();
  worker = new Worker(entry, { workerData: { databasePath } });
  response = await request();
  assert.equal(response.value.totals.tokens.records, 2);
  appendFileSync(
    join(logins[0].root, 'projects', 's.jsonl'),
    Array.from({ length: 1000 }, (_, index) => line(`stress-${index}`)).join(''),
  );
  let writes = 0;
  let writeError;
  const interval = setInterval(() => {
    try {
      sqlite
        .prepare("INSERT OR REPLACE INTO settings VALUES ('usage-smoke-write', ?, ?)")
        .run(JSON.stringify(writes++), new Date().toISOString());
    } catch (error) {
      writeError = error;
    }
  }, 2);
  try {
    response = await request();
  } finally {
    clearInterval(interval);
  }
  assert.equal(response.ok, true);
  assert.equal(response.value.totals.tokens.records, 1002);
  assert.equal(writeError, undefined);
  assert.ok(writes > 0);
  log(
    'Usage worker smoke passed: deduplication, incremental scans, restart, and concurrent SQLite writes.',
  );
} finally {
  if (worker !== undefined) await worker.terminate();
  sqlite.close();
  rmSync(root, { recursive: true, force: true });
}
