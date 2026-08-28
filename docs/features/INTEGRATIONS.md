# GitHub and Linear integrations

Status: planned.

## Goal

See assigned development work in BuilderHelm and start a correctly linked
workspace when the user chooses to build it.

## V1 scope

- Connect GitHub and Linear through supported OAuth/app flows.
- List and filter assigned issues, pull requests, and tasks.
- Import selected work into Board with source identity and URL.
- Start Space or Swarm from an imported item.
- Sync explicit status changes and attach branch, PR, and CI results.

## Rules

- Reading tasks never starts an agent automatically.
- External writes are explicit, scoped, idempotent, and receipted.
- Preserve source IDs; do not duplicate an already imported item.
- Request the least privileges required and store tokens in OS credential storage.

## Acceptance

Import, refresh, start-work, status-sync, disconnect, and revoked-token paths
work without duplicate tasks or silent external mutations.
