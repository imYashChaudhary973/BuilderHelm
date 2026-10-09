import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { killProcessTree } from '../../../packages/core/src/platform/process-tree.ts';

const require = createRequire(import.meta.url);
const desktop = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const cli = resolve(dirname(require.resolve('electron-vite')), '../bin/electron-vite.js');
const dataDirectory = mkdtempSync(join(tmpdir(), 'builderhelm-local-'));
const env = {
  ...process.env,
  NODE_ENV: 'development',
  BUILDERHELM_LOCAL_DEVELOPMENT: '1',
  BUILDERHELM_DATABASE_PATH: join(dataDirectory, 'builderhelm.sqlite'),
};
for (const key of [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_RENDERER_URL',
  'ELECTRON_ENTRY',
  'ELECTRON_CLI_ARGS',
  'BUILDERHELM_SMOKE_TEST',
  'BUILDERHELM_DEBUG_PORT',
  'BUILDERHELM_PTY_PROBE',
  'REMOTE_DEBUGGING_PORT',
  'V8_INSPECTOR_PORT',
  'V8_INSPECTOR_BRK_PORT',
  'NO_SANDBOX',
]) {
  delete env[key];
}
process.stdout.write(`Local development data: ${dataDirectory}\n`);
const child = spawn(
  process.execPath,
  [cli, 'dev', '--', `--user-data-dir=${join(dataDirectory, 'userdata')}`],
  { cwd: desktop, env, detached: process.platform !== 'win32', stdio: 'inherit' },
);
const stop = () => {
  if (child.pid !== undefined) killProcessTree(child.pid);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.once('error', () => {
  process.stderr.write(
    'Local development could not start. Install dependencies with pnpm first.\n',
  );
  process.exitCode = 1;
});
child.once('exit', (code) => {
  // The renderer's helper processes and dev server belong to this child group.
  stop();
  process.exitCode = code ?? 0;
});
