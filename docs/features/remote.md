# Remote control

Status: host pairing on `feat/ade-remote`. Loopback and private-network TCP.
No relay. Fixture-tested; Remote page not clicked live in Electron. Metro /
Xcode / Play Store not exercised.

## Contract

A companion observes and directs one BuilderHelm host. The host owns
execution, Git, credentials, and workspaces. Pairing is explicit, short-lived,
and one-shot. Sessions are scoped to observe / instruct / approve / cancel.
Revocation is immediate. Replayed approvals fail. Duplicate command IDs do
not run twice. Reconnect is by event sequence.

The desktop process must remain open. There is no daemon and no relay in this
phase.

## Surfaces

- SQLite `ade_remote_sessions` / commands / events / audit (migration 24)
- Host Ed25519 identity and session keys in the secret store, never SQLite
- AES-256-GCM frames after pairing
- Remote page: listen, pairing code, revoke, audit
- `apps/mobile` companion: pair, status, artifacts, instruct, approve, cancel,
  stale / disconnected
