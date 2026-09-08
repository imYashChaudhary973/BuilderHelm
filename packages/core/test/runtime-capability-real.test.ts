import { describe, expect, it } from 'vitest';

import { RuntimeCapabilityService } from '../src/runtimes/runtime-capability-service.js';
import {
  BOARD_AGENT_CATALOG,
  type RuntimeTransportDeclaration,
} from '@builderhelm/protocol';

/**
 * Manual evidence run against the real machine, following the same gate as
 * the installed-CLI smoke: BUILDERHELM_CLI_SMOKE=1 pnpm vitest run
 * packages/core/test/runtime-capability-real.test.ts
 *
 * It pins the honest end of the contract: nothing absent may claim presence,
 * and the orchestrations that the real smoke proves stay orchestration-ready.
 */
const declarations: RuntimeTransportDeclaration[] = BOARD_AGENT_CATALOG.filter(
  (entry) => entry.command.length > 0,
).map((entry) => ({
  id: entry.id,
  label: entry.label,
  transport: 'pty' as const,
  command: entry.command,
  args: [],
  verified: entry.id === 'claude' || entry.id === 'codex' ? 'orchestration-ready' : null,
  evidence: null,
  configured: false,
}));

describe.skipIf(process.env['BUILDERHELM_CLI_SMOKE'] !== '1')(
  'real runtime capability detection',
  () => {
    it('probes the actual machine and prints the matrix', async () => {
      const service = new RuntimeCapabilityService(declarations);
      const snapshot = await service.snapshot();

      for (const runtime of snapshot.runtimes) {
        console.log(
          `${runtime.id.padEnd(12)} ${runtime.tier.padEnd(20)} ${
            runtime.version ?? '-'
          }  ${runtime.path ?? '-'}`,
        );
      }

      for (const runtime of snapshot.runtimes) {
        if (runtime.tier === 'unavailable') {
          expect(runtime.path).toBeNull();
          expect(runtime.version).toBeNull();
        } else {
          expect(runtime.path).not.toBeNull();
        }
        if (runtime.id === 'claude' || runtime.id === 'codex') {
          expect(runtime.tier).toBe('orchestration-ready');
        }
      }
    });
  },
);
