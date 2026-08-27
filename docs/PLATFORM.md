# BuilderHelm platform

Last reviewed: 2026-08-27. Architecture: [STACK](STACK.md). Adoption plan:
[ADOPTION](ADOPTION.md).

BuilderHelm is a local-first coding platform built from a Rust core engine and
a TypeScript desktop platform. Developers build through CLI agents, voice,
workflow automation, and a shared workspace without switching between tools.

## Product suite

| Product                       | Purpose                                                                               | Current state                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **BuilderHelm**               | The desk: Space, Swarm, Board, Memory, Agent, Code, Chat in one shell                 | Space, Board, Memory, chrome, editor/Git sidebars ship; Agent/Code/Chat are next |
| **Swarm Builder**             | Multi-agent collaboration: mission, roster, task graph, worktrees, verify/review/land | Built on `feat/swarm-v2`; P0 hardening remains                                   |
| **Terminal Workflow Builder** | Agent-native workflows described in natural language; scan, plan, implement, verify   | Planned after the hybrid bridge and Swarm P0                                     |
| **Helm Code**                 | Standalone CLI-first coding engine on the same Rust core                              | Planned product                                                                  |

Planned platform surfaces:

- **BuilderHelm Voice** — privacy-first, on-device voice for hands-free coding,
  commit messages, documentation, comments, and communication.
- **BuilderHelm MCP** — MCP-standard multi-agent collaboration and task-board
  access.
- **Helm Transform** — natural-language programming: describe a feature; the
  agent scans the codebase, folds context, creates a plan, implements across
  files, and verifies the result.
- Integrations with Cursor-compatible tooling, Windsurf-compatible tooling,
  and open MCP standards.

## Architecture ownership

| Layer         | Rust core engine                                                         | TypeScript platform                           |
| ------------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| Core services | Settings, models, chat, actions, knowledge, projects, board, persistence | Calls the typed engine contract               |
| Agent runtime | Swarm orchestration, seat phases, permissions, PTY lifecycle             | Setup/live UI, graph, transcript, task board  |
| Terminal      | PTY spawn/resize/stream, platform shell selection                        | xterm.js rendering, pane layout, interaction  |
| Desktop       | Native dialogs, keyring, git subprocess, filesystem scope                | Electron/React shell, editor, browser, Git UI |
| Integration   | Engine-side MCP and CLI capabilities                                     | Cursor/Windsurf/MCP coordination and UX       |

The preload API remains the renderer boundary. Phase A of
[ADOPTION](ADOPTION.md) replaces TypeScript core implementations behind that
API with the Rust engine; the renderer does not need a rewrite.

## Desktop modes

Seven top-bar items, one window:

| Nav        | Organizes around       | You see                                  | Engine                             |
| ---------- | ---------------------- | ---------------------------------------- | ---------------------------------- |
| **Space**  | One folder, you drive  | xterm grid                               | Optional CLI per pane              |
| **Swarm**  | One mission            | Queen + crew, graph, terminal/diff views | Rust swarm engine + PATH CLIs      |
| **Board**  | Human Kanban           | Project boards and cards                 | SQLite task contract               |
| **Memory** | Local vault            | Cited recall and source previews         | Rust retrieval engine              |
| **Agent**  | Named teammate         | Brief, memory, skills, places, chats     | Durable agent + CLI thread         |
| **Code**   | Project folder         | Terminal, thread, files, Git             | Rust engine + TypeScript editor UI |
| **Chat**   | Unmounted conversation | Threads, attachments, model picker       | Subscription CLI or API wallet     |

## Agent and Code

A named Agent is **name + brief + memory + skills + allowed folders + chats**.
Claude Code, Codex, Grok Build, and other detected CLIs can power it; they are
not the durable teammate.

Code is Space with a thread and preset launcher:

- Solo: one terminal and one thread.
- Pair: two agents with explicit file ownership.
- Swarm: current Swarm workflow and worktree isolation.
- Workbench: terminal, thread, files, Git, and optional browser/plugin panels.

## Model pipes

Every composer labels which billing/credential path it uses:

| Pipe                 | Pays through                                     | Surfaces                 |
| -------------------- | ------------------------------------------------ | ------------------------ |
| **Subscription CLI** | Claude Max, ChatGPT/Codex, Grok Build CLI        | Agent, Code, Swarm seats |
| **API wallet**       | OpenAI, Anthropic, xAI, OpenRouter/OpenCode keys | Chat, Memory answers     |

Grok Build CLI and Super Grok chat are separate quota pools. The UI never
claims otherwise.

## Plugins and routines

- **Skill**: reusable text instructions; no secret.
- **Plugin**: acts on an external service. Credentials stay in the platform
  keyring. Reads may auto-run; write/spend/publish actions require permission
  policy and immutable receipts.
- **Routine**: schedules a named Agent while BuilderHelm is open. Every run is
  a fresh chat; default outcome is a draft. No unattended publish, delete, or
  payment.

First plugins: GitHub, then one communications integration. Do not build a
large catalog before the permission loop is proven.

## Product principles

1. **Local first.** The machine is the source of truth; LAN/cloud is opt-in.
2. **The app owns the workspace.** Agents are guests in panes.
3. **Human-controlled writes.** Models may propose; application code validates
   and records.
4. **Engine optionality.** An agent CLI can disappear without taking folders,
   Git, memory, or tasks with it.
5. **Cross-platform contract.** macOS, Windows, and Linux run the same engine
   contract; platform-specific code stays behind Rust/TypeScript adapters.

## Explicit boundaries

- Not a personal-life OS, social autoposter, or unrestricted computer-use
  agent.
- No background daemon or safety-critical routine in the first release.
- No claim that BuilderHelm replaces GitHub, Linear, Stripe, or model vendors.
- Browser panel remains the existing Electron surface; the experimental iced
  browser cut is not the shipping product.
