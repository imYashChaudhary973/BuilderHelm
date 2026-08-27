#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(root, 'methods.json'), 'utf8'));

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, acc);
    else if (entry.name.endsWith('.json') && entry.name !== 'methods.json') acc.push(path);
  }
  return acc;
}

function coverage(files) {
  const counts = {};
  const byMethod = {};
  for (const [ns, spec] of Object.entries(catalog)) {
    counts[ns] = 0;
    byMethod[ns] = {};
    for (const method of Object.keys(spec.methods)) byMethod[ns][method] = 0;
  }
  for (const file of files) {
    const rel = relative(root, file).split('/');
    const ns = rel[0];
    const method = rel[1];
    if (counts[ns] === undefined || byMethod[ns]?.[method] === undefined) continue;
    const fixture = JSON.parse(readFileSync(file, 'utf8'));
    if (fixture.constraints !== undefined) continue;
    counts[ns] += 1;
    byMethod[ns][method] += 1;
  }
  return { counts, byMethod };
}

function reportCoverage(files) {
  const { counts, byMethod } = coverage(files);
  const errors = [];
  let methods = 0;
  let covered = 0;
  for (const [ns, spec] of Object.entries(catalog)) {
    const methodNames = Object.keys(spec.methods);
    methods += methodNames.length;
    for (const method of methodNames) {
      const n = byMethod[ns][method];
      if (n > 0) covered += 1;
      else errors.push(`${ns}.${method}: 0 cases`);
    }
    if (counts[ns] < spec.min) {
      errors.push(`${ns}: ${String(counts[ns])} cases, min ${String(spec.min)}`);
    }
  }
  return { errors, methods, covered, counts };
}

const args = process.argv.slice(2);
const targetFlag = args.indexOf('--target');
const target = targetFlag >= 0 ? args[targetFlag + 1] : 'ts';
const files = walk(root);
const summary = reportCoverage(files);

console.log(
  `corpus: ${String(files.length)} files, ${String(summary.covered)}/${String(summary.methods)} methods`,
);
for (const [ns, n] of Object.entries(summary.counts)) {
  console.log(`  ${ns}: ${String(n)} (min ${String(catalog[ns].min)})`);
}

if (summary.errors.length > 0) {
  console.error(summary.errors.join('\n'));
  process.exit(1);
}

if (target === 'rust') {
  const bin = process.env.HELM_CONFORMANCE_BIN;
  if (bin === undefined) {
    console.error('rust target: set HELM_CONFORMANCE_BIN (Phase 1+)');
    process.exit(2);
  }
  const result = spawnSync(bin, ['--conformance', root], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

if (target !== 'ts') {
  console.error(`unknown target ${target}`);
  process.exit(2);
}

const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', 'apps/desktop/test/corpus-replay.test.ts'],
  { stdio: 'inherit', cwd: join(root, '..') },
);
process.exit(result.status ?? 1);
