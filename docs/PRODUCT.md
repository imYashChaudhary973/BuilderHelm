# Exeum

Working name. Final name, logo, and tagline are TBD. Do not invent a
tagline in the product. Leave the slot empty until copy is chosen.

Exeum is a local-first desktop harness for building software. The point is
that you do not leave the app: terminals, agents, tasks, memory, browser,
editor, Git, and skills stay in one shell.

The code package is still `zero-os`. That is a repository name, not the
product name.

## Choose how you want to work

The first screen is four modes. Each card shows a keyboard shortcut on the
right.

| Mode | Shortcut | Promise |
| ---- | -------- | ------- |
| **Space** | ⌘T | The terminal built for vibe coding. Split panes, command blocks, and an agent in every shell. |
| **Swarm** | ⌘S | Many agents, one job. Coordinators, builders, scouts, and reviewers with budgets and guardrails. |
| **Board** | ⌘B | Plan the work. Work the plan. A Kanban board built for builders — turn loose ideas into shipped tasks. |
| **Memory** | ⌘M | A living knowledge graph. Persistent memory your agents read and write as they build. Context that compounds. |

**Bridge** is not a fifth home card. It is the assistant overlay (and later
the voice assistant) that can be toggled from any mode.

The terminal grid under `/board` is **Space**, not Kanban Board. Kanban
Board is a different surface and is not built yet.

## Principles

1. **The app owns the workspace.** Agents are guests in panes. Folder,
   layout, Git, and memory stay here if a model disappears tomorrow.
2. **Local first.** The Mac is the source of truth. LAN or cloud is opt-in.
3. **An agent is optional.** “Open without AI” is a first-class path.
4. **Human-controlled actions.** High-impact tools still need approval and
   a receipt. A terminal is not a blank check for the rest of the system.
5. **One shell.** Browser, editor, Git, and skills live in the sidebar, not
   in other apps.

## What this is not

- Not a replacement for macOS.
- Not the old Zero OS personal-life OS (HealthKit, content studio,
  scheduled life automations, clinical claims).
- Not a social auto-poster or unrestricted computer-use agent.

## Surfaces

```text
Home (4 modes)
  ├─ Space     → folder + layout → optional agents → live terminals
  ├─ Swarm     → multi-agent run
  ├─ Board     → Kanban
  └─ Memory    → knowledge graph

Chrome (every mode)
  ├─ Top bar   → Space / Swarm / Board / Memory / Skills / Settings
  ├─ Left rail → stacked workspaces
  └─ Right rail → browser, editor, Git, skills

Overlay
  └─ Bridge assistant / Swarm builder / notifications / updates
```

## Name and branding

- Public name, wordmark, and tagline land later. Logo will be supplied.
- Until then, docs and UI use **Exeum**.
- Do not block product work on naming.
