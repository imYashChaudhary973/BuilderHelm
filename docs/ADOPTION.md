# Hybrid architecture adoption plan

Accepted 2026-08-27. Decision: [ADR 0006](adr/0006-hybrid-architecture.md).
Supersedes the full-Rust migration plan (ADR 0005, plan removed).

**The pivot in one line:** the full-Rust rewrite is cancelled; BuilderHelm
becomes a platform on a hybrid architecture — a Rust **core engine** (engine,
settings management, agent workflows, performance-critical operations) plus a
TypeScript **platform** (development environment, UI frameworks,
cross-platform capability, AI-tool coordination).

## 1. What the application uses

| Layer                | Technology                                                                 | Owns                                                                                                    |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Rust core engine     | tokio, serde, rusqlite, reqwest, keyring, portable-pty, alacritty_terminal | Core engine, settings management, agent workflows, PTY/terminal I/O, model gateway, permissions, SQLite |
| TypeScript platform  | Electron + React + Vite                                                    | Development environment, UI framework, chrome, cross-platform shell (macOS/Windows/Linux)               |
| Typed IPC contract   | schema-validated, 71 channels                                              | The only boundary. Both sides satisfy the 218-fixture conformance corpus                                |
| AI-tool coordination | TypeScript + MCP                                                           | Cursor/Windsurf/MCP-standard integrations, seat↔agent coordination, multi-agent collaboration           |

What this replaces: the "everything in Rust" goal. What it keeps: everything
already built on both sides.

## 2. Where the code stands today

| Asset                          | State                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------- |
| TypeScript renderer (Electron) | Shipping: Space, Swarm, Board, Memory, chrome, sidebars                           |
| Rust engine (`crates/`)        | Green: protocol, core services, db, gateway, pty, swarm, host, conformance binary |
| Conformance corpus             | 218 fixtures, 75 IPC methods, replays green against the TypeScript app            |
| `helm-ui` (iced renderer)      | Experimental; keep as an engine-contract consumer, **not** the shipping UI        |
| CI                             | Ubuntu: TypeScript verify + Rust workspace gates                                  |

## 3. Adoption phases

### Phase A — Put the Rust engine behind the Electron contract — **landed 2026-08-27**

**Trigger:** hybrid docs land and `feat/swarm-v2` is stable.

Shipped on `feat/hybrid-bridge` as a bundled Rust sidecar, not a native Node
addon:

- Electron main launches `helm-app engine` as a long-running child process.
- Transport is newline-delimited JSON over stdio, one frame per line.
- The process is local-only: no TCP listener, no remote trust boundary.
- The preload API and all 12 namespaces are unchanged; the renderer was not
  touched. Every channel still runs on its TypeScript handler.
- Handshake carries protocol version, engine version, host kind, the full
  channel map, and the emittable event list. Verified before the client is
  trusted; a refused handshake leaves no child running.
- Graceful shutdown closes stdin then waits before SIGKILL, exits reject
  in-flight calls, restarts bounded at three, cancellation via `AbortSignal`,
  and engine stderr redacted for tokens, secret json values, and home paths.
- All 218 fixtures replay through the sidecar, driven by the same runner that
  drives the in-process host, so fixture setup has exactly one owner.

**Ownership:** Rust owns the engine process and method dispatcher. TypeScript
owns child-process lifecycle and preserves the renderer API.

**Exit — met.** `pnpm verify` green (221 tests), desktop smoke passes with the
engine attached and without it, `cargo fmt --check` clean, clippy 0, 301 Rust
tests, corpus 218/218 in-process and 218/218 over the sidecar, no visible
product behavior change.

Decisions this phase settled that the plan left open:

- **Response frames pass the payload through verbatim** rather than the
  planned `{ id, ok, value | error }`. Channels disagree on shape:
  `zero:system:health` answers a bare object, `zero:board:home-dir` an
  `{ok,value}` envelope. Re-wrapping would have broken the corpus.
- **Contract mismatch is asymmetric.** A channel the app calls but the engine
  does not serve is fatal. A channel the engine serves that the app never
  calls is a warning, because a Rust-first plan lands engine channels ahead of
  their callers; requiring equality would make the engine unshippable
  mid-migration. This is live today: Rust serves 71 channels, TypeScript
  knows 69.
- **No event frames yet.** The Rust host has no emitter, so the handshake
  advertises an empty `events` list and `zero:board:event`,
  `zero:chat:stream-event`, and `zero:swarm:event` stay with TypeScript until
  phases B and C. Consumers read the list instead of assuming.
- **A missing engine is not fatal in phase A**, since no channel depends on
  it. It becomes fatal in phase C, when the first namespace moves across.
  `HELM_ENGINE_BIN` selects the binary; the smoke asserts `engine.ready`
  whenever that variable is set, so the wiring cannot rot unnoticed.

