import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const directory = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@zero/core',
          '@zero/db',
          '@zero/model-gateway',
          '@zero/observability',
          '@zero/protocol',
          '@zero/shared',
        ],
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(directory, 'src/main/index.ts'),
          'pty-host': resolve(directory, 'src/main/pty-host.ts'),
        },
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@zero/protocol', '@zero/shared', '@zero/shared/error', 'zod'],
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(directory, 'src/renderer'),
    // Vite handles TSX directly. Avoiding the React refresh preamble keeps the
    // development renderer compatible with the same strict CSP as production.
    plugins: [],
  },
});
