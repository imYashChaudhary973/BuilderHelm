# Git and review

Status: the service is covered by tests on macOS — unified diffs, line comments
routed to the owning seat, checks recorded with command and revision, draft
pull requests, CI status, and land refusal when the reviewed head moved. The
`/review` route renders against those calls but has not been driven end to end,
because opening a Space needs the OS folder picker.

## Requires the GitHub CLI

Pull-request drafting and CI status shell out to `gh`, so GitHub work needs the
CLI installed and signed in. Nothing else in the review surface does: diffs,
comments, checks, and landing are local Git only. A missing binary reports
"Install the GitHub CLI (gh)", an unauthenticated one asks for `gh auth login`,
and a branch with no pull request says so instead of printing gh's stderr.

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

## Landing takes two presses

The first press inspects the branch and names the exact commit to be landed.
The second lands that commit. One press that read the tip and merged it would
certify nothing — the reviewer would be approving whatever the agent pushed a
moment earlier. `landBranch` re-reads the tip between the two and fails closed
if it moved.

CI is read through the branch's pull request, so the commit GitHub tested is
not necessarily the reviewed one. Both are reported and the result is marked
stale when they differ, rather than showing green for a commit nobody read.

## Rules

- Validate repository identity before invoking Git.
- Use fixed Git arguments and neutralize unsafe repository-local execution hooks where required.
- Never infer approval from an agent-generated commit message or PR description.
- Push, PR creation, merge, rebase, and conflict resolution remain explicit actions.
- Record the exact head and base revisions used for review.

## Acceptance

A reviewer can trace task -> run -> branch -> diff -> checks -> feedback ->
commit -> pull request. Landing fails closed when the reviewed head changes.
