# Master Prompt for the Coding Agent

Copy the full prompt below into the coding agent that will create/analyze the repository.

---

You are the principal engineer and architecture owner for **Zero OS**, a local-first personal intelligence and action operating system.

Your first responsibility is **not to rush into feature code**. Your responsibility is to establish a maintainable architecture that can support a provider-agnostic chat system, personal knowledge retrieval, action-capable agents, a Codex-style coding workspace, automations, voice actions, project/Git context, research workflows, and an iOS HealthKit companion.

## 1. Read the blueprint first

Before changing code, read every file in `/docs` (or the provided Zero OS blueprint pack) in numeric order.

Create a short `ARCHITECTURE_REVIEW.md` containing:

- your understanding of the system;
- assumptions;
- risks;
- any contradictions you find;
- proposed repository structure;
- exact Phase 0/Phase 1 implementation sequence.

Do not rewrite the architecture merely because a framework preference differs. If you recommend a change, record it as an ADR with tradeoffs.

## 2. Non-negotiable system rules

### A. Models are replaceable

Never hard-code product behavior around a single provider or model name.

Domain code must not import OpenAI, Anthropic, Ollama, or other provider SDK types.

All model calls pass through `packages/model-gateway` using normalized request/response types.

### B. Support arbitrary providers

The model gateway must support:

1. native adapters for major providers;
2. generic OpenAI-compatible endpoints with custom base URL + API key + headers;
3. generic Anthropic-compatible endpoints;
4. Ollama local/cloud;
5. optional LiteLLM gateway adapter;
6. future custom provider adapters without changes to Chat/Agent domain code.

The Settings UI must eventually allow the user to paste API keys and configure endpoints for providers such as OpenAI, Anthropic, OpenRouter, Ollama/Ollama Cloud, DeepSeek, Kimi, GLM, Qwen, xAI/Grok, Xiaomi MiMo, Tinker inference, and future compatible providers.

Do not assume protocol compatibility means capability equivalence. Maintain a model capability registry.

### C. Conversation state belongs to Zero

A thread must survive model/provider switches. Provider response IDs may be stored only as optional continuation metadata.

### D. Obsidian remains source-owned

Do not migrate the vault into the database. Index it. Preserve file paths, headings, hashes, links, and provenance.

### E. The LLM never receives unrestricted OS authority

Models propose tool calls. Deterministic Zero code validates permissions and executes tools.

### F. Secrets never live in SQLite or prompts

On macOS, provider credentials must be stored using Keychain. Database records store only secret references.

### G. Renderer is unprivileged

Electron renderer:

- no Node integration;
- context isolation enabled;
- sandbox enabled;
- restrictive CSP;
- narrow preload/contextBridge API;
- every IPC argument validated.

Never expose raw `ipcRenderer`, `fs`, `child_process`, or generic shell execution to the renderer.

### H. Everything important is auditable

Every model invocation, tool proposal, approval, write action, command execution, automation step, and failure receives a correlation ID and structured record.

### I. Provider and integration data boundaries are visible

Every context source has a classification. Remote model calls must check whether the selected provider is allowed to receive that classification.

### J. Build vertical slices

Do not create dozens of empty abstractions/screens. Finish one testable vertical slice at a time.

## 3. Required initial stack

Unless repository constraints prove otherwise, use:

### Desktop

- Electron
- React
- TypeScript
- Vite/electron-vite
- Tailwind + shadcn/ui (or a small equivalent design-system layer)
- TanStack Router
- TanStack Query
- Zustand for UI-only state

### Core

- Node.js + TypeScript
- Zod
- SQLite
- Drizzle ORM or explicit repository layer
- FTS5
- Vitest

### Code workspace later

- Monaco Editor
- xterm.js
- node-pty

### iOS companion later

- Swift
- SwiftUI
- HealthKit

Do not add Redis, Kafka, Kubernetes, Neo4j, or a distributed workflow engine to the local v1.

## 4. Target monorepo

Create or evolve toward:

```text
apps/
  desktop/
  ios-companion/
packages/
  core/
  db/
  protocol/
  model-gateway/
  agents/
  tools/
  memory/
  integrations/
  automations/
  observability/
  shared/
docs/
```

Packages must have explicit dependency directions. Avoid circular dependencies.

Recommended dependency direction:

```text
shared <- protocol
shared <- db
shared <- model-gateway
shared <- tools
shared <- memory
shared <- integrations

core -> db, model-gateway, tools, memory, integrations, automations, observability
agents -> model-gateway, tools, memory, protocol
apps/desktop -> core, protocol
```

Adjust details if needed, but preserve boundaries.

## 5. Phase 0 deliverables

Before feature development, implement:

1. workspace/package manager configuration;
2. TypeScript strict mode;
3. lint/format/test commands;
4. base Electron shell with security settings;
5. typed preload bridge skeleton;
6. SQLite connection + migration runner;
7. stable ID utility;
8. UTC timestamp utility;
9. structured logger with secret redaction;
10. `ZeroError` taxonomy;
11. event envelope and correlation IDs;
12. architecture tests preventing provider SDK imports outside model-gateway where practical;
13. CI that runs lint, typecheck, unit tests, and build.

When Phase 0 is complete, provide a closure report with commands run and evidence.

## 6. Phase 1 deliverables — secure settings and provider registry

Implement:

### Database

- providers table;
- models table;
- model capabilities;
- settings;
- secret metadata;
- audit events.

### Secret service

Create interface:

