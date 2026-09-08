# Agents, Code, Chats, and connected tools

Status: host connectors shipped on `feat/ade-mcp` (fixture-tested). ACP
still sends `mcpServers: []`; tools execute on the host, not inside the CLI.
No marketplace. No live paid Apify or X call in verification.

## Product contract

Keep the supplied reference layout: centered Agents / Code / Chats tabs,
mode-specific sidebar, dark rounded content panels, compact composer, and a
separate Settings navigation. Use real profiles, projects, capabilities, and
history instead of the example names and conversations in the references.

| Surface            | User action                              | Host behavior                                                                           |
| ------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| Agents             | Select a named bot; start a conversation | Load its instructions, engine, permitted connections, folder, and history               |
| Code               | Select a workspace and installed CLI     | Launch the existing PTY service in a validated folder; preserve panes across navigation |
| Chats              | Start a general or project conversation  | Use the shared conversation UI and chosen engine; connections are explicit per thread   |
| Settings / Plugins | Connect, inspect tools, test, disconnect | Store credentials in the OS credential store; expose only redacted connection metadata  |
| Agent settings     | Select tools and limits                  | Save grants scoped to that profile, never grant every bot ambient account access        |

An agent is a saved configuration, not a permanently running process. A bot is
an agent profile used for recurring or specialized work. Creating a profile
must not spawn a process. Switching tabs must not cancel a running task.

## What already exists

- `apps/desktop/src/main/acp/`: installed-agent discovery, sessions, permission
  requests, threads, and named profiles. Profiles currently live in a settings
  blob. `session.ts` currently sends an empty `mcpServers` list.
- `packages/core/src/chat/chat-service.ts`: API-model streaming and transcript
  persistence; records proposed tool calls but does not execute a tool loop.
- `packages/tools/src/index.ts`: typed local tool registry and permission
  engine. The current registry uses a closed set of local work-tool IDs.
- `packages/core/src/actions/action-service.ts`: existing action execution
  infrastructure to reuse for approvals and receipts.
- `apps/desktop/src/main/keyring-secret-store.ts`: credential adapter.
- Code already uses xterm.js and node-pty. Keep those services and the existing
  workspace, Git, file, and review operations.
- Plugins and Automations are placeholders. ACP and model API chat are distinct
  backends; the visible Chats tab currently uses ACP, per ADR 0008.

## Execution architecture

```text
Agents / Chats UI                    Code UI
       |                                |
validated preload commands        existing workspace/PTY commands
       |                                |
run coordinator                   installed CLI + validated cwd/worktree
       |
       +-- ACP engine: user's installed agent and its own authentication
       +-- API engine: explicit provider key through existing model gateway
       |
registered tool request
       -> validate schema and active profile/thread grant
       -> evaluate action, data destination, and cost policy
       -> durable approval if needed
       -> host connector worker -> MCP server or approved API endpoint
       -> bounded result + receipt -> engine -> cited answer
```

Do not put credentials, tool execution, SQLite, or raw IPC in React. Electron
main routes requests; blocking or crash-prone connector work runs in a utility
process. Use the existing packages: protocol owns schemas, core owns runs,
tools owns policy, db owns migrations, and desktop owns OS integration.

Keep ADR 0008's authentication boundary. ACP agents own their model login;
BuilderHelm never extracts their provider tokens. API-engine profiles explicitly
use separately configured API credentials and separate billing. Add this as an
opt-in profile engine, not a replacement for installed coding agents.

For ACP connections, give compatible agents a per-run host-controlled MCP proxy,
not raw upstream credentials. The proxy exposes only the selected tools and
checks grants again on every call. Its short-lived credential is scoped to the
run and revoked on termination. Check advertised transport capabilities before
starting; show unsupported connection capability instead of silently omitting
tools. Existing CLI network/filesystem access is not sandboxed by this proxy;
never present MCP grants as complete confinement of a local CLI.

For the API engine, add a bounded loop around the existing model gateway:
stream -> collect tool calls -> validate/approve -> execute -> persist tool
results -> continue generation. Preserve provider continuation formats inside
adapters. Reject unknown tools and invalid arguments before any side effect.

## Durable records and command contract

Reuse existing thread, turn, action, approval, and receipt records where their
contracts fit. Add forward migrations only for missing concepts:

