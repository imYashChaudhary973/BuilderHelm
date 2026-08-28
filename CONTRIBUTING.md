# Contributing to BuilderHelm

BuilderHelm is developed in small, reviewable branches. The repository is
private; access does not grant permission to redistribute its code or assets.

## Before you start

1. Read [AGENTS.md](AGENTS.md), [Architecture](docs/ARCHITECTURE.md), and
   [Status](docs/STATUS.md).
2. Confirm the requested behavior and the surfaces it affects.
3. Create a feature worktree from the current `origin/main`.
4. Keep unrelated local changes and credentials out of the worktree.

```bash
scripts/worktree-add short-name
```

## Technical rules

- Product source is TypeScript. Do not add Rust, Cargo files, crates, or a Rust sidecar.
- Keep Electron main responsive; move blocking or crash-prone work to a utility process.
- Keep renderers sandboxed with context isolation and no Node integration.
- Validate IPC, network, file, Git, and provider inputs before side effects.
- Use `execFile`/spawn argument arrays. Never interpolate untrusted text into a shell command.
- Give parallel agents separate branches and worktrees.
- Keep secrets in operating-system credential storage, never source, logs, SQLite, or mobile.
- Prefer existing packages and platform APIs over new dependencies.

## Change shape

- One concern per branch and pull request.
- Add the smallest test that would fail if the behavior regressed.
- Update user-facing or architecture documentation in the same change.
- Do not commit generated output, personal screenshots, databases, credentials, or agent scratch files.
- Use Conventional Commit subjects: `type(scope): imperative summary`.

## Verification

Run the smallest focused checks while working. Before asking for review, run:

```bash
pnpm check:architecture
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:desktop
```

If a platform or external service was not exercised, state that limitation.

## Pull requests

Explain the problem, the implemented behavior, verification performed, and any
known limitation. UI changes need visual evidence. Security, credentials,
permissions, remote control, and destructive Git behavior always require human
review before landing.
