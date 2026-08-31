import type { SettingsRepository } from '@builderhelm/db';
import {
  browserSettingsSchema,
  browserSettingsUpdateInputSchema,
  parsePreviewUrl,
  type BrowserProfile,
  type BrowserSettings,
  type BrowserSettingsUpdateInput,
} from '@builderhelm/protocol/browser';
import { BuilderHelmError, createId, utcNow } from '@builderhelm/shared';

const SETTINGS_KEY = 'browser.settings';
const DEFAULT_PROFILE_ID = '00000000-0000-4000-8000-000000000001';

function defaultProfile(): BrowserProfile {
  return {
    id: DEFAULT_PROFILE_ID,
    name: 'Default',
    isDefault: true,
    cookieDomains: [],
    cookieCount: 0,
    createdAt: utcNow(),
  };
}

function defaultSettings(): BrowserSettings {
  return {
    homePage: '',
    searchEngine: 'google',
    zoomPercent: 100,
    linkRouting: false,
    shiftOpensInApp: false,
    terminalLinkActions: true,
    localhostWorktreeLabels: false,
    activeProfileId: DEFAULT_PROFILE_ID,
    profiles: [defaultProfile()],
  };
}

/**
 * Owns the browser preferences and the profile list behind them.
 *
 * Two invariants this service exists to hold: the profile list always contains
 * exactly one default profile, and `activeProfileId` always names a profile
 * that exists. Violating either would strand the browser on a partition with
 * no metadata, so both are re-checked on every read and every write — a row
 * written by an older build, or hand-edited, degrades to the defaults instead
 * of propagating.
 */
export class BrowserSettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  read(): BrowserSettings {
    const raw = this.repository.read(SETTINGS_KEY);
    if (raw === undefined) return defaultSettings();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaultSettings();
    }
    const result = browserSettingsSchema.safeParse(parsed);
    if (!result.success) return defaultSettings();
    return this.normalize(result.data);
  }

  update(input: BrowserSettingsUpdateInput): BrowserSettings {
    const patch = browserSettingsUpdateInputSchema.parse(input);
    const current = this.read();
    if (patch.homePage !== undefined) {
      const trimmed = patch.homePage.trim();
      if (trimmed.length > 0 && parsePreviewUrl(trimmed) === null) {
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          'The home page must be an http or https URL, or empty for a blank tab.',
        );
      }
    }
    if (
      patch.activeProfileId !== undefined &&
      !current.profiles.some((profile) => profile.id === patch.activeProfileId)
    ) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'No such browser profile');
    }
    // `exactOptionalPropertyTypes` makes a spread of the patch unsound: an
    // absent key and a key set to undefined are different types, and only the
    // former means "leave it alone".
    return this.persist({
      ...current,
      homePage:
        patch.homePage === undefined
          ? current.homePage
          : patch.homePage.trim().length === 0
            ? ''
            : (parsePreviewUrl(patch.homePage.trim()) ?? ''),
      searchEngine: patch.searchEngine ?? current.searchEngine,
      zoomPercent: patch.zoomPercent ?? current.zoomPercent,
      linkRouting: patch.linkRouting ?? current.linkRouting,
      shiftOpensInApp: patch.shiftOpensInApp ?? current.shiftOpensInApp,
      terminalLinkActions: patch.terminalLinkActions ?? current.terminalLinkActions,
      localhostWorktreeLabels:
        patch.localhostWorktreeLabels ?? current.localhostWorktreeLabels,
      activeProfileId: patch.activeProfileId ?? current.activeProfileId,
    });
  }

  createProfile(name: string): BrowserSettings {
    const current = this.read();
    const label = name.trim();
    if (label.length === 0) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'A profile needs a name');
    }
    if (current.profiles.length >= 10) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Profile limit reached');
    }
    if (
      current.profiles.some(
        (profile) => profile.name.toLowerCase() === label.toLowerCase(),
      )
    ) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'That profile name is taken');
    }
    const profile: BrowserProfile = {
      id: createId(),
      name: label,
      isDefault: false,
      cookieDomains: [],
      cookieCount: 0,
      createdAt: utcNow(),
    };
    return this.persist({ ...current, profiles: [...current.profiles, profile] });
  }

  deleteProfile(id: string): BrowserSettings {
    const current = this.read();
    const profile = current.profiles.find((entry) => entry.id === id);
    if (profile === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'No such browser profile');
    }
    if (profile.isDefault) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'The default profile cannot be deleted',
      );
    }
    const profiles = current.profiles.filter((entry) => entry.id !== id);
    return this.persist({
      ...current,
      profiles,
      activeProfileId:
        current.activeProfileId === id ? DEFAULT_PROFILE_ID : current.activeProfileId,
    });
  }

  /** Records what an import touched. Domains and counts only, never values. */
  recordCookieImport(
    id: string,
    domains: readonly string[],
    imported: number,
  ): BrowserSettings {
    const current = this.read();
    if (!current.profiles.some((profile) => profile.id === id)) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'No such browser profile');
    }
    return this.persist({
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === id
          ? {
              ...profile,
              cookieDomains: [...new Set(domains)].slice(0, 50),
              cookieCount: imported,
            }
          : profile,
      ),
    });
  }

  activeProfile(): BrowserProfile {
    const settings = this.read();
    return (
      settings.profiles.find((profile) => profile.id === settings.activeProfileId) ??
      defaultProfile()
    );
  }

  private normalize(settings: BrowserSettings): BrowserSettings {
    const withDefault = settings.profiles.some((profile) => profile.isDefault)
      ? settings.profiles
      : [defaultProfile(), ...settings.profiles].slice(0, 10);
    const activeProfileId = withDefault.some(
      (profile) => profile.id === settings.activeProfileId,
    )
      ? settings.activeProfileId
      : (withDefault.find((profile) => profile.isDefault)?.id ?? DEFAULT_PROFILE_ID);
    return { ...settings, profiles: withDefault, activeProfileId };
  }

  private persist(next: BrowserSettings): BrowserSettings {
    const settings = browserSettingsSchema.parse(this.normalize(next));
    this.repository.write(SETTINGS_KEY, JSON.stringify(settings), utcNow());
    return settings;
  }
}