| Record            | Required fields                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Connection        | id, name, transport, endpoint/approved command, secret reference, enabled state, last test time, schema revision     |
| Profile extension | engine kind, instructions, connection/tool grants, default project, timeout, maximum steps, external spending cap    |
| Run               | id, profile/thread ID, engine, status, input, immutable configuration snapshot, start/end time, cancellation flag    |
| Tool attempt      | run ID, call ID, tool revision, redacted arguments, approval ID, external job ID, outcome, result/artifact reference |
| Run event         | run ID, monotonic sequence, type, redacted payload, timestamp                                                        |

The server supplies IDs, time, effective permissions, and status. Secret values
must never appear in these rows. Version and migrate existing profile settings
without losing names, marks, selected agents, or thread associations.

Proposed narrow operations: `connections.list`, `connections.connect`,
`connections.test`, `connections.disconnect`, `profiles.updateGrants`,
`runs.start`, `runs.cancel`, `runs.get`, `runs.events(afterSequence)`, and
`approvals.answer`. Validate both sides with Zod. Credential submission is a
write-only operation; list/read responses return authentication status only.
Scope every operation to the local authenticated host session and its target
profile/project. Do not expose arbitrary fetch, shell, or database commands.

Use namespaced connection tools and versioned JSON Schema validation; extend
the closed work-tool contract deliberately rather than casting dynamic IDs to
`WorkToolId`. Bound schema size and reject unsupported constructs.

Run states: queued -> running -> waiting_for_approval -> running ->
succeeded / failed / cancelled / interrupted. A missing heartbeat or socket is
not proof of completion. Persist state before starting external work and use
ordered events so reconnect does not duplicate text or calls. One active turn
per thread; bounded host concurrency and queue length.

On restart, mark lost local processes interrupted. Reattach to saved remote job
IDs when supported. For ambiguous writes, record `outcomeUnknown` on the tool
attempt and require reconciliation; never blindly retry a post or paid job.
Retry only safe reads with bounded backoff. Cancel both the local run and the
remote job where supported; report if remote cancellation cannot be confirmed.

## Connection and approval policy

Connecting an account authorizes credential storage and testing, not arbitrary
execution. Show tool names, destination, data access, and cost before enabling.
An Apify scrape is an external paid operation even when the resulting data is
read-only. Extend policy to evaluate spending separately from read/write risk;
the existing automatic allowance for local reads is insufficient here.

For MVP, require approval for each paid run and each external write. Later,
explicit standing grants may cover a specific tool, account, input constraints,
expiry, and enforceable budget. If a provider cannot enforce a spending ceiling,
show that limitation and require per-run approval instead of promising a hard cap.
Bind approvals to immutable argument hashes and tool revisions, expire them,
and consume them once. Denial or expired authentication stops the call.

MCP annotations are hints, not permission authority. Reconnection or a changed
tool schema invalidates affected grants until reviewed. Disconnect revokes
credentials and grants, prevents new calls, and reports any remote work still
running. Keep historical receipts redacted and readable.

HTTP connectors use HTTPS and approved destinations, with redirect and resolved
IP checks against private-network access. Local MCP commands require explicit
trust and fixed argv; do not shell-evaluate connection text. OAuth uses state,
PKCE, exact redirect validation, and resource/audience-bound tokens. Avoid token
passthrough. Redact headers, tokens, and query secrets from diagnostics.

Tool results, scraped posts, files, and plugin descriptions are untrusted data.
They cannot authorize another tool, alter grants, or become system instructions.
Bound downloads, result items, stream buffers, tool steps, and execution time.
Display provenance and safe links; do not render raw remote HTML.

## Worked flow: research a topic on X with Apify

1. In Settings / Plugins, connect Apify using its MCP endpoint and the user's
   API token. Store the token in Keychain. Test authentication and discover tools.
2. In Social Content Manager settings, select an approved research Actor/tool.
   Inspect its input schema, data needs, limits, and pricing. Do not auto-install
   or execute arbitrary Actors selected by model-generated text.
3. User asks: “Research local AI apps on X from the last seven days.” The agent
   prepares query, date range, result limit, and proposed Actor input.
4. Show an approval card naming Apify, the selected Actor, query, date range,
   result limit, and cost estimate/cap or explicit unknown-cost status.
5. After approval, start the job and persist its external run ID. Stream factual
   states such as started, collecting, fetching results, and summarizing.
