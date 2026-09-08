# Security modes

Every visible mode names its enforcement. A prompt-only instruction is not
Plan. Worktrees isolate Git history; they are not an OS sandbox.

## Three axes

Swarm's Safe / Auto-edit / Full bypass is a preset, not a fourth engine.

| Preset      | Execution | Access            | Approval     |
| ----------- | --------- | ----------------- | ------------ |
| Safe        | Plan      | read              | ask          |
| Auto-edit   | Build     | workspace (files) | accept-edits |
| Full bypass | Build     | full              | bypass       |

Full is an explicit per-run choice. Launch never falls back to it.

ACP chat has no Swarm preset. Host policy follows the runtime's `mode`
config chip when the value is a known plan / accept-edits / bypass token;
anything else stays **ask** (prompt the person). Unknown chips are never
Full.

## Host action boundary

BuilderHelm work tools (`project.*`, `task.*`) keep using
`PermissionEngine` + `ActionService` receipts:

- policy ask / auto_approve / deny
- approval bound to request id, tool id, exact arguments, and expiry
- stale, replayed, and expired approvals cannot execute
- receipts are append-only

ACP permission is a separate loop (the agent executes, the host only
answers). Approvals bind to **session + request id**. A late click, a
replay, or an answer for another session is ignored. Cancel or close
resolves pending requests as `cancelled` so the run cannot proceed on a
dead prompt.

ACP `fs/write` is confined to the session root and refused in Plan.

## Runtime flags (Swarm seats)

| Runtime  | Safe                               | Auto-edit                              | Full                                         |
| -------- | ---------------------------------- | -------------------------------------- | -------------------------------------------- |
| Claude   | `--permission-mode plan` (runtime) | `acceptEdits`                          | `--dangerously-skip-permissions`             |
| Codex    | `--sandbox read-only` (runtime)    | `workspace-write` + `--approve-for-me` | `--dangerously-bypass-approvals-and-sandbox` |
| Grok     | `--permission-mode plan` (runtime) | `acceptEdits`                          | `bypassPermissions`                          |
| Gemini   | `--approval-mode plan` (runtime)   | `auto_edit`                            | `yolo`                                       |
| OpenCode | not advertised                     | prompt-only (no flag)                  | `--auto`                                     |
| Kimi     | not advertised                     | `-y`                                   | `--auto`                                     |
| Oh My Pi | not advertised                     | `--approval-mode write`                | `yolo`                                       |
| Pi       | not advertised                     | `--approve`                            | not advertised                               |

Interactive PTY panes type the catalog command with no sandbox flags
(Gemini still gets `--skip-trust`). ACP spawn is transport-only; Plan is
host-enforced, not an OS jail.

Accept-edits covers scoped file changes. Shell, fetch, delete, and
credential paths still ask (or deny in Plan). A remembered always-allow
cannot override Plan.

## AI approval

- Runtime-provided review (for example Codex "Approve for me") stays a
  chip the runtime owns. It is not host always-allow.
- A host Swarm reviewer, when wired, is an explicit runtime/account
  structured call. Unreadable output fails closed. Approving `.env`,
  `auth.json`, or key files is rewritten to `fix`.
- Failure or uncertainty returns to human review. The reviewer cannot
  change policy.

## Untrusted inputs

Opening a project does not run setup scripts or `pnpm install`. Swarm
verify may install inside an already-running mission, after agent work,
not at folder open.

ACP `session/new` sends `mcpServers: []`. Plugins are a NotBuilt stub.
Repository instructions, MCP output, and plugin content are untrusted.
Worktrees remain trusted-code isolation; OS confinement is a later
execution capability.
