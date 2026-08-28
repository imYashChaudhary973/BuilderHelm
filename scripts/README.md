# Scripts

Repository scripts are deterministic, non-interactive automation:

- `worktree-add` creates a feature worktree from `origin/main`.
- `worktree-status` reports BuilderHelm worktrees.
- `check-architecture.mjs` refuses unsupported Rust artifacts and stale product namespaces.

Scripts do not read credentials, mutate production services, or operate on a
broad unresolved path. Destructive behavior requires an explicit target and a
separate user request.
