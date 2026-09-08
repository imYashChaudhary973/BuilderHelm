import { spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { killProcessTree } from '../src/platform/process-tree.js';

describe('process tree shutdown', () => {
  it('cancels 1, 2, 4, and 8 owned processes', async () => {
    const timings: Array<{ n: number; cancelMs: number }> = [];
    for (const n of [1, 2, 4, 8] as const) {
      const children = Array.from({ length: n }, () =>
        spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          stdio: 'ignore',
        }),
      );
      const started = performance.now();
      for (const child of children) {
        if (child.pid === undefined) throw new Error('child pid missing');
        killProcessTree(child.pid);
      }
      await Promise.all(
        children.map(
          (child) =>
            new Promise<void>((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error('child did not exit')),
                5_000,
              );
              child.on('exit', () => {
                clearTimeout(timer);
                resolve();
              });
            }),
        ),
      );
      timings.push({ n, cancelMs: Math.round(performance.now() - started) });
    }
    expect(timings.map((row) => row.n)).toEqual([1, 2, 4, 8]);
  }, 20_000);
});
