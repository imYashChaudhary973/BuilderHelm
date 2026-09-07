import { describe, expect, it } from 'vitest';

import { readServerSentEvents } from '../src/http.js';

function body(chunks: readonly string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: readonly string[]): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of readServerSentEvents(body(chunks))) events.push(event);
  return events;
}

describe('readServerSentEvents', () => {
  it('parses CRLF frames', async () => {
    await expect(
      collect(['data: {"n":1}\r\n\r\ndata: {"n":2}\r\n\r\n']),
    ).resolves.toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('parses CRLF frames split across chunk boundaries', async () => {
    await expect(
      collect(['data: {"n":1}\r', '\n\r', '\ndata: {"n":2}\r\n\r\n']),
    ).resolves.toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('parses LF frames and stops at DONE without emitting it', async () => {
    await expect(collect(['data: {"n":1}\n\n', 'data: [DONE]\n\n'])).resolves.toEqual([
      { n: 1 },
    ]);
  });
});
