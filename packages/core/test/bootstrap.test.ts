import { createCorrelationId } from '@builderhelm/shared';
import { describe, expect, it } from 'vitest';

import { bootstrapCore, MemorySecretStore } from '../src/index.js';

describe('core bootstrap', () => {
  it('migrates an in-memory database and reports ready health', () => {
    const logs: string[] = [];
    const runtime = bootstrapCore({
      databasePath: ':memory:',
      secretStore: new MemorySecretStore(),
      logSink: (line) => logs.push(line),
    });
    const correlationId = createCorrelationId();

    expect(runtime.health(correlationId)).toMatchObject({
      status: 'ok',
      database: 'ready',
      correlationId,
    });
    expect(logs.join('\n')).not.toContain(':memory:');

    runtime.close();
    expect(logs.map((line) => JSON.parse(line).event)).toEqual([
      'core.started',
      'core.stopped',
    ]);
  });
});
