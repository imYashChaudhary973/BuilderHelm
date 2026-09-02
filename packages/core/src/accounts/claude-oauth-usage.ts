import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const OAUTH_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA_HEADER = 'oauth-2025-04-20';
const OAUTH_TIMEOUT_MS = 10_000;

function readAccessToken(configRoot: string | null): string | null {
  const roots = [configRoot, join(homedir(), '.claude')].filter(
    (root): root is string => root !== null,
  );
  for (const root of roots) {
    const credPath = join(root, '.credentials.json');
    if (!existsSync(credPath)) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(credPath, 'utf8'));
      const oauth = (parsed as Record<string, unknown>).claudeAiOauth;
      const accessToken =
        typeof oauth === 'object' && oauth !== null
          ? (oauth as Record<string, unknown>).accessToken
          : undefined;
      if (typeof accessToken === 'string' && accessToken.length > 0) return accessToken;
    } catch {
      // unreadable credentials; skip
    }
  }
  return null;
}

/**
 * Reads Claude subscription windows from the official OAuth usage endpoint, the
 * same source Claude's usage console uses. The statusLine piggyback only emits
 * after an in-session API call, so this is the reliable primary source. The
 * access token stays in memory; it is never logged or persisted.
 */
export async function readClaudeOAuthUsage(
  configRoot: string | null,
): Promise<unknown | null> {
  const token = readAccessToken(configRoot);
  if (token === null) return null;
  try {
    const response = await fetch(OAUTH_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': OAUTH_BETA_HEADER,
        'User-Agent': 'claude-code/2.1.0',
      },
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
    if (response.status < 200 || response.status >= 300) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
