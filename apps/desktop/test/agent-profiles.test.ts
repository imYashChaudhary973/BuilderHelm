import { describe, expect, it } from 'vitest';

import { AgentProfiles } from '../src/main/acp/profiles.js';

function memoryStore(): {
  read(key: string): string | undefined;
  write(key: string, valueJson: string, updatedAt: string): void;
} {
  const rows = new Map<string, string>();
  return {
    read: (key) => rows.get(key),
    write: (key, valueJson) => {
      rows.set(key, valueJson);
    },
  };
}

const input = {
  name: 'Social Content Manager',
  mark: 'diamond',
  agent: { id: 'codex', label: 'Codex', command: 'codex-acp', args: [] },
  defaultCwd: '/tmp/roster',
} as const;

describe('agent profiles', () => {
  it('creates a namespaced profile and reads it back', () => {
    const profiles = new AgentProfiles(memoryStore());
    const created = profiles.upsert(input);

    expect(created.id).toMatch(/^profile-[0-9a-f-]{36}$/);
    expect(profiles.list()).toHaveLength(1);
    expect(profiles.find(created.id)?.name).toBe('Social Content Manager');
  });

  it('updates in place, keeping the id and createdAt', () => {
    const profiles = new AgentProfiles(memoryStore());
    const created = profiles.upsert(input);
    const updated = profiles.upsert({
      ...input,
      id: created.id,
      name: 'BuilderHelm Merch',
      mark: 'star',
    });

    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.name).toBe('BuilderHelm Merch');
    expect(profiles.list()).toHaveLength(1);
  });

  it('rejects an update to a profile that does not exist', () => {
    const profiles = new AgentProfiles(memoryStore());
    expect(() =>
      profiles.upsert({ ...input, id: 'profile-00000000-0000-4000-8000-000000000000' }),
    ).toThrowError(/not found/);
  });

  it('carries the launch selection and keeps profiles without one parsing', () => {
    const store = memoryStore();
    const profiles = new AgentProfiles(store);
    const withLaunch = profiles.upsert({
      ...input,
      launch: { model: 'claude-sonnet-4-5', effort: null, accountRef: 'work' },
    });
    expect(withLaunch.launch).toEqual({
      model: 'claude-sonnet-4-5',
      effort: null,
      accountRef: 'work',
    });

    // An update that does not mention launch preserves the stored selection.
    const renamed = profiles.upsert({ ...input, id: withLaunch.id, name: 'Renamed' });
    expect(renamed.launch).toMatchObject({ model: 'claude-sonnet-4-5' });

    // A stored profile from before the field existed still parses, with no
    // selection invented: null across the board.
    const legacy = profiles.upsert({ ...input, name: 'Legacy' });
    const raw = JSON.parse(store.read('agent.profiles') ?? '[]') as {
      name: string;
      launch?: unknown;
    }[];
    for (const row of raw) if (row.name === 'Legacy') delete row.launch;
    store.write('agent.profiles', JSON.stringify(raw), new Date().toISOString());
    const reread = new AgentProfiles(store);
    expect(reread.find(legacy.id)?.launch).toBeNull();
  });

  it('removes a profile and keeps its threads readable afterwards', () => {
    const profiles = new AgentProfiles(memoryStore());
    const created = profiles.upsert(input);
    profiles.remove(created.id);

    expect(profiles.list()).toHaveLength(0);
    expect(profiles.find(created.id)).toBeNull();
  });

  it('refuses a relative project folder and a blank name', () => {
    const profiles = new AgentProfiles(memoryStore());
    expect(() =>
      profiles.upsert({ ...input, defaultCwd: 'roster/relative' }),
    ).toThrowError(/absolute/);
    expect(() => profiles.upsert({ ...input, name: '   ' })).toThrowError();
  });

  it('ignores an unreadable blob instead of failing the roster', () => {
    const store = memoryStore();
    store.write('agent.profiles', '{not json', '2026-09-07T00:00:00.000Z');
    expect(new AgentProfiles(store).list()).toHaveLength(0);
  });
});
