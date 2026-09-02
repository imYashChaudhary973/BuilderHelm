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
    // The launch animation runs ThreeUI's WebGL2 source in a sandboxed frame.
    // `about:srcdoc` inherits this policy and its inline scripts would be
    // blocked, so the frame loads a bundled same-origin page instead. Only
    // assets shipped in the app can be framed.
    "frame-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Renderer-relative path of the page that hosts the launch animation. */
export const ELEMENTS_HOST_PATH = '/elements-host.html';

/**
 * Policy for the frame that runs ThreeUI's `elemental-lightning` source.
 *
 * That source is one vendored static document whose shaders live in inline
 * `<script>` blocks, so this context has to allow inline script where the
 * shell must not. The trade is bounded: the shell frames it with
 * `sandbox="allow-scripts"`, so it runs on an opaque origin with no access to
 * the shell, and every fetch, subframe, and plugin stays denied here. The
 * shell's own policy still forbids inline script and still refuses to be
 * framed.
 */
export function buildElementsHostPolicy(): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    // Only the shell may frame it.
    "frame-ancestors 'self'",
  ].join('; ');
}
