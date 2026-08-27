#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLS, ROWS, SCROLLBACK, TERM, createTerm, snapshot, writeTerm } from './term.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '../../apps/desktop/package.json');
const require = createRequire(desktop);
const { spawn } = require('node-pty');

const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const ACKS = [
  { id: 'claude-trust', match: /I trust this folder/i, reply: '\r' },
  { id: 'codex-update', match: /Update available/i, reply: '3\r' },
  { id: 'workspace-trust', match: /trust this (workspace|directory)/i, reply: '\r' },
];
const FAILS = /session limit|usage limit|rate limit|not logged in|please (log|sign) in|invalid api key/i;

const WIDE = 'Print exactly this line and nothing else: 日本語 中文测试 한글 🚀 ✅';
const SCROLL =
  'Print the integers 1 through 1100, each on its own line. No markdown, no extra text.';

const SESSIONS = [
  { name: 'claude-colour', binary: 'claude', args: [], kind: 'tui' },
  { name: 'claude-cursor', binary: 'claude', args: [], kind: 'tui', keys: ['\x1b[B', '\x1b[C'] },
  { name: 'claude-resize', binary: 'claude', args: [], kind: 'tui', resize: { cols: 80, rows: 24 } },
  {
    name: 'claude-wide',
    binary: 'claude',
    args: ['-p', WIDE, '--permission-mode', 'dontAsk'],
    kind: 'print',
    until: /日本語/,
  },
  {
    name: 'claude-scrollback',
    binary: 'claude',
    args: ['-p', SCROLL, '--permission-mode', 'dontAsk'],
    kind: 'print',
    untilLength: 1001,
    timeoutMs: 180_000,
  },
  { name: 'codex-colour', binary: 'codex', args: [], kind: 'tui' },
  { name: 'codex-cursor', binary: 'codex', args: [], kind: 'tui', keys: ['\x1b[B', '\x1b[C'] },
  { name: 'codex-resize', binary: 'codex', args: [], kind: 'tui', resize: { cols: 80, rows: 24 } },
  {
    name: 'codex-wide',
    binary: 'codex',
    args: ['exec', '--sandbox', 'read-only', WIDE],
    kind: 'print',
  },
  {
    name: 'codex-scrollback',
    binary: 'codex',
    args: ['exec', '--sandbox', 'read-only', SCROLL],
    kind: 'print',
    timeoutMs: 180_000,
  },
  { name: 'grok-colour', binary: 'grok', args: [], kind: 'tui' },
  { name: 'grok-cursor', binary: 'grok', args: [], kind: 'tui', keys: ['\x1b[B', '\x1b[C'] },
  { name: 'grok-resize', binary: 'grok', args: [], kind: 'tui', resize: { cols: 80, rows: 24 } },
  {
    name: 'grok-wide',
    binary: 'grok',
    args: ['--permission-mode', 'dontAsk', WIDE],
    kind: 'print',
    until: /日本語/,
    timeoutMs: 180_000,
  },
  {
    name: 'grok-scrollback',
    binary: 'grok',
    args: ['--permission-mode', 'dontAsk', SCROLL],
    kind: 'print',
    untilLength: 1001,
    timeoutMs: 180_000,
  },
];

