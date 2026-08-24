import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ptyRoot = dirname(require.resolve('node-pty/package.json'));
const release = join(ptyRoot, 'build', 'Release');
const helper = join(release, 'spawn-helper');
if (existsSync(helper)) process.exit(0);

const pre = join(ptyRoot, 'prebuilds', `${process.platform}-${process.arch}`);
const srcHelper = join(pre, 'spawn-helper');
const srcPty = join(pre, 'pty.node');
if (!existsSync(srcHelper) || !existsSync(srcPty)) process.exit(0);

mkdirSync(release, { recursive: true });
copyFileSync(srcHelper, helper);
copyFileSync(srcPty, join(release, 'pty.node'));
chmodSync(helper, 0o755);
chmodSync(join(release, 'pty.node'), 0o755);
