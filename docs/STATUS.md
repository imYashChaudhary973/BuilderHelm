# Implementation status

Last reviewed: 2026-08-28.

This document distinguishes working code from planned product scope. A feature
is not shipped merely because a route, mock, fixture, or documentation page exists.

## Working in the repository

- Secure Electron main/preload/renderer boundary.
- TypeScript application services and Zod-validated IPC.
- SQLite migrations and repositories.
- Keychain-backed provider settings.
- Provider-independent model gateway and canonical chat history.
- Permissioned actions, approvals, and receipts.
- Project dashboard and Git continuity.
- Space setup with real xterm.js terminals backed by node-pty.
- Per-pane installed-agent selection and plain-shell mode.
- Board project selection, persistence, stages, and drag-and-drop.
- Memory vault selection, local Markdown indexing, answers, and citations.
- Editor tree, tabs, save, save-all, autosave, and word wrap.
- Git status, history, stage, unstage, and commit.
- Swarm mission, roster, CLI seats, live state, directives, budgets, and worktree flow.

## Partial or needing hardening

- Swarm verification, review, landing, stop/reconnect, and failure recovery.
- Terminal throughput and renderer batching under sustained multi-pane output.
- Consistent agent capability detection and structured-output adapters.
- Cross-platform shell, path, credential, and PTY behavior.
- The Node 24 and Electron 43 upgrade still needs packaged desktop verification.

## Planned, not shipped

- Built-in browser interaction and UI-element handoff.
- Unified diff, test, CI, conflict, commit, and pull-request review surface.
- GitHub and Linear task integrations.
- Global search across worktrees, files, agents, commands, and artifacts.
- Rich development notes with slash commands and inline logs.
- Usage, quota, rate-limit, and account-switching UI.
- Optional encrypted relay and remote host pairing.
- React Native iOS and Android companion.
- Verified Windows and Linux desktop distributions.
- Signed installers, auto-update, notarization, and release channels.

## Current verification boundary

macOS is the only exercised desktop platform. Windows, Linux, mobile, relay,
real hosted CI integration, and release signing require future evidence.

## Architecture-reset compatibility

This reset changes internal package names, IPC channel names, environment
variables, the local database filename, and the Keychain service name. Existing
development databases are not migrated automatically, and provider credentials
must be entered again. Previous Keychain items are left untouched rather than
deleted. Startup fails closed with an explanatory dialog rather than silently
when a database predates the reset.

See [MIGRATION.md](MIGRATION.md) for the one-time cleanup steps.
