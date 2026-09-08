# ADR 0010: Workspace foundation, retention, and owned recovery

- Status: Accepted
- Date: 2026-09-08

## Context

Independent agent runs must be durable, isolated, and recoverable before any
orchestration is layered on. Earlier behavior worked against that goal in three
ways: workspace identity lived in renderer `localStorage`, failed session
creation rolled back worktrees and branches, and cleanup targeted numeric PIDs
that the OS can reassign.

## Decision

**Durable workspace records live in host SQLite.** Migration 25 adds
`ade_workspaces` (state machine: `provisioning → running → interrupted →
closed`), `ade_workspace_metadata`, `ade_terminal_output` (bounded tail per
pane), and `ade_editor_drafts`. Launch intent (`WorkspaceStore.begin`) is
persisted with the canonical root and base SHA before any worktree or process
exists. The renderer keeps only harmless presentation preferences; its legacy
metadata is imported once, idempotently, and the old storage is retained.

**Provisioned worktrees are retained, never rolled back.** Worktree removal is
separate from cancellation: a failed or interrupted launch keeps every checkout
it created, records their locations, and offers an explicit restart that
re-verifies each checkout (canonical path, common Git dir, branch) before
reopening shells. Restart never replays a previous prompt or command. The host
boot reconciles all `running`/`provisioning` records to `interrupted`.

**Pane processes are owned by identity, not PID.** `stopOwnedPty` captures the
descendant tree while the PTY is live, re-verifies each process start time
before signaling, and kills descendants newest-first. Invalid working
directories fail the launch instead of falling back to the home directory.

**Editor drafts are recoverable and conflict-aware.** A draft is stored with
the disk text it was based on. Recovery marks a conflict when the file changed
on disk; the user keeps the draft, takes the disk version, or rebases.
Identical draft/base pairs are not persisted.

**The sandboxed preload cannot require Node builtins.** Preload code must
import protocol schemas through subpath exports (`@builderhelm/protocol/board`,
`@builderhelm/protocol/workspaces`), never through the package barrel: barrel
reachability pulls modules whose dependency closure includes
`@builderhelm/shared` root (`node:crypto`), which crashes sandboxed preloads at
startup.

## Consequences

- Workspace selection, branch, and isolated/shared state survive renderer
  reloads and full desktop restarts.
- Interrupted provisioning is explained and recoverable; work is never silently
  deleted.
- Worktrees from abandoned attempts can accumulate; reclaiming them is an
  explicit future user action, not automatic cleanup.
- New protocol modules must ship a subpath export if the preload consumes them.
- Enforced by `apps/desktop/test/board-worktree-rollback.test.ts` and
  `packages/core/test/workspace-store.test.ts`.
