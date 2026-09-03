# No Sleep — implementation plan

Status: PLAN — awaiting approval. Branch `feat/no-sleep` at `3b75a8b`.

## Feature

A control on the bottom bar's right edge with three modes:

| Mode      | Behaviour                                 |
| --------- | ----------------------------------------- |
| **On**    | Keep this computer awake continuously     |
| **Agent** | Stay awake only while an agent is working |
| **Off**   | Allow normal system sleep behaviour       |

The mode persists across restarts; the blocker itself is reapplied at launch.

## Mechanism (macOS, no new dependencies)

`powerSaveBlocker.start('prevent-app-suspension')` in the main process —
Electron 43.4.1, `node_modules/electron/electron.d.ts:11140`. This is the exact
equivalent of bare `caffeinate`: it blocks **idle system sleep** while still
allowing the display to sleep.

Bounds (same as `caffeinate` with no flags), stated up front:

- Closing the lid still sleeps the machine — not blockable in software.
- A user-initiated sleep ( Apple menu → Sleep ) still sleeps.
- The display still sleeps on its timer. If you want the screen held awake
  too, that is a one-line change to `'prevent-display-sleep'` — say so and it
  becomes part of **On** (Agent stays system-only).

## Agent mode — what counts as "working"

Research found **no existing source of truth** for "an agent is working", and
the two durable signals both over-report in ways that would keep the Mac awake
forever:

- Interactive panes run `zsh -i` that never exits (`board-pty-manager.ts:179`),
  so pane liveness pins the Mac awake forever.
- A swarm run stays `status: 'running'` while parked in **review** awaiting a
  human click (`swarm-service.ts:481`) — an overnight false positive.

So Agent mode counts **actual execution windows** only, via a small
`ActivityMonitor` (counter + change callback) owned in `main/index.ts` beside
`boardPty`:

| Work                               | Increment                          | Decrement                   |
| ---------------------------------- | ---------------------------------- | --------------------------- |
| Swarm orchestration loop           | `SwarmService.pump` guard (`:458`) | existing `finally` (`:541`) |
| Planner CLI (`planTasks`, `:777`)  | wrap body                          | wrap body                   |
| Seat warm-up (`warmSeats`, `:195`) | wrap body                          | wrap body                   |
| Chat model streaming               | `activeStreams.set` (`ipc.ts:762`) | existing `finally` (`:777`) |

The pump window transitively covers seat CLI runs, the `pnpm` verify gate (up
to 10 min), and the reviewer, because all are awaited inside it.

**Explicitly not counted in v1:** idle interactive terminals, runs parked in
review, and the quota-ingest listener. If you want agents typed into ordinary
terminal panes to count too, that needs a pane-activity heuristic (the
`emitted` char counter has no timestamps) — a follow-up, not v1.

`ActivityMonitor.onChange` follows the existing `onAccountsChanged` callback
seam (`ipc.ts:342`, wired at `index.ts:339`).

## Architecture (follows the accounts/browser-setting pattern exactly)

```
renderer (bar control) → preload (invoke+unwrap) → main handlers
    → NoSleepService (core: mode persistence)      → settings table
    → PowerController (main: powerSaveBlocker)      → ActivityMonitor edges
```

- **`packages/protocol/src/no-sleep.ts`** (new) — `NO_SLEEP_MODES = ['on','agent','off'] as const`, `noSleepModeSchema` (`z.enum`), state schema `{ mode, blockerActive, agentActive }`, request/response wrappers with the file-local `ipcResult` helper, all `.strict()`. Add the `./no-sleep` subpath to `packages/protocol/package.json` and the barrel export.
- **`packages/protocol/src/ipc.ts`** — channels `noSleepRead: 'builderhelm:no-sleep:read'`, `noSleepSet: 'builderhelm:no-sleep:set'` (`builderhelm:` prefix is enforced by `check-architecture.mjs:53`); `readonly noSleep: { read(): Promise<NoSleepState>; set(input): Promise<NoSleepState> }` on `BuilderHelmDesktopApi`.
- **`packages/core/src/no-sleep/no-sleep-service.ts`** (new) — `NoSleepService` modelled on `browser-settings-service.ts`: key `noSleep.mode`, read = JSON.parse in try/catch → `safeParse` → default `'off'`; `set(mode)` persists `JSON.stringify(mode)` (the settings table's `json_valid` CHECK forbids bare strings) and returns the resulting state. Holds **no Electron imports** — it computes desired state; the main process owns the OS call.
- **`packages/core/src/swarm/swarm-service.ts`** — `activeWorkCount()` + `onWorkChanged(listener)` following the `onRunEvent` pattern (`:182`), edges added around pump/planTasks/warmSeats.
- **`apps/desktop/src/main/no-sleep.ts`** (new) — `PowerController`: holds the blocker id; listens to mode changes and activity changes; `start('prevent-app-suspension')` / `stop(id)` so exactly one blocker exists at a time; `dispose()` for `before-quit` (`index.ts:366-380` — `core.close()` has no disposer hook, so teardown lives here deliberately).
- **`apps/desktop/src/main/ipc.ts`** — read handler (template `:1707-1720`) and set handler (template `:2485-2500`, fires the activity recompute), `removeHandler` pairs in the disposer. `ActivityMonitor` edges for chat wrap `activeStreams` set/delete.
- **`apps/desktop/src/preload/index.ts`** — `noSleep` block copying the `toggleHook` template (`:1265-1271`): correlationId, input `.parse`, response `.parse`, `unwrap`.
- **`apps/desktop/src/renderer/src/components/no-sleep.tsx`** (new) — right-edge control after `.usageBarRefresh` (`flex: 1` on `.usageBarMain` already pushes it right; no new CSS trick). Cup glyph + mode label + filled dot when the blocker is actually held. Click opens a small menu anchored like `.usagePopover` (outside-click dismissal and the hover-timer pattern are local to `usage-bar.tsx` and get copied, not shared — extraction would be a refactor this feature does not need). Menu rows: On / Agent / Off with title + one-line description and a radio dot, per your mock.
- **`apps/desktop/src/renderer/src/styles.css`** — `.noSleepChip`, `.noSleepMenu`, row styles; nothing touches `.usageBar` itself.
- **Tests** — `packages/core/test/no-sleep-service.test.ts`: default mode, persistence round-trip, corrupt-JSON fallback, invalid mode fallback; `swarm-service` activity edges (pump begin/end, review-parked does NOT count). Optional IPC boundary test per `provider-ipc.test.ts` if you want the channel contract pinned.

Persistence: **no migration** — the `settings` table is an untyped JSON key/value store (`0002-provider-settings.ts:54-58`); a new key needs no schema work.

## Sequence

1. Protocol module + channels + API type (types compile everywhere at once)
2. Core: `NoSleepService` + swarm activity edges + tests
3. Main: `PowerController` + `ActivityMonitor` + handlers + `before-quit` teardown
4. Preload bridge
5. Renderer: bar control + menu + CSS
6. `pnpm verify` + `smoke:desktop` + live check in the running app (toggle each mode, confirm `powerSaveBlocker.isStarted`, confirm Agent mode releases after a run finishes)

## Deliberately out of scope (v1)

- Holding the display awake (one-line change if wanted — see above)
- Counting agents in ordinary interactive terminal panes
- Battery-aware behaviour (`powerMonitor.onBatteryPower` exists if wanted later)
- Any Windows/Linux equivalent (`powerSaveBlocker` is cross-platform already; only the naming/verification is macOS here)
