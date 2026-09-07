import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { hostname } from 'node:os';

import { verifyLicence, type AuthService, type AuthTokenBundle } from '@builderhelm/core';
import type { AuthState } from '@builderhelm/protocol/auth';
import { app, shell } from 'electron';

const MAX_BODY = 64 * 1024;
const DEADLINE_MS = 5 * 60 * 1000;
const ACCOUNT_ORIGIN = 'https://builderhelm.com';
const IDENTITY_URL = 'https://cdtvxtnomtmwibkcjiwy.supabase.co';
const IDENTITY_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkdHZ4dG5vbXRtd2lia2NqaXd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1OTU1NjEsImV4cCI6MjEwMzE3MTU2MX0.rT8mxIPeSDgcUseQUpyuHBUPqHWrbjUh9t70OKZ-LbQ';
const DEVICE_SALT = 'builderhelm.device.v1';

const RETURN_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>BuilderHelm</title>
  <style>
    html,body { min-height:100vh; margin:0; background:#0a0a0a; color:#ececea;
      font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; }
    body { display:grid; place-items:center; }
    p { max-width: 36ch; text-align:center; }
  </style>
</head>
<body>
  <p id="m">Signing you in…</p>
  <script>
    const params = new URLSearchParams(location.hash.slice(1));
    fetch('/return', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        state: params.get('state'),
        access_token: params.get('access_token'),
        refresh_token: params.get('refresh_token'),
        expires_at: params.get('expires_at')
      })
    }).then((r) => r.text()).then((t) => {
      document.getElementById('m').textContent = t;
    }).catch(() => {
      document.getElementById('m').textContent = 'Could not reach BuilderHelm. Return to the app and try again.';
    });
  </script>
</body>
</html>`;

/**
 * Where the account pages live.
 *
 * Overridable only in development, so a live sign-in can be exercised against
 * a local site build before the marketing site ships. A packaged app always
 * talks to production: honouring the variable there would let anyone point the
 * gate at a page that phishes the user's account password.
 */
function accountOrigin(): string {
  const override = process.env.BUILDERHELM_ACCOUNT_ORIGIN;
  if (!app.isPackaged && override !== undefined && override.length > 0) {
    return override.replace(/\/+$/, '');
  }
  return ACCOUNT_ORIGIN;
}

export function statesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function parseReturnBody(raw: string): {
  state: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.state !== 'string' || typeof record.access_token !== 'string')
    return null;
  if (typeof record.refresh_token !== 'string') return null;
  const expiresAt =
    typeof record.expires_at === 'string' && record.expires_at.length > 0
      ? Number(record.expires_at)
      : null;
  return {
    state: record.state,
    accessToken: record.access_token,
    refreshToken: record.refresh_token,
    expiresAt: expiresAt !== null && Number.isFinite(expiresAt) ? expiresAt : null,
  };
}

export function deviceHash(): string {
  const raw = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
    encoding: 'utf8',
  });
  const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(raw);
  if (match === null) {
    throw new Error('Could not read this Mac’s hardware identifier.');
  }
  return createHash('sha256').update(`${DEVICE_SALT}:${match[1]}`).digest('hex');
}

async function mintLicence(accessToken: string): Promise<string> {
  const response = await fetch(`${IDENTITY_URL}/functions/v1/licence`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      apikey: IDENTITY_ANON_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ deviceHash: deviceHash(), label: hostname() || 'Mac' }),
  });
  const body: unknown = await response.json().catch(() => null);
  let code = `licence_${response.status}`;
  let licence: string | null = null;
  if (typeof body === 'object' && body !== null) {
    if ('error' in body && typeof body.error === 'string') code = body.error;
    if ('licence' in body && typeof body.licence === 'string') licence = body.licence;
  }
  if (!response.ok || licence === null) throw new Error(code);
  return licence;
}

async function refreshSession(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
}> {
  const response = await fetch(`${IDENTITY_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: IDENTITY_ANON_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof body !== 'object' || body === null) {
    throw new Error('session_expired');
  }
  if (!('access_token' in body) || !('refresh_token' in body)) {
    throw new Error('session_expired');
  }
  if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
    throw new Error('session_expired');
  }
  const expiresAt =
    'expires_at' in body && typeof body.expires_at === 'number' ? body.expires_at : null;
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt,
  };
}

function licenceErrorMessage(code: string): string {
  if (code === 'slots_full') {
    return 'This plan is already signed in on its device limit. Revoke a device at builderhelm.com/account.';
  }
  if (code === 'no_plan' || code === 'plan_lapsed') {
    return 'This account does not have an active plan.';
  }
  if (code === 'session_expired') return 'Sign in again.';
  return 'Could not verify this account. Try again.';
}

