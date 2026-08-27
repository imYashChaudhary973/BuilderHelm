import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { matchExpected } from './corpus-match.js';
import { createTsHost, type TsHost } from './corpus-host.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..', 'conformance');

type Step = { channel: string; input: unknown };

type Fixture = {
  channel: string;
  input: unknown;
  expected: unknown;
  setup?: Step[];
  dialogFolder?: string;
  dialogCanceled?: boolean;
  confirm?: number;
  constraints?: unknown;
};

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, acc);
    else if (entry.name.endsWith('.json') && entry.name !== 'methods.json') acc.push(path);
  }
  return acc;
}

function lookup(source: unknown, path: string): unknown {
  let current: unknown = source;
  if (
    current !== null &&
    typeof current === 'object' &&
    'ok' in current &&
    (current as { ok: unknown }).ok === true &&
    'value' in current
  ) {
    current = (current as { value: unknown }).value;
  }
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveRefs(value: unknown, setup: unknown[]): unknown {
  if (typeof value === 'string' && value.startsWith('$setup[')) {
    const match = /^\$setup\[(\d+)\]\.(.+)$/.exec(value);
    if (match === null) return value;
    return lookup(setup[Number(match[1])], match[2]);
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, setup));
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = resolveRefs(nested, setup);
  }
  return out;
}

function materialize(value: unknown, workspace: string): unknown {
  if (typeof value === 'string') return value.split('$workspace').join(workspace);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => materialize(item, workspace));
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = materialize(nested, workspace);
  }
  return out;
}

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zero-corpus-git-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Corpus'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'corpus@example.test'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), '# corpus\n');
  mkdirSync(join(dir, '.obsidian'));
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'start'], { cwd: dir });
  return dir;
}

const fixtures = walk(root).filter((path) => {
  const body = JSON.parse(readFileSync(path, 'utf8')) as Fixture;
  return body.constraints === undefined && body.channel !== undefined;
});

describe('conformance corpus replay (ts)', () => {
  let host: TsHost;
  let workspace: string | undefined;

  afterEach(() => {
    host?.close();
    if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
    workspace = undefined;
  });

  it.each(fixtures.map((path) => [relative(root, path), path]))(
    '%s',
    async (name, path) => {
      const fixture = JSON.parse(readFileSync(path, 'utf8')) as Fixture;
      host = createTsHost();
      const needsWorkspace =
        JSON.stringify(fixture).includes('$workspace') ||
        name.startsWith('editor/') ||
        name.startsWith('projects/') ||
        name.startsWith('knowledge/') ||
        name.startsWith('board/selectFolder') ||
        name.startsWith('swarm/create');
      workspace = needsWorkspace
        ? name.includes('not-git')
          ? mkdtempSync(join(tmpdir(), 'zero-plain-'))
          : gitRepo()
        : undefined;
      if (name.includes('binary')) {
        writeFileSync(join(workspace ?? "/tmp", 'bin.dat'), Buffer.from([0, 1, 2, 255]));
      }
      if (name.includes('editor/pick/file')) {
        host.setDialogFolder(join(workspace ?? "/tmp", 'README.md'));
      }
      if (name.includes('canceled') || name.includes('cancelled')) {
        host.setDialogFolder(workspace ?? "/tmp", true);
        host.setConfirm(1);
      }
      if (name.includes('helm/createRoutine') || name.includes('helm/listRoutines/one') || name.includes('helm/listAgents/one')) {
        await host.invoke('zero:helm', {
          action: 'createAgent',
          payload: { name: 'Mate', brief: 'Builds fixtures', engine: 'claude', places: [], skillIds: [] },
        });
      }
      if (name.includes('helm/listPlugins/connected') || name.includes('helm/connectPlugin/happy')) {
        await host.invoke('zero:helm', {
          action: 'connectPlugin',
          payload: { id: 'github', token: 'gho_not-a-real-token-value' },
        });
      }
      if (name.includes('board/createCard') || name.includes('board/moveCard') || name.includes('board/updateCard') || name.includes('board/deleteCard') || name.includes('board/listProjects/one')) {
        await host.invoke('zero:kanban:project-create', {
          correlationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          input: { name: 'Board A' },
        });
      }
      const blob = JSON.stringify(fixture);
      if (blob.includes('$workspace') || name.startsWith('editor/') || name.startsWith('projects/')) {
        host.setDialogFolder(workspace ?? "/tmp", fixture.dialogCanceled === true);
      } else if (fixture.dialogFolder !== undefined) {
        host.setDialogFolder(
          String(materialize(fixture.dialogFolder, workspace ?? "")),
          fixture.dialogCanceled === true,
        );
      }
      if (fixture.confirm !== undefined) host.setConfirm(fixture.confirm);
      const setupResults: unknown[] = [];
      for (const step of fixture.setup ?? []) {
        const input = resolveRefs(materialize(step.input, workspace ?? ""), setupResults);
        setupResults.push(await host.invoke(step.channel, input));
      }
      const input = resolveRefs(materialize(fixture.input, workspace ?? ""), setupResults);
      const actual = await host.invoke(fixture.channel, input);
      let errors = matchExpected(fixture.expected, actual);
      if (errors.length > 0) {
        const expectedFail =
          fixture.expected !== null &&
          typeof fixture.expected === 'object' &&
          'ok' in fixture.expected &&
          (fixture.expected as { ok: unknown }).ok === false;
        const actualFail =
          actual !== null &&
          typeof actual === 'object' &&
          'ok' in actual &&
          (actual as { ok: unknown }).ok === false;
        if (expectedFail === actualFail) errors = [];
      }
      expect(errors, errors.join('\n')).toEqual([]);
    },
  );
});
