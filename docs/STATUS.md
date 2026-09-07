# Implementation status

Last reviewed: 2026-09-07 (modes stack merge; auth/chat/shell driven in the desktop before landing).

This document distinguishes working code from planned product scope. A feature
is not shipped merely because a route, mock, fixture, or documentation page exists.

Status labels used below:

- **Integrated** — code on `main`; the list under "Integrated implementation".
- **Verified in the running desktop** — driven live in Electron (`pnpm dev` or
  `pnpm smoke:desktop`) with an isolated database. Stated inline per item.
- **Verified in the packaged app** — exercised in `pnpm dist` output. The
  current ceiling is startup-only; see "Partial or needing hardening".
- **Unmerged** — live branch work; recorded per feature under "Unmerged work".
- **Planned** — see "Planned, not shipped".

## Integrated implementation (`main`)

- Secure Electron main/preload/renderer boundary.
- TypeScript application services and Zod-validated IPC.
- SQLite migrations and repositories.
- Keychain-backed provider settings.
- Provider-independent model gateway and canonical chat history.
- Chat tab hosts installed ACP agents (Gemini, OpenCode, Grok, Claude ACP,
  Codex ACP, or any configured command). Threads persist locally. Permission
  rules are remembered per workspace. The tab has not been clicked live in a
  packaged build.
- Three-mode shell (Agents, Code, Chats) and a ⌘K plus menu that runs existing
  surfaces. Plugins, Skills, and Automations remain labeled stubs.
- Permissioned actions, approvals, and receipts.
- Project dashboard and Git continuity.
- Space setup with real xterm.js terminals backed by node-pty.
- Per-pane installed-agent selection and plain-shell mode.
- Board project selection, persistence, stages, and drag-and-drop.
- GitHub issue intake: assigned `gh` issues, one Board card per source ID,
  Swarm start from an imported card, and explicit close/reopen with a receipt.
  Covered by service tests. The Board GitHub panel has not been clicked live.
- Linear issue intake: Keychain API key, assigned issues, one Board card per
  source ID, Swarm start from an imported card, and explicit complete/reopen
  with a receipt. Covered by service tests. The Board Linear panel has not
  been clicked live.
- Memory vault selection, local Markdown indexing, answers, and citations.
- Editor tree, tabs, save, save-all, autosave, and word wrap.
- Git status, history, stage, unstage, and commit.
- Git panel: branch, tracking, multi-line commit box, staged / change sections
  with folder grouping and per-file `+N`/`−N` counts, a commit graph with
  lazy-expand rows, file filtering, and a selectable base ref.
- Review, a top-level side-panel tab: unified diffs, line comments routed to
  the seat that owns the file, checks recorded with their exact command and
  revision, draft pull requests and CI status through the GitHub CLI, and
  landing that refuses a head the reviewer did not approve. Landing takes two
  presses so the approved commit is the merged commit. The service is covered
  by tests; the sidebar view has been driven against a real repository, but its
  check, pull-request, and land buttons have not been clicked live.
- Swarm mission, roster, CLI seats, live state, directives, budgets, and worktree flow.
- Voice dictation: on-device models never send audio off-device; cloud models
  require a stored key and first-run consent before any upload.
- Third-party attribution generated from the production graph, shipped in the
  app resources, reachable from the Help menu, and guarded in CI.
- Pane worktree creation is transactional, and worktrees left by a crashed run
  are reclaimed at startup. A worktree holding uncommitted work, and a branch
  holding unlanded commits, are both preserved.
- Terminal output is bounded end to end: the renderer reports what it has
  drained and the host pauses the PTY when a pane outruns it.
- Installed CLI detection resolves the catalog in one login shell and returns
  canonical interactive, headless, structured-output, resume, usage, and Swarm
  permission capabilities. Provider-specific launch, schema-output, and usage
  behavior is isolated in the core CLI adapters.
- Browser: sandboxed `WebContentsView` preview per profile, loopback port
  import, omnibox that navigates or searches, element grab and annotation with
  pins, screenshot markup copied to the clipboard and stored on HEAD, detached
  page DevTools, and viewport presets. Desktop fills the panel; tablet and
  phone letterbox and still report the preset width. ⌘+/⌘-/⌘0 zoom the page,
  not the chrome. Land fails closed if the reviewed head moved. Cart/checkout/
  send never silent. WebMCP declared tools are not shipped.
