import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const directory = fileURLToPath(new URL('.', import.meta.url));

/** Branch and short SHA of the tree this bundle was built from. */
function buildStamp(): string {
  try {
    const git = (args: readonly string[]): string =>
      execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
    return `${git(['rev-parse', '--abbrev-ref', 'HEAD'])}@${git(['rev-parse', '--short', 'HEAD'])}`;
  } catch {
    return 'unknown';
  }
}

// Preventive, not the active compliance mechanism. esbuild defaults
// `legalComments` to dropping them and, unlike Terser, has no `@license`
// heuristic, so enabling minification later would silently delete dependency
// copyright lines. `external` writes them beside the bundle instead.
//
// This does not by itself restore every banner today: minification is off, and
// @rollup/plugin-commonjs drops the leading banner of CJS dependencies such as
// React during interop. Attribution is therefore carried by the generated
// THIRD_PARTY_NOTICES.txt, which reproduces each dependency's full licence text
// and is what the MIT and BSD terms actually require.
const preserveLegalComments = { legalComments: 'external' } as const;

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@builderhelm/core',
          '@builderhelm/db',
          '@builderhelm/model-gateway',
          '@builderhelm/observability',
          '@builderhelm/protocol',
          '@builderhelm/shared',
        ],
      }),
    ],
    esbuild: preserveLegalComments,
    build: {
      rollupOptions: {
        input: { index: resolve(directory, 'src/main/index.ts') },
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@builderhelm/protocol',
          '@builderhelm/shared',
          '@builderhelm/shared/error',
          'zod',
        ],
      }),
    ],
    esbuild: preserveLegalComments,
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
    esbuild: preserveLegalComments,
    define: {
      __BUILD_STAMP__: JSON.stringify(buildStamp()),
    },
    // Vite handles TSX directly. Avoiding the React refresh preamble keeps the
    // development renderer compatible with the same strict CSP as production.
    plugins: [],
  },
});
