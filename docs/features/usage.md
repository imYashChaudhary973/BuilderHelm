# Usage, pricing, and subscription limits

Status: implemented on `feat/providers`; unmerged. The desktop renderer calls
validated preload methods. History scanning, foreign database reads, and report
aggregation run in a worker, separate from Electron main.

## Usage and cost

Usage has Cost, Tokens, and Limits views. Cost and Tokens have today, 7/30/90-day,
all-time, and environment filters. Reports break down measured records by provider,
account, model, local day, and the top 50 sessions by tokens. Tables page through
20 rows at a time. Missing, partial, failed, and unavailable sources remain visible.

Token categories are disjoint: uncached input + cache read + cache write + output.
Reasoning is a share of output; one-hour cache writes are a share of cache writes.
Neither is counted twice. Conversation text is never used to guess tokens.

Calculated amounts are **estimated API-equivalent cost**, separate from actual
subscription bills. Provider-reported cost takes precedence and is displayed as
unsplit Other. Unknown models or unpublished fast tiers stay Unpriced. Missing
categories and unrecorded speed tiers remain explicit; standard pricing is an
assumption when the source did not record speed.

Bundled rates retain their provider URL and date. Refresh downloads the public
LiteLLM community table without uploading history. Overrides and model aliases
recalculate historical estimates. An override replaces the model's standard/fast
rates, long-context rule, and geography multiplier; its 1h write rate is optional.

## Provider coverage

| Provider              | Measured usage                                                                                 | Subscription windows                                                              | Account selection                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Claude Code           | JSONL assistant usage, deduplicated by message/request identity                                | Account-specific statusLine reports while an interactive session runs             | System, managed, or attached configuration folders                |
| Codex                 | Saved JSONL rollouts, incremental cursors; cached input split out and reasoning kept in output | Official app-server `account/rateLimits/read`, per login, at most once per minute | System, managed, or attached `CODEX_HOME`                         |
| OpenCode              | Read-only message counters from supported `message`/`session_message` SQLite layouts           | Unavailable here; OpenCode owns its provider billing                              | One system integration; isolated account switching is unsupported |
| BuilderHelm API chats | Saved API response usage; protocol-specific input normalization                                | Unavailable here; API billing is separate                                         | Existing configured API providers                                 |
| Grok                  | No supported historical token source in this feature                                           | Existing CLI billing-log window, when available                                   | System, managed, or attached homes                                |

Gemini, Kimi, Pi/OMP, Cursor/Copilot, plain shell, and custom commands have no
historical usage adapter here. Their exclusion is explicit in Data sources.

OpenCode uses message creation times and model IDs, rather than attributing an
entire session to its latest model/day. Live counters replace the same event.
Unsupported database versions fail visibly. Codex installations without saved
rollouts show missing history; the adapter does not manufacture records from
conversation text or an unrecognized state database.

## Account and session rules

Each login has a stable local reference and configuration location. When available,
Claude account plus organization identity or Codex account claims are hashed to
identify the actual account. Credentials stay in the CLI's own storage; no tokens
are copied between folders. Without trustworthy identity, folders remain distinct.
Historical CLI records are attributed to the current identity of their source
folder; earlier account changes inside that folder cannot be reconstructed.
Remote history synchronization and API account deduplication across independently
configured connections are not implemented.

Users can add, attach, rename, disconnect, disable, and manually select logins
(up to 15 additional folders per provider).
System logins use the CLI's default folder. Managed logins use a folder created
under BuilderHelm's data directory and the CLI's own sign-in command. Attached
folders are selected through the native picker, resolved to a real directory,
and must already contain a login. The home directory or its parents, the system
login folder, and BuilderHelm-managed folders cannot be attached again.
Removing a managed login deletes only its validated managed folder; removing an
attached login leaves the folder alone. Custom labels are kept, while generic
labels can become the login email when it becomes available.
Disabling keeps usage history and prevents new turns, including on an already
connected ACP process. Removing an attached login forgets its configuration
reference and leaves its folder alone. System default stays enabled. A selected
removed, disabled, or missing folder fails instead of falling back to another login.

Agents chat displays the login before connecting and binds new threads to it.
Changing the active login affects new conversations. Existing threads keep their
original folder and refuse cross-login resume. Older threads with no recorded
login remain readable but require a new conversation to run. There is no automatic
account failover or replay of a partially executed turn. CLI/Swarm paths that
cannot honor an explicit account reference reject it clearly; their existing
active-login terminal environment remains available.

## Limits

Limits are current account-specific readings, not historical token estimates.
They have provider window ID/label/scope, used percentage, reported reset,
observation time, plan when supplied, and availability/error state. They are never
calculated from tokens or estimated cost. An expired reset retains the last reading
as stale until a provider reports again; it never becomes invented 100% availability.

One account connected through several folders is shown once when trustworthy
identity matches, using the latest reading. Each named window stays separate.
The optional pool is the arithmetic mean of reported remaining percentages for
that window. Non-reporting accounts do not contribute. The soonest reset gain is
that account's reported used share divided by the reporting account count. These
summaries do not route turns or promise that distinct subscriptions are transferable.

Grok refresh reads the log already written by the user’s CLI; it does not spawn an
interactive billing pull. Codex reads are limited to two concurrent logins.

Claude statusLine integration is opt-in for system and attached folders and restores
previous settings when turned off. Managed folders receive the hook automatically;
removal only changes a statusLine command owned by BuilderHelm.
Errors keep the last reading visibly stale.
Raw provider error payloads and ACP stderr do not enter client-visible errors or
persisted thread events; authentication failures keep a safe sign-in instruction.

## Persistence and verification

SQLite stores normalized event keys, source identities, file offsets, database
cursors, account labels, and pricing settings. Duplicate lines, copied/forked
Claude histories, and repeated environment views do not add another event.
Disabled/disconnected accounts retain previously ingested records. File scans
read up to 1 MiB per source per refresh, and reports stream 1,000-row pages.
SQLite uses WAL; worker writes use short batches so normal app writes can proceed.

Focused tests cover token normalization, pricing/tier handling, overrides, event
identity, incremental scans, missing files, OpenCode counter updates, per-login
quota, pool arithmetic, disabled launches, account-bound resume, worker failure,
and safe provider errors. `pnpm smoke:usage` exercises the built worker against
a temporary database, including duplicate folders, append/restart, and concurrent
SQLite writes. Run `pnpm typecheck` and `pnpm build` before that smoke check.

The Oct 8, 2026 fixture walkthrough uses the production renderer, preload/IPC,
and Electron backend through a loopback test bridge. The BuilderHelm sign-in gate
is supplied as a fixture; real provider login and paid turns, packaged click-through,
Windows/Linux, mobile, remote synchronization, and hosted CI are separate evidence.
