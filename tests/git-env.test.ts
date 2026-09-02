import { expect, it } from 'vitest';

// Guards tests/setup.ts. An inherited GIT_DIR outranks the `cwd` every git
// fixture in this suite passes, so it redirects fixture commits into the real
// repository. If the scrub is ever dropped, fail here rather than in a
// developer's branch history.
it('runs with no inherited git environment', () => {
  const leaked = Object.keys(process.env)
    .filter((key) => key.startsWith('GIT_'))
    .filter((key) => key !== 'GIT_TERMINAL_PROMPT');

  expect(leaked).toEqual([]);
  expect(process.env.GIT_TERMINAL_PROMPT).toBe('0');
});
