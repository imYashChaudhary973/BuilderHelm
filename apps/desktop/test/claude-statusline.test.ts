import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loginTerminalScript } from '../src/main/login-script.js';
import {
  installClaudeStatusLine,
  uninstallClaudeStatusLine,
} from '../src/main/quota-ingest.js';

const folders: string[] = [];
const SCRIPT = '/Users/x/Library/Application Support/BuilderHelm/claude-statusline.sh';
const MINE = { type: 'command', command: '~/bin/my-statusline' };
const REF = 'claude:system';
const OURS = { type: 'command', command: `"${SCRIPT}" ${REF}` };

afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

function claudeFolder(settings: Record<string, unknown> | null): string {
  const folder = mkdtempSync(join(tmpdir(), 'claude-statusline-'));
  folders.push(folder);
  if (settings !== null) {
    writeFileSync(join(folder, 'settings.json'), JSON.stringify(settings));
  }
  return folder;
}

function read(folder: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(folder, 'settings.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('Claude statusLine hook', () => {
  it('leaves a statusLine BuilderHelm never installed alone on uninstall', () => {
    const folder = claudeFolder({ statusLine: MINE, theme: 'dark' });
    uninstallClaudeStatusLine(folder);
    expect(read(folder)).toEqual({ statusLine: MINE, theme: 'dark' });
  });

  it('keeps the original statusLine across repeated installs and restores it', () => {
    const folder = claudeFolder({ statusLine: MINE });
    installClaudeStatusLine(folder, SCRIPT, REF);
    // Every launch installs again; the second must not stash our own script.
    installClaudeStatusLine(folder, SCRIPT, REF);
    expect(read(folder).statusLine).toEqual(OURS);
    uninstallClaudeStatusLine(folder);
    expect(read(folder)).toEqual({ statusLine: MINE });
  });

  it('removes only its own statusLine when there was none before', () => {
    const folder = claudeFolder({ theme: 'dark' });
    installClaudeStatusLine(folder, SCRIPT, REF);
    uninstallClaudeStatusLine(folder);
    expect(read(folder)).toEqual({ theme: 'dark' });
  });

  it('upgrades a hook from before logins were named without losing the stash', () => {
    const folder = claudeFolder({
      statusLine: { type: 'command', command: `"${SCRIPT}"` },
      'x-builderhelm-statusline-stash': { previous: MINE },
    });
    installClaudeStatusLine(folder, SCRIPT, REF);
    expect(read(folder).statusLine).toEqual(OURS);
    uninstallClaudeStatusLine(folder);
    expect(read(folder)).toEqual({ statusLine: MINE });
  });

  it('refuses an account ref that could break out of the command', () => {
    const folder = claudeFolder({ statusLine: MINE });
    installClaudeStatusLine(folder, SCRIPT, 'claude:x; rm -rf ~');
    expect(read(folder)).toEqual({ statusLine: MINE });
  });
});

describe('loginTerminalScript', () => {
  it('keeps a hostile folder name inside both the shell and AppleScript strings', () => {
    const script = loginTerminalScript(
      'CLAUDE_CONFIG_DIR',
      `/tmp/a'b"c\\d; rm -rf ~`,
      'claude auth login',
    );
    expect(script).toBe(
      `tell application "Terminal" to do script "CLAUDE_CONFIG_DIR='/tmp/a'\\\\''b\\"c\\\\d; rm -rf ~' claude auth login"`,
    );
  });
});
