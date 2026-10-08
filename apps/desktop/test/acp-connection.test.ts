import { describe, expect, it } from 'vitest';
import { AcpConnection } from '../src/main/acp/connection.js';

it('keeps authentication errors actionable without persisting sensitive provider responses', async () => {
  const connection = new AcpConnection({
    command: process.execPath,
    args: [
      '-e',
      `process.stdin.on('data', (chunk) => { const request = JSON.parse(chunk.toString()); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'Unauthorized: secret-provider-cookie', data: { access_token: 'secret-provider-token' } } }) + '\\n'); });`,
    ],
    cwd: '/tmp',
    onExit() {},
    onTransportError() {},
  });
  try {
    const error = await connection
      .request('session/new', {})
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      message: expect.stringContaining('authentication required'),
    });
    expect(JSON.stringify(error)).not.toContain('secret-provider');
  } finally {
    await connection.close();
  }
});

describe('agent diagnostics', () => {
  it('does not forward raw stderr or malformed protocol data to the client', async () => {
    const errors: unknown[] = [];
    let exitMessage = '';
    const connection = new AcpConnection({
      command: process.execPath,
      args: [
        '-e',
        `process.stdout.write('secret-malformed-protocol\\n'); process.stderr.write('secret-provider-token'); setTimeout(() => process.exit(1), 20);`,
      ],
      cwd: '/tmp',
      onExit: (_code, message) => {
        exitMessage = message;
      },
      onTransportError: (error) => {
        errors.push(error);
      },
    });
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      expect(errors.length).toBeGreaterThan(0);
      expect(JSON.stringify(errors)).not.toContain('secret-malformed');
      expect(exitMessage).not.toContain('secret-provider');
      expect(exitMessage).toContain('diagnostics');
    } finally {
      await connection.close();
    }
  });
});