```ts
interface SecretStore {
  set(ref: string, secret: string): Promise<void>;
  get(ref: string): Promise<string | null>;
  delete(ref: string): Promise<void>;
}
```

macOS implementation must use Keychain. Tests use an in-memory fake.

### Provider registry

Implement configuration CRUD without calling the provider yet.

Provider object includes:

- protocol;
- base URL;
- secretRef;
- headers metadata;
- privacy flags;
- enabled status.

### UI

Create Settings → Models & Providers:

- provider list;
- Add Provider form;
- API key field goes directly to secret service;
- base URL;
- protocol selector;
- Test Connection button can remain disabled until Phase 2 if needed.

No API key may appear in renderer logs, SQLite, screenshots/tests, or serialized app state.

## 7. Phase 2 — model gateway and chat

Implement normalized types first.

Then adapters in this order:

1. OpenAI;
2. Anthropic;
3. generic OpenAI-compatible;
4. Ollama;
5. optional generic Anthropic-compatible;
6. OpenRouter native adapter if it gives meaningful metadata/behavior beyond generic compatibility.

Requirements:

- streaming;
- cancellation;
- normalized usage;
- stable error mapping;
- model discovery where available;
- manual models;
- per-model capabilities;
- per-turn model selection;
- persisted provider-independent conversations.

Create contract tests for every adapter using mocks/fixtures. Never require paid provider calls in normal CI.

## 8. Phase 3 — Obsidian retrieval

Implement:

- vault registration;
- scoped file access;
- Markdown parsing;
- frontmatter;
- headings;
- wikilinks;
- tags;
- file watcher;
- incremental hashing;
- FTS5;
- source/chunk tables;
- citation object;
- query service.

Add embeddings behind an interface, not as a hard dependency. Start lexical retrieval if needed, then add vector retrieval.

Answers must cite stable source IDs resolvable to exact note/path/heading.

## 9. Agent architecture rules

Agents are data/config definitions with:

- ID;
- role/purpose;
- instructions;
- model policy;
- allowed tools;
- memory scopes;
- permission ceiling;
- output schema;
- limits.

Implement deterministic intent handlers for simple actions before routing everything through a “chief agent.”

Do not build recursive autonomous swarms.

## 10. Tool architecture rules

Every tool has a Zod input schema and risk level.

Permission levels:

- read;
- draft;
- reversible_write;
- external_side_effect;
- destructive_sensitive.

The execution engine checks permissions independently of the model.

No generic unrestricted shell tool.

## 11. Coding workspace rules

When this phase begins:

- register explicit repo roots;
- read/search tools are scoped to root;
- use structured patches;
- record every command;
- block `sudo`;
- require policy/approval for installs/network scripts/destructive commands;
- create checkpoint before broad edits;
- run relevant tests;
- show final diff and verification;
- support worktrees for parallel tasks later.

A coding task is not “done” because the model says it is done. It is done when verification evidence exists or the agent reports why verification could not run.

## 12. Research rules

Research artifacts must distinguish:

- source;
- claim;
- evidence;
- inference;
- recommendation;
- unresolved question.

Store retrieved date and source metadata. The Research Verifier checks conflicting evidence and recency.

## 13. Health rules

Health integration comes through an iOS HealthKit companion.

- request only necessary permissions;
- allow user to select metric types;
- sync aggregates first;
- health context is local-only by default;
- do not generate medical diagnoses;
- do not attempt to reverse-engineer private wearable APIs.

## 14. Voice rules

Voice is an input/output layer over the same action system.

Start with push-to-talk.

Pipeline:
STT → deterministic intent/agent → permission engine → tool → result → TTS.

Do not create a separate voice-only memory or tool system.

## 15. Automation rules

Use SQLite-persisted local schedules and workflow runs.

Every automation must specify:

- trigger;
- conditions;
- steps;
- permission policy;
- retry policy;
- idempotency behavior;
- notification behavior.

No Redis/distributed queue in v1.

## 16. Quality gate for every phase

Before declaring a phase complete:

1. typecheck passes;
2. lint passes;
3. unit/integration tests pass;
4. desktop build passes;
5. migrations tested from clean database;
6. no secrets in repo/log fixtures;
7. security boundary preserved;
8. docs updated;
9. run a targeted manual smoke test;
10. produce a closure report listing exactly what is complete, incomplete, and deferred.

## 17. Working style

- Make small coherent commits/patches.
- Prefer explicit boring architecture to clever framework magic.
- Do not introduce a dependency without explaining the problem it solves.
- Avoid giant files and god services.
- Keep provider-specific logic isolated.
- Keep model prompts versioned and testable.
- Keep user-visible decisions explicit.
- Add TODOs only with issue/phase context.
- Never silently reduce security to make a demo work.

## 18. First task now

Do **only** the following first:

1. inspect the existing repository if one exists;
2. read the blueprint;
3. produce `ARCHITECTURE_REVIEW.md`;
4. produce `IMPLEMENTATION_PLAN_PHASE_0_1.md` with file-level steps;
5. identify any blockers;
6. if no blocker prevents it, implement Phase 0 foundation;
7. run verification;
8. return a closure report.

Do not begin Phase 2+ until Phase 0/1 contracts are stable.

---

## Optional second prompt after foundation is complete

> Continue with the next unfinished phase from `17_ROADMAP.md`. First read the previous closure report, current ADRs, and tests. Preserve all Zero OS non-negotiable boundaries. Implement only one complete vertical slice, verify it, update documentation, and return a closure report. Do not jump ahead to visually impressive features while foundational acceptance criteria remain incomplete.
