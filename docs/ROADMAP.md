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
- Board: named project boards, isolated tasks, left-rail tabs, and persisted drag and drop.
- Memory: private Obsidian retrieval, cited answers, source previews, and recent questions.

## Next — Swarm

First loop on `feat/swarm`: one job, four roles (coordinator, builder, scout,
reviewer) on a 4-pane Space grid, 20-minute budget, 90s silence = stuck.
Worktree isolation and richer coordinator policy come after this loop works.

## Future directions — delegate and build

These are directional capabilities to evaluate after Swarm. BuilderHelm should
adapt the interaction patterns to its local-first security model rather than
clone the referenced product.

### Agent, Code, and Chat in one window

- Add a title-bar mode switch that changes the rail, workspace, and composer
  while preserving each mode's state.
- Give named agents their own chat history, working status, skills, settings,
  tool-call trace, and approval queue.
- Keep model, reasoning, permission, build, token-usage, and voice controls
  consistent across modes.

### Dockable ADE workspace

- Expand BuilderHelm Space into a workspace tree of local projects, agent CLIs,
  shells, localhost previews, and task threads.
- Dock terminals, browser previews, and agent threads beside the work, with a
  one-click tidy layout.
- Continue launching Claude Code, Codex, and other compatible CLIs from the
  user's PATH over local folders.

### Scheduled agent routines

- Run named agents on explicit schedules for recurring research, summaries,
  maintenance, and outreach preparation.
- Include enable/disable controls, recurrence, run history, failure status,
  budgets, permissions, and approval gates before external side effects.

### Voice inside BuilderHelm

- Add hold-to-talk dictation, such as Fn-to-record, directly to the real
  composer with a visible recording state and explicit send.
- Keep wake-word listening out of scope; voice starts only from deliberate user
  input.

### Secure plugin catalog

- Add permission-scoped integrations for social publishing, lead enrichment,
  video analytics, image generation, and future services.
- Store credentials in Keychain, keep secrets out of engine prompts, preview
  requested access, and expose connection and audit status.

## Later — platform

Platform work starts after Swarm and only when it supports a proven product
loop:

- Settings shell beyond providers
- Mobile companion + QR LAN pair
- Usage credits, budgets, and billing controls
- Auto-update + About

## Explicitly not on this roadmap

- HealthKit / iOS health dashboard
- Content studio / social drafts
- Wake word
- Cloud multi-user “life OS”
- Fancy 3D knowledge graph as a v1 goal
- Rewriting the app in Rust ([STACK](STACK.md))
