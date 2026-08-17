# Phase 4 Progress Report

> Historical checkpoint. Phase 4 subsequently merged through PR #3. See
> [Implementation Status](../STATUS.md) for the current repository state.

- Date: 2026-08-11
- Branch: `phase-4/tools-permissions-action-chat`
- Status: Complete; merged into `main`

## Completed checkpoints

### Schema-backed tool registry

- Added the `@zero/tools` package with stable tool IDs, provider-safe model names,
  human descriptions, strict Zod input and output schemas, risk levels, data scopes,
  timeouts, idempotency metadata, rollback metadata, summaries, and resource
  serializers.
- Registered `task.list`, `task.create`, `task.update`, `project.get_status`, and
  `project.add_decision`, plus the minimal `project.create` bootstrap action needed
  to exercise the project domain from a clean database.
- Models receive only registry-derived JSON schemas. Unknown tools, invalid inputs,
  invalid outputs, and multiple proposed tool calls fail closed.

### Independent permission engine

- Kept permission decisions outside model prompts and adapters.
- Read and draft operations are allowed unless explicitly denied.
- Reversible writes ask by default and support narrow per-tool `ask`,
  `auto_approve`, or `deny` policies.
- External and destructive risk levels cannot be auto-approved.
- Tools without real rollback support cannot be auto-approved.
- Policy changes are schema-validated, require a native main-process confirmation,
  and are written with immutable audit events.

### Exact, single-use approval lifecycle

- Persists the exact validated arguments, affected resources, risk, actor, model,
  correlation ID, reversibility, and expiry before presenting an approval.
- Renderer approval calls carry only the approval UUID; the main process reloads
  the saved arguments, displays them in a native confirmation, and independently
  evaluates the current policy.
- Database triggers prevent argument replacement, deletion, terminal-state
  reactivation, and reuse of a resolved approval.
- Expired, denied, failed, and executed approvals are retained for audit history.

### Transactional tasks, projects, decisions, and receipts

- Added migration 6 for projects, tasks, project decisions, permission policies,
  approval requests, and action receipts.
- Project/task/decision mutations, approval consumption, receipt creation, and
  execution audit events commit in one SQLite transaction.
- UUID request IDs provide idempotency for write commands, and duplicate approval
  execution cannot create a second task.
- Every successful write produces an immutable receipt with actor/model/tool,
  exact arguments, approval state, result, affected resources, timestamp, and
  accurate rollback information. Project decisions are explicitly non-reversible
  because no archive/delete operation exists in this phase.

### Deterministic action chat with bounded model fallback

- Parses project creation, task creation with priority and due date, task status
  updates, task lists, project status, and project decisions locally first.
- Correctly handles the canonical command: “Add a high-priority task to Project A
  to benchmark the sync layer tomorrow.”
- Uses a selected tool-capable model only when deterministic parsing cannot resolve
  the command. The model receives a bounded local catalog and can propose exactly
  one registered tool; it cannot grant permission or execute the action.
- Until work records carry explicit sensitivity metadata, the fallback catalog is
  treated as personal, sensitive, and health data. Local models remain available;
  remote fallback requires explicit provider opt-in for every restricted class.
- Model invocation, completion/failure, tool request, approval, denial, execution,
  and failure events are auditable without storing command or task text in logs.

### Desktop action and approval flow

- Added a narrow preload API and strict main-process IPC handlers for snapshot,
  command proposal, approval, rejection, and policy updates.
- Added an Actions route with a one-action composer, optional model fallback,
  project/task snapshot, exact-argument approval cards, risk and expiry details,
  per-tool P2 policy controls, and inspectable immutable receipts.
- React renders action data as text/JSON; no raw HTML or generic shell surface is
  exposed.

## Security invariants retained

- Renderer input, model tool calls, database rows, and IPC responses cross strict
  schema boundaries before use.