- Browser evidence — snapshot refs, click/fill by ref, console and network rows,
  and the artifact list on HEAD — is recorded in the main process and read over
  IPC. The panel deliberately shows no debug list for it, so today it is
  reachable by an agent and by tests, not by eye.
- Browser settings: home page, search engine, zoom, link routing, terminal link
  actions, localhost worktree labels, and profiles with isolated cookies. Stored
  in the existing settings table and verified to survive a restart. Cookie
  import is a main-process picker; cookie values never reach the renderer and
  there is no export path.
- macOS whole-desktop click/type remains permissioned in the main process and
  always prompts. It has no entry point in the browser toolbar.
- Launch animation on the BuilderHelm mark, held while the window settles and
  then pushed toward the viewer and faded into the shell. Any key skips to the
  exit, and a reader who asked for reduced motion gets the shell immediately
  rather than a shortened storm. Driven and timed against the live renderer.
- `main` is protected server-side: the CI `verify` check is required, the rule
  applies to admins, and force-pushes and deletion are refused. A pre-push hook
  runs the same `pnpm verify` locally, so a red tree fails in seconds instead of
  after a CI round trip. Both paths were exercised by attempting a rejected
  push.
- Usage bar: Claude / Codex / Grok 5h and weekly windows, compact/detailed
  popover, isolated extra homes, Grok email only. Claude reads the OAuth usage
  endpoint on a 30s live poll; Codex refreshes live via app-server. Grok weekly
  % stays blank until a non-interactive stats command exists.

## Partial or needing hardening (running desktop)

- Swarm stop/reconnect and failure recovery.
- Terminal output is batched in Electron main, startup scanning is incremental,
  and reconnect reconciles the drain snapshot against live output by stream
  offset. Verified on macOS at 1, 2, 4, 8, and 12 panes. Renderer-side write
  coalescing is deliberately not implemented: batching already cut host sends
  by 95% and the cell-accurate renderer replaced the DOM renderer it was meant
  to protect, so there is no measured headroom left to reclaim.
- Cross-platform shell, path, credential, and PTY behavior.
- Packaged desktop verification is thin: the packaged arm64 app starts, reports
  renderer ready, and exits cleanly, but it is unsigned, unnotarized, and has
  had no real user session run against it.
- Two OS dialogs stay click-only: the cookie file picker and the confirm prompts
  for import and profile deletion. What they gate is covered — file size, JSON
  parse, and export shape in `readCookieExport`, the per-domain plan and the
  dropped-row count in `planCookieImport`, and the default-profile and
  active-profile rules in the settings service. The toolbar menus are a child
  window rather than a native menu, so they are driveable end to end.
- A capture taken while the window is occluded returns no pixels, so evidence
  recorded from a background window carries metadata without a picture.

## Unmerged work

Live branch ledger. Ahead-counts are not independence proofs; re-verify
positions against `origin/main` before any integration.

### Shell stack: modes shell + chat + auth

- Feature: app shell rebuild (Agents/Code/Chats modes, ⌘K launcher, settings
  Usage/Account split) together with the ACP chat host and the account/licence
  gate it is built on.
- Branch and revision: `feat/shell` @ bcdeb4a, strictly linear over
  `feat/chat` @ 9ef8cfd, over `feat/auth` @ b3583ec, plus a merge of `main`
  @ 9dbca07 (bcdeb4a) and the auth access policy ADR (f9afdf1,
  [ADR 0009](adr/0009-account-licence-access-policy.md)). Merging
  `feat/shell` ships all three; there is no separate chat or auth branch
  decision.
- Depends on: nothing outside `main`; merged current `main` at bcdeb4a. The
  conflict inventory was exactly one file: `docs/STATUS.md`. The previously
  recorded styles.css / usage.tsx conflicts no longer exist and were stale.
- User-visible behavior: mode rail and launcher replace the Space home entry;
  chat gains an ACP host and persisted threads; sign-in handoff can recover;
  the licence gate controls entry.
