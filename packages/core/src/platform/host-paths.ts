import { existsSync } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';

export function pathFromEnv(env: NodeJS.ProcessEnv, platform: string): string {
  if (platform !== 'win32') return env.PATH ?? '';
  const key = Object.keys(env).find((name) => name.toLowerCase() === 'path');
  return key === undefined ? '' : (env[key] ?? '');
}

export function pathEntries(env: NodeJS.ProcessEnv, platform: string): string[] {
  const separator = platform === 'win32' ? ';' : ':';
  return pathFromEnv(env, platform)
    .split(separator)
    .filter((segment) => segment.length > 0);
}

export function executableCandidates(
  command: string,
  platform: string,
  pathext = '',
): string[] {
  if (platform !== 'win32') return [command];
  if (/\.[A-Za-z0-9]+$/.test(command)) return [command];
  const extensions = (pathext.length > 0 ? pathext : '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .filter((ext) => ext.length > 0);
  return extensions.map((ext) => `${command}${ext}`);
}

export async function resolveOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: string,
): Promise<string | null> {
  const names = executableCandidates(command, platform, env.PATHEXT);
  const mode = platform === 'win32' ? constants.F_OK : constants.X_OK;
  for (const directory of pathEntries(env, platform)) {
    for (const name of names) {
      const candidate = join(directory, name);
      try {
        await access(candidate, mode);
        return candidate;
      } catch {
        // Keep scanning PATH.
      }
    }
  }
  return null;
}

export function isFilesystemRoot(resolved: string, platform: string): boolean {
  if (platform === 'win32') return /^[A-Za-z]:\\?$/.test(resolved);
  return resolved === '/';
}

export function defaultShell(
  platform: string,
  env: NodeJS.ProcessEnv,
): { readonly binary: string; readonly args: readonly string[] } {
  if (platform === 'win32') {
    return {
      binary: env.ComSpec ?? env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe',
      args: [],
    };
  }
  if (typeof env.SHELL === 'string' && env.SHELL.length > 0 && existsSync(env.SHELL)) {
    return { binary: env.SHELL, args: ['-i'] };
  }
  if (existsSync('/bin/zsh')) return { binary: '/bin/zsh', args: ['-i'] };
  return { binary: '/bin/bash', args: ['-i'] };
}
