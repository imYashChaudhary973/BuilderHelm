import { execFile } from 'node:child_process';

import { resolveOnPath } from '../platform/host-paths.js';
import {
  RUNTIME_TIERS,
  runtimeSnapshotSchema,
  type RuntimeCapability,
  type RuntimeSnapshot,
  type RuntimeTier,
  type RuntimeTransportDeclaration,
} from '@builderhelm/protocol';

/** Ladder order used to keep the highest verified tier. */
const TIER_RANK = RUNTIME_TIERS.reduce(
  (rank, tier, index) => ({ ...rank, [tier]: index }),
  {} as Record<RuntimeTier, number>,
);

/** Version flags tried in order; first exit-0 answer wins. */
const VERSION_ARGV: readonly (readonly string[])[] = [['--version'], ['-v'], ['version']];

const PROBE_TIMEOUT_MS = 5_000;
const VERSION_MAX = 120;

export interface RuntimeProbeOptions {
  /** Resolve a command the way a shell would; tests inject a fake. */
  readonly resolve?: (command: string) => Promise<string | null>;
  /** Run the binary for a version string; tests inject a fake. */
  readonly runVersion?: (path: string, args: readonly string[]) => Promise<string | null>;
  readonly now?: () => string;
}

async function defaultResolve(command: string): Promise<string | null> {
  return resolveOnPath(command, process.env, process.platform);
}

function defaultRunVersion(
  path: string,
  args: readonly string[],
): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const child = execFile(
    path,
    [...args],
    { timeout: PROBE_TIMEOUT_MS, encoding: 'utf8' },
    (error, stdout) => {
      // A non-zero exit disqualifies that flag, not the runtime.
      resolve(error === null ? stdout : null);
    },
  );
  // Agent CLIs otherwise wait for optional piped context forever.
  child.stdin?.end();
  return promise;
}

function cleanVersion(stdout: string): string | null {
  const line = stdout
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  if (line === undefined || line.length === 0) return null;
  return line.slice(0, VERSION_MAX);
}

/**
 * Consolidated runtime capability detection: PATH resolution, version probing,
 * transport grouping, and tier derivation from the verification declarations
 * the host passes in. The service owns no vendor knowledge; honesty comes from
 * the declarations, presence comes from this machine.
 */
export class RuntimeCapabilityService {
  private readonly declarations: readonly RuntimeTransportDeclaration[];
  private readonly resolve: (command: string) => Promise<string | null>;
  private readonly runVersion: (
    path: string,
    args: readonly string[],
  ) => Promise<string | null>;
  private readonly now: () => string;

  constructor(
    declarations: readonly RuntimeTransportDeclaration[],
    options: RuntimeProbeOptions = {},
  ) {
    this.declarations = declarations;
    this.resolve = options.resolve ?? defaultResolve;
    this.runVersion = options.runVersion ?? defaultRunVersion;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async snapshot(): Promise<RuntimeSnapshot> {
    const checkedAt = this.now();
    const byId = new Map<string, RuntimeTransportDeclaration[]>();
    for (const declaration of this.declarations) {
      const existing = byId.get(declaration.id);
      if (existing === undefined) byId.set(declaration.id, [declaration]);
      else existing.push(declaration);
    }

    const runtimes = await Promise.all(
      [...byId.entries()].map(async ([, group]) => this.probeRuntime(group, checkedAt)),
    );
    runtimes.sort((a, b) => a.id.localeCompare(b.id));
    return runtimeSnapshotSchema.parse({ runtimes, checkedAt });
  }

  private async probeRuntime(
    group: readonly RuntimeTransportDeclaration[],
    checkedAt: string,
  ): Promise<RuntimeCapability> {
    const label = group[0]!.label;
    const detected = await Promise.all(
      group.map(async (declaration) => ({
        declaration,
        path: await this.resolve(declaration.command),
      })),
    );
    const available = detected.filter((entry) => entry.path !== null);
    const path = available[0]?.path ?? null;
    const version = path === null ? null : await this.probeVersion(path);

    const transports = [
      ...new Set(available.map((entry) => entry.declaration.transport)),
    ].sort();
    const verified = available
      .map((entry) => entry.declaration)
      .map((entry) => entry.verified)
      .filter((tier): tier is RuntimeTier => tier !== null);
    const tier = deriveTier(path !== null, verified);

    const missing = detected.filter(
      (entry) => entry.declaration.configured && entry.path === null,
    );
    const unverified = path !== null && verified.length === 0;
    let detail: string | null = null;
    const missingAcp = detected.find(
      (entry) => entry.declaration.transport === 'acp' && entry.path === null,
    );
    if (path === null && missing.length > 0) {
      detail = `Configured command "${missing[0]!.declaration.command}" no longer resolves on PATH.`;
    } else if (missingAcp !== undefined) {
      detail =
        `Structured chat needs ${basename(missingAcp.declaration.command)} on PATH. Install or configure your own ACP adapter, then reopen this view. ${transports.includes('pty') ? `${label} is available in Code terminals.` : ''}`.trim();
    } else if (unverified) {
      detail = `Detected ${basename(path!)} but no BuilderHelm-checked path has exercised it yet.`;
    }

    return {
      id: group[0]!.id,
      label,
      path,
      version,
      transports,
      tier,
      detail,
      checkedAt,
    };
  }

  private async probeVersion(path: string): Promise<string | null> {
    for (const args of VERSION_ARGV) {
      const stdout = await this.runVersion(path, args);
      const version = stdout === null ? null : cleanVersion(stdout);
      if (version !== null) return version;
    }
    return null;
  }
}

function basename(command: string): string {
  const index = command.lastIndexOf('/');
  return index === -1 ? command : command.slice(index + 1);
}

/**
 * The ladder: absent is unavailable; present without evidence is untested;
 * otherwise the strongest verified transport wins.
 */
export function deriveTier(
  present: boolean,
  verified: readonly RuntimeTier[],
): RuntimeTier {
  if (!present) return 'unavailable';
  let best: RuntimeTier = 'untested';
  for (const tier of verified) {
    if (TIER_RANK[tier] > TIER_RANK[best]) best = tier;
  }
  return best;
}
