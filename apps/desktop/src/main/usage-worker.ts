import { parentPort, workerData } from 'node:worker_threads';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { openDatabase, SettingsRepository } from '@builderhelm/db';
import { PricingService, UsageService, type LoginLocation } from '@builderhelm/core';
import {
  usageWorkerRequestSchema,
  usageWorkerResponseSchema,
} from './usage-worker-protocol.js';

const config = z
  .object({ databasePath: z.string().refine(isAbsolute) })
  .strict()
  .parse(workerData);
const database = openDatabase(config.databasePath);
// Wait for short app writes in the background worker; never block Electron main.
database.execute('PRAGMA busy_timeout = 5000');
let logins: LoginLocation[] = [];
const pricing = new PricingService(new SettingsRepository(database));
const usage = new UsageService(database, { logins: () => logins }, pricing, {
  debug() {},
  info() {},
  warn() {},
  error() {},
});
const port = parentPort;
if (port === null) throw new Error('Usage worker needs its host port');
// The host sends one request at a time. No provider responses or credentials
// cross this boundary; only login locations and validated usage reports do.
port.on('message', async (raw: unknown) => {
  const request = usageWorkerRequestSchema.safeParse(raw);
  if (!request.success) return;
  const { id, input } = request.data;
  logins = request.data.logins;
  try {
    const value = await usage.report(input);
    port.postMessage(usageWorkerResponseSchema.parse({ id, ok: true, value }));
  } catch {
    port.postMessage(usageWorkerResponseSchema.parse({ id, ok: false }));
  }
});
port.on('close', () => database.close());
