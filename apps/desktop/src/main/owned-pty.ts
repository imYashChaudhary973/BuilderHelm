import { execFileSync } from 'node:child_process';
import type { IPty } from 'node-pty';

/** Capture descendants while the owned PTY is live; never match process names. */
export function stopOwnedPty(pty: IPty): void {
  if (Number.isInteger(pty.pid) && pty.pid > 1 && process.platform !== 'win32') {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,lstart='], {
      encoding: 'utf8',
      timeout: 2000,
      maxBuffer: 4 * 1024 * 1024,
    })
      .trim()
      .split('\n')
      .map((line) => {
        const fields = line.trim().split(/\s+/);
        return {
          pid: Number(fields[0]),
          parent: Number(fields[1]),
          started: fields.slice(2).join(' '),
        };
      });
    const owned = new Set([pty.pid]);
    const descendants: typeof rows = [];
    for (let changed = true; changed;) {
      changed = false;
      for (const row of rows)
        if (!owned.has(row.pid) && owned.has(row.parent)) {
          owned.add(row.pid);
          descendants.push(row);
          changed = true;
        }
    }
    for (const row of descendants.reverse()) {
      try {
        const started = execFileSync('ps', ['-p', String(row.pid), '-o', 'lstart='], {
          encoding: 'utf8',
          timeout: 1000,
        })
          .trim()
          .replace(/\s+/g, ' ');
        if (started === row.started) process.kill(row.pid, 'SIGKILL');
      } catch {
        /* The captured process already exited. Do not target a replacement. */
      }
    }
  }
  pty.kill();
}
