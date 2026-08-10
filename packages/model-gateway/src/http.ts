export class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`Provider HTTP request failed with status ${status}`);
    this.name = 'ProviderHttpError';
  }
}

export type GatewayFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function providerEndpoint(baseUrl: string | null, path: string): URL {
  const base = new URL(baseUrl ?? 'https://api.openai.com/v1');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(path.replace(/^\//, ''), base);
}

export async function* readServerSentEvents(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<unknown> {
  if (body === null) throw new TypeError('Provider returned no response body');
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data.length > 0 && data !== '[DONE]') yield JSON.parse(data) as unknown;
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }

  buffer += decoder.decode();
  const remaining = buffer.trim();
  if (remaining.length > 0) {
    const data = remaining
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data.length > 0 && data !== '[DONE]') yield JSON.parse(data) as unknown;
  }
}

export async function* readJsonLines(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<unknown> {
  if (body === null) throw new TypeError('Provider returned no response body');
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n');
      while (boundary >= 0) {
        const line = buffer.slice(0, boundary).trim();
        buffer = buffer.slice(boundary + 1);
        if (line.length > 0) yield JSON.parse(line) as unknown;
        boundary = buffer.indexOf('\n');
      }
    }
  } finally {
    reader.releaseLock();
  }

  buffer += decoder.decode();
  const remaining = buffer.trim();
  if (remaining.length > 0) yield JSON.parse(remaining) as unknown;
}
