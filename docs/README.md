# Documentation

## Start here

1. [Implementation status](STATUS.md) — what exists in the repository now
2. [Stack decision](STACK.md) — TypeScript, Electron, phone pairing. Not Rust.
3. [Product and architecture blueprint](blueprint/00_README.md) — intended
   direction and numbered reading order
4. [Agent rules](../AGENTS.md) — commit, land, worktrees, subagent cap
5. [Architecture decisions](adr/README.md) — accepted decisions and consequences
6. [Delivery reports](reports/README.md) — historical evidence from completed phases

## Source hierarchy

When documents disagree, use this order:

1. Current code, tests, and migrations define runtime behavior.
2. `AGENTS.md` is the workflow contract (commit, land, worktrees, subagents).
3. `docs/STACK.md` is the language and platform decision.
4. `STATUS.md` summarizes the current implementation and active phase.
5. ADRs define accepted architectural decisions.
6. The blueprint defines product intent and longer-term architecture.
7. Phase reports describe historical checkpoints; they are not active plans.

## Maintenance rules

- Update `STATUS.md` when a phase begins, closes, or materially changes scope.
- Update `AGENTS.md` when workflow rules change (commit, land, worktrees).
  Update `docs/STACK.md` only when the language or platform decision changes.
- Add an ADR for durable architectural decisions. Do not rewrite an accepted ADR
  to hide an earlier decision; supersede it with a new ADR instead.
- Update the Markdown blueprint intentionally and revise its version and research
  snapshot when its product direction changes.
- Keep phase reports as historical evidence. Add a current-outcome note when a
  report's branch or pull-request status changes.
- Treat `blueprint/Zero_OS_Master_Blueprint.docx` as a convenience export. The
  numbered Markdown files are canonical.
- Remove duplicate indexes and completed implementation plans once their durable
  decisions and outcomes are captured elsewhere.
