import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type {
  SwarmTaskVerifier,
  SwarmVerifyInput,
  SwarmVerifyResult,
} from './swarm-service.js';

const execFileAsync = promisify(execFile);

/**
 * Workspace directories touched by a task, derived from its file ownership.
 * `packages/db/src/x.ts` -> `packages/db`; anything outside a workspace root
 * contributes nothing, so the caller falls back to a typecheck-only gate.
 */
export function workspaceTargetsForFiles(files: readonly string[]): string[] {
  const targets = new Set<string>();
  for (const file of files) {
    const parts = file.replace(/^\.\//, '').split('/');
    const [root, name] = parts;
    if (parts.length < 3) continue;
    if (root !== 'packages' && root !== 'apps') continue;
    if (name === undefined || name.length === 0) continue;
    targets.add(`${root}/${name}`);
  }
  return [...targets].sort();
}

export interface PnpmVerifierOptions {
  /** Install dependencies when the worktree has none. Worktrees start empty. */
  readonly install?: boolean;
  readonly typecheckTimeoutMs?: number;
  readonly testTimeoutMs?: number;
  readonly installTimeoutMs?: number;
}

/**
 * Default verify gate: typecheck the workspace, then run the test files of the
 * packages the task owns. Runs inside the seat worktree, so it validates the
 * work exactly as the agent left it.
 */
function readManifestScripts(manifestPath: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return new Set();
    const scripts = (parsed as { scripts?: unknown }).scripts;
    if (typeof scripts !== 'object' || scripts === null) return new Set();
    return new Set(Object.keys(scripts as Record<string, unknown>));
  } catch {
    return new Set();
  }
}

export class PnpmTaskVerifier implements SwarmTaskVerifier {
  constructor(private readonly options: PnpmVerifierOptions = {}) {}

  async verify(input: SwarmVerifyInput): Promise<SwarmVerifyResult> {
    const cwd = input.worktreePath;
    const manifestPath = join(cwd, 'package.json');
    if (!existsSync(manifestPath)) {
      return { ok: true, detail: 'no package manifest; nothing to verify' };
    }
    const scripts = readManifestScripts(manifestPath);
    const install = this.options.install ?? true;
    if (install && !existsSync(join(cwd, 'node_modules'))) {
      const installed = await this.run(
        ['install', '--prefer-offline'],
        cwd,
        this.options.installTimeoutMs ?? 600_000,
      );
      if (!installed.ok) {
        return { ok: false, detail: `pnpm install failed: ${installed.detail}` };
      }
    }

    if (scripts.has('typecheck')) {
      const typecheck = await this.run(
        ['typecheck'],
        cwd,
        this.options.typecheckTimeoutMs ?? 300_000,
      );
      if (!typecheck.ok) {
        return { ok: false, detail: `typecheck failed: ${typecheck.detail}` };
      }
    }

    const targets = workspaceTargetsForFiles(input.task.files);
    if (targets.length === 0 || !scripts.has('test')) {
      return { ok: true, detail: 'available checks passed' };
    }
    const tests = await this.run(
      ['exec', 'vitest', 'run', ...targets],
      cwd,
      this.options.testTimeoutMs ?? 600_000,
    );
    if (!tests.ok) {
      return { ok: false, detail: `tests failed: ${tests.detail}` };
    }
    return { ok: true, detail: `typecheck and tests passed for ${targets.join(', ')}` };
  }

  private async run(
    args: readonly string[],
    cwd: string,
    timeout: number,
  ): Promise<SwarmVerifyResult> {
    try {
      await execFileAsync('pnpm', [...args], { cwd, timeout });
      return { ok: true, detail: '' };
    } catch (error) {
      const output =
        typeof error === 'object' && error !== null && 'stdout' in error
          ? String((error as { stdout?: unknown }).stdout ?? '')
          : '';
      const tail = output.trim().split('\n').slice(-8).join('\n');
      return { ok: false, detail: tail.length > 0 ? tail : 'no output' };
    }
  }
}
