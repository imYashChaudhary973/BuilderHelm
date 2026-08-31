import { parentPort } from 'node:worker_threads';

import { walkFileNames } from './file-walk.js';

parentPort?.on(
  'message',
  (message: {
    readonly root: string;
    readonly query: string;
    readonly limit: number;
  }) => {
    try {
      const hits = walkFileNames(message.root, message.query, { limit: message.limit });
      parentPort?.postMessage({ ok: true, hits });
    } catch (cause) {
      parentPort?.postMessage({
        ok: false,
        error: cause instanceof Error ? cause.message : 'Search failed',
      });
    }
  },
);
