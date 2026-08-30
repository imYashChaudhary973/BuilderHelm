import { readFile, stat } from 'node:fs/promises';

import { dialog, session, type BrowserWindow } from 'electron';

import {
  BROWSER_COOKIE_FILE_MAX_BYTES,
  browserCookieImportFileSchema,
  browserProfilePartition,
  toBrowserCookieWrite,
  type BrowserCookieImportResult,
  type BrowserProfile,
} from '@builderhelm/protocol/browser';
import { BuilderHelmError } from '@builderhelm/shared';

/**
 * Imports a Cookie-Editor JSON export into one profile's partition.
 *
 * Everything sensitive stays in this function: the renderer supplies only a
 * profile id, the path comes from the trusted main-process dialog, and the
 * result carries domains and counts. A cookie value is never returned, logged,
 * or handed to an agent, and rows whose domain or path cannot be trusted are
 * dropped rather than written to a neighbouring origin.
 */
export async function importProfileCookies(
  win: BrowserWindow,
  profile: BrowserProfile,
): Promise<BrowserCookieImportResult> {
  const empty: BrowserCookieImportResult = {
    profileId: profile.id,
    imported: 0,
    rejected: 0,
    domains: [],
    cancelled: true,
  };
  const picked = await dialog.showOpenDialog(win, {
    title: `Import cookies into ${profile.name}`,
    properties: ['openFile'],
    filters: [{ name: 'Cookie export', extensions: ['json'] }],
  });
  const path = picked.filePaths[0];
  if (picked.canceled || path === undefined) return empty;

  const info = await stat(path);
  if (info.size > BROWSER_COOKIE_FILE_MAX_BYTES) {
    throw new BuilderHelmError(
      'VALIDATION_FAILED',
      'That cookie file is too large to import.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new BuilderHelmError('VALIDATION_FAILED', 'That file is not valid JSON.');
  }
  const items = browserCookieImportFileSchema.safeParse(parsed);
  if (!items.success) {
    throw new BuilderHelmError(
      'VALIDATION_FAILED',
      'That file is not a supported cookie export.',
    );
  }

  const writes = items.data.map(toBrowserCookieWrite);
  const accepted = writes.filter((write) => write !== null);
  let rejected = writes.length - accepted.length;
  const byDomain: Record<string, number> = {};
  for (const write of accepted) {
    byDomain[write.domain] = (byDomain[write.domain] ?? 0) + 1;
  }
  const domains = Object.keys(byDomain).sort();
  if (accepted.length === 0) {
    return { ...empty, rejected, cancelled: false };
  }

  const summary = domains
    .slice(0, 20)
    .map((domain) => `${domain} · ${String(byDomain[domain] ?? 0)}`)
    .join('\n');
  const confirmed = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Cancel', 'Import'],
    defaultId: 1,
    cancelId: 0,
    title: 'Import cookies',
    message: `Import ${String(accepted.length)} cookies into ${profile.name}?`,
    detail: `These sign-ins become available to pages opened in this profile.\n\n${summary}`,
  });
  if (confirmed.response !== 1) return { ...empty, rejected, cancelled: true };

  const store = session.fromPartition(browserProfilePartition(profile.id)).cookies;
  let imported = 0;
  for (const write of accepted) {
    try {
      await store.set(write);
      imported += 1;
    } catch {
      // A cookie the browser refuses is reported as rejected, never retried
      // with weakened attributes.
      rejected += 1;
    }
  }
  return {
    profileId: profile.id,
    imported,
    rejected,
    domains: domains.slice(0, 50),
    cancelled: false,
  };
}
