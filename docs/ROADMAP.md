# Roadmap

No feature freeze. New work lands on the hybrid stack: Rust engine +
TypeScript platform ([STACK](STACK.md), [ADOPTION](ADOPTION.md)).

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

## Shipped on feat/swarm-v2 (not “next”)

Mission / Roster / Launch, helm presets, live graph, mid-flight add/remove,
Plan / Activity tabs, worktree per builder, verify + review + land queue,
20-minute budget. Mix with BridgeMind + Conductor: [ADE](ADE.md).

Still open on Swarm itself: context-file UI (only `@path` in the mission),
Agent-tab tool transcript, Claude-only structured plan/review (no `grok -p`).

## Next — P0 then Agent / Code / Chat

Do not start routines, voice, or plugins until P0 is green.

### P0 Swarm usable

- Claude-only JSON plan/review. Banner: Grok Build CLI ≠ Super Grok chat.
- Agent inspector shows active task + PTY tail.
- Stop and terminals stay attached (`boardSessionId` on create).

### P1 Title-bar Agent | Code | Chat

- Agent: named teammate + tool-call transcript ([docs](https://docs.bridgemind.ai/docs/agent-mode)).
- Code: folder + PTY grid + Claude/Codex thread pane ([docs](https://docs.bridgemind.ai/docs/code-mode)).
- Chat: unmounted threads — put `/chat` in chrome.

### P2 Conductor review

- Diff + comment-to-seat + Checks before land-to-main
  ([parallel agents](https://www.conductor.build/docs/concepts/parallel-agents)).
- Worktree setup/run + port map.

### P3 Local MCP board

- `claim` / `in-review` / human `complete` over `swarm_*`. Not a PTY host.
  Not `api.conductor.build`.

### Later (unchanged intent)

- Scheduled routines, hold-to-talk voice, Keychain plugin catalog.
- Settings shell, usage HUD, auto-update, mobile companion.

## Hybrid architecture adoption

Accepted 2026-08-27. Rust core engine (engine, settings, agent workflows,
performance-critical operations) + TypeScript platform (development
environment, UI, cross-platform capability). Decision:
[ADR 0006](adr/0006-hybrid-architecture.md). Plan of record:
[ADOPTION](ADOPTION.md). Phase A (engine embedding) starts after the current
`feat/swarm-v2` work lands.

## Explicitly not on this roadmap

- HealthKit / iOS health dashboard
- Content studio / social drafts
- Wake word
- Cloud multi-user “life OS”
- Fancy 3D knowledge graph as a v1 goal
- Microsoft Conductor YAML as a second orchestrator
- Conductor Cloud / BridgeMind Cloud as a dependency
