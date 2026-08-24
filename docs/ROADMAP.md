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
- Chrome: top bar, left rail, Browser / Editor / Git sidebars.
- Git write: stage, unstage, commit.
- Board: To Do / In Progress / Complete kanban with persisted drag and drop.
- Memory: private Obsidian retrieval, cited answers, source previews, and recent questions.

## Next — Swarm

Multi-agent runs with roles, budgets, and stuck-agent policy. Reuse Space
panes as the execution surface.

## Later — platform

Only after Space + Board + Memory work:

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