6. Fetch bounded results, deduplicate by post ID/URL, and preserve author, URL,
   post timestamp, and retrieval timestamp. Explain incomplete coverage or errors.
7. Return findings with citations to the collected posts and a sources list.
   Store the answer and a redacted execution receipt under the bot's thread.
8. “Draft an X post from this” produces a draft. Publishing requires a separately
   connected X write-capable integration and approval of the exact text/account.
   Apify access does not imply access to the user's X account.

Do not assume every Actor supports the same inputs, pricing, or coverage.
Validate the selected Actor before implementation. No real scrape, account
connection, payment, or publication is authorized by this design document.

## Scheduling and notifications

Ship manual runs first. Then add host-owned schedules referencing a profile and
an immutable task specification, with timezone, next run, overlap policy, and
budget. Default to no overlap and no replay of missed paid runs after sleep.
The desktop host must be running; expose that requirement in Settings. Resume
remote jobs after wake where possible. Notify on completion, failure, or required
approval, not every poll. A permanent daemon and cloud scheduler are later work.

## Delivery and acceptance

1. UI: match all four references using live data. Verify Agents empty/active
   chat, Chats empty/active thread, Code launcher/multiple panes, and Settings.
   Preserve keyboard navigation, cancellation, history, and tool access. Disabled
   notch/update controls must say unavailable; do not imply those services exist.
2. Connections: one reviewed Apify MCP integration, secure credential storage,
   test/disconnect, grants, and schema validation. Test denied/revoked access,
   malicious destinations, schema changes, and secret redaction.
3. Manual bot run: API engine tool loop plus durable run events and approvals;
   ACP proxy after capability checks. Prove the full research flow with fixture
   tools first, then a separately authorized live Apify run with a small cap.
4. Recovery: test cancellation, lost connection, restart, duplicate events,
   interrupted remote job, quota exhaustion, and ambiguous write outcomes.
5. Scheduling: add only after manual execution and recovery pass. Test sleep,
   missed trigger, overlapping runs, expired credentials, and budget exhaustion.

For each slice run the repository architecture/license/format/lint/type/test/
build checks and desktop smoke. Add focused regression coverage at policy and
run-state boundaries. Desktop smoke is startup evidence, not proof of external
integration. Hosted CI, live Apify, live X, and release acceptance remain separate.

## Primary references

- [Apify MCP integration](https://docs.apify.com/integrations/mcp): remote MCP and token setup.
- [Apify API](https://docs.apify.com/api/v2): asynchronous Actor runs and datasets.
- [MCP tool security](https://modelcontextprotocol.io/specification/draft/server/tools): tool annotations are untrusted hints.
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization): resource-bound authorization.

## Verification of the visual slice

The corrected UI is uncommitted in `feat/product-look`. The reference is the
user-supplied Excalidraw scene, inspected at full size on 2026-09-08.

- `pnpm verify` passes with Node 24.18.0: architecture, licenses, telemetry,
  formatting, lint, typecheck, 505 tests (6 skipped), and build.
- The desktop startup smoke passes. Visual checks use an isolated local host
  fixture; their model choices and terminal output are explicitly sample data.
- Checked populated Agents, empty and active conversations, model search and
  selection, Build/Plan and permission forwarding, profile creation and selection,
  consistent dialog controls, and red/yellow/green No Sleep modes.
- Checked Code launch and adding distinct harness panes, including the reference
  layout with one tall pane and two stacked panes.
- Live installed Codex and OpenCode both accepted ACP initialization, session
  creation, and setting the current model again. No prompt or inference was sent.
  Codex advertised six models including Astra, Sol, Terra, and Luna. OpenCode
  advertised 457 models, including OpenRouter's Sonnet 5, Opus 5, Fable 5 and 5.1.
  The protocol now accepts up to 2048 choices; a regression test covers 457.
- Model, mode, and approval controls retain the exact harness values. Product
  labels map “Approve for me” to “AI approval” and “Ask for approval” to “Human
  review”; no separate BuilderHelm AI reviewer or new permission grants were added.

Provider authentication and access still determine whether an advertised model
can execute. Hosted CI, paid model inference, external plugins, release packaging,
and pixel-perfect acceptance remain separate from these checks. No commit, push,
merge, paid scrape, or X publication was made.
