import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      '**/test/**/*.test.ts',
      'tests/**/*.test.ts',
      'conformance/replay.test.ts',
    ],
    coverage: {
      reporter: ['text', 'json-summary'],
    },
  },
});
