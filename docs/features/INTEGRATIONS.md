# GitHub and Linear integrations

Status: GitHub issue intake through the installed GitHub CLI is working in
code. Linear, pull-request intake, and a BuilderHelm-owned OAuth app are not
shipped.

## Goal

See assigned development work in BuilderHelm and start a correctly linked
workspace when the user chooses to build it.

## V1 scope

- List open GitHub issues assigned to the signed-in `gh` account.
- Import a selected issue onto the active Board with source identity and URL.
- Start Swarm from an imported card; the mission carries the issue URL.
- Sync an explicit close or reopen to GitHub and keep an append-only receipt.
- Refuse duplicate imports of the same GitHub issue.

## Rules

- Reading assigned issues never starts an agent automatically.
- External writes are explicit, scoped, idempotent, and receipted.
- Preserve source IDs; do not duplicate an already imported item.
- Reuse the user's GitHub CLI login. Do not copy tokens into BuilderHelm.

## Acceptance

Import, refresh, start-work, status-sync, and revoked-token paths work without
duplicate tasks or silent external mutations. Linear remains planned.
