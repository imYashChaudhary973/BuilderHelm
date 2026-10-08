import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { UsageWorkerClient } from '../src/main/usage-worker-client.js';

const mocks = vi.hoisted(() => ({
  workers: [] as Array<
    EventEmitter & {
      postMessage: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
    }
  >,
}));
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    postMessage = vi.fn();
    terminate = vi.fn(async () => 0);
    constructor() {
      super();
      mocks.workers.push(this);
    }
  },
}));
afterEach(() => {
  mocks.workers.splice(0);
});
const input = { range: 'all' as const, environment: null };

it('bounds queued scans, serializes them, and rejects every pending request on shutdown', async () => {
  const client = new UsageWorkerClient(
    '/fixture/worker.js',
    '/fixture/db.sqlite',
    () => [],
  );
  const pending = Array.from({ length: 4 }, () =>
    client.report(input).catch((error: unknown) => error),
  );
  await expect(client.report(input)).rejects.toThrow(/could not be read/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(mocks.workers[0]?.postMessage).toHaveBeenCalledTimes(1);
  client.close();
  const errors = await Promise.all(pending);
  expect(errors.every((error) => error instanceof Error)).toBe(true);
  expect(mocks.workers[0]?.terminate).toHaveBeenCalledTimes(1);
});

it('fails a malformed worker response without exposing its payload and can restart', async () => {
  const client = new UsageWorkerClient(
    '/fixture/worker.js',
    '/fixture/db.sqlite',
    () => [],
  );
  const pending = client.report(input).catch((error: unknown) => error);
  await new Promise<void>((resolve) => setImmediate(resolve));
  mocks.workers[0]!.emit('message', { ok: true, token: 'secret-worker-payload' });
  const error = await pending;
  expect(error).toBeInstanceOf(Error);
  expect(JSON.stringify(error)).not.toContain('secret-worker');
  const retry = client.report(input).catch((value: unknown) => value);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(mocks.workers).toHaveLength(2);
  client.close();
  await retry;
});
