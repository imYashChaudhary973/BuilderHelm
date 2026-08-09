import { migrations, openDatabase, ProviderRepository, runMigrations } from '@zero/db';
import { createLogger } from '@zero/observability';
import { createCorrelationId } from '@zero/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemorySecretStore, ProviderService } from '../src/index.js';

const open = new Set<ReturnType<typeof openDatabase>>();

function setup(): {
  repository: ProviderRepository;
  secrets: MemorySecretStore;
  service: ProviderService;
  logs: string[];
} {
  const database = openDatabase(':memory:');
  open.add(database);
  runMigrations(database, migrations);
  const repository = new ProviderRepository(database);
  const secrets = new MemorySecretStore();
  const logs: string[] = [];
  return {
    repository,
    secrets,
    service: new ProviderService(
      repository,
      secrets,
      createLogger((line) => logs.push(line)),
    ),
    logs,
  };
}

const input = {
  label: 'Example',
  protocol: 'openai' as const,
  baseUrl: 'https://api.example.test/v1',
  headers: [],
  privacy: { allowPersonal: true, allowSensitive: false, allowHealth: false },
  enabled: true,
  apiKey: 'phase-one-secret-sentinel',
};

afterEach(() => {
  for (const database of open) database.close();
  open.clear();
  vi.restoreAllMocks();
});

describe('provider service', () => {
  it('creates, lists, updates, disables, and deletes without returning the credential', async () => {
    const { repository, secrets, service, logs } = setup();
    const created = await service.create(input, createCorrelationId());

    expect(created).toMatchObject({
      label: 'Example',
      hasCredential: true,
      enabled: true,
    });
    expect(JSON.stringify(created)).not.toContain(input.apiKey);
    expect(service.list()).toEqual([created]);

    const stored = repository.findById(created.id);
    expect(stored).toBeDefined();
    expect(await secrets.get(stored!.secretRef)).toBe(input.apiKey);

    const updated = await service.update(
      {
        ...input,
        id: created.id,
        label: 'Example 2',
        enabled: false,
        apiKey: 'replacement-sentinel',
      },
      createCorrelationId(),
    );
    expect(updated).toMatchObject({ label: 'Example 2', enabled: false });
    expect(await secrets.get(stored!.secretRef)).toBe('replacement-sentinel');

    await expect(service.delete(created.id, createCorrelationId())).resolves.toEqual({
      deleted: true,
    });
    expect(service.list()).toEqual([]);
    expect(await secrets.get(stored!.secretRef)).toBeNull();
    expect(repository.listAuditEvents().map((event) => event.eventType)).toEqual([
      'provider.created',
      'provider.updated',
      'provider.deleted',
    ]);
    expect(logs.join('\n')).not.toContain(input.apiKey);
    expect(logs.join('\n')).not.toContain('replacement-sentinel');
  });

  it('removes a newly written secret when the database create fails', async () => {
    const { repository, secrets, service } = setup();
    vi.spyOn(repository, 'create').mockImplementation(() => {
      throw new Error('simulated database failure');
    });

    await expect(service.create(input, createCorrelationId())).rejects.toMatchObject({
      code: 'DATABASE_FAILED',
    });
    expect(repository.list()).toEqual([]);
    expect(await secrets.get(`zero.provider.unavailable.api-key`)).toBeNull();
  });

  it('restores the previous secret when a database update fails', async () => {
    const { repository, secrets, service } = setup();
    const created = await service.create(input, createCorrelationId());
    const stored = repository.findById(created.id)!;
    vi.spyOn(repository, 'update').mockImplementation(() => {
      throw new Error('simulated database failure');
    });

    await expect(
      service.update(
        { ...input, id: created.id, apiKey: 'new-sentinel' },
        createCorrelationId(),
      ),
    ).rejects.toMatchObject({ code: 'DATABASE_FAILED' });
    expect(await secrets.get(stored.secretRef)).toBe(input.apiKey);
  });
});
