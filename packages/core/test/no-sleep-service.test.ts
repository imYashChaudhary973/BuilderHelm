import type { BuilderHelmDatabase, SettingsRepository } from '@builderhelm/db';
import {
  migrations,
  openDatabase,
  runMigrations,
  SettingsRepository,
} from '@builderhelm/db';
import { afterAll, describe, expect, it } from 'vitest';

import { NoSleepService } from '../src/no-sleep/no-sleep-service.js';

interface ServiceHarness {
  readonly service: NoSleepService;
  readonly settings: SettingsRepository;
}

const databases: BuilderHelmDatabase[] = [];

const setup = (): ServiceHarness => {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  const settings = new SettingsRepository(database);
  return { service: new NoSleepService(settings), settings };
};

afterAll(() => {
  for (const database of databases) database.close();
});

describe('NoSleepService', () => {
  it('defaults to off with no blocker held', () => {
    const { service } = setup();
    expect(service.read()).toEqual({
      mode: 'off',
      blockerActive: false,
      agentActive: false,
    });
    expect(service.wantsBlocker()).toBe(false);
  });

  it('persists the mode across service instances', () => {
    const { service, settings } = setup();
    service.set('on', true);
    const rehydrated = new NoSleepService(settings);
    expect(rehydrated.mode()).toBe('on');
    expect(rehydrated.read(true)).toMatchObject({ mode: 'on', blockerActive: true });
  });

  it('falls back to off for corrupt JSON and invalid values', () => {
    const { service, settings } = setup();
    // The settings table rejects non-JSON at the CHECK constraint, so the
    // corrupt shape a hand edit can still produce is valid-JSON-wrong-value.
    settings.write('noSleep.mode', '"turbo"', '2026-09-02T00:00:00.000Z');
    expect(service.mode()).toBe('off');
    settings.write('noSleep.mode', 'null', '2026-09-02T00:00:00.000Z');
    expect(service.mode()).toBe('off');
  });

  it('wants a blocker for on always and for agent only while working', () => {
    const { service } = setup();
    service.set('on', false);
    expect(service.wantsBlocker()).toBe(true);
    service.set('agent', false);
    expect(service.wantsBlocker()).toBe(false);
    service.setAgentActive(true);
    expect(service.wantsBlocker()).toBe(true);
    service.setAgentActive(false);
    expect(service.wantsBlocker()).toBe(false);
  });

  it('reports the agentActive edge in set and read', () => {
    const { service } = setup();
    expect(service.setAgentActive(true)).toBe(true);
    expect(service.setAgentActive(true)).toBe(false);
    expect(service.read(true).agentActive).toBe(true);
    expect(service.set('agent', true)).toEqual({
      mode: 'agent',
      blockerActive: true,
      agentActive: true,
    });
  });
});
