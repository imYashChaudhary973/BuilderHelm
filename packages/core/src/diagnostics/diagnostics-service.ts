import { redact } from '@builderhelm/observability';
import { utcNow } from '@builderhelm/shared';

/** Advertised Swarm builder cap. Do not raise without a measured 1/2/4/8 run. */
export const ADVERTISED_SWARM_BUILDER_CAP = 2 as const;

export interface DiagnosticBundle {
  readonly exportedAt: string;
  readonly platform: string;
  readonly arch: string;
  readonly node: string;
  readonly electron: string | null;
  readonly schemaVersion: number;
  readonly swarmBuilderCap: typeof ADVERTISED_SWARM_BUILDER_CAP;
  readonly logs: readonly unknown[];
}

export function buildDiagnostics(input: {
  readonly schemaVersion: number;
  readonly logs: readonly unknown[];
}): DiagnosticBundle {
  return redact({
    exportedAt: utcNow(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    electron: process.versions.electron ?? null,
    schemaVersion: input.schemaVersion,
    swarmBuilderCap: ADVERTISED_SWARM_BUILDER_CAP,
    logs: input.logs,
  }) as DiagnosticBundle;
}
