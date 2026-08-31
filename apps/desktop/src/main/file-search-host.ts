import { Worker } from 'node:worker_threads';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BuilderHelmError } from '@builderhelm/shared';

import type { FileHit } from './file-walk.js';

function workerPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'search-worker.js');
}

export class FileSearchHost {
  private worker: Worker | null = null;
  private generation = 0;
  private pendingReject: ((error: Error) => void) | null = null;

  query(root: string, query: string, limit: number): Promise<FileHit[]> {
    this.cancel();
    const generation = (this.generation += 1);
    const { promise, resolve, reject } = Promise.withResolvers<FileHit[]>();
    this.pendingReject = reject;
    let worker: Worker;
    try {
      worker = new Worker(workerPath());
    } catch (cause) {
      this.pendingReject = null;
      reject(
        new BuilderHelmError(
          'TOOL_EXECUTION_FAILED',
          'File search worker failed to start',
          {
            cause,
          },
        ),
      );
      return promise;
    }
    this.worker = worker;
    const finish = (error: Error | null, hits: FileHit[]): void => {
      if (generation !== this.generation) return;
      this.worker = null;
      this.pendingReject = null;
      worker.terminate().catch(() => undefined);
      if (error !== null) reject(error);
      else resolve(hits);
    };
    worker.once(
      'message',
      (message: { ok: boolean; hits?: FileHit[]; error?: string }) => {
        if (!message.ok) {
          finish(
            new BuilderHelmError('VALIDATION_FAILED', message.error ?? 'Search failed'),
            [],
          );
          return;
        }
        finish(null, message.hits ?? []);
      },
    );
    worker.once('error', (cause) => {
      finish(
        new BuilderHelmError('TOOL_EXECUTION_FAILED', 'File search worker crashed', {
          cause,
        }),
        [],
      );
    });
    worker.postMessage({ root, query, limit });
    return promise;
  }

  cancel(): void {
    this.generation += 1;
    const reject = this.pendingReject;
    this.pendingReject = null;
    const worker = this.worker;
    this.worker = null;
    worker?.terminate().catch(() => undefined);
    reject?.(new BuilderHelmError('VALIDATION_FAILED', 'Search cancelled'));
  }
}