**Still open:** where the sidecar binary lives in a packaged build
(resources directory, arch-specific naming, macOS notarization). Blocks P5-4
packaging, not phases B–D.

### Phase B — Terminal/PTY cutover

**Trigger:** Phase A sidecar is stable under desktop smoke.

- Route `board-pty-manager` calls to `helm-pty` through the sidecar. Keep
  xterm.js as the renderer; Rust owns spawn, resize, write, kill, and output
  events.
- Preserve pane ordering and concurrent spawn. Measure the current Electron
  baseline before changing the path, then repeat the same 12-pane workload.
- **Ownership:** Rust engine team owns PTY lifecycle; TypeScript platform team
  owns xterm integration and pane UX.
- **Exit:** transcript fixtures green, 12 panes responsive, no orphan
  processes after partial failure, CPU/memory recorded against baseline.

#### Step 1 — event frames — **landed 2026-08-28**

PTY output is push, and phase A left the protocol request/response only, so
the transport had to exist before any pane could move. What shipped:

- An `event` frame: `{"type":"event","event":"<channel>","payload":{...}}`,
  with no id, because nothing asked for it.
- Every frame now leaves the engine through one writer thread fed by a
  channel. Responses and unprompted events share that queue, so ordering is
  FIFO and a torn line is impossible once a background task emits.
- `EngineClient` gained `onEvent` and drops any event the handshake did not
  advertise, so the two sides cannot disagree about who owns a channel.
- The handshake advertises only what the launch can actually emit. A
  production launch still advertises none: the transport is real, the
  engine-side source is not yet, and claiming otherwise would make the
  consumer stand down its own emitter and lose events.
- Under `--test-controls` an `emit` control drives a real event across the
  process boundary, and answers `ok` only after the event is queued ahead of
  it. That ack is a barrier, so the tests need no sleep.
- The corpus sidecar reader skips event frames while waiting for a reply.
  Without it, the first fixture that made the engine emit would have failed on
  an id mismatch.

**Exit — met.** `pnpm verify` green (225 tests, 4 new), `cargo fmt --check`
clean, clippy 0, `cargo test --workspace` 0 failures, corpus 218/218
in-process and 218/218 over the sidecar, desktop smoke green with and without
the engine. No visible product behaviour change: `zero:board:event` still
comes from the TypeScript main process.

#### Step 2 — Electron baseline recorded — **2026-08-28**

Recorded before any pane moves, because after the cutover the number is gone.
Harness: `apps/desktop/test/pty-baseline.test.ts`, run with
`pnpm --filter @zero/desktop baseline:pty`. It drives the real
`BoardPtyManager` with the real `node-pty` (an N-API prebuild, so it loads
outside Electron) and a recording stand-in for `WebContents`. Everything the
cutover replaces is exercised: spawn, the per-chunk base64 and envelope parse,
write, resize, kill. The test is skipped unless `HELM_PTY_BASELINE=1`, so CI
stays fast.

Workload: 12 shell panes in one shared folder; one warm round-trip each; then
every pane prints 2,000 x 41 bytes at once (984 KB total, 1,014 KB observed
with prompts and echo).

Median of three runs on an M5, macOS 27, `zsh -i`:

| Metric                           |      Value |
| -------------------------------- | ---------: |
| Spawn, 12 panes                  |    18.3 ms |
| Spawn, per pane                  |     1.5 ms |
| First byte, median               |    23.1 ms |
| Shell ready (first command ran)  |   3,900 ms |
| Shell ready, worst pane          |   4,210 ms |
| Warm round-trip, median          |    11.0 ms |
| Warm round-trip, worst pane      |    11.1 ms |
| Burst, 12 panes x 82 KB          |    70.8 ms |
| Throughput                       | 13.7 MiB/s |
| Main-process CPU per MiB         |     105 ms |
| RSS growth over the burst        |   42.8 MiB |
| Resize, 12 panes                 |    0.24 ms |
| Drain, 12 panes                  |    0.02 ms |
| Orphan processes after `dispose` |          0 |

What these say about the cutover:

- **Spawn, resize, and drain are already cheap.** Rust will not win here, and
  a regression would be the thing to watch instead.
- **Shell readiness dominates everything a user feels** at 3.9 s, and it is
  `zsh -i` sourcing rc files, not the transport. The engine cannot fix it;
  only dropping `-i` or warming a shell can. Do not read a post-cutover change
  in this number as an engine win.
- **CPU per MiB is the real target**: 105 ms per MiB, 88 ms of it user time,
  spent on a base64 encode plus a zod envelope parse for every chunk. Rust
  owning the parser and framing is what should move this.
