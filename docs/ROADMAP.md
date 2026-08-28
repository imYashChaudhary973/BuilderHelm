# Roadmap

BuilderHelm is delivered as complete vertical loops. A later phase does not
start by creating empty implementation scaffolding; it starts when its entry
conditions are met.

## P0 — TypeScript architecture reset

- Remove the previous native-engine migration and duplicate runtime.
- Establish Node.js 24, supported Electron, React, Vite, xterm.js, and node-pty.
- Replace conflicting documents and add an architecture guard.
- Keep the existing desktop product behavior compiling and tested.

## P1 — Reliable local agent workspaces

- Harden terminal stream batching, backpressure, reconnect, and cleanup.
- Make worktree creation transactional and recover orphaned runs.
- Normalize installed CLI detection and capability metadata.
- Verify 1, 2, 4, 8, and 12 panes on macOS.

## P2 — Review and ship loop

- Unified diff and file review.
- Test and check results with exact command evidence.
- Feedback routed to the correct run or seat.
- Commit and pull-request drafting from selected changes.
- CI status, conflict detection, and human-controlled landing.

## P3 — Browser verification

- Sandboxed preview panel with port mapping.
- Navigation, click, fill, screenshot, console, and network evidence.
- Select a visible UI element and send sanitized context to an agent.
- Record verification artifacts against the run.

## P4 — Planning, context, and integrations

- GitHub and Linear task intake and status sync.
- Global command/search surface.
- Rich development notes, slash commands, inline logs, and autosave.
- Memory citations connected to runs, decisions, and review.
- Usage, quota, rate-limit, and provider account visibility.

## P5 — Remote control and mobile

- Host identity, QR pairing, revocation, and encrypted sessions.
- Local-network and private-network connection modes first.
- Optional relay only after direct remote value is proven.
- React Native iOS and Android clients for observe, instruct, approve, pause, and cancel.
- No provider credentials, raw shell, or unrestricted filesystem API on mobile.

## P6 — Desktop platform expansion

- Windows PTY, paths, credential storage, packaging, and smoke tests.
- Linux PTY, Secret Service, Wayland/X11 behavior, packaging, and smoke tests.
- Signed release channels and auto-update after platform parity.

## Not now

- Bundling a proprietary model.
- A second product runtime or UI framework.
- Containers or VMs as the default local mode.
- Unrestricted computer control from mobile.
- Automatic merge without review evidence.
