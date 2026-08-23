# Agent rules

Follow this file on every turn. It beats conversation memory.

Language and platform: [docs/STACK.md](docs/STACK.md). Do not reopen TypeScript vs Rust unless that file is revised.

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

## When to commit

Commit on the **feature branch only**, after a slice is actually done.

A slice is done when:

1. The bug is gone or the stated behavior works. The user used it, or you
   proved it in the running app / a test. "Looks like it should work" is not done.
2. The diff is that slice. No drive-by refactors, no second feature.
3. Typecheck of the touched packages passes.
4. No secrets (`.env`, keys, tokens, Keychain dumps).
5. No generated junk (`node_modules`, `.next`, `dist` unless the repo already
   tracks that path).

Do **not** commit:

- mid-debug, broken terminals, red typecheck
- "checkpoint in case we lose the chat"
- after every file save
- onto `main`

After a done-slice commit, push the **feature branch** (`git push -u origin feat/<name>`).
That is backup, not a land. Never push `main` from a feature worktree.

If the slice is not done, keep the working tree dirty. Uncommitted is cheaper
than a lie in git history.

## Ready means (whole feature, not one commit)

A feature is ready to land only when all of these are true:

1. The stated goal works end to end in the running app.
2. `tsc -b`, tests for the touched packages, and desktop smoke pass in that worktree.
3. No leftover stubs, TODOs-as-implementation, or unrelated dirty files.
4. `origin/main` is an ancestor of the feature branch (rebase/merge main in first
   if it is not).
5. The user can do the thing without a hidden extra step you did not document.

Example: "terminals were not opening" is ready when Open starts a live PTY and
you can type. It is not ready when spawn still fails and the UI only looks nicer.

## When to merge to main

User authorized landing ready work on `main`. Do it when the feature is ready
and the diff is the feature (plus its tests). Do not ask again.

Steps:

```sh
cd "/Users/yashchaudhary/Desktop/Axiom - PIOS-worktrees/main"
git pull --ff-only
git merge --ff-only feat/<name>   # rebase onto main first if not fast-forward
git push origin main
```

Then remove the feature worktree **only if nothing is running from it**:

```sh
git worktree remove "../<name>"
git branch -d feat/<name>
```

Leave the worktree if Electron / a hub process is still using that checkout.

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
- the only proof is "the code looks right"

## How to work

- Read this file, `docs/STACK.md`, and `docs/STATUS.md` before changing product scope.
- Prefer the smallest change that satisfies the goal.
- Verify in the worktree you edited, not a sibling checkout.
- Do not force-push `main`.