- **RSS grows 43 MiB to move 1 MB.** The manager keeps an 80,000-char rolling
  buffer per pane and rebuilds it with `output + text` on every chunk. That
  allocation churn is a second thing the engine should remove.

**Next in phase B:** delete the abandoned `src/main/pty-host.ts`
utilityProcess PTY host first. Nothing spawns it - the only reference is its
`electron.vite.config.ts` build entry, so it ships in every bundle and never
loads - and adding a Rust owner while it exists would put three PTY
implementations in the tree against the invariant below. Then give `helm-pty`
output a real emitter, advertise `zero:board:event` unconditionally, drop the
TypeScript emitter, and re-run this harness against the engine-backed path.

### Phase C — Core services cutover

**Trigger:** Phase A contract stable; security review scheduled.

- Move provider settings, secrets, models, chat, knowledge, projects, board,
  actions, and swarm namespaces behind the sidecar one namespace at a time.
- Keyring remains fail-closed (Keychain / Credential Manager / Secret
  Service). Permission and credential changes require human review.
- Remove TypeScript implementations only after their corpus slices pass
  through Rust; keep TypeScript schemas at the bridge boundary.
- **Exit:** all 75 methods route through Rust; no duplicate stateful service
  remains in TypeScript; corpus 218/218 green.

### Phase D — Cross-platform

**Trigger:** all stateful namespaces are engine-backed.

- Windows: ConPTY, Credential Manager, drive/case/long-path scoping, hidden
  subprocesses, and DX12 where native Rust rendering is used.
- Linux: PTY, Secret Service/keyutils backend, dialogs, and packaging.
- Remove macOS assumptions from TypeScript path/shell UX.
- **Exit:** TypeScript verify, Rust gates, desktop smoke, and full corpus green
  on macOS, Windows, and Linux CI.

### Phase E — Product suite

**Trigger:** engine-backed desktop is green on at least macOS and Windows.

One loop at a time, each behind its own gate:

1. **Swarm Builder** hardening — the open P0 items (structured plan/review,
   agent inspector transcript, stop/reattach). Rust owns orchestration;
   TypeScript owns the graph and inspector.
2. **Agent | Code | Chat** surfaces — durable agent records in Rust, thread
   and preset UX in TypeScript.
3. **Terminal Workflow Builder** + **Helm Transform** — natural-language
   workflow scan, plan, implement, verify. Rust owns codebase context,
   planning, and execution; TypeScript owns authoring and review UX.
4. **Helm Code** — ship the CLI on the same engine crates; no second core.
5. **BuilderHelm MCP** — expose agents, swarm, and the task board over MCP.
6. **BuilderHelm Voice** — on-device voice; nothing leaves the machine by
   default. Requires an explicit dependency decision before work starts.
7. **Integrations** — Cursor-compatible, Windsurf-compatible, MCP standards.

**Exit per product:** its own conformance fixtures exist and replay green, and
platform gates stay green.

### Continuous invariants (every phase)

- `pnpm verify` and `pnpm smoke:desktop` stay green.
- `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
  and `cargo test --workspace` stay green.
- Corpus stays green through `helm-app --conformance`; a new behavior needs a
  fixture before code.
- One concern per worktree. Permission, credential, and path-scoping changes
  go through a PR with human review.
- No third implementation of any layer; no duplicated stateful service.

## 4. What current features do under the hybrid

| Feature             | Rust owns                                 | TypeScript owns                    |
| ------------------- | ----------------------------------------- | ---------------------------------- |
| Space / PTY grid    | PTY spawn, resize, parser, snapshots      | xterm view, chrome, wizard UX      |
| Swarm               | Orchestration, seats, phases, persistence | Graph, inspector, chat/activity UI |
| Board               | Persistence (SQLite), task contract       | Kanban UI, drag and drop           |
| Memory              | Obsidian retrieval, embeddings, citations | Source viewer, question UX         |
| Providers/Chat      | Gateway, credentials, policy, receipts    | Settings forms, chat UI            |
| Editor/Git sidebars | File I/O + git subprocess                 | Tree/tabs/commit UX                |

## 5. Risks

| Risk                                           | Mitigation                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Two-language surface drift                     | Corpus is the oracle; CI gates both stacks on every push         |
| Embedding the engine into Electron is new glue | Phase A is exactly that glue, kept behind the existing IPC shape |
| Windows/Linux parity                           | Phase D CI matrix; engine is already portable-first              |
| Scope creep into "rewrite everything anyway"   | ADR 0005 is closed; renderer rewrite work is out of scope        |

## 6. First three concrete steps

1. Land the hybrid docs (this change).
2. Start Phase A in a worktree: engine-embedding boundary + corpus replay.
3. Add the CI platform matrix when Phase D opens.
