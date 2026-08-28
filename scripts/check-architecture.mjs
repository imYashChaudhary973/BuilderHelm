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
const staleTokens = [
  '@zero/',
  'ZERO_',
  'zero-os',
  'zero_metadata',
  'zero.provider',
  'zero-',
  'phase-zero',
  'window.zero',
];
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
      repoPath !== 'scripts/check-architecture.mjs' &&
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
