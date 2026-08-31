# Swarm

Status: core local flow exists. Verify still gates work; landing waits for a human and fails closed if the reviewed head moved.

## Goal

Run multiple agents against one mission while keeping roles, tasks, budgets,
branches, evidence, and human checkpoints explicit.

## V1 scope

- Define mission, project, base branch, roster, roles, and budget.
- Create one worktree and branch for each independent builder task.
- Coordinate planner, builder, scout, and reviewer responsibilities.
- Direct one seat or all seats during a run.
- Display active task, terminal tail, artifacts, failures, and elapsed usage.
- Verify, review, queue for landing, stop, reconnect, and resume from durable state.

## Rules

- One file owner at a time when tasks overlap.
- The coordinator assigns work; it does not silently merge it.
- Budgets include time, retries, output, and provider usage when available.
- Stuck policy escalates to the user rather than looping indefinitely.
- Landing requires current-base reconciliation and review evidence.

## Acceptance

A multi-seat run survives one seat failure, stops all owned processes, restores
after application restart, produces inspectable artifacts, and never lands
unreviewed work automatically.
