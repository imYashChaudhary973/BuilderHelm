# Git and review

Status: basic Git actions working; preview screenshots, snapshots, tool calls,
and console slices list next to changes. Unified review, PR, CI, and conflict
flows planned.

## Goal

Turn agent output into a human-reviewed, verifiable Git change without bouncing
between applications.

## V1 scope

- Repository, branch, worktree, staged, unstaged, and untracked state.
- File and line diffs with comments routed back to the owning agent.
- Test and check results tied to exact commands and revisions.
- Stage, unstage, commit, and draft pull-request metadata.
- GitHub CI status and logs.
- Base-branch drift and conflict detection before landing.
- Batch reviewed branches, return failures to agents, and land approved work.

## Rules

- Validate repository identity before invoking Git.
- Use fixed Git arguments and neutralize unsafe repository-local execution hooks where required.
- Never infer approval from an agent-generated commit message or PR description.
- Push, PR creation, merge, rebase, and conflict resolution remain explicit actions.
- Record the exact head and base revisions used for review.

## Acceptance

A reviewer can trace task -> run -> branch -> diff -> checks -> feedback ->
commit -> pull request. Landing fails closed when the reviewed head changes.