- SQL remains parameterized; no command execution, dynamic code evaluation,
  arbitrary path access, outbound action, or unrestricted MCP tool is introduced.
- The local model is a proposer only. Permission evaluation and execution remain
  deterministic trusted-core responsibilities.
- Approvals are exact, expiring, single-use records. Writes and their receipts are
  transactional and append-only.
- Approval resolution reuses the immutable correlation ID stored with the proposal,
  preserving one audit chain across request, consent, receipt, and execution.
- Logs contain correlation IDs, tool IDs, states, and error codes—not user command
  text, task content, credentials, or serialized model context.
- The current scope is single-user local data, so tenant authorization is not
  applicable. Process isolation and narrow Electron IPC remain the authorization
  boundary.

## Verification

| Gate                                                               | Result                           |
| ------------------------------------------------------------------ | -------------------------------- |
| Prettier check (workspace source, excluding user-owned `.claude/`) | Passed                           |
| ESLint (workspace source, excluding user-owned `.claude/`)         | Passed                           |
| TypeScript project build                                           | Passed                           |
| Full Vitest suite                                                  | Passed: 36 files, 127 tests      |
| Focused Phase 4 suite                                              | Passed: 6 files, 28 tests        |
| Electron production build                                          | Passed                           |
| Electron desktop smoke test                                        | Passed                           |
| Production dependency audit                                        | Passed: no known vulnerabilities |
| `git diff --check`                                                 | Passed                           |
| Secret, oversized-file, and dangerous-sink scan                    | Passed                           |

The service-level vertical slice proves project creation, canonical task creation,
explicit approval, exactly-once persistence, immutable receipt creation, approval
replay rejection, task update with rollback arguments, read tools, project decision
creation, narrow auto-approval and denial policies, approval expiry, model proposal
validation, and audit coverage. Protocol and IPC tests prove the renderer cannot
select an arbitrary tool or replace approved arguments.

### Manual Actions acceptance

Manual acceptance on 2026-08-13 used the built Electron app with
`--force-renderer-accessibility` and the isolated profile
`/private/tmp/axiom-pios-phase4-acceptance`.

- Created `Project A` only after the exact arguments appeared in the Actions UI and
  the native main-process confirmation was approved.
- Created the high-priority task `benchmark the sync layer` due the next day after
  the same exact-argument and native-confirmation flow.
- Updated that task to `done` through an explicit approval and confirmed the local
  snapshot showed one completed task.
- Changed `task.update` to `auto_approve` through native policy confirmation, then
  changed the task to `blocked` without a pending approval. The fourth immutable
  receipt recorded `auto_approved`.
- Changed `task.create` to `deny` through native policy confirmation. Two attempted
  task-creation submissions failed closed with `PERMISSION_DENIED`; project, task,
  approval, and receipt counts did not change.
- Restored both tested policies to `ask`. Direct read-only SQLite inspection
  confirmed one project, one task, four receipts, two deny audit events, and safe
  final policy defaults.

## Scope note

Phase 4 accepts text commands through an input contract that a future speech-to-text
adapter can call unchanged. Microphone capture, speech recognition, and spoken
approval belong to Phase 9 in the execution roadmap and were not added here.

## Delivery status

- Committed as `3131971` and pushed to
  `origin/phase-4/tools-permissions-action-chat`.
- Published as [draft PR #3](https://github.com/imYashChaudhary973/Axiom-Zero/pull/3),
  stacked on `phase-3/obsidian-memory`.
- Pull-request CI passed and GitHub reports the PR as mergeable.
- Deterministic manual task creation, task update, auto-approval, denial, receipt,
  and safe-policy-reset acceptance is complete.

## Current outcome

- Merged into `main` through PR #3 in merge commit `4cd140a`.
- A live tool-capable model exercise remains optional because the model is a
  proposal-only fallback and its strict contract is covered by automated tests.
- The verification table above remains the checkpoint evidence; it is not a
  current-worktree test result.
