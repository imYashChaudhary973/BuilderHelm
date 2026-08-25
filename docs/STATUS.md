# Implementation Status

- Last reviewed: 2026-08-24
- Baseline: Phases 0–5 and Board landed on `main` at `b7bdb96`
- Active work: Phase 6 coding workspace on `feat/coding-loop`

This document is the canonical summary of what the repository implements now.
The [blueprint](blueprint/00_README.md) describes intended product direction,
while [phase reports](reports/README.md) preserve checkpoint evidence.

## Delivery status

| Phase | State       | Delivered capability                                                                                                      |
| ----- | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| 0     | Complete    | pnpm workspace, secure Electron boundary, SQLite migrations, typed IPC, observability, and architecture tests             |
| 1     | Complete    | Keychain-backed provider settings, provider metadata, audit events, and provider UI                                       |
| 2     | Complete    | Provider-independent model gateway, model discovery, streaming chat, canonical chat persistence, and capability overrides |
| 3     | Complete    | Read-only Obsidian indexing, local retrieval, cited answers, source viewing, and change detection                         |
| 4     | Complete    | Schema-backed tools, deterministic permissions, exact approvals, action receipts, and action chat                         |
| 5     | Complete    | Project dashboard, repository attachment, Git status and history, Today summary, and project continuity                   |
| 6     | In progress | Board plus permissioned `project.run_tests`, coding-bug fixture, and inspectable land diff |
| 7–12  | Planned     | Research, automation, voice, health, content, advanced graph, and product hardening                                       |

## Current application surfaces

- Today dashboard (projects, tasks, blockers, connected repositories)
- Provider and model settings
- Multi-provider chat
- Obsidian knowledge retrieval
- Permissioned actions, tasks, and receipts
- Projects and Git continuity
- Exeum Board (terminal grid, isolated worktrees, land with unified diff)

## Current architecture

The Electron renderer is unprivileged and accesses the local core only through
an explicit preload API and schema-validated IPC. The core owns SQLite state,
model policy, provider credentials, knowledge retrieval, permission decisions,
and tool execution. Provider-specific wire formats remain inside
`@zero/model-gateway`.

SQLite is at migration 8 on `main`. Migration 7 stores project repository
snapshots and bounded commit history. Migration 8 stores Board presets.

An unsigned macOS `Zero.app` can be packed with
`pnpm --filter @zero/desktop dist`.

## Verification

Run the complete local gate with:

```bash
pnpm verify
pnpm smoke:desktop
```

The phase reports record the exact results at each completed checkpoint. Do not
treat those historical test counts as the result for the current worktree.

## Known scope boundaries

- macOS is the supported desktop runtime; Keychain integration is intentionally
  fail-closed.
- Local Ollama endpoints may use loopback HTTP. Remote credentialed providers
  must use HTTPS.
- Models can propose actions, but deterministic application code validates
  permission and executes them.
- Board land merges locally and does not push remotes or open pull requests.
- `project.run_tests` runs hardcoded `node --test` in a registered repo after approval. It is not a generic shell.
- Voice, autonomous coding, automation, HealthKit, and publishing integrations