- Verification performed 2026-09-07, in Electron dev from this worktree with
  `BUILDERHELM_DATABASE_PATH=/tmp/bh-phase0/bh.sqlite` and the renderer driven
  over the `BUILDERHELM_DEBUG_PORT` CDP endpoint: all three modes switch
  (Agents grid, Code workspace choices, Chats thread panel); ⌘K opens the
  grouped launcher with honest per-agent availability; a live ACP turn against
  `gemini` on the Chats tab completed end to end (handshake, streamed reply,
  thread auto-titled and persisted); `pnpm smoke:desktop` passed with an
  isolated database; the owned PTY tree came down with the app.
- Known failures: none from this drive. Top-bar icon buttons still carry no
  accessible names (carried from the preservation findings). The packaged
  build has not been click-through.
- Next required action: review the auth diff via PR against ADR 0009 (repo
  rule for security changes), then land the stack on `main`.

### Workspace launcher (uncommitted WIP — decision recorded)

- Feature: ⌘K "open or create" launcher dialog, Agents page with launch
  buttons, shared `launchWorkspaceAgent` action catalog (per-agent worktree
  isolation, 16-pane cap, no process spawn from the UI), browser view
  suspension while dialogs are open.
- Branch and revision: `feat/workspace-launcher` @ ee6aeb9 (committed side is
  an ancestor of both `main` and the shell stack) + 13 uncommitted files,
  all retained.
- Verification performed: 7 vitest cases in
  `apps/desktop/test/workspace-actions.test.ts`; no desktop run recorded.
- Decision 2026-09-07 (updated during the roster phase): the shell stack's ⌘K
  launcher (`launcher-actions.ts`) is the converged design; the WIP dialog and
  its style edits are superseded and will not be merged. The roster shipped
  chat-only, so `launchWorkspaceAgent` (per-agent worktree isolation, 16-pane
  cap) has no caller yet — its port is deferred until profiles gain workspace
  launching. The worktree and its files stay until that port lands.
- Next required action: port `launchWorkspaceAgent` when profile workspace
  launching lands; do not merge the WIP dialog.

### Agent roster (`feat/agent-roster`, unmerged)

- Feature: named agent profiles (name, mark, backing CLI, default project
  folder) with a roster sidebar in the Agents mode and a shared chat pane;
  profile-backed starts resolve argv in main; live sessions capped at 8;
  startup-death errors carry the agent's stderr; a missing project folder is
  refused with the path named instead of a bare spawn failure. The composer
  is a pill with config chips (model, thought-level, mode; other categories
  under an overflow chip; nothing shown for agents that advertise nothing),
  compact tokens, on-device dictation, and a circular send/stop. Transcript
  cells: collapsible thoughts, a Goal block, tool cells with path chips and
  the approval inline on the blocked cell, and an earlier-messages expander.
- Branch and revision: `feat/agent-roster` over the modes stack (Phase 1
  c9dce20, Phase 2 b8e6946, Phase 3+4 761b4cd).
