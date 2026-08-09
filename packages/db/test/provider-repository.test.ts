import { createCorrelationId, createId, utcNow } from '@zero/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  migrations,
  openDatabase,
  ProviderRepository,
  runMigrations,
  type ZeroDatabase,
} from '../src/index.js';

const databases: ZeroDatabase[] = [];

function setup(): { database: ZeroDatabase; repository: ProviderRepository } {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  return { database, repository: new ProviderRepository(database) };
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('provider repository', () => {
  it('persists provider metadata and append-only audit evidence without a secret value', () => {
    const { database, repository } = setup();
    const now = utcNow();
    const id = createId();
    const secretRef = `zero.provider.${id}.api-key`;
    repository.create(
      {
        id,
        label: 'Local test',
        protocol: 'openai',
        baseUrl: 'https://api.example.test/v1',
        secretRef,
        headersJson: '[]',
        allowPersonal: true,
        allowSensitive: false,
        allowHealth: false,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        ref: secretRef,
        providerId: id,
        service: 'test.keychain',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: createId(),
        eventType: 'provider.created',
        actorType: 'user',
        actorId: null,
        correlationId: createCorrelationId(),
        riskLevel: 'destructive_sensitive',
        resourceRefsJson: JSON.stringify([{ type: 'provider', id }]),
        beforeJson: null,
        afterJson: JSON.stringify({ id, hasCredential: true }),
        approvalId: null,
        createdAt: now,
      },
    );

    expect(repository.findById(id)).toMatchObject({ label: 'Local test', secretRef });
    expect(repository.listAuditEvents()).toHaveLength(1);
    expect(() =>
      database.run('UPDATE audit_events SET event_type = ?', ['tampered']),
    ).toThrow(/append-only/);
    expect(() => database.run('DELETE FROM audit_events')).toThrow(/append-only/);
  });

  it('enforces provider privacy flags and valid JSON at the database boundary', () => {
    const { database } = setup();
    expect(() =>
      database.run(
        `INSERT INTO providers (
          id, label, protocol, base_url, secret_ref, headers_json,
          allow_personal, allow_sensitive, allow_health, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          createId(),
          'Bad',
          'openai',
          null,
          'ref',
          'not-json',
          1,
          0,
          0,
          1,
          utcNow(),
          utcNow(),
        ],
      ),
    ).toThrow();
  });
});
