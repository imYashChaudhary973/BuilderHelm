# Mobile companion

Status: protocol and TypeScript companion on `feat/ade-remote`. Metro / Xcode /
Play Store not exercised. Host must remain open.

## Goal

Use a companion to observe and direct agents running on a BuilderHelm host.

## V1 scope

- Pair with a host using an expiring pairing code (QR JSON is the same payload).
- Observe host status and artifacts.
- Send a scoped instruction, an approval response, or a cancel.
- Show stale and disconnected state.
- No pause/resume/retry, notifications, or terminal tails in this cut.

## Architecture

`apps/mobile` speaks the versioned protocol in `packages/protocol/src/remote.ts`.
The host performs every filesystem, Git, terminal, provider, and browser action.
The companion is not a model backend.

## Security

- No coding CLI or repository runs on the phone.
- No provider, Git, SSH, session, or repository credentials leave the host.
- No raw shell, filesystem, process, plugin, or configuration API is exposed.
- Command IDs are idempotent except approvals, which fail on replay.
- Revoked sessions cannot act.

## Acceptance

Pairing, reconnect, revocation, stale/disconnected, duplicate instruct, and
replayed approval are fixture-tested against the host. A packaged iOS/Android
binary is not in this phase.
