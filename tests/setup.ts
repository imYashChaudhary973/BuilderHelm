// Git exports GIT_DIR, GIT_INDEX_FILE, GIT_PREFIX and friends into any process
// it spawns: hooks, `rebase -x`, `filter-branch`, some IDE test runners.
//
// Fixtures across this suite build throwaway repositories with `execFileSync`
// and an explicit `cwd`, which is correct in a normal shell. It is not enough
// under an inherited GIT_DIR, because GIT_DIR outranks cwd — so every fixture
// `git init`, `git add`, and `git commit` retargets the real repository and
// commits fixture files onto the developer's current branch. Observed: a
// pre-push hook running `pnpm test` left this repo on a commit named
// "start fixture" with `notes.md` and `agent.txt` committed to the branch.
//
// Fixing the ~40 call sites would need a helper each one has to remember to
// use. Scrubbing the inherited environment once, here, immunises every test
// regardless of who spawned the run. Nothing in this suite reads a GIT_*
// variable it did not set itself.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('GIT_')) delete process.env[key];
}

// The scrub above also removes GIT_TERMINAL_PROMPT, which the surrounding
// environment sets to 0. Put it back: without it a fixture that ever reaches a
// remote waits on a credential prompt instead of failing, and a suite that
// hangs is harder to diagnose than one that errors.
process.env.GIT_TERMINAL_PROMPT = '0';