function visible(text) {
  return text.replace(ansi, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gitWorkdir() {
  const dir = mkdtempSync(join(tmpdir(), 'helm-pty-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'README.md'), 'pty capture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=corpus', '-c', 'user.email=corpus@example.test', 'commit', '-m', 'start'],
    { cwd: dir, stdio: 'ignore' },
  );
  return dir;
}

function envFor(cwd) {
  return {
    ...process.env,
    HOME: process.env.HOME ?? homedir(),
    USER: process.env.USER ?? '',
    LOGNAME: process.env.LOGNAME ?? process.env.USER ?? '',
    SHELL: '/bin/zsh',
    TERM,
    COLORTERM: 'truecolor',
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:${join(homedir(), '.grok/bin')}`,
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    PWD: cwd,
    NO_COLOR: '',
    FORCE_COLOR: '1',
  };
}

async function capture(session) {
  const cwd = gitWorkdir();
  const term = createTerm();
  const chunks = [];
  const steps = [];
  const acked = new Set();
  let text = '';
  let writes = Promise.resolve();
  let failed = false;
  let dataSeen = false;
  let resolveFirst;
  const firstData = new Promise((resolve) => {
    resolveFirst = resolve;
  });

  const pty = spawn(session.binary, session.args, {
    name: TERM,
    cols: COLS,
    rows: ROWS,
    cwd,
    env: envFor(cwd),
  });

  const byteLength = () => chunks.reduce((n, c) => n + c.length, 0);

  pty.onData((chunk) => {
    const buf = Buffer.from(chunk, 'utf8');
    chunks.push(buf);
    text += chunk;
    dataSeen = true;
    resolveFirst();
    writes = writes.then(() => writeTerm(term, chunk));
    const view = visible(text);
    if (FAILS.test(view)) {
      failed = true;
      console.error(`${session.name}: CLI failure in output`);
    }
    for (const ack of ACKS) {
      if (acked.has(ack.id) || !ack.match.test(view)) continue;
      acked.add(ack.id);
      pty.write(ack.reply);
    }
  });

  const exit = new Promise((resolve) => {
    pty.onExit(({ exitCode }) => resolve(exitCode));
  });


  await Promise.race([
    firstData,
    exit,
    sleep(session.kind === 'print' ? 45_000 : 12_000),
  ]);
  if (!dataSeen) throw new Error(`${session.name}: no PTY output`);
  await sleep(500);
  await writes;
  steps.push({ kind: 'snapshot', byteOffset: byteLength(), snapshot: snapshot(term) });

  if (session.keys !== undefined) {
    for (const key of session.keys) pty.write(key);
    await sleep(500);
    await writes;
    steps.push({ kind: 'snapshot', byteOffset: byteLength(), snapshot: snapshot(term) });
  }

  if (session.resize !== undefined) {
    steps.push({
      kind: 'resize',
      byteOffset: byteLength(),
      cols: session.resize.cols,
      rows: session.resize.rows,
    });
    pty.resize(session.resize.cols, session.resize.rows);
    term.resize(session.resize.cols, session.resize.rows);
    await sleep(800);
    await writes;
    steps.push({ kind: 'snapshot', byteOffset: byteLength(), snapshot: snapshot(term) });
  }

  if (session.kind === 'tui') {
    pty.write('\x03');
    const result = await Promise.race([exit, sleep(2000).then(() => 'timeout')]);
    if (result === 'timeout') {
      try {
        pty.kill();
      } catch {
        // already gone
      }
    }
  } else {
    const deadline = Date.now() + (session.timeoutMs ?? 90_000);
    while (Date.now() < deadline && !failed) {
      const ended = await Promise.race([
        exit.then(() => 'exit'),
        sleep(400).then(() => 'tick'),
      ]);
      await writes;
      if (ended === 'exit') break;
      if (
        session.untilLength !== undefined &&
        snapshot(term).length >= session.untilLength
      ) {
        await sleep(500);
        await writes;
        break;
      }
      if (
        session.until instanceof RegExp &&
        session.untilLength === undefined &&
        session.until.test(visible(text))
      ) {
        await sleep(1500);
        await writes;
        break;
      }
      if (session.until === undefined && session.untilLength === undefined) {
        break;
      }
    }
    try {
      pty.kill();
    } catch {
      // already gone
    }
  }
  await writes;
  steps.push({ kind: 'snapshot', byteOffset: byteLength(), snapshot: snapshot(term) });
  term.dispose();

  const raw = Buffer.concat(chunks);
  if (raw.length === 0) throw new Error(`${session.name}: empty raw`);
  writeFileSync(join(here, `${session.name}.raw`), raw);
  writeFileSync(
    join(here, `${session.name}.grid`),
    `${JSON.stringify(
      {
        term: TERM,
        cols: COLS,
        rows: ROWS,
        scrollback: SCROLLBACK,
        cli: session.binary,
        argv: session.args,
        steps,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `${session.name}: ${String(raw.length)} bytes, ${String(steps.length)} steps, cwd=${cwd}`,
  );
}

const wanted = new Set(process.argv.slice(2));
const list =
  wanted.size === 0 ? SESSIONS : SESSIONS.filter((session) => wanted.has(session.name));
if (list.length === 0) {
  console.error('no matching sessions');
  process.exit(1);
}
mkdirSync(here, { recursive: true });
for (const session of list) {
  await capture(session);
}
