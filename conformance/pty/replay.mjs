#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTerm, writeTerm, snapshot } from './term.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function sessions() {
  return readdirSync(here)
    .filter((name) => name.endsWith('.grid'))
    .map((name) => name.slice(0, -'.grid'.length));
}

function equal(a, b, path, errors) {
  if (a === b) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      errors.push(`${path}: length ${String(a.length)} != ${String(b.length)}`);
      return;
    }
    for (let i = 0; i < a.length; i++) equal(a[i], b[i], `${path}[${String(i)}]`, errors);
    return;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) equal(a[key], b[key], `${path}.${key}`, errors);
    return;
  }
  errors.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}

async function replayOne(name) {
  const grid = JSON.parse(readFileSync(join(here, `${name}.grid`), 'utf8'));
  const raw = readFileSync(join(here, `${name}.raw`));
  const term = createTerm(grid.cols, grid.rows);
  let offset = 0;
  const errors = [];
  for (const step of grid.steps) {
    if (step.byteOffset < offset) {
      errors.push(`step ${step.kind}: byteOffset went backwards`);
      continue;
    }
    if (step.byteOffset > offset) {
      await writeTerm(term, raw.subarray(offset, step.byteOffset));
      offset = step.byteOffset;
    }
    if (step.kind === 'resize') {
      term.resize(step.cols, step.rows);
    }
    if (step.snapshot !== undefined) {
      const actual = snapshot(term);
      equal(actual, step.snapshot, `${name}@${String(step.byteOffset)}`, errors);
    }
  }
  if (offset < raw.length) await writeTerm(term, raw.subarray(offset));
  term.dispose();
  return errors;
}

const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : sessions();
if (names.length === 0) {
  console.error('no .grid sessions in conformance/pty');
  process.exit(1);
}

let failed = 0;
for (const name of names) {
  const errors = await replayOne(name);
  if (errors.length === 0) {
    console.log(`ok ${name}`);
  } else {
    failed += 1;
    console.error(`fail ${name}`);
    for (const error of errors.slice(0, 12)) console.error(`  ${error}`);
    if (errors.length > 12) console.error(`  … ${String(errors.length - 12)} more`);
  }
}
console.log(`${String(names.length - failed)}/${String(names.length)} sessions`);
process.exit(failed === 0 ? 0 : 1);
