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

### Environment variables

| Variable                    | Purpose                                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BUILDERHELM_DATABASE_PATH` | Use an explicit SQLite file. Defaults to `builderhelm.sqlite` in the user data directory.                                                                                   |
| `BUILDERHELM_SMOKE_TEST`    | Set to `1` by `pnpm smoke:desktop`. Forces a temporary database, keeps the window hidden, and exits once the renderer reports ready. Overrides `BUILDERHELM_DATABASE_PATH`. |
| `BUILDERHELM_DEBUG_PORT`    | Exposes a Chrome DevTools Protocol endpoint on that port so external tooling can attach to the renderer.                                                                    |
| `BUILDERHELM_PTY_PROBE`     | Spawns one throwaway PTY in the given directory at startup and logs the result. Use when diagnosing terminal spawn failures.                                                |

Never point these at live user data. `BUILDERHELM_SMOKE_TEST` and
`BUILDERHELM_PTY_PROBE` are diagnostics, not product configuration.

## Migrating from a pre-reset build

The architecture reset renamed the local database, the keychain service, and the
first migration. Nothing is migrated automatically. See
[MIGRATION.md](MIGRATION.md) for the one-time cleanup steps.

## Checks

```bash
pnpm check:architecture
pnpm check:licenses
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:desktop
```

`pnpm verify` runs the architecture and licence guards, formatting, lint, types,
tests, and the desktop build. Run focused tests while iterating and the complete
relevant gate before review.

## Third-party licences

BuilderHelm is proprietary but ships permissively licensed components, which
obliges us to reproduce their copyright and licence text in the distribution.

- `pnpm check:licenses` fails on any shipped dependency that is reciprocal
  (GPL, AGPL, LGPL) or commercially restricted (SSPL, BUSL, non-commercial).
  Only production dependencies count; build and test tooling is never shipped.
- `pnpm notices` regenerates `THIRD_PARTY_NOTICES.txt` from the resolved
  production graph. `pnpm build` and `pnpm dist` run it automatically.
- Packaging copies that file plus Electron's `LICENSES.chromium.html`, which
  also carries the Chromium, Node.js, and LGPL ffmpeg texts, into the app
  resources. The Help menu opens all three.
- Keep ffmpeg dynamically linked. LGPL is satisfied by the separate
  `libffmpeg.dylib`; statically linking it would not be.

Adding a dependency with an unrecognised licence fails the guard on purpose.
Clear it, then add it to the allowlist in `scripts/check-licenses.mjs`.

## Native dependencies

`node-pty`, Electron, and the credential adapter contain platform binaries.
Keep their build scripts allowlisted in `pnpm-workspace.yaml`, pin versions, and
exercise packaging on each supported operating system.

## Documentation

Update `STATUS.md` when behavior changes, the matching feature contract when
scope changes, `ARCHITECTURE.md` when a boundary changes, and an ADR when a
durable decision changes.
