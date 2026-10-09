# Local development entry

Status: implemented on `feat/local-development`, based on the unmerged
`feat/providers` usage feature. This is an opt-in desktop development entry.

Run from its worktree:

```sh
pnpm dev:local
```

The launcher opens the local workspace and displays **Local · signed out** in
the title bar. That control returns to the sign-in screen, where **Continue
locally** reopens the workspace. Reentry closes an outstanding browser handoff.
An actual sign-in replaces local mode; signing out afterward returns to the gate.
Reloading an opted-in dev server starts local mode again.

This mode does not sign an account in. Existing valid sessions are still honored;
without one, the real account service stays signed out. It creates no account,
session token, licence, subscription entitlement, or provider credential. Local
tools use their existing permissions and the installed CLI's own login. Account
services still require their normal authenticated session. Settings → Account
continues to show **Not signed in**.

The launcher creates a new temporary SQLite file and Electron user-data directory
on each run, prints their parent path, and retains those files when the app exits.
It clears inherited smoke/debug/entry overrides, spawns fixed executables with
argument arrays, and stops only its owned child process tree. Development data
is separate from the normal app profile. Keychain keeps its existing application
ownership and permission rules.

`BUILDERHELM_LOCAL_DEVELOPMENT=1` enables entry only under `electron-vite dev`.
Every build compiles the flag to false, even with that variable set. The renderer
also requires `import.meta.env.DEV`. A packaged app ignores
`ELECTRON_RENDERER_URL` and loads its own gated renderer. Normal `pnpm dev`
without the explicit opt-in retains the sign-in gate.

Focused configuration tests cover default-off behavior, the exact opt-in, and
production/development build rejection. A native Electron walkthrough verifies
entry, return to sign-in, Continue locally, and the signed-out Account page using
isolated data. The unsigned macOS arm64 package passes startup smoke with the
development flag set and an unreachable inherited renderer URL, demonstrating that
it loads its own renderer. Packaged click-through, Windows/Linux, mobile, CLI clients,
remote connections, and live account sign-in are outside this evidence.
