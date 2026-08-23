# Implementation Status

- Last reviewed: 2026-08-24
- Baseline: browser sidebar landed on `main` at `eb5b4fc`
- Active work: none. Next slice is the right-sidebar editor

What the repository implements now. Product intent lives in
[PRODUCT](PRODUCT.md), [UX](UX.md), and [ROADMAP](ROADMAP.md).

## Shipped

| Surface | Capability |
| --- | --- |
| Foundation | pnpm workspace, secure Electron boundary, SQLite migrations, typed IPC, observability |
| Providers | Keychain-backed settings, discovery, audit events |
| Model gateway | Provider-independent adapters, streaming chat, canonical history |
| Knowledge | Read-only Obsidian retrieval with citations |
| Actions | Schema-backed tools, permissions, approvals, receipts |
| Projects | Dashboard, Git status and history, Today summary |
| Space | Home, wizard, Open without AI, per-pane agents, live xterm grid |
| Chrome | Top bar modes, stacked Space rail |
| Browser | Right sidebar preview for http(s) and localhost |

## Current application surfaces

- Space (home, workspace setup, agent pick, live terminals)
- App chrome (top bar + left rail)
- Browser sidebar (http/https and localhost preview)
- Provider and model settings
- Multi-provider chat
- Obsidian knowledge retrieval
- Permissioned actions, tasks, and receipts
- Projects and Git continuity
- Today dashboard

## Current architecture

The Electron renderer is unprivileged and talks to the local core only
through an explicit preload API and schema-validated IPC. The core owns
SQLite, model policy, provider credentials, knowledge retrieval,
permission decisions, and tool execution. Provider wire formats stay
inside `@zero/model-gateway`.

SQLite is at migration 8. Migration 7 stores project repository snapshots.
Migration 8 stores Space presets.

Unsigned macOS `Zero.app`: `pnpm --filter @zero/desktop dist`.

## Verification

```bash
pnpm verify
pnpm smoke:desktop
```

## Known scope boundaries

- macOS is the supported desktop runtime. Keychain is fail-closed.
- Local Ollama may use loopback HTTP. Remote credentialed providers must
  use HTTPS.
- Models can propose actions. Application code validates permission and
  executes them.
- Ready work lands on `main`. Permission or security changes still use a PR.
- Windows and Linux desktops are not verified yet.
- Swarm, Kanban Board, Memory mode, editor/Git sidebars, and phone pairing
- are not built yet.
