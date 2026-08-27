# Stack decision

Last decided: 2026-08-27 (hybrid architecture). Replaces the 2026-08-26
single-Rust decision ([ADR 0005](adr/0005-rust-migration.md), superseded) and
the 2026-08-23 "TypeScript is the product language" decision. Decision
record: [ADR 0006](adr/0006-hybrid-architecture.md). Plan:
[ADOPTION](ADOPTION.md).

## Decision

**Hybrid: Rust backend + TypeScript platform.**

- **Rust is the core engine**: core engine services, settings management,
  agent workflows, and performance-critical operations (model gateway, PTY and
  terminal I/O, permissions, secrets, SQLite).
- **TypeScript is the platform**: the development environment, UI frameworks,
  cross-platform capability on macOS/Windows/Linux, and the coordination layer
  for AI-assisted development tools.

There is no full-Rust rewrite of the UI. The Electron renderer ships.

## Target stack

| Concern              | Rust (engine)                                                | TypeScript (platform)                    |
| -------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| Runtime              | `tokio`                                                      | Node/Electron                            |
| Engine contract      | `serde` + `serde_json`, corpus                               | schema-validated IPC, 71 channels        |
| Persistence          | `rusqlite` (`bundled`), SQLite                               | reads via the contract                   |
| Provider HTTP        | `reqwest` (streaming, `rustls`)                              | —                                        |
| Secrets              | `keyring` (Keychain / CredMan / Secret Service), fail-closed | settings UI                              |
| PTY / terminal       | `portable-pty` (ConPTY), `alacritty_terminal`                | xterm.js view                            |
| Chrome / product UI  | —                                                            | React + Vite + Electron                  |
| Dialogs              | `rfd`                                                        | —                                        |
| Logging              | `tracing`                                                    | pino                                     |
| Git                  | subprocess (CREATE_NO_WINDOW on Windows)                     | subprocess in renderer-adjacent paths    |
| AI-tool coordination | engine-side MCP surface                                      | Cursor/Windsurf/MCP-standard integration |

## Why hybrid

- The heavy 90% is the engine: 12-pane PTY I/O, retrieval, permissions,
  persistence. That is where native speed and memory safety pay.
- The TypeScript renderer and tooling are already built, shipped, and are a
  product strength (AI-tool coordination, editor integration).
- A single-language rewrite discarded one side for no measurable win; the
  conformance corpus already proved the engine contract works.

## Rule

- New **engine, settings, and agent-workflow** code is Rust.
- New **UI, tooling, and platform** code is TypeScript-first.
- The typed IPC contract is the boundary; both implementations satisfy the
  corpus.
- Do not add a third implementation of any layer.