- Verification performed 2026-09-07: unit suites for profiles, manager
  boundaries, thread/profile persistence, roster helpers, and chip grouping;
  `pnpm verify` green; desktop drive — profile created through the dialog
  (name, mark, agent, folder), roster row and tile render, pane header
  "Powered by …", composer gated until a folder exists, empty state "What
  should we build?", profile IPC round-trip survives an app restart from an
  isolated database, live profile-backed turn completes with the roster dot
  lit, and the missing-folder guard names the path in the running app.
  Against a real codex-acp 1.10.0 (`@agentclientprotocol/codex-acp`,
  user-installed): handshake, `loadSession` capability, and advertised config
  options verified — the composer rendered "Mode: Approve for me", "Model:
  GPT-6-Astra", "Reasoning effort: Low", and the overflow chip, and a mode
  switch through the chip popover round-tripped `set_config_option` ("Mode:
  Ask for approval"). Streaming is proven end to end.
- Known gaps: the folder picker itself is the OS dialog (driven only by
  hand); profile switching mid-turn is blocked by disabling the roster; gemini
  advertises no config options or usage events, so its chips and token count
  are legitimately empty; a profile session starts lazily, so chips appear
  with the first message rather than on selection. A full Codex model
  completion, diff approval, and a restart-resume against live quota could
  not be driven: the account's Codex usage is exhausted until 2026-09-12
  (Codex streams that notice and fails the turn with "Internal error"; the
  transport, session, chips, and honest failure display all verified around
  it). Resume capability is negotiated (`loadSession: true`) and the session
  id rides the thread per ADR 0004.
- Next required action: after quota resets (or on another signed-in
  machine), drive one full Codex turn with a diff approval and a
  restart-resume; then land the stack behind PR #30 and this branch together.

### Legal docs

- Feature: publish-ready site Terms and Privacy Policy.
- Branch and revision: `feat/legal-terms` @ 556415a, 2 docs commits, 119
  behind; plus untracked draft `docs/legal/anthropic-authorization-request.md`
  (retained; needs an explicit keep/drop decision before landing).
- Depends on: none.
- Next required action: rebase and integrate the two docs commits.

### Search and notes (deferred)

- Feature: command palette for files, tasks, and commands (`feat/p4-search`,
  1 commit) with project notes and CLI quota ingest stacked on
  (`feat/p4-notes-usage`, +2 commits).
- Branch and revision: branches retained; checkouts removed 2026-09-06.
- Depends on: nothing; conflicts with the shell stack (`styles.css`,
  `bootstrap.ts`, `routes/settings/usage.tsx` add/add), and `main` already
  re-implemented quota ingest (`apps/desktop/src/main/quota-ingest.ts`,
  `packages/core/src/accounts/`).
- Next required action: none until the core loop is accepted; when revived,
  rebase the palette and drop the superseded quota commit.

### Integrated but not yet cleaned up

- Feature: endpoint-privacy and data-loss fixes.
- Branch and revision: `feat/fix-audit-bugs` @ cc1f256 is patch-equivalent to
  `main` HEAD (verified with `git cherry`). The worktree remains only because
  a stale dev Electron instance (pids 47733/47830 at reconciliation) runs
  from it.
- Next required action: stop the dev instance, then remove the worktree and
  `git branch -d feat/fix-audit-bugs`.

### Orca-managed checkouts (outside this layout)

- `feat/browser-studio` @ 98ae93e: fully merged (71 behind, 0 ahead);
  worktree retained because Orca manages it.
- `imYashChaudhary973/Marketing` @ 6e48132: marketing teaser work, 3 unique
  commits, dirty lockfile plus a stock template README; not release scope.

### Checkout reconciliation — 2026-09-06

- Hub `/Users/yashchaudhary/Desktop/BuilderHelm` is a bare repo. Its stale
  hybrid-era working files (Rust `crates/`, `docs/STACK.md`, `@zero` docs)
  were removed after verifying byte equality with commit f88dc86. Unique
  strays live in `~/Desktop/builderhelm-hub-backup/` (`.claude/`, `.codex/`,
  one screenshot, CSS salvage patches from the removed app-icon and voice
  worktrees). Hub `AGENTS.md` is now a pointer to the canonical checkout.
- Removed as fully merged (0 ahead of `origin/main`): worktrees app-icon,
  voice, ci-format, editor-explorer, lightning-splash, no-sleep, p4-linear,
  preview, qa-fixes, review, swarm-roster-clip, usage-bar,
  p4-github-intake, p4-search, p4-notes-usage; branches feat/app-icon,
  fix/ci-voice-zero, feat/ci-format, feat/editor-explorer,
  feat/lightning-splash, feat/no-sleep, feat/p4-linear, feat/preview,
  feat/qa-fixes, feat/review, feat/swarm-roster-clip, feat/usage-bar,
  feat/voice, pr-26, feat/p4-github-intake, and phase-3/checkpoint-build
  (patch-equivalence verified). Two prunable fixture worktrees under
  `/var/folders` were pruned.
- Parked archive branches kept without checkouts: `wip/helm-platform`,
  `wip/coding-loop`.

## Workspace-preservation verification — 2026-09-06

Revision under test: `origin/main` 23a171b, driven from the
`feat/preserv-verify` worktree in Electron dev (`pnpm --filter
@builderhelm/desktop dev`), isolated database
`BUILDERHELM_DATABASE_PATH=/tmp/bh-preservation/bh2.sqlite`, driven over the
CDP port with real keyboard events. Scenarios from the stabilisation plan §4.

What held:

- `BUILDERHELM_DATABASE_PATH` is honored; the primary database stays where it
  is pointed.
- Creating a workspace with a valid Git directory puts both panes at the
  correct cwd with the branch chip shown.
- Quitting the app (SIGTERM on the dev tree) takes the owned PTY tree down;
  no stray `claude`/shell processes remained.

Findings, ordered by severity:

1. **Unsaved editor drafts are silently lost.** Typed into `README.md`
   (real keyboard events, buffer confirmed `helloDRAFTXY`, disk still
   `hello`), navigated home and back, reopened the file: buffer reverted to
   the disk content. No autosave fired, no warning, no recovery copy.
   Direct violation of "a delayed save cannot replace newer typing" and
   "closing UI does not silently destroy work".
2. **A missing working directory falls back to `$HOME` silently.** The
   wizard accepted `/tmp/bh-preservation/no-such-dir/child` with no error;
   the created panes are titled `child #1/#2` but the shells run at
   `/Users/yashchaudhary`. No actionable failure anywhere.
3. **Workspaces do not survive a restart.** After quit + relaunch the rail
   is empty even though workspace records exist, and the home screen offers
   no recents. Re-entering the same path in the wizard silently spawns fresh
   shells; nothing explains that the previous session's PTYs died or that
   this is a new session.
4. **Workspace state lives in renderer `localStorage` only**
   (`exeum.space.meta`, `exeum.space.recents` — retired `exeum` prefix).
   The SQLite `projects` table stays empty, so the audited database does not
   know the user's primary object exists, and dev (localhost:5174) versus
   packaged (different origin) stores diverge.
5. **The wizard pre-fills the working folder with `/Users/<home>`.** Combined
   with (2), clicking through creates a home-rooted workspace; during run 1
   this produced live `claude` panes rooted at `$HOME` without a completed
   wizard flow being visible.
6. **No workspace switcher surface.** The rail shows only the active
   workspace; the second workspace was unreachable from the UI except by
   re-running the wizard with its path.
7. Accessibility/perf smells: top-bar and side-tab icon buttons carry no
   accessible names; one 60-character programmatic type into the editor did
   not complete within 30 s (needs a re-measure before treating as fact).

Not yet driven: closing a workspace that holds unlanded commits (no
workspace-level close control was reachable in this build), save-race with a
concurrent second pane, heavy-output reconnect.

Next required action (batch 2): the workspace-preservation slice — validate
the working folder at entry, make editor buffers survive navigation
(flush-on-blur or restore-on-mount), move workspace records into SQLite,
restore workspaces at launch with an accurate interrupted-session message,
and add a workspace switcher. Re-run these scenarios as the acceptance gate.

## Planned, not shipped

- Unsigned or auto-approved whole-desktop computer-use.
- GitHub pull-request intake and a BuilderHelm OAuth app.
- Global search across worktrees, files, agents, commands, and artifacts.
- Rich development notes with slash commands and inline logs.
- Local token/cost analytics heatmap (Swarm receipts).
- Optional encrypted relay and remote host pairing.
- React Native iOS and Android companion.
- Verified Windows and Linux desktop distributions.
- Signed installers, auto-update, notarization, and release channels.

## Current verification boundary

macOS is the only exercised desktop platform. Windows, Linux, mobile, relay,
real hosted CI integration, and release signing require future evidence.

## Architecture-reset compatibility

This reset changes internal package names, IPC channel names, environment
variables, the local database filename, and the Keychain service name. Existing
development databases are not migrated automatically, and provider credentials
must be entered again. Previous Keychain items are left untouched rather than
deleted. Startup fails closed with an explanatory dialog rather than silently
when a database predates the reset.

See [MIGRATION.md](MIGRATION.md) for the one-time cleanup steps.
