# Board

Status: working locally.

## Goal

Keep human planning separate from terminal layout while allowing a task to start
an isolated workspace when it is ready to build.

## V1 scope

- Named project boards.
- To Do, In Progress, In Review, and Complete states.
- Create, edit, move, archive, and restore tasks.
- Persist ordering and project membership.
- Start a Space or Swarm from a selected task.
- Link tasks to runs, branches, artifacts, and pull requests.

## Rules

- Moving a card never starts code execution implicitly.
- Human acknowledgement owns Complete.
- External tracker synchronization is explicit and idempotent.
- A task records blockers and dependents without circular dependencies.

## Acceptance

Board state survives restart, concurrent updates do not lose tasks, and starting
a workspace records the exact task and project relationship.
