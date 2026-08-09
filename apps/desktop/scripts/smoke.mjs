import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';

import electronPath from 'electron';

const entry = resolve('out/main/index.js');

if (!existsSync(entry)) {
  throw new Error('Desktop build is missing. Run the build before the smoke test.');
}

const child = spawn(electronPath, [entry], {
  env: { ...process.env, ZERO_SMOKE_TEST: '1' },
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
}, 20_000);

child.on('exit', (code) => {
  clearTimeout(timeout);
  if (code !== 0 || !output.includes('desktop.smoke_ready')) {
    process.stderr.write(output);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Electron desktop smoke test passed.\n');
});
