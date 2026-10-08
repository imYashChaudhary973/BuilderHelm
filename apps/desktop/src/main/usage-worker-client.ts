import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { LoginLocation } from '@builderhelm/core';
import type { UsageReport, UsageReportInput } from '@builderhelm/protocol/usage';
import { BuilderHelmError } from '@builderhelm/shared';
import {
  usageWorkerRequestSchema,
  usageWorkerResponseSchema,
} from './usage-worker-protocol.js';

/** History scans and aggregation run off Electron main, with one bounded queue. */
export class UsageWorkerClient {
  private worker: Worker | null = null;
  private closed = false;
  private queued = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private pending: {
    id: string;
    resolve: (value: UsageReport) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  constructor(
    private readonly entryPath: string,
    private readonly databasePath: string,
    private readonly logins: () => LoginLocation[],
  ) {}

  report(input: UsageReportInput): Promise<UsageReport> {
    if (this.closed || this.queued >= 4) return Promise.reject(this.failure());
    this.queued += 1;
    const request = this.tail
      .then(() => this.read(input))
      .finally(() => {
        this.queued -= 1;
      });
    this.tail = request.catch(() => undefined);
    return request;
  }
  private read(input: UsageReportInput): Promise<UsageReport> {
    if (this.closed) return Promise.reject(this.failure());
    const request = usageWorkerRequestSchema.parse({
      id: randomUUID(),
      input,
      logins: this.logins(),
    });
    if (this.worker === null) {
      const worker = new Worker(this.entryPath, {
        workerData: { databasePath: this.databasePath },
      });
      this.worker = worker;
      worker.on('message', (raw: unknown) => {
        const response = usageWorkerResponseSchema.safeParse(raw);
        const pending = this.pending;
        if (pending === null) return;
        if (!response.success || response.data.id !== pending.id) {
          this.stop(worker);
          return;
        }
        clearTimeout(pending.timer);
        this.pending = null;
        if (response.data.ok) pending.resolve(response.data.value);
        else pending.reject(this.failure());
      });
      worker.on('error', () => this.stop(worker));
      worker.on('exit', () => this.stop(worker));
    }
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop(worker), 60_000);
      this.pending = { id: request.id, resolve, reject, timer };
      worker.postMessage(request);
    });
  }
  private failure(): Error {
    return new BuilderHelmError(
      'INTEGRATION_OFFLINE',
      'Usage history could not be read. Refresh to try again; saved records are kept.',
    );
  }
  private stop(worker: Worker): void {
    if (this.worker !== worker) return;
    this.worker = null;
    const pending = this.pending;
    this.pending = null;
    if (pending !== null) {
      clearTimeout(pending.timer);
      pending.reject(this.failure());
    }
    void worker.terminate();
  }
  close(): void {
    this.closed = true;
    if (this.worker !== null) this.stop(this.worker);
  }
}
