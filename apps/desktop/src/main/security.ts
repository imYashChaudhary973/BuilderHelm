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

export function buildContentSecurityPolicy({ dev = false }: { dev?: boolean } = {}): string {
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
