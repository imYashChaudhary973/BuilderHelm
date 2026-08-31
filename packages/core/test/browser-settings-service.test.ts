import {
  migrations,
  openDatabase,
  runMigrations,
  SettingsRepository,
} from '@builderhelm/db';
import { browserProfilePartition } from '@builderhelm/protocol/browser';
import { describe, expect, it } from 'vitest';

import { BrowserSettingsService } from '../src/browser/browser-settings-service.js';

function setup(): { service: BrowserSettingsService; repository: SettingsRepository } {
  const database = openDatabase(':memory:');
  runMigrations(database, migrations);
  const repository = new SettingsRepository(database);
  return { service: new BrowserSettingsService(repository), repository };
}

describe('browser settings', () => {
  it('starts with a blank home page and one default profile', () => {
    const { service, repository } = setup();

    const settings = service.read();

    expect(settings.homePage).toBe('');
    expect(settings.searchEngine).toBe('google');
    expect(settings.zoomPercent).toBe(100);
    expect(settings.profiles).toHaveLength(1);
    expect(settings.profiles[0]?.isDefault).toBe(true);
    expect(settings.activeProfileId).toBe(settings.profiles[0]?.id);
    // Reading must not write a row nobody asked for.
    expect(repository.read('browser.settings')).toBeUndefined();
  });

  it('persists an update and survives a fresh service over the same row', () => {
    const { service, repository } = setup();

    service.update({ searchEngine: 'duckduckgo', zoomPercent: 125, linkRouting: true });

    const reloaded = new BrowserSettingsService(repository).read();
    expect(reloaded.searchEngine).toBe('duckduckgo');
    expect(reloaded.zoomPercent).toBe(125);
    expect(reloaded.linkRouting).toBe(true);
  });

  it('normalizes a home page and keeps empty meaning blank', () => {
    const { service } = setup();

    expect(service.update({ homePage: 'google.com' }).homePage).toBe(
      'http://google.com/',
    );
    expect(service.update({ homePage: '   ' }).homePage).toBe('');
    expect(() => service.update({ homePage: 'javascript:alert(1)' })).toThrow(/http/i);
  });

  it('gives each profile its own partition and never deletes the default', () => {
    const { service } = setup();

    const created = service.createProfile('Staging');
    const staging = created.profiles.find((profile) => profile.name === 'Staging');
    const fallback = created.profiles.find((profile) => profile.isDefault);
    expect(staging).toBeDefined();
    expect(browserProfilePartition(staging?.id ?? '')).not.toBe(
      browserProfilePartition(fallback?.id ?? ''),
    );

    expect(() => service.deleteProfile(fallback?.id ?? '')).toThrow(/default/i);
    expect(() => service.createProfile('staging')).toThrow(/taken/i);
  });

  it('falls back to the default profile when the active one is deleted', () => {
    const { service } = setup();
    const created = service.createProfile('Staging');
    const staging = created.profiles.find((profile) => profile.name === 'Staging');
    service.update({ activeProfileId: staging?.id ?? '' });

    const after = service.deleteProfile(staging?.id ?? '');

    // Leaving activeProfileId dangling would open the browser on a partition
    // with no metadata behind it.
    expect(after.profiles.some((profile) => profile.id === staging?.id)).toBe(false);
    expect(after.profiles.some((profile) => profile.id === after.activeProfileId)).toBe(
      true,
    );
  });

  it('refuses to activate a profile that does not exist', () => {
    const { service } = setup();

    expect(() =>
      service.update({ activeProfileId: '00000000-0000-4000-8000-0000000000ff' }),
    ).toThrow(/profile/i);
  });

  it('records cookie domains and counts, never values', () => {
    const { service, repository } = setup();
    const id = service.read().activeProfileId;

    const after = service.recordCookieImport(id, ['example.com', 'example.com'], 12);

    const profile = after.profiles.find((entry) => entry.id === id);
    expect(profile?.cookieCount).toBe(12);
    expect(profile?.cookieDomains).toEqual(['example.com']);
    expect(repository.read('browser.settings') ?? '').not.toContain('session');
  });

  it('degrades to defaults when the stored row is unusable', () => {
    const { service, repository } = setup();

    repository.write(
      'browser.settings',
      '{"searchEngine":"yandex"}',
      '2026-08-30T00:00:00.000Z',
    );

    // A row from an older build must not crash the browser panel.
    expect(service.read().searchEngine).toBe('google');
    expect(service.read().profiles).toHaveLength(1);
  });
});
