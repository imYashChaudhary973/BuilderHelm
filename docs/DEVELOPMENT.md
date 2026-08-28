# Development

## Requirements

- Node.js 24.18.0 or newer within Node 24 LTS.
- pnpm 11.16.0 through Corepack.
- Git with worktree support.
- macOS for the currently verified Electron runtime.

```bash
corepack enable
pnpm install
```

## Worktrees

Never implement a feature in the canonical `main` worktree. From the canonical
checkout, create one worktree per concern:

```bash
scripts/worktree-add short-name
```

Use `scripts/worktree-status` to inspect active BuilderHelm worktrees. Do not
remove a worktree while it owns a running Electron process, terminal, or server.

## Run the desktop

Use an isolated database while developing:

```bash
BUILDERHELM_DATABASE_PATH=/private/tmp/builderhelm-dev.sqlite pnpm dev
```

## Checks

```bash
pnpm check:architecture
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:desktop
```

`pnpm verify` runs formatting, lint, types, tests, and the desktop build. Run
focused tests while iterating and the complete relevant gate before review.

## Native dependencies

`node-pty`, Electron, and the credential adapter contain platform binaries.
Keep their build scripts allowlisted in `pnpm-workspace.yaml`, pin versions, and
exercise packaging on each supported operating system.

## Documentation

Update `STATUS.md` when behavior changes, the matching feature contract when
scope changes, `ARCHITECTURE.md` when a boundary changes, and an ADR when a
durable decision changes.
