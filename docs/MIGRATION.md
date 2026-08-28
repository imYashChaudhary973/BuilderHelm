# Migrating from a pre-reset build

One-time transition notes for installs that predate the TypeScript architecture
reset ([ADR 0007](adr/0007-typescript-platform.md)). Delete this document once no
pre-reset install remains.

This is the only document permitted to quote retired product identifiers, so the
architecture guard skips it. Do not add current guidance here.

## Database

The local database filename changed, so a fresh database is created and the old
file is simply left behind. The default path needs no action.

Pointing `BUILDERHELM_DATABASE_PATH` at a database created before the reset
fails closed with `MIGRATION_FAILED` and an explanatory dialog, because the
first migration was renamed and its metadata table no longer matches. Move that
file aside or choose a new path. There is no automatic upgrade.

Old databases are named `zero.sqlite`; current ones are `builderhelm.sqlite`.

## Provider credentials

Provider credentials must be entered again. Credentials stored by the previous
build are left in place rather than deleted, so nothing is destroyed if you roll
back.

Those items are unreachable by the current build: it reads only the
`app.builderhelm.credentials` service. They stay protected by the operating
system, but they are orphaned. After re-entering credentials, remove them:

```bash
# Inspect first. This prints metadata, not secret values.
security find-generic-password -s 'app.zero-os.credentials'

# Delete one entry at a time, repeating until none remain.
security delete-generic-password -s 'app.zero-os.credentials'
```

BuilderHelm never deletes keychain items it does not own, so this stays a
deliberate manual step.

## Environment variables

Every `ZERO_`-prefixed variable was renamed to `BUILDERHELM_`. Update shell
profiles, run configurations, and scripts. The current set is documented in
[DEVELOPMENT.md](DEVELOPMENT.md).

## Stale Rust build output

Checkouts that built the retired Rust workspace still hold a `target/`
directory, often several gigabytes per worktree. Nothing reads it now. It stays
listed in `.gitignore` and `.prettierignore` so it can never be staged or
linted, but it is pure dead weight:

```bash
# Per worktree. Check the size first, then remove.
du -sh target && rm -rf target
```
