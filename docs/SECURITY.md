# Security model

BuilderHelm executes developer tools against real repositories. Its primary
risks are command execution, path traversal, repository confusion, malicious
web content, secret exposure, remote-control abuse, and excessive agent agency.

## Trust boundaries

1. Renderer to preload and Electron main.
2. User or agent input to filesystem, Git, shell, database, or network sinks.
3. Agent process to the host machine and sibling workspaces.
4. Remote client or relay to the execution host.
5. Web preview content to BuilderHelm and agent prompts.
6. Provider responses and repository content to privileged tools.

## Required controls

- Sandboxed renderers, context isolation, no Node integration, restrictive CSP.
- Narrow preload methods with runtime validation and sender checks.
- Canonical path resolution and workspace-root enforcement.
- Fixed executables and argument arrays; no shell interpolation.
- Authentication, authorization, validation, and idempotency before side effects.
- Immutable approval arguments reloaded before execution.
- Append-only receipts for privileged actions.
- Redaction of tokens, credentials, user paths, and sensitive provider payloads.
- Fail-closed credential storage and permission checks.
- Bounded concurrency, output, runtime, retries, and process trees.

## Worktrees

Git worktrees isolate ordinary edits and branches. They do not stop a process
from reading the host filesystem, changing shared repository configuration, or
accessing credentials available to the user. Do not describe worktrees as a
security sandbox.

## Browser content

Preview web contents run without Node integration and cannot receive the main
renderer preload. BuilderHelm controls permissions, navigation, downloads, new
windows, external links, and inspected data. DOM text sent to an agent is
untrusted prompt input and must be bounded and labelled.

## Remote and mobile

- Pair devices with an expiring, single-use bootstrap.
- Give every host and client a revocable device identity.
- Use authenticated encrypted frames with replay protection.
- Expose versioned commands, not raw RPC, shell, filesystem, process, plugin, or configuration APIs.
- Keep provider, Git, SSH, session, and repository credentials on the host.
- Require biometric or equivalent confirmation for high-impact mobile approvals.
- Record the requesting device and final outcome in the receipt.

## Reporting

The repository is private. Report suspected security issues privately to the
owner rather than creating a public issue.
