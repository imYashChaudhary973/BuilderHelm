import {
  PREVIEW_VIEWPORTS,
  type BrowserMenuPayload,
} from '@builderhelm/protocol/browser';
import { useEffect, useState } from 'react';

import {
  IconCheck,
  IconChevron,
  IconDisplay,
  IconGear,
  IconImport,
  IconPlus,
} from './browser-icons.js';

type Pane = 'root' | 'cookies' | 'viewport';

/**
 * Styled overflow menu. Lives in its own frameless window so it paints above
 * the embedded page — renderer DOM in the shell cannot.
 */
export function BrowserMenuPopup(): React.JSX.Element {
  const [payload, setPayload] = useState<BrowserMenuPayload | null>(null);
  const [pane, setPane] = useState<Pane>('root');

  useEffect(() => {
    return window.builderHelm.browser.onMenuPayload((next) => {
      setPayload(next);
      setPane(next.kind === 'viewport' ? 'viewport' : 'root');
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (pane !== 'root' && payload?.kind === 'overflow') {
        setPane('root');
        return;
      }
      window.builderHelm.browser.pickMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pane, payload?.kind]);

  if (payload === null) return <div className="browserMenu" />;

  const pick = (choice: string): void => {
    window.builderHelm.browser.pickMenu(choice);
  };

  if (payload.kind === 'import') {
    return (
      <div className="browserMenu">
        <div className="browserMenuList" role="menu" aria-label="Import a mapped port">
          {payload.origins.length === 0 ? (
            <button type="button" className="browserMenuItem" disabled role="menuitem">
              <span>No localhost URLs in pane output yet</span>
            </button>
          ) : (
            payload.origins.map((origin) => (
              <button
                key={origin.url}
                type="button"
                className="browserMenuItem"
                role="menuitem"
                onClick={() => pick(`open:${origin.url}`)}
              >
                <span>
                  {payload.settings.localhostWorktreeLabels
                    ? `${String(origin.port)} · ${origin.sessionId === null ? 'unassigned' : origin.sessionId.slice(0, 8)}`
                    : `${String(origin.port)} · ${origin.url}`}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  if (pane === 'cookies') {
    return (
      <div className="browserMenu">
        <div className="browserMenuList" role="menu" aria-label="Import cookies">
          <button
            type="button"
            className="browserMenuItem"
            role="menuitem"
            onClick={() => setPane('root')}
          >
            <span>Import Cookies</span>
          </button>
          <div className="browserMenuRule" />
          {payload.settings.profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className="browserMenuItem"
              role="menuitem"
              onClick={() => pick(`cookies:${profile.id}`)}
            >
              <span>
                {profile.cookieCount === 0
                  ? profile.name
                  : `${profile.name} · ${String(profile.cookieCount)} cookies`}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (pane === 'viewport' || payload.kind === 'viewport') {
    return (
      <div className="browserMenu">
        <div className="browserMenuList" role="menu" aria-label="Viewport size">
          {payload.kind === 'overflow' && (
            <>
              <button
                type="button"
                className="browserMenuItem"
                role="menuitem"
                onClick={() => setPane('root')}
              >
                <span>Viewport Size</span>
              </button>
              <div className="browserMenuRule" />
            </>
          )}
          {(['desktop', 'tablet', 'phone'] as const).map((id) => (
            <button
              key={id}
              type="button"
              className="browserMenuItem"
              role="menuitemradio"
              aria-checked={payload.viewport === id}
              onClick={() => pick(`viewport:${id}`)}
            >
              <span className="browserMenuCheck">
                {payload.viewport === id ? <IconCheck /> : null}
              </span>
              <span>
                {id.charAt(0).toUpperCase()}
                {id.slice(1)} · {String(PREVIEW_VIEWPORTS[id].width)}px
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="browserMenu">
      <div className="browserMenuList" role="menu" aria-label="Browser menu">
        {payload.settings.profiles.map((profile) => (
          <button
            key={profile.id}
            type="button"
            className="browserMenuItem"
            role="menuitemradio"
            aria-checked={payload.settings.activeProfileId === profile.id}
            onClick={() => pick(`profile:${profile.id}`)}
          >
            <span className="browserMenuCheck">
              {payload.settings.activeProfileId === profile.id ? <IconCheck /> : null}
            </span>
            <span>{profile.name}</span>
          </button>
        ))}
        <button
          type="button"
          className="browserMenuItem"
          role="menuitem"
          onClick={() => pick('profile-new')}
        >
          <IconPlus />
          <span>New Profile</span>
        </button>
        <div className="browserMenuRule" />
        <button
          type="button"
          className="browserMenuItem"
          role="menuitem"
          onClick={() => setPane('cookies')}
        >
          <IconImport />
          <span>Import Cookies</span>
          <IconChevron />
        </button>
        <button
          type="button"
          className="browserMenuItem"
          role="menuitem"
          onClick={() => setPane('viewport')}
        >
          <IconDisplay />
          <span>Viewport Size</span>
          <IconChevron />
        </button>
        <div className="browserMenuRule" />
        <button
          type="button"
          className="browserMenuItem"
          role="menuitem"
          onClick={() => pick('settings')}
        >
          <IconGear />
          <span>Browser Settings</span>
        </button>
      </div>
    </div>
  );
}
