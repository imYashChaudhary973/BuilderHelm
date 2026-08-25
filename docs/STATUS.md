# Implementation Status

- Last reviewed: 2026-08-25
- Baseline: BuilderHelm chrome landed on `main` at `c9726ab`
- Active work: Swarm execution engine on `feat/swarm-v2`

What the repository implements now. Product intent lives in
[PRODUCT](PRODUCT.md), [UX](UX.md), and [ROADMAP](ROADMAP.md).

## Shipped

| Surface       | Capability                                                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation    | pnpm workspace, secure Electron boundary, SQLite migrations, typed IPC, observability                                                                                                                                                                                 |
| Providers     | Keychain-backed settings, discovery, audit events                                                                                                                                                                                                                     |
| Model gateway | Provider-independent adapters, streaming chat, canonical history                                                                                                                                                                                                      |
| Memory        | Left-rail BuilderHelm Memory, local Obsidian indexing, cited answers and source previews                                                                                                                                                                              |
| Actions       | Schema-backed tools, permissions, approvals, receipts                                                                                                                                                                                                                 |
| Projects      | Dashboard, Git status and history, Today summary                                                                                                                                                                                                                      |
| Space         | BuilderHelm Space home, wizard, per-pane agents, live xterm grid                                                                                                                                                                                                      |
| Brand         | BuilderHelm name, tagline, helm mark                                                                                                                                                                                                                                  |
| Chrome        | Left feature rail, icon tools panel, 18–60% resize                                                                                                                                                                                                                    |
| Browser       | Localhost preview, recents, last tab, stage-clipped BrowserView                                                                                                                                                                                                       |
| Editor        | Workspace-scoped tree, tabs, save / save-all / autosave, word wrap                                                                                                                                                                                                    |
| Git           | Branch, staged vs worktree, history, stage, unstage, commit                                                                                                                                                                                                           |
| Board         | Project chooser, independent persisted boards, left-rail project tabs, drag-and-drop stages                                                                                                                                                                           |
| Swarm         | Mission / roster / launch wizard, Skiff 3 · Cutter 5 · Frigate 8 · Flagship 12, per-seat CLI, 18 skills, live graph + `@all` bar                                                                                                                                      |
| Swarm engine  | Headless argv seats (8 CLIs, safe / auto-edit / full modes), structured decomposition with exclusive file ownership, worktree per seat, verify gate, review gate, land queue, retry-once, budget clock, resume from ledger, token and cost metering (`feat/swarm-v2`) |

## Current application surfaces

- BuilderHelm Space (home, workspace setup, agent pick, live terminals)
- BuilderHelm Board (multi-project Kanban with isolated tasks and drag and drop)
- BuilderHelm Memory (private Obsidian recall with inspectable citations)
- BuilderHelm Swarm (wizard, helm-size presets, live graph and terminals)
- App chrome (top bar + left feature rail + tools panel)
- Browser, editor, and Git tools tabs
- Provider and model settings
- Multi-provider chat
- Permissioned actions, tasks, and receipts
- Projects and Git continuity
- Today dashboard

## Current architecture

The Electron renderer is unprivileged and talks to the local core only
through an explicit preload API and schema-validated IPC. The core owns
SQLite, model policy, provider credentials, knowledge retrieval,
permission decisions, and tool execution. Provider wire formats stay
inside `@zero/model-gateway`.

SQLite is at migration 12. Migration 11 adds Kanban review and cancelled
columns. Migration 12 stores swarm runs, seats, tasks, and an append-only
message ledger, so a swarm survives a restart and can resume.

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
- Swarm runs on `feat/swarm-v2`. Mid-flight roster edits and Bridge are not built yet.
- Swarm seats run headless one task at a time; kiro-cli has no headless mode and cannot take a seat.
- Decomposition needs a CLI that constrains output to a JSON Schema (claude or grok). Without one a swarm runs the mission as a single task.
