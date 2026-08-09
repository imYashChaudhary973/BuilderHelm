# Execution Roadmap

## Strategy

Do not build every dashboard and agent at once. Build the **platform spine** first, then one complete vertical slice at a time.

## Phase 0 — repository and architecture guardrails

Deliverables:

- monorepo;
- architecture decision records;
- coding standards;
- package boundaries;
- typed error system;
- config system;
- test framework;
- CI;
- docs folder containing this blueprint.

Exit criteria: clean desktop shell boots and core package tests run.

## Phase 1 — Desktop shell + database + secure settings

Build:

- Electron secure process boundary;
- React shell/navigation;
- SQLite migrations;
- Keychain secret service;
- settings;
- provider connection UI skeleton;
- audit event infrastructure.

Exit criteria: user can add provider credentials securely without invoking a model.

## Phase 2 — Model Gateway + provider-agnostic Chat

Build:

- normalized message model;
- provider registry;
- OpenAI native adapter;
- Anthropic native adapter;
- generic OpenAI-compatible adapter;
- Ollama adapter;
- streaming;
- model discovery/manual add;
- model switch per turn;
- cost/usage records;
- privacy/provider policy.

Exit criteria: one thread can use multiple providers/models and persists correctly.

## Phase 3 — Obsidian Memory vertical slice

Build:

- vault selector;
- Markdown watcher/parser;
- FTS index;
- embedding interface;
- source viewer;
- hybrid retrieval;
- citations;
- basic entities/links.

Exit criteria: cited personal knowledge questions work reliably against a test vault.

## Phase 4 — Tools, permissions, action chat

Build:

- tool registry;
- permission engine;
- approval UI;
- action receipts;
- task/project domain;
- task tools;
- project tools.

Exit criteria: text/voice-parsed commands can safely create/update local tasks.

## Phase 5 — Project dashboard + Git

Build:

- projects;
- repository registration;
- local Git activity ingestion;
- project timeline;
- decisions/blockers;
- Today dashboard initial version.

Exit criteria: the Today page can summarize active work from actual project data.

## Phase 6 — Coding workspace

Build:

- Monaco;
- xterm + PTY;
- file tree;
- Git diff;
- structured patch tool;
- command policy;
- coding agent;
- test runner;
- checkpoint/rollback;
- worktree support later in phase.

Exit criteria: fixture bug can be fixed end-to-end with passing tests and inspectable diff.

## Phase 7 — Research system

Build:

- research jobs;
- source store;
- claim/evidence table;
- browser/search tools;
- Researcher + Verifier agents;
- cited research brief;
- promote to decision/Obsidian.

Exit criteria: a research question produces an auditable, source-backed brief.

## Phase 8 — Automation engine

Build:

- scheduler;
- triggers;
- workflow steps;
- retries/idempotency;
- automation builder;
- local notifications.

Exit criteria: daily brief and vault-maintenance workflows run reliably.

## Phase 9 — Voice

Build:

- push-to-talk;
- STT provider abstraction;
- deterministic intent parser;
- TTS;
- approval voice/UI flow.

Exit criteria: create task, search knowledge, open project, and query commits by voice.

## Phase 10 — Health companion

Build:

- iOS SwiftUI companion;
- HealthKit permissions;
- daily aggregate sync;
- encrypted transport;
- Health dashboard;
- local-only privacy mode.

Exit criteria: selected metrics sync and render with correct provenance/source.

## Phase 11 — Content/founder agents

Build:

- voice profile;
- idea inbox;
- Content Strategist;
- platform writer agents;
- livestream/video ideation;
- draft review flow.

Exit criteria: one work log can become differentiated drafts without publishing automatically.

## Phase 12 — Advanced graph + automation + product hardening

- richer entity graph;
- memory conflict resolution;
- parallel coding agents/worktrees;
- MCP marketplace/management;
- optional remote access/sync;
- signed releases and auto-update;
- accessibility;
- disaster recovery;
- performance tuning.

## What NOT to build first

- fancy 3D graph;
- autonomous social posting;
- dozens of integrations;
- custom vector database server;
- distributed agent swarm;
- wake word;
- full raw health history sync;
- cloud multi-user architecture.

The fastest path to a great OS is to prove three loops first:

1. **ask → retrieve → cited answer**
2. **ask → tool → safe action → receipt**
3. **ask → code → patch → test → diff**
