# Mobile companion

Status: planned.

## Goal

Use iOS or Android to observe and direct agents running on a Mac, Windows PC,
Linux host, or approved remote machine.

## V1 scope

- Pair with a host using an expiring QR bootstrap.
- List hosts, projects, runs, agents, tasks, and attention requests.
- Read summaries, bounded terminal tails, diffs, tests, screenshots, and CI.
- Send follow-up instructions and review feedback.
- Approve, reject, pause, resume, retry, or cancel allowed actions.
- Receive notifications when a run needs attention.

## Architecture

The React Native client speaks a versioned authenticated protocol to the host.
The host performs every filesystem, Git, terminal, provider, and browser action.
The initial release may require BuilderHelm desktop to remain running.

## Security

- No coding CLI or repository runs on the phone.
- No provider, Git, SSH, session, or repository credentials leave the host.
- No raw shell, filesystem, process, plugin, or configuration API is exposed.
- Commands have stable IDs, idempotency, expiry, capability ceilings, and receipts.
- High-impact approvals require device authentication.

## Acceptance

Pairing, reconnect, revocation, offline state, duplicate delivery, cancellation,
and an ambiguous host crash all fail safely and remain understandable to the user.
