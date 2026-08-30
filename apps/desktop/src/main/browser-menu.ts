import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

import {
  PREVIEW_VIEWPORTS,
  previewViewportIds,
  type BrowserMenuInput,
  type BrowserMenuResult,
  type BrowserSettings,
  type PreviewOrigin,
  type PreviewViewportId,
} from '@builderhelm/protocol/browser';

export interface BrowserMenuState {
  readonly origins: readonly PreviewOrigin[];
  readonly settings: BrowserSettings;
  readonly viewport: PreviewViewportId;
}

function viewportItems(
  state: BrowserMenuState,
  choose: (choice: string) => void,
): MenuItemConstructorOptions[] {
  return previewViewportIds.map((id) => ({
    label: `${id.charAt(0).toUpperCase()}${id.slice(1)} · ${String(PREVIEW_VIEWPORTS[id].width)}px`,
    type: 'radio',
    checked: state.viewport === id,
    click: () => choose(`viewport:${id}`),
  }));
}

function importItems(
  state: BrowserMenuState,
  choose: (choice: string) => void,
): MenuItemConstructorOptions[] {
  if (state.origins.length === 0) {
    return [{ label: 'No localhost URLs in pane output yet', enabled: false }];
  }
  return state.origins.map((origin) => ({
    label: state.settings.localhostWorktreeLabels
      ? `${String(origin.port)} · ${origin.sessionId === null ? 'unassigned' : origin.sessionId.slice(0, 8)}`
      : `${String(origin.port)} · ${origin.url}`,
    click: () => choose(`open:${origin.url}`),
  }));
}

function overflowItems(
  state: BrowserMenuState,
  choose: (choice: string) => void,
): MenuItemConstructorOptions[] {
  return [
    ...state.settings.profiles.map<MenuItemConstructorOptions>((profile) => ({
      label: profile.name,
      type: 'radio',
      checked: state.settings.activeProfileId === profile.id,
      click: () => choose(`profile:${profile.id}`),
    })),
    { label: 'New Profile…', click: () => choose('profile-new') },
    { type: 'separator' },
    {
      label: 'Import Cookies',
      submenu: state.settings.profiles.map<MenuItemConstructorOptions>((profile) => ({
        label:
          profile.cookieCount === 0
            ? profile.name
            : `${profile.name} · ${String(profile.cookieCount)} cookies`,
        click: () => choose(`cookies:${profile.id}`),
      })),
    },
    { label: 'Viewport Size', submenu: viewportItems(state, choose) },
    { type: 'separator' },
    { label: 'Browser Settings…', click: () => choose('settings') },
  ];
}

/**
 * Toolbar menus are native for a structural reason: the embedded page is a
 * child view composited above the renderer, so an HTML popover anchored in the
 * toolbar is painted behind the page and becomes unclickable.
 *
 * Items are built from main-process state — real mapped ports, the real profile
 * list — so the renderer cannot inject a target by asking for a menu.
 */
export async function popupBrowserMenu(
  win: BrowserWindow,
  input: BrowserMenuInput,
  state: BrowserMenuState,
): Promise<BrowserMenuResult> {
  const { promise, resolve } = Promise.withResolvers<BrowserMenuResult>();
  let choice: string | null = null;
  const choose = (value: string): void => {
    choice = value;
  };
  const template =
    input.kind === 'import'
      ? importItems(state, choose)
      : input.kind === 'viewport'
        ? viewportItems(state, choose)
        : overflowItems(state, choose);
  Menu.buildFromTemplate(template).popup({
    window: win,
    x: input.x,
    y: input.y,
    callback: () => resolve({ choice }),
  });
  return promise;
}
