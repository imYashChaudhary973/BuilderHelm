# Space

Status: working on macOS.

## Goal

Give one project a focused desktop workspace containing terminal panes and the
tools needed to inspect and ship work.

## V1 scope

- Select a project folder.
- Choose shared-folder or per-pane worktree mode.
- Create 1, 2, 4, 6, 8, 10, or 12 terminal panes.
- Assign an installed agent or plain shell to each pane.
- Resize, reorder, maximize, add, close, and restore panes.
- Keep Editor, Git, and future Browser tools scoped to the same project.

## Rules

- Reducing pane count clamps assignments; counts never become negative.
- A transactional launch leaves no orphan panes after partial failure.
- Each pane displays its cwd, branch, agent, status, and failure reason.
- Shared-folder mode is explicit and never described as isolated.

## Acceptance

Every supported layout launches real PTYs, accepts input, streams output, resizes,
restores state, and cleans up without orphan processes.
