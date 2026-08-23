# Roadmap

Build the four-mode harness, one complete loop at a time. Do not revive the
old Zero OS 12-phase personal-OS plan (health companion, content studio,
life automations).

Code that already exists is reused, not rebuilt: Electron shell, Keychain
providers, model gateway, chat, Obsidian retrieval, permissioned tools,
Git snapshots, PTY grid, app chrome.

## Shipped

- Space: home, folder/layout wizard, Open without AI, per-pane agents,
  usable xterm grid, stacked Spaces.
- Chrome: top bar modes and left rail.

## Next — right sidebar

Exit: a usable browser in the right rail (localhost + URL). Editor and
Git after that. Do not fake empty panels.

## Then — Board and Memory

- **Board:** Kanban. Ideas → tasks → shipped. New route, not a rename of
  the terminal grid.
- **Memory:** promote today's Obsidian retrieval into the Memory mode.

## Then — Swarm

Multi-agent runs with roles, budgets, and stuck-agent policy. Reuse Space
panes as the execution surface.

## Later — platform

Only after Space + chrome + one right-rail panel work:

- Settings shell beyond providers
- Mobile companion + QR LAN pair
- Voice assistant (credits)
- Auto-update + About

## Explicitly not on this roadmap

- HealthKit / iOS health dashboard
- Content studio / social drafts
- Wake word
- Cloud multi-user “life OS”
- Fancy 3D knowledge graph as a v1 goal
- Rewriting the app in Rust ([STACK](STACK.md))
