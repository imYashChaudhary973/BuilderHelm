# Architecture

BuilderHelm is a TypeScript platform built on Electron, React, Vite, Node.js 24,
xterm.js, node-pty, SQLite, and schema-validated contracts.

## Decision

Product runtime and application logic are implemented in TypeScript. The
repository does not contain or ship a Rust engine, Rust UI, Cargo workspace, or
native sidecar. See [ADR 0001](adr/0001-typescript-platform.md).

## Process model

```text
React renderer (sandboxed)
        |
        | narrow contextBridge methods
        v
Electron main
        |
        +-- TypeScript application services
        +-- SQLite repositories
        +-- operating-system credential adapter
        +-- Git and filesystem adapters
        +-- node-pty process manager
        +-- utility processes for blocking, crash-prone, or CPU-heavy work
        |
        +-- optional authenticated remote session
                |
                +-- mobile client
                +-- CLI client
                +-- optional relay carrying encrypted frames
```

The renderer never receives filesystem, process, database, credential, or raw
Electron access. The preload exposes one method per operation and validates the
request and response against `packages/protocol` schemas.

## Package ownership

| Package                  | Owns                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| `packages/core`          | application services, orchestration, policies, and use cases           |
| `packages/db`            | SQLite connection, migrations, and repositories                        |
| `packages/model-gateway` | optional provider API normalization used by built-in AI flows          |
| `packages/observability` | redacted structured logs and correlation IDs                           |
| `packages/protocol`      | public domain objects, IPC requests, events, and future network frames |
| `packages/shared`        | identifiers, errors, time, and small cross-package utilities           |
| `packages/tools`         | registered tools, permission checks, approvals, and receipts           |

Electron-specific code stays in `apps/desktop`. Shared packages must not import
Electron or renderer code.

## Agent execution

Each run records its project, base revision, branch, worktree, selected CLI,
arguments, environment policy, status, budget, artifacts, and receipts.

```text
validated task
  -> create branch/worktree
  -> allocate ports and process budget
  -> spawn fixed CLI with argv and cwd
  -> stream bounded events
  -> collect diffs/tests/browser evidence
  -> review or send feedback
  -> commit/PR only after approval
  -> stop processes and archive workspace
```

Worktrees prevent ordinary write collisions but share Git metadata and host-user
permissions. Strong isolation, if later required, is a separate container or VM mode.

## Terminal

The PTY process and terminal renderer are separate:

```text
agent or shell -> node-pty -> bounded events -> xterm.js -> React pane chrome
```

Ghostty informs interaction and visual design but is not embedded. Terminal
streams require batching, backpressure, bounded scrollback, explicit resize,
reconnect snapshots, and complete process-tree cancellation.

## Persistence

SQLite is the local source of truth for projects, tasks, boards, provider
metadata, chats, memory indexes, approvals, receipts, and runs. Secrets are not
stored in SQLite. Schema changes are forward-only migrations with focused tests.

## Remote control

The host owns execution. Mobile and CLI clients send versioned commands and
receive redacted events. They never receive provider credentials or an
unrestricted shell/filesystem API. The v1 host may require the desktop app to
remain running; a permanent background service is not part of the first release.

## Browser

Remote web content runs in a separate sandboxed web contents with no Node
integration. Navigation, downloads, permissions, new windows, external links,
and inspected element data are allowlisted and sanitized before they cross into
the application or an agent prompt.

## Performance rules

- Keep Electron main free of synchronous repository scans and large Git loops.
- Use utility processes for blocking or crash-prone work.
- Batch terminal, token, watcher, and log events.
- Bound queues, buffers, histories, and concurrent agents.
- Virtualize large React lists and subscribe per visible pane.
- Measure before adding another runtime or native implementation.
