import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['.git', 'node_modules', 'out', 'dist', 'coverage']);
const forbiddenNames = new Set([
  'Cargo.lock',
  'Cargo.toml',
  'clippy.toml',
  'rustfmt.toml',
]);
const textExtensions = new Set([
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
// Stale product namespaces. Each token must be specific enough that ordinary
// prose cannot trip it: a bare 'zero-' also matches "zero-based" and
// "zero-width", so the retired identifiers are listed explicitly instead.
const staleTokens = [
  '@zero/',
  'ZERO_',
  'zero-os',
  'zero_metadata',
  'zero.provider',
  'zero.sqlite',
  'phase-zero',
  'phaseZero',
  'window.zero',
  // Retired IPC channel prefix; every channel moved to 'builderhelm:'. Bare so
  // single-quoted, double-quoted, and template literals are all caught.
  'zero:',
  // Retired exported identifiers from the pre-reset package namespace.
  'ZeroError',
  'ZeroErrorCode',
  'ZeroDatabase',
  'ZeroDesktopApi',
  'ZeroId',
];
// Files allowed to quote retired identifiers: this guard, which must list them,
// and the transition runbook, which must tell users what to clean up. Keep this
// set at exactly those two entries.
const tokenScanExempt = new Set(['scripts/check-architecture.mjs', 'docs/MIGRATION.md']);
const failures = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    const repoPath = relative(root, path);
    if (entry.isDirectory()) {
      if (entry.name === 'crates') failures.push(repoPath);
      else walk(path);
      continue;
    }
    if (forbiddenNames.has(entry.name) || entry.name.endsWith('.rs')) {
      failures.push(repoPath);
      continue;
    }
    if (
      !tokenScanExempt.has(repoPath) &&
      textExtensions.has(entry.name.slice(entry.name.lastIndexOf('.')))
    ) {
      const source = readFileSync(path, 'utf8');
      for (const token of staleTokens) {
        if (source.includes(token)) failures.push(`${repoPath}: stale ${token}`);
      }
    }
  }
}

walk(root);

if (failures.length > 0) {
  process.stderr.write(`Unsupported architecture artifacts:\n${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Architecture check passed: TypeScript platform only.\n');
}
