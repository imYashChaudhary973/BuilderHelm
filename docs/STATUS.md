# Implementation Status

No feature freeze. Active work lands on the hybrid stack: Rust core engine +
TypeScript platform ([STACK](STACK.md), [ADOPTION](ADOPTION.md)).

- Last reviewed: 2026-08-28
- Baseline: ADOPTION phase A landed on `main` at `44f6985`
- Active work: phase B, terminal/PTY cutover ([ADOPTION](ADOPTION.md))
- **Hybrid architecture** ([ADR 0006](adr/0006-hybrid-architecture.md), [ADOPTION](ADOPTION.md)): Rust core engine + TypeScript platform. The full-Rust migration was cancelled ([ADR 0005](adr/0005-rust-migration.md), superseded).

What the repository implements now. Product intent lives in
[PRODUCT](PRODUCT.md), [UX](UX.md), [ROADMAP](ROADMAP.md), and [ADE](ADE.md).

## Shipped

| Surface       | Capability                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation    | pnpm workspace, secure Electron boundary, SQLite migrations, typed IPC, observability                                                     |
| Providers     | Keychain-backed settings, discovery, audit events                                                                                         |
| Model gateway | Provider-independent adapters, streaming chat, canonical history                                                                          |
| Memory        | Left-rail BuilderHelm Memory, local Obsidian indexing, cited answers and source previews                                                  |
| Actions       | Schema-backed tools, permissions, approvals, receipts                                                                                     |
| Projects      | Dashboard, Git status and history, Today summary                                                                                          |
| Space         | BuilderHelm Space home, wizard, per-pane agents, live xterm grid                                                                          |
| Brand         | BuilderHelm name, tagline, helm mark                                                                                                      |
| Chrome        | Square plus opens home; workspace icons with rename/color/close; expanded name + terminal count; no build stamp                           |
| Browser       | Localhost preview, recents, last tab, stage-clipped BrowserView                                                                           |
| Editor        | Workspace-scoped tree, tabs, save / save-all / autosave, word wrap                                                                        |
| Git           | Branch, staged vs worktree, history, stage, unstage, commit                                                                               |
| Board         | Project chooser, independent persisted boards, drag-and-drop stages                                                                       |
| Swarm         | Mission / roster / launch, helm presets, per-seat CLI, live graph, `@all`, Plan / Activity / Roster, mid-flight add/stop                  |
| Swarm engine  | PATH CLIs in PTYs (Grok interactive; others headless argv), exclusive files, worktree per builder, verify + review + land, budget, resume |
| Engine bridge | Rust `helm-app engine` sidecar behind the existing IPC shape: NDJSON over stdio, verified handshake, bounded restart, redacted stderr     |

## Current application surfaces

- BuilderHelm Space (home, workspace setup, agent pick, live terminals)
- BuilderHelm Board (multi-project Kanban with isolated tasks and drag and drop)
- BuilderHelm Memory (private Obsidian recall with inspectable citations)
- BuilderHelm Swarm (wizard, helm-size presets, live graph and terminals)
- App chrome (top bar + square plus rail of workspaces + tools panel)
- Browser, editor, and Git tools tabs
- Provider and model settings
- Permissioned actions, tasks, and receipts
- Projects and Git continuity
- Today dashboard

## Engine status

The Rust engine (`crates/`) runs as a bundled **sidecar** child of Electron
main, not an in-process addon: newline-delimited JSON over stdio, local-only,
no TCP listener. Phase A of [ADOPTION](ADOPTION.md) landed on 2026-08-27. The
preload API and every namespace are unchanged, so each channel still executes
on its TypeScript handler; the bridge is stood up and verified ahead of the
cutover. The renderer-cutover phases of the old migration plan are cancelled;
the Electron renderer ships.

| Surface            | Count                                               |
| ------------------ | --------------------------------------------------- |
| IPC channels       | 71 served by the engine, 69 known to the platform   |
| Schema migrations  | 12                                                  |
| Database tables    | 31                                                  |
| UI routes          | 8 plus settings                                     |
| TypeScript tests   | 221 in 46 files                                     |
| Rust tests         | 301                                                 |
| Conformance corpus | 218 fixtures, green in-process and over the sidecar |

Channel mismatch is asymmetric on purpose: a channel the platform calls but
the engine does not serve is fatal, while a channel the engine serves ahead of
its caller is a warning. The engine has no event emitter yet, so the handshake
advertises zero events and `zero:board:event`, `zero:chat:stream-event`, and
`zero:swarm:event` stay on TypeScript until phases B and C.

Source: 15,566 lines of portable domain logic, 3,831 Electron-coupled,
8,241 renderer. `src/` only.

## Current architecture

The Electron renderer is unprivileged and talks to the local core only
through an explicit preload API and schema-validated IPC. The core owns
SQLite, model policy, provider credentials, knowledge retrieval,
permission decisions, and tool execution. Provider wire formats stay
inside `@zero/model-gateway`.

SQLite is at migration 12. Migration 11 rebuilds Kanban cards for the
cancelled review stage. Migration 12 stores swarm runs, seats, tasks, and
messages.

Unsigned macOS `BuilderHelm.app`: `pnpm --filter @zero/desktop dist`.

## Verification

```bash
pnpm verify
pnpm smoke:desktop
HELM_ENGINE_BIN=target/debug/helm-app pnpm smoke:desktop
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run -p helm-app -- --conformance
cargo run -p helm-app -- --conformance-sidecar . target/debug/helm-app
```

## Known scope boundaries

- macOS is the only verified desktop runtime today. Secret storage is
  fail-closed on every platform.
- Local Ollama may use loopback HTTP. Remote credentialed providers must
  use HTTPS.
- Models can propose actions. Application code validates permission and
  executes them.
- Ready work lands on `main`. Permission or security changes still use a PR.
- Windows and Linux desktops are not verified yet; they are Phase D targets
  of [ADOPTION](ADOPTION.md) (ConPTY, Credential Manager, DX12 on Windows).
- Swarm runs on `main`. Bridge overlay is not built. Local MCP is not built.
- Named Agents, Routines, the GitHub plugin row, migration 0013, and the
  Agent / Code / Chat mode switch ([ADE](ADE.md)) are parked unmerged on
  `wip/helm-platform`. They are not in the app today.
- The packaged-build home for the sidecar binary (resources directory,
  arch-specific naming, notarization) is still open. It blocks packaging, not
  phases B through D.
- Grok **planner/reviewer** still uses `grok -p` (Grok Build, 402 even when Super Grok chat has quota). Seats use interactive grok (no `-p`). kiro-cli cannot take a seat.
- Worktrees stay serial; pane PTYs spawn concurrently after locate (P0-2). Login
  shell is still `zsh -i`. Fixture: `conformance/board/createSession/`.
- Electron `BrowserView` (browser panel) was **cut for v1** on 2026-08-27
  (Gate 3 retro). The Browser sidebar tab stays a recorded placeholder; the
  `browser.command` IPC method stays in the corpus with no UI. Revisit a
  webview-based panel (wry or Electron-native) when the platform suite opens.
