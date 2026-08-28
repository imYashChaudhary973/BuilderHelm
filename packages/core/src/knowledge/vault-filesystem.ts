import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { BuilderHelmError } from '@builderhelm/shared';

const maxNoteBytes = 2_000_000;
const maxNotes = 10_000;
const ignoredDirectories = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
  );
}

export function resolveVaultRoot(input: string): { rootPath: string; name: string } {
  let rootPath: string;
  try {
    rootPath = realpathSync.native(input);
  } catch (cause) {
    throw new BuilderHelmError('VALIDATION_FAILED', 'The selected vault is unavailable', {
      cause,
    });
  }
  if (!statSync(rootPath).isDirectory() || !existsSync(join(rootPath, '.obsidian'))) {
    throw new BuilderHelmError(
      'VALIDATION_FAILED',
      'Select an Obsidian vault containing a .obsidian directory',
    );
  }
  return { rootPath, name: basename(rootPath) };
}

export interface VaultMarkdownFile {
  readonly relativePath: string;
  readonly content: string;
  readonly modifiedAtMs: number;
  readonly sizeBytes: number;
}

interface VaultMarkdownMetadata {
  readonly relativePath: string;
  readonly resolvedPath: string;
  readonly modifiedAtMs: number;
  readonly sizeBytes: number;
}

function listVaultMarkdown(rootPath: string): VaultMarkdownMetadata[] {
  const trustedRoot = realpathSync.native(rootPath);
  const files: VaultMarkdownMetadata[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (files.length >= maxNotes) {
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          'The vault exceeds the note limit',
        );
      }
      if (ignoredDirectories.has(entry.name)) continue;
      const candidate = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(candidate);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLocaleLowerCase().endsWith('.md')) continue;
      const resolved = realpathSync.native(candidate);
      if (!inside(trustedRoot, resolved) || lstatSync(resolved).isSymbolicLink())
        continue;
      const stats = statSync(resolved);
      if (stats.size > maxNoteBytes) continue;
      files.push({
        relativePath: relative(trustedRoot, resolved).split(sep).join('/'),
        resolvedPath: resolved,
        modifiedAtMs: stats.mtimeMs,
        sizeBytes: stats.size,
      });
    }
  };
  walk(trustedRoot);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function readVaultMarkdown(rootPath: string): VaultMarkdownFile[] {
  return listVaultMarkdown(rootPath).flatMap((file) => {
    const buffer = readFileSync(file.resolvedPath);
    if (buffer.includes(0)) return [];
    return [
      {
        relativePath: file.relativePath,
        content: buffer.toString('utf8'),
        modifiedAtMs: file.modifiedAtMs,
        sizeBytes: file.sizeBytes,
      },
    ];
  });
}

export function vaultMarkdownFingerprint(rootPath: string): string {
  const hash = createHash('sha256');
  for (const file of listVaultMarkdown(rootPath)) {
    hash.update(file.relativePath);
    hash.update('\0');
    hash.update(String(file.modifiedAtMs));
    hash.update('\0');
    hash.update(String(file.sizeBytes));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function readVaultSource(rootPath: string, relativePath: string): string {
  const trustedRoot = realpathSync.native(rootPath);
  const candidate = resolve(trustedRoot, relativePath);
  let resolved: string;
  try {
    resolved = realpathSync.native(candidate);
  } catch (cause) {
    throw new BuilderHelmError('INTEGRATION_OFFLINE', 'The cited note is unavailable', {
      cause,
    });
  }
  if (!inside(trustedRoot, resolved) || !resolved.toLocaleLowerCase().endsWith('.md')) {
    throw new BuilderHelmError(
      'PERMISSION_DENIED',
      'The cited source is outside the vault',
    );
  }
  const stats = statSync(resolved);
  if (!stats.isFile() || stats.size > maxNoteBytes) {
    throw new BuilderHelmError('VALIDATION_FAILED', 'The cited note cannot be displayed');
  }
  return readFileSync(resolved, 'utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}
