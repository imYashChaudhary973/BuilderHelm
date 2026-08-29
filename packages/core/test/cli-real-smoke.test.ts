import { describe, expect, it } from 'vitest';

import { callStructuredAgent } from '../src/swarm/cli-adapters.js';

const schema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
} as const;

describe.skipIf(process.env['BUILDERHELM_CLI_SMOKE'] !== '1')(
  'installed CLI structured-output smoke',
  () => {
    for (const agentId of ['claude', 'codex'] as const) {
      it(`${agentId} returns schema-constrained output`, async () => {
        await expect(
          callStructuredAgent(
            { agentId, cwd: process.cwd(), timeoutMs: 120_000 },
            'Return an object with ok set to true. Do not use tools.',
            schema,
          ),
        ).resolves.toEqual({ ok: true });
      }, 130_000);
    }
  },
);
