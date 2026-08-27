# Agent · Code · Chat · Swarm

How BuilderHelm mixes [BridgeMind One](https://bridgemind.ai) (modes + transcript + Swarm preset) with [Conductor](https://www.conductor.build/docs/concepts/parallel-agents) (worktrees + human review). Local-first. Engines stay on PATH.

Last reviewed: 2026-08-26.

## Mix in one sentence

**Queen runs the swarm. Human is the helm. Each builder gets a Conductor worktree. Each seat is a BridgeMind thread (what it did) plus a terminal (the TUI). MCP is the shared board, not the PTY host.**

## Modes

Title-bar switch. Same app. Different rail + pane + composer.

| Mode       | Organizes around                               | You see                                                        | Process                                                     | Today                                                       |
| ---------- | ---------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| **Agent**  | Named teammate (brief, memory, skills, places) | Chat transcript: thoughts, tool calls, token meter, stop turn  | Claude Code / Codex thread adapter; other CLIs as terminals | Inspector **Agent** tab is cost/status only. No tool log.   |
| **Code**   | Project folder                                 | Live terminals, optional thread pane, files, localhost browser | PATH CLIs in PTYs. Swarm preset = several role sessions     | Space grid + Swarm **Terminals** toggle. No thread adapter. |
| **Chat**   | Nothing mounted                                | Threads with no repo                                           | Model gateway + Keychain providers                          | `/chat` exists, **not in chrome**.                          |
| **Board**  | Project Kanban                                 | Cards, stages, drag-and-drop                                   | SQLite, not agents                                          | Shipped.                                                    |
| **Swarm**  | One mission + folder + roster                  | Graph, queen hub, Plan / Activity / Roster, `@all`             | `SwarmService.pump` + per-seat PTY                          | Shipped on `feat/swarm-v2`.                                 |
| **Memory** | Obsidian vault                                 | Cited answers                                                  | Local index                                                 | Shipped.                                                    |

Sources: [Agent Mode](https://docs.bridgemind.ai/docs/agent-mode), [Code Mode](https://docs.bridgemind.ai/docs/code-mode) (Solo / Pair / Workbench / **Swarm** presets), [bridgemind.ai](https://bridgemind.ai) (“engines, not identity”).

**Board is Kanban, not a third title-bar mode.** Do not rename it to “Code”. Code is Space + Swarm terminals.

## Swarm loop (queen)

Human writes mission + folder + roster (queen, scout, builders, reviewer). Then:

1. Open a board session (real PTYs). Return `boardSessionId` on create.
2. Warm worktrees (`exeum/<seat>` under `<repo>-worktrees/`).
3. Queen/planner splits the mission into a DAG with **exclusive file owners**. Prefer Claude Code `-p --json-schema` (Max/Pro login). Never Grok Build `-p` for plan.
4. Scout maps the repo (read-only) → context pack for builders.
5. Pump: idle builder takes the next unblocked task. One task per seat.
6. Builder works in its worktree. Interactive TUI when the CLI has a Super-Grok / Max login path; wait for `SWARM_TASK_DONE` or process exit.
7. Verify gate (deterministic). Reviewer gate (read-only on the same branch).
8. Sequential land into the mission folder (`git merge --no-ff`). Human still owns main/PR.
9. Stop kills every pane and aborts plan/pump. Status `stopped` is not overwritten by a late fail.

Queen assigns. Pump is deterministic (Microsoft Conductor idea, already in TypeScript). Human stops, lands to main, and reads the transcript.

Cap 12. Presets: Skiff 3 · Cutter 5 · Frigate 8 · Flagship 12.

## Isolation (Conductor grain)

From [Parallel agents](https://www.conductor.build/docs/concepts/parallel-agents):

| Work                                        | Isolation                                    |
| ------------------------------------------- | -------------------------------------------- |
| Two features that can ship separately       | **Workspace per unit** (own branch + tree)   |
| Implement + review + test-fix on one change | **One workspace**, reviewer read-only        |
| Swarm builders on one mission               | **Worktree per builder seat** (what we have) |

Copy later: `.worktreeinclude`, setup/run scripts, port map. Do not copy Conductor Cloud, city-named folders, or auto GitHub merge.

Human review surface to add: live diff + comment back to the seat + Checks, **before** anything touches `main`. Local land inside `exeum/*` can stay automatic after verify+review.

## See what the agent is doing

BridgeMind splits this on purpose:

- **Thread** (Claude Code / Codex): conversation + tool calls. This is Agent mode / Code thread pane.
- **Terminal**: raw TUI. This is Code mode.

We only had the terminal, and create used to return `boardSessionId: null`, so even that was blank.

Plan:

1. Keep the xterm grid (Code).
2. Add a **Thread** view per seat: stream PTY → parse tool-ish lines into ledger kinds `tool_call` / `tool_result` (or a side channel when the CLI has `--output-format stream-json`).
3. Agent inspector shows the **active task + last tools + elapsed**, not just tokens.
4. Chat tab becomes `@seat` / `@all` plus the thread, not a filtered event dump.

## Billing (why Super Grok 54% still 402s)

Observed on this machine: `grok --help` titles the binary **Grok Build TUI**. `grok -p` returned `402 Payment Required: Grok Build usage balance exhausted` while grok.com Super Grok showed ~50% left.

| Path                        | Binary flags                                   | Pool                                                            |
| --------------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| Super Grok **website**      | —                                              | Chat quota. Unused by our swarm.                                |
| Grok **planner / reviewer** | `grok -p --json-schema` in `cli-structured.ts` | **Grok Build**. This is the 402.                                |
| Grok **seat**               | `grok --permission-mode … <prompt>` (no `-p`)  | Still the Grok Build CLI. May share Build, not Super Grok chat. |
| Claude plan / seats         | `claude -p`                                    | Claude Max/Pro. Correct.                                        |
| Codex seats                 | `codex exec`                                   | ChatGPT/Codex. Correct.                                         |
| Settings → Providers        | HTTP APIs                                      | Keychain keys / OpenRouter. Chat mode only.                     |

Fix remaining 402:

1. Never call grok `-p` (planner + reviewer). Claude only for structured JSON. If no Claude, one-task fallback (already).
2. UI copy: “Grok seats use **Grok Build CLI**, not Super Grok chat.”
3. Do not invent OpenRouter swarm seats in this slice.

## MCP control plane

[BridgeMind MCP](https://docs.bridgemind.ai/docs/mcp) and our builtin skill: **shared board**, not a swarm engine.

```
todo → in-progress → in-review → complete
```

Claim before work. Humans mark complete. `taskKnowledge` compounds. Handoff / delegate are first-class.

BuilderHelm mapping:

| MCP          | Ours                      |
| ------------ | ------------------------- |
| Project      | Swarm run + Board project |
| Task         | `swarm_tasks` row         |
| Agent        | Seat (role + CLI)         |
| Knowledge    | Memory / `taskKnowledge`  |
| `claim_task` | Pump assigning a seat     |
| `in-review`  | Reviewer gate             |
| `complete`   | Human / land              |

Ship a **local** MCP server over the existing SQLite ledger so Cursor / Claude Code / us see the same queue. Do not call `api.conductor.build`. Do not make MCP spawn PTYs.

## Phased delivery

### P0 — Swarm actually usable (current branch)

- Claude-only structured plan/review. No grok `-p`.
- Create returns attached session; terminals + Stop work.
- Grok seats interactive; banner names Grok Build vs Super Grok.
- Agent tab: active task title + last PTY tail (not just $).

### P1 — See the work (Agent + Code)

- Title-bar **Agent | Code | Chat** next to Space / Swarm / Board / Memory (modes nest: Swarm live is Code+Agent for that run).
- Thread adapter for Claude/Codex seats. Terminal stays for Grok and others.
- Chat route in chrome (unmounted threads = Chat mode).

### P2 — Conductor review

- Diff pane + comment-to-seat before land-to-main.
- Setup/run + port isolation for worktrees.

### P3 — Local MCP

- `list_tasks` / `claim_task` / `update_task` / `handoff_task` over `swarm_*` tables.
- Optional later: speak BridgeMind’s cloud MCP as a client.

## Steal / skip

**Steal:** engines ≠ identity; thread + terminal; Swarm preset lineup before spend; worktree per shippable unit; human Checks before main; MCP as board.

**Skip:** BridgeMind Cloud, Conductor Cloud, Microsoft YAML as a second orchestrator, CrewAI/LangGraph, auto-merge GitHub, bundled CLIs, routines/plugins until Swarm P0 is boringly green.

## Out of scope until P0 is green

Routines, voice, plugin catalog, OpenRouter-as-seat, more Grok model IDs, Bridge overlay.
