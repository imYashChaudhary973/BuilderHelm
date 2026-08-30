import type { WebPreferences } from 'electron';

export const secureWebPreferences = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
} satisfies WebPreferences;

/**
 * The shell is a single document whose routes live in memory. Origin equality
 * alone is not enough: on `file://` every URL shares the origin `null`, so a
 * stray in-app anchor to `/settings/browser` counts as same-origin and would
 * replace the whole app with a failed page load. Only same-document
 * navigation — query and hash changes — is allowed.
 */
export function isAllowedNavigation(currentUrl: string, destinationUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const destination = new URL(destinationUrl);
    return (
      current.origin === destination.origin && current.pathname === destination.pathname
    );
  } catch {
    return false;
  }
}

export function buildContentSecurityPolicy({
  dev = false,
}: { dev?: boolean } = {}): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    dev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    dev
      ? "connect-src 'self' ws: http://localhost:* ws://localhost:*"
      : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
