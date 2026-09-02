# Implementation status

Last reviewed: 2026-09-02.

This document distinguishes working code from planned product scope. A feature
is not shipped merely because a route, mock, fixture, or documentation page exists.

## Working in the repository

- Secure Electron main/preload/renderer boundary.
- TypeScript application services and Zod-validated IPC.
- SQLite migrations and repositories.
- Keychain-backed provider settings.
- Provider-independent model gateway and canonical chat history.
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

## Partial or needing hardening

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

## Planned, not shipped

- Unsigned or auto-approved whole-desktop computer-use.
- GitHub pull-request intake and a BuilderHelm OAuth app.
- Global search across worktrees, files, agents, commands, and artifacts.
- Rich development notes with slash commands and inline logs.
- Usage, quota, rate-limit, and account-switching UI.
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
