# UI / UX Blueprint

## Design objective

Zero should feel like a **command center**, not a collection of mini apps. Every surface should share the same context, command palette, agent state, and source system.

## Global shell

### Left navigation

1. Today
2. Chat
3. Projects
4. Code
5. Research
6. Knowledge
7. Health
8. Content
9. Automations
10. Activity
11. Settings

### Global top bar

- universal command/search field;
- active scope chip (project/repository/person/topic);
- model/agent status;
- local/cloud privacy indicator;
- notifications/approvals.

### Persistent assistant affordance

A small voice/action button opens a compact command overlay without forcing the user to leave the current workspace.

## Today dashboard

The Today screen answers: **What deserves attention now?**

Suggested sections:

### Focus

- top 3 priorities;
- next calendar commitment;
- currently active project;
- continue-last-session shortcut.

### Projects pulse

For each active project:

- status;
- priority;
- next task;
- recent commit;
- blocker;
- last worked timestamp.

### Work activity

- recent Git commits;
- completed tasks;
- changed notes/decisions;
- agent results awaiting review.

### Health snapshot

Only user-approved metrics, displayed as trends rather than judgments.

### Resurface

Useful old notes/decisions that connect to current work.

## Chat

### Thread header

- thread title;
- active agent;
- model selector;
- privacy mode;
- context scope;
- cost.

### Composer

- text;
- voice;
- attach file/source;
- `@project`, `@note`, `@repo`, `@agent` references;
- tool mode indicator.

### Message anatomy

Assistant responses can include:

- answer;
- source citations;
- tool/action cards;
- approval cards;
- generated artifacts;
- model used;
- trace toggle.

Do not expose raw hidden reasoning. Show concise plans, sources, tool events, and verification instead.

## Projects

### Project overview

- goal/description;
- status and priority;
- current milestone;
- tasks;
- blockers;
- decisions;
- repository activity;
- linked knowledge;
- research;
- recent sessions.

### Project timeline

Unified chronological events from tasks, Git, decisions, agent sessions, and notes.

## Code

Codex-style workspace described in `09_CODING_WORKSPACE.md`.

## Research

### Research brief view

- question;
- status;
- source list;
- claims/evidence table;
- contradictions;
- findings;
- recommendation;
- unresolved questions.

### Research inbox

Research jobs can run as bounded tasks and return for review.

## Knowledge

Three views:

1. Search/results
2. Entity page
3. Graph explorer

Entity pages should be more useful than the graph itself. Example Project entity page shows related decisions, people, notes, commits, and tasks.

## Health

- daily summary;
- 7/30/90-day trends;
- metric picker;
- data source and last sync;
- privacy settings.

Avoid competitive scores or appearance/body-comparison framing. Focus on neutral trends and user-selected goals.

## Content

### Idea inbox

Capture hooks, lessons, builds, research, and work-log ideas.

### Draft studio

Tabs/variants for:

- X;
- Bluesky;
- Mastodon;
- Instagram concept/caption;
- short-form video;
- YouTube video;
- livestream.

### Voice profile

A versioned profile of preferred tone, vocabulary, formats, topics, and examples. It is user-editable and shared by platform agents.

## Automations

Visual workflow list:

- name;
- trigger;
- actions;
- permission level;
- last run;
- next run;
- success/failure status.

Opening an automation shows a readable “when → if → do” view before technical JSON/YAML.

## Activity / Audit

Timeline filters:

- agent;
- project;
- integration;
- risk;
- model;
- action type.

Every action can open a receipt.

## Settings

### Models & providers

- API key connections;
- endpoint;
- discovered models;
- capabilities;
- default policies;
- budget;
- privacy allowance.

### Integrations

- vault;
- GitHub;
- Health companion;
- calendar;
- browser/MCP.

### Permissions

Per-tool and per-agent settings.

### Privacy

- local-only mode;
- sensitive-data routing;
- log retention;
- export/delete.

## Command palette examples

- `Open Project: ZenPense`
- `Ask Researcher...`
- `Create Task...`
- `Run Daily Briefing`
- `Open recent coding session`
- `Switch to local-only mode`
- `Search all memory...`
