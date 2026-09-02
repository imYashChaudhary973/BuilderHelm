import { createServer, type Server } from 'node:http';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { formatQuotaLine } from '@builderhelm/core';
import type { AccountQuota } from '@builderhelm/protocol';

const MAX_BODY = 64 * 1024;

export function startQuotaIngest(options: {
  readonly userData: string;
  readonly ingestClaude: (payload: unknown) => AccountQuota | null;
}): { scriptPath(): string | null; close(): void } {
  const token = randomBytes(24).toString('hex');
  let scriptPath: string | null = null;
  const server: Server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/claude-statusline') {
      response.writeHead(404);
      response.end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401);
      response.end();
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
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (rejected) return;
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const quota = options.ingestClaude(body);
        if (quota === null) {
          response.writeHead(204);
          response.end();
          return;
        }
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(formatQuotaLine(quota));
      } catch {
        response.writeHead(400);
        response.end();
      }
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (address === null || typeof address === 'string') return;
    scriptPath = join(options.userData, 'claude-statusline.sh');
    writeFileSync(
      scriptPath,
      `#!/bin/sh
curl -sS -X POST "http://127.0.0.1:${address.port}/claude-statusline" \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  --data-binary @- \\
  --connect-timeout 1 --max-time 1 || true
`,
      { mode: 0o755 },
    );
    try {
      chmodSync(scriptPath, 0o755);
    } catch {
      // ignore
    }
  });
  return {
    scriptPath: () => scriptPath,
    close() {
      server.close();
    },
  };
}

/** Writes only into a BuilderHelm-owned config dir, never ~/.claude unless that is the root. */
export function installClaudeStatusLine(configRoot: string, scriptPath: string): void {
  if (!existsSync(configRoot)) return;
  const settingsPath = join(configRoot, 'settings.json');
  mkdirSync(dirname(settingsPath), { recursive: true });
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
      settings = parsed as Record<string, unknown>;
    } catch {
      return;
    }
  }
  const current = settings.statusLine;
  const command =
    typeof current === 'object' && current !== null
      ? (current as Record<string, unknown>).command
      : undefined;
  if (
    typeof command === 'string' &&
    command.length > 0 &&
    !command.endsWith('claude-statusline.sh')
  ) {
    return;
  }
  settings.statusLine = { type: 'command', command: scriptPath };
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}
