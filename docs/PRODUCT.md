# BuilderHelm

Your agents. You at the helm.

BuilderHelm is a local-first desktop harness for building software. The
point is that you do not leave the app: terminals, agents, tasks, memory,
browser, editor, Git, and skills stay in one shell.

The npm workspace is still `zero-os`. That is a repository name, not the
product name.

## Choose how you want to work

The first screen is four modes. Each card shows a keyboard shortcut on the
right.

| Mode       | Shortcut | Promise                                                                                                       |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| **Space**  | ⌘T       | The terminal built for vibe coding. Split panes, command blocks, and an agent in every shell.                 |
| **Swarm**  | ⌘S       | Many agents, one job. Coordinators, builders, scouts, and reviewers with budgets and guardrails.              |
| **Board**  | ⌘B       | Plan the work. Work the plan. A Kanban board built for builders — turn loose ideas into shipped tasks.        |
| **Memory** | ⌘M       | A living knowledge graph. Persistent memory your agents read and write as they build. Context that compounds. |

**Bridge** is not a fifth home card. It is the assistant overlay (and later
the voice assistant) that can be toggled from any mode.

The terminal grid under `/board` is **Space**, not Kanban Board. Kanban
Board is a different surface and is not built yet.

## Swarm

One job, a named roster, then a live map of the seats.

### Setup

1. **Mission** — working folder, recents, brief shared with every seat.
2. **Roster** — pick a size, Safe or Skip permissions, add or remove seats,
   choose a CLI per seat, toggle Auto, pick skills.
3. **Launch** — name the run and start.

### Size presets

| Preset       | Seats | Mix                                              |
| ------------ | ----- | ------------------------------------------------ |
| **Skiff**    | 3     | 1 coordinator, 1 builder, 1 scout                |
| **Cutter**   | 5     | 1 coordinator, 2 builders, 1 scout, 1 reviewer   |
| **Frigate**  | 8     | 1 coordinator, 5 builders, 1 scout, 1 reviewer   |
| **Flagship** | 12    | 1 coordinator, 7 builders, 2 scouts, 2 reviewers |

Seats stay editable after a preset. Cap is 12. Every detected agent CLI on
the Mac is eligible.

### Live

A graph of the roster (coordinator as hub), a roster rail, an `@all` /
`@seat` command bar, and a toggle back to the terminal grid. 20-minute
budget. Silent seats get a nudge, then stop.

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
- Not a personal-life OS (HealthKit, content studio, scheduled life
  automations, clinical claims).
- Not a social auto-poster or unrestricted computer-use agent.

## Name and branding

- Public name: **BuilderHelm**
- Tagline: **Your agents. You at the helm.**
- Symbol: helm mark from the approved asset pack. Do not stretch, crop,
  outline, or add glow.
