import { describe, expect, it } from 'vitest';

import {
  defaultShell,
  executableCandidates,
  isFilesystemRoot,
  pathFromEnv,
} from '../src/platform/host-paths.js';

describe('host paths', () => {
  it('reads Windows Path case-insensitively and expands PATHEXT', () => {
    expect(pathFromEnv({ Path: 'C:\\Windows;C:\\Tools' }, 'win32')).toBe(
      'C:\\Windows;C:\\Tools',
    );
    expect(pathFromEnv({ PATH: '/usr/bin:/bin' }, 'linux')).toBe('/usr/bin:/bin');
    expect(executableCandidates('git', 'win32', '.EXE;.CMD')).toEqual([
      'git.EXE',
      'git.CMD',
    ]);
    expect(executableCandidates('git.exe', 'win32', '.EXE')).toEqual(['git.exe']);
    expect(executableCandidates('git', 'darwin')).toEqual(['git']);
  });

  it('identifies volume roots and never treats a home path as one', () => {
    expect(isFilesystemRoot('C:\\', 'win32')).toBe(true);
    expect(isFilesystemRoot('C:/', 'win32')).toBe(false);
    expect(isFilesystemRoot('/', 'linux')).toBe(true);
    expect(isFilesystemRoot('/Users/builder', 'darwin')).toBe(false);
    expect(isFilesystemRoot('C:\\Users\\builder', 'win32')).toBe(false);
  });

  it('picks cmd.exe on Windows and a real unix shell otherwise', () => {
    expect(defaultShell('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' })).toEqual({
      binary: 'C:\\Windows\\System32\\cmd.exe',
      args: [],
    });
    const unix = defaultShell('linux', { SHELL: '/bin/bash' });
    expect(unix.args).toEqual(['-i']);
    expect(unix.binary.length).toBeGreaterThan(0);
  });
});
