import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BROWSER_SEARCH_ENGINES,
  browserSearchEngineIds,
  browserZoomPercents,
  type BrowserSettings,
  type BrowserSettingsUpdateInput,
  type BrowserZoomPercent,
} from '@builderhelm/protocol/browser';
import { useEffect, useState } from 'react';

function Switch({
  label,
  hint,
  checked,
  busy,
  onChange,
}: {
  readonly label: string;
  readonly hint: string;
  readonly checked: boolean;
  readonly busy: boolean;
  readonly onChange: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="voiceRow voiceSeparator">
      <div>
        <strong>{label}</strong>
        <p className="voiceHint">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={checked ? 'voiceSwitch voiceSwitchOn' : 'voiceSwitch'}
        disabled={busy}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

export function BrowserSettingsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [homePage, setHomePage] = useState('');
  const [profileName, setProfileName] = useState('');

  const browser = useQuery({
    queryKey: ['browser-settings'],
    queryFn: () => window.builderHelm.browser.settings(),
  });
  const settings: BrowserSettings | undefined = browser.data;

  useEffect(() => {
    if (settings !== undefined) setHomePage(settings.homePage);
  }, [settings?.homePage]);

  const update = useMutation({
    mutationFn: (input: BrowserSettingsUpdateInput) =>
      window.builderHelm.browser.updateSettings(input),
    onSuccess: async (next) => {
      setError(null);
      queryClient.setQueryData(['browser-settings'], next);
      // Zoom is a live property of the open page, not only a stored default.
      await window.builderHelm.browser
        .command({ action: 'zoom', percent: next.zoomPercent })
        .catch(() => undefined);
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const createProfile = useMutation({
    mutationFn: (name: string) => window.builderHelm.browser.createProfile({ name }),
    onSuccess: (next) => {
      setError(null);
      setProfileName('');
      queryClient.setQueryData(['browser-settings'], next);
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const deleteProfile = useMutation({
    mutationFn: (id: string) => window.builderHelm.browser.deleteProfile({ id }),
    onSuccess: (next) => {
      setError(null);
      queryClient.setQueryData(['browser-settings'], next);
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const importCookies = useMutation({
    mutationFn: (id: string) => window.builderHelm.browser.importCookies({ id }),
    onSuccess: async (result) => {
      setError(
        result.cancelled
          ? null
          : `Imported ${String(result.imported)} cookies across ${String(result.domains.length)} domains.` +
              (result.rejected > 0 ? ` ${String(result.rejected)} rejected.` : ''),
      );
      await queryClient.invalidateQueries({ queryKey: ['browser-settings'] });
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const busy =
    update.isPending ||
    createProfile.isPending ||
    deleteProfile.isPending ||
    importCookies.isPending;

  return (
    <>
      <header className="settingsHeader voiceHeader">
        <div>
          <h1>Browser</h1>
          <p className="voiceLede">
            The built-in browser previews local work and collects verification evidence.
            Cookies stay on this machine and are never shared with an agent.
          </p>
        </div>
      </header>
      {(error !== null || browser.isError) && (
        <p className="errorBanner" role="alert">
          {error ??
            (browser.error instanceof Error
              ? browser.error.message
              : 'Could not load Browser settings.')}
        </p>
      )}
      <div className="settingsLayout voiceLayout">
        <section className="voiceCard" aria-labelledby="browser-general-title">
          <h2 className="srOnly" id="browser-general-title">
            General
          </h2>
          <div className="voiceRow">
            <div>
              <strong>Default Home Page</strong>
              <p className="voiceHint">
                URL opened when creating a new browser tab. Leave empty to open a blank
                tab.
              </p>
            </div>
            <div className="browserSettingField">
              <input
                aria-label="Default home page"
                className="browserSettingInput"
                placeholder="https://google.com"
                value={homePage}
                spellCheck={false}
                onChange={(event) => setHomePage(event.target.value)}
              />
              <button
                type="button"
                className="drawChip drawChipPrimary"
                disabled={busy || homePage === (settings?.homePage ?? '')}
                onClick={() => update.mutate({ homePage })}
              >
                Save
              </button>
            </div>
          </div>

          <div className="voiceRow voiceSeparator">
            <div>
              <strong>Default Search Engine</strong>
              <p className="voiceHint">
                Used when typing non-URL text in the address bar.
              </p>
            </div>
            <select
              aria-label="Default search engine"
              className="browserSettingSelect"
              value={settings?.searchEngine ?? 'google'}
              disabled={busy}
              onChange={(event) =>
                update.mutate({
                  searchEngine: event.target
                    .value as (typeof browserSearchEngineIds)[number],
                })
              }
            >
              {browserSearchEngineIds.map((id) => (
                <option key={id} value={id}>
                  {BROWSER_SEARCH_ENGINES[id].label}
                </option>
              ))}
            </select>
          </div>

          <div className="voiceRow voiceSeparator">
            <div>
              <strong>Default Zoom</strong>
              <p className="voiceHint">Applied to newly opened browser tabs.</p>
            </div>
            <select
              aria-label="Default zoom"
              className="browserSettingSelect"
              value={String(settings?.zoomPercent ?? 100)}
              disabled={busy}
              onChange={(event) =>
                update.mutate({
                  zoomPercent: Number(event.target.value) as BrowserZoomPercent,
                })
              }
            >
              {browserZoomPercents.map((percent) => (
                <option key={percent} value={String(percent)}>
                  {percent}%
                </option>
              ))}
            </select>
          </div>

          <Switch
            label="Link Routing"
            hint="Open http(s) links in BuilderHelm's built-in browser — from the terminal, markdown, and the editor. ⇧⌘-click always uses your system browser."
            checked={settings?.linkRouting ?? false}
            busy={busy}
            onChange={(linkRouting) => update.mutate({ linkRouting })}
          />
          <div className="browserSettingNested">
            <Switch
              label="Hold Shift to open in BuilderHelm"
              hint="Links open in your system browser. When enabled, ⇧⌘+click opens one in BuilderHelm's built-in browser instead."
              checked={settings?.shiftOpensInApp ?? false}
              busy={busy}
              onChange={(shiftOpensInApp) => update.mutate({ shiftOpensInApp })}
            />
            <Switch
              label="Show terminal link actions"
              hint="Show available actions when you click a terminal link. Turn this off to require ⌘-click."
              checked={settings?.terminalLinkActions ?? true}
              busy={busy}
              onChange={(terminalLinkActions) => update.mutate({ terminalLinkActions })}
            />
          </div>
          <Switch
            label="Localhost Worktree Labels"
            hint="Label mapped workspace ports with the worktree that opened them, so browser tabs are easier to tell apart. The real origin is never rewritten."
            checked={settings?.localhostWorktreeLabels ?? false}
            busy={busy}
            onChange={(localhostWorktreeLabels) =>
              update.mutate({ localhostWorktreeLabels })
            }
          />
        </section>

        <section className="voiceCard" aria-labelledby="browser-profiles-title">
          <div className="voiceRow">
            <div>
              <strong id="browser-profiles-title">Session &amp; Cookies</strong>
              <p className="voiceHint">
                Select a default profile for new browser tabs. Import cookies and switch
                profiles per tab via the ⋯ toolbar menu.
              </p>
            </div>
            <div className="browserSettingField">
              <input
                aria-label="New profile name"
                className="browserSettingInput"
                placeholder="Profile name"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
              />
              <button
                type="button"
                className="drawChip drawChipPrimary"
                disabled={busy || profileName.trim().length === 0}
                onClick={() => createProfile.mutate(profileName)}
              >
                Add Profile
              </button>
            </div>
          </div>
          <ul className="browserProfiles">
            {(settings?.profiles ?? []).map((profile) => {
              const active = settings?.activeProfileId === profile.id;
              return (
                <li key={profile.id} className="browserProfile">
                  <div>
                    <strong>{profile.name}</strong>
                    {active && <span className="browserProfileBadge">Active</span>}
                    <p className="voiceHint">
                      {profile.cookieCount === 0
                        ? 'No cookies imported'
                        : `${String(profile.cookieCount)} cookies · ${profile.cookieDomains
                            .slice(0, 3)
                            .join(', ')}`}
                    </p>
                  </div>
                  <div className="browserProfileActions">
                    {!active && (
                      <button
                        type="button"
                        className="drawChip"
                        disabled={busy}
                        onClick={() => update.mutate({ activeProfileId: profile.id })}
                      >
                        Use
                      </button>
                    )}
                    <button
                      type="button"
                      className="drawChip"
                      disabled={busy}
                      onClick={() => importCookies.mutate(profile.id)}
                    >
                      Import Cookies
                    </button>
                    {!profile.isDefault && (
                      <button
                        type="button"
                        className="drawChip"
                        aria-label={`Delete ${profile.name}`}
                        disabled={busy}
                        onClick={() => deleteProfile.mutate(profile.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}
