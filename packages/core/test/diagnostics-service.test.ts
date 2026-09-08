import { describe, expect, it } from 'vitest';

import { createCorrelationId } from '@builderhelm/shared';

import { ADVERTISED_SWARM_BUILDER_CAP } from '../src/diagnostics/diagnostics-service.js';
import { bootstrapCore, MemorySecretStore } from '../src/index.js';

describe('diagnostics export', () => {
  it('redacts secrets and keeps the advertised builder cap at 2', () => {
    const runtime = bootstrapCore({
      databasePath: ':memory:',
      secretStore: new MemorySecretStore(),
    });
    runtime.logger.info({
      event: 'diagnostics.probe',
      correlationId: createCorrelationId(),
      data: { token: 'sk-secret-abcdefgh', apiKey: 'never-export' },
    });
    const bundle = runtime.diagnostics();
    const serialized = JSON.stringify(bundle);
    runtime.close();

    expect(bundle.swarmBuilderCap).toBe(ADVERTISED_SWARM_BUILDER_CAP);
    expect(bundle.swarmBuilderCap).toBe(2);
    expect(serialized).not.toContain('sk-secret-abcdefgh');
    expect(serialized).not.toContain('never-export');
    expect(serialized).toContain('[REDACTED]');
    expect(bundle.schemaVersion).toBeGreaterThan(0);
  });
});
