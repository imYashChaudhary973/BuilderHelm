# Global search

Status: command palette working for files, Board cards, Memory notes, and
registered commands. Persistent incremental index is not shipped.

## Goal

Find and run one action across worktrees, files, agents, commands, tasks, notes,
and artifacts without leaving the current flow.

## V1 scope

- Command palette with keyboard-first navigation.
- Search current and archived workspaces.
- Filter by project, worktree, branch, agent, task, artifact type, and time.
- Open a result or execute a registered command.
- Incremental indexing with progress and cancellation.

## Rules

- Search results respect project and vault boundaries.
- Secret and ignored paths are excluded.
- Commands are registered and permissioned; search text is never executed as shell input.
- Result lists are bounded and virtualized.

## Acceptance

Indexing runs outside Electron main, updates incrementally, cancels promptly,
and opens the exact selected object without crossing workspace scope.
