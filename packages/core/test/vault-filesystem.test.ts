import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readVaultMarkdown,
  readVaultSource,
  resolveVaultRoot,
  vaultMarkdownFingerprint,
} from '../src/knowledge/vault-filesystem.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixtureVault(): { root: string; outside: string } {
  const base = mkdtempSync(join(tmpdir(), 'zero-vault-'));
  directories.push(base);
  const root = join(base, 'My Vault');
  const outside = join(base, 'outside.md');
  mkdirSync(join(root, '.obsidian'), { recursive: true });
  mkdirSync(join(root, 'Projects'), { recursive: true });
  writeFileSync(join(root, 'Projects', 'Zero.md'), '# Zero\nPrivate notes.');
  writeFileSync(join(root, '.obsidian', 'workspace.json'), '{}');
  writeFileSync(outside, '# Outside\nMust not be indexed.');
  symlinkSync(outside, join(root, 'escaped.md'));
  return { root, outside };
}

describe('vault filesystem sandbox', () => {
  it('requires an Obsidian marker and ignores symlink escapes and config files', () => {
    const { root } = fixtureVault();
    expect(resolveVaultRoot(root)).toMatchObject({ name: 'My Vault' });
    expect(readVaultMarkdown(root).map((file) => file.relativePath)).toEqual([
      'Projects/Zero.md',
    ]);
  });

  it('denies direct traversal outside the selected vault', () => {
    const { root } = fixtureVault();
    expect(() => readVaultSource(root, '../outside.md')).toThrow('outside the vault');
  });

  it('changes its watch fingerprint when Markdown files change', () => {
    const { root } = fixtureVault();
    const before = vaultMarkdownFingerprint(root);
    writeFileSync(join(root, 'New.md'), '# New\nNew evidence.');
    expect(vaultMarkdownFingerprint(root)).not.toBe(before);
  });

  it('rejects ordinary folders that are not Obsidian vaults', () => {
    const base = mkdtempSync(join(tmpdir(), 'zero-folder-'));
    directories.push(base);
    expect(() => resolveVaultRoot(base)).toThrow('Select an Obsidian vault');
  });
});
