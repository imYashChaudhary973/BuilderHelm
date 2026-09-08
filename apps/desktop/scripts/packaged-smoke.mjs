import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appPath = resolve(desktopRoot, 'dist/mac-arm64/BuilderHelm.app');
const macosBinary = join(appPath, 'Contents/MacOS/BuilderHelm');
const resources = join(appPath, 'Contents/Resources');
const notices = join(resources, 'THIRD_PARTY_NOTICES.txt');
const asar = join(resources, 'app.asar');
const unpacked = join(resources, 'app.asar.unpacked');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  fail(
    `Packaged smoke is macOS arm64 only. This host is ${process.platform}/${process.arch}. Windows and Linux packages are not exercised.`,
  );
}

if (!existsSync(macosBinary) || !existsSync(asar) || !existsSync(notices)) {
  fail('Packaged app is missing. Run pnpm dist first (unsigned macOS arm64 dir target).');
}

function containsNative(directory) {
  if (!existsSync(directory)) return false;
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        stack.push(path);
        continue;
      }
      if (entry.endsWith('.node') || entry === 'spawn-helper') return true;
    }
  }
  return false;
}

if (!containsNative(unpacked)) {
  fail('Packaged app is missing unpacked native modules (node-pty / keyring).');
}

const child = spawn(macosBinary, [], {
  env: { ...process.env, BUILDERHELM_SMOKE_TEST: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString();
});

const timeout = setTimeout(() => {
  child.kill('SIGTERM');
  setTimeout(() => {
    if (child.exitCode === null && child.pid !== undefined) {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }, 2_000);
}, 40_000);

child.on('exit', () => {
  clearTimeout(timeout);
  if (!output.includes('desktop.smoke_ready')) {
    process.stderr.write(output);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Packaged macOS arm64 smoke test passed.\n');
});
