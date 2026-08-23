# Implementation Status

- Last reviewed: 2026-08-24
- Baseline: BuilderHelm chrome landed on `main` at `c9726ab`
- Active work: Git stage/commit on `feat/editor`

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
| Brand | BuilderHelm name, tagline, helm mark |
| Chrome | Icon tools panel, 18–60% resize, Space rail |
| Browser | Localhost preview, recents, last tab, stage-clipped BrowserView |
| Editor | Workspace-scoped tree, tabs, save / save-all / autosave, word wrap |
| Git | Branch, staged vs worktree, history (read-only until the next slice) |

## Current application surfaces

- Space (home, workspace setup, agent pick, live terminals)
- App chrome (top bar + left rail + tools panel)
- Browser, editor, and Git sidebars
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

Unsigned macOS `BuilderHelm.app`: `pnpm --filter @zero/desktop dist`.

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
- Swarm, Kanban Board, Memory, Skills, Git write (stage/commit), Bridge,
  and phone pairing are not built yet.
