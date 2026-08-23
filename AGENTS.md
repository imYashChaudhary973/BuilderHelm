# Agent rules

Follow this file on every turn. It beats conversation memory.

## Subagents

- At most **3** subagents at once. Never 4+.
- Spawn them when work splits cleanly. Do the work yourself when one slice is faster.
- Pin the contract (files, APIs, non-goals) in the batch context before they start.
- Subagents do not run repo-wide `verify` / `build` / `lint`. The parent runs the gate once.

## Git layout

```
Desktop/Axiom - PIOS                         # do not treat as main
Desktop/Axiom - PIOS-worktrees/main          # origin/main only
Desktop/Axiom - PIOS-worktrees/<name>        # one feature each
```

- Never commit on `main` inside a feature checkout.
- New work from current `origin/main`: `scripts/worktree-add <name>`
  → `feat/<name>` at `Axiom - PIOS-worktrees/<name>`.
- New work that depends on an unmerged branch: cut the worktree from that
  branch (`git worktree add -b feat/<name> <dest> <branch>`), not from
  `origin/main`.
- One concern per worktree. Do not pile unrelated features onto one branch.

## Ready means

A feature is ready only when all of these are true:

1. The stated goal works end to end.
2. `tsc -b`, tests, and desktop smoke pass in that worktree.
3. No leftover stubs, TODOs-as-implementation, or unrelated dirty files.

## When to merge to main

User authorized landing ready work on `main`. Do it when the feature is ready
and the diff is the feature (plus its tests). Steps:

```sh
cd "/Users/yashchaudhary/Desktop/Axiom - PIOS-worktrees/main"
git pull --ff-only
git merge --ff-only feat/<name>   # rebase onto main first if not fast-forward
git push origin main
```

Then remove the feature worktree:

```sh
git worktree remove "../<name>"
git branch -d feat/<name>
```

## When to open a PR instead

Open a PR, do not push `main`, when any of these hold:

- merge is not fast-forward and needs review
- security, credentials, or permission-engine behavior changed
- the user asked for a PR
- you are unsure the feature is actually done

## When not to merge

- tests, typecheck, or smoke failed
- the branch still contains unfinished work
- `main` moved and you have not rebased/merged it in yet

## How to work

- Read this file and `docs/STATUS.md` before changing product scope.
- Prefer the smallest change that satisfies the goal.
- Verify in the worktree you edited, not a sibling checkout.
- Do not force-push `main`.