export class AuthHandoff {
  private waiting = false;
  private error: string | null = null;
  private server: Server | null = null;
  private expectedState: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private used = false;
  private signInUrl: string | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly onChange: (state: AuthState) => void,
  ) {}

  async read(): Promise<AuthState> {
    if (this.waiting) {
      return {
        status: 'waiting',
        session: null,
        error: this.error,
        signInUrl: this.signInUrl,
      };
    }
    return this.auth.read(this.error);
  }

  async begin(): Promise<AuthState> {
    await this.cancel();
    const state = randomBytes(32).toString('hex');
    this.expectedState = state;
    this.waiting = true;
    this.error = null;
    this.used = false;
    const server = createServer((request, response) => {
      const url = request.url ?? '';
      if (request.method === 'GET' && url.startsWith('/return')) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(RETURN_PAGE);
        return;
      }
      if (request.method !== 'POST' || url !== '/return') {
        response.writeHead(404);
        response.end();
        return;
      }
      if (this.used) {
        response.writeHead(409);
        response.end('This sign-in link was already used.');
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let rejected = false;
      request.on('data', (chunk: Buffer) => {
        if (rejected) return;
        size += chunk.length;
        if (size > MAX_BODY) {
          rejected = true;
          response.writeHead(413);
          response.end();
          request.destroy();
        } else {
          chunks.push(chunk);
        }
      });
      request.on('end', () => {
        if (rejected) return;
        void this.finishReturn(Buffer.concat(chunks).toString('utf8'), response);
      });
    });
    this.server = server;
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      await this.cancel();
      return this.auth.read('Could not start the sign-in listener.');
    }
    this.timer = setTimeout(() => {
      void this.cancel('Sign in timed out. Open the page again.');
    }, DEADLINE_MS);
    const returnUrl = `http://127.0.0.1:${address.port}/return`;
    this.signInUrl = `${accountOrigin()}/signin?return=${encodeURIComponent(returnUrl)}&state=${state}`;
    await shell.openExternal(this.signInUrl);
    const next = await this.read();
    this.onChange(next);
    return next;
  }

  async cancel(error: string | null = null): Promise<AuthState> {
    this.closeServer();
    this.waiting = false;
    this.signInUrl = null;
    this.expectedState = null;
    this.error = error;
    const next = await this.auth.read(error);
    this.onChange(next);
    return next;
  }

  async signOut(): Promise<AuthState> {
    this.closeServer();
    this.waiting = false;
    this.signInUrl = null;
    this.expectedState = null;
    this.error = null;
    const next = await this.auth.signOut();
    this.onChange(next);
    return next;
  }

  async openAccount(): Promise<AuthState> {
    await shell.openExternal(`${accountOrigin()}/account`);
    return this.read();
  }

  async restore(): Promise<AuthState> {
    const tokens = await this.auth.rawBundle();
    if (tokens === null) return this.auth.read();
    const claims = verifyLicence(tokens.licence);
    const day = 24 * 60 * 60 * 1000;
    if (claims !== null && claims.exp * 1000 - Date.now() > day) {
      return this.auth.read();
    }
    try {
      const refreshed = await refreshSession(tokens.refreshToken);
      const licence = await mintLicence(refreshed.accessToken);
      return await this.auth.apply({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        licence,
      });
    } catch (error) {
      if (claims !== null) return this.auth.read();
      const message = licenceErrorMessage(
        error instanceof Error ? error.message : 'session_expired',
      );
      return this.auth.signOut(message);
    }
  }

  close(): void {
    this.closeServer();
  }

  private closeServer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.server?.close();
    this.server = null;
  }

  private async finishReturn(
    raw: string,
    response: { writeHead: (code: number) => void; end: (body?: string) => void },
  ): Promise<void> {
    const parsed = parseReturnBody(raw);
    if (
      parsed === null ||
      this.expectedState === null ||
      !statesEqual(parsed.state, this.expectedState)
    ) {
      response.writeHead(400);
      response.end('Sign in could not be verified. Return to the app.');
      return;
    }
    this.used = true;
    try {
      const licence = await mintLicence(parsed.accessToken);
      const bundle: AuthTokenBundle = {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        expiresAt: parsed.expiresAt,
        licence,
      };
      this.closeServer();
      this.waiting = false;
      this.signInUrl = null;
      this.expectedState = null;
      this.error = null;
      const next = await this.auth.apply(bundle);
      this.onChange(next);
      response.writeHead(200);
      response.end('Signed in — you can close this tab.');
    } catch (error) {
      const message = licenceErrorMessage(
        error instanceof Error ? error.message : 'licence_failed',
      );
      this.closeServer();
      this.waiting = false;
      this.signInUrl = null;
      this.expectedState = null;
      const next = await this.auth.signOut(message);
      this.onChange(next);
      response.writeHead(403);
      response.end(message);
    }
  }
}
