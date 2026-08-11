# Product Requirements Document

## Primary personas

### Builder

Works on multiple software products and needs project context, coding assistance, Git activity, tasks, research, and decisions in one place.

### Student / learner

Needs a searchable personal knowledge base, research synthesis, project planning, study context, and efficient capture.

### Creator / founder

Needs research, content ideation, platform-specific drafts, product intelligence, and an operating rhythm without losing personal voice.

These are modes of the same user, not separate accounts.

## Core jobs-to-be-done

### Personal knowledge

- Search everything the user has deliberately connected.
- Answer with source citations.
- Resolve relationships between people, projects, decisions, notes, commits, tasks, and events.
- Save durable decisions and memories without polluting raw notes.

### Project command center

- Show active projects and current status.
- Surface today’s priorities.
- Ingest Git activity.
- Track decisions, blockers, milestones, research, and tasks.
- Open a project directly in the coding workspace.

### Action chat

- Chat with any configured model.
- Switch model mid-thread without losing Zero-owned conversation state.
- Allow tool calls when the chosen model supports them.
- Route unsupported actions to a compatible model if policy allows.
- Preview and approve impactful actions.

### Coding workspace

- Repository/file tree.
- Editor/diff view.
- terminal.
- Git status/history.
- agent task thread.
- context picker.
- model selector.
- plan → patch → test → review loop.
- checkpoints and rollback.

### Research workspace

- Define a research question.
- Search the web and connected sources.
- save sources and claims.
- compare conflicting evidence.
- produce a cited brief.
- promote conclusions to project decisions or knowledge notes.

### Health dashboard

- Import authorized HealthKit metrics through an iOS companion.
- Show trends for steps, sleep, activity, and other user-approved metrics.
- Avoid diagnosis and clinical claims.
- Allow health data to remain local-only.

### Content studio

- Maintain content ideas and source material.
- Produce platform-specific drafts using specialist agents.
- Preserve a shared personal voice profile.
- Require manual review before publishing in v1.

### Voice actions

- Push-to-talk v1; optional wake phrase later.
- Transcribe locally by default when possible.
- Convert intent into a structured action plan.
- Execute low-risk actions with configured permission.
- read back the result concisely.

## Functional requirements

### FR-1 Provider settings

The user can add a provider with:

- provider type;
- API key/credential reference;
- base URL;
- optional organization/project headers;
- models endpoint or manual model list;
- default timeout;
- rate-limit policy;
- spend limit;
- privacy classification.

Credentials must be stored in the OS secure secret store, never plain SQLite.

### FR-2 Model catalog

Every model record includes capability flags. The UI must not assume every model can use tools, images, structured output, reasoning controls, or streaming.

### FR-3 Conversations

- Thread is provider-independent.
- Every message records model/provider used.
- Model may change per assistant turn.
- Tool calls are first-class timeline events.
- Context sources are visible.

### FR-4 Knowledge retrieval

Use hybrid retrieval:

1. exact/keyword search;
2. semantic vector retrieval;
3. graph expansion;
4. recency weighting;
5. source authority weighting;
6. optional reranking.

### FR-5 Durable facts

Facts require source provenance and confidence. User-authored explicit facts outrank inferred facts.

### FR-6 Agents

Agents are configuration objects, not subclasses hard-coded throughout the app.

Required fields:

- identity and role;
- instructions;
- model policy;
- allowed tools;
- memory scopes;
- permission ceiling;
- output schema;
- escalation rules.

### FR-7 Action engine

Every action is validated against a tool schema and permission policy before execution.

### FR-8 Automation

Triggers include:

- scheduled time;
- app event;
- file/vault change;
- Git event;
- new integration data;
- task state change;
- manual trigger.

### FR-9 Audit

The user can inspect exactly what an agent did and why.

### FR-10 Offline mode

The app remains useful offline with:

- Obsidian/local search;
- local tasks/projects;
- local model chat when configured;
- local coding operations;
- cached data;
- audit history.

## Key user journeys

### Journey A — ask the personal graph

1. User asks: “Why did I choose architecture B for Project X?”
2. Intent router identifies `knowledge_query`.
3. Context builder retrieves project notes, decision record, linked research, and relevant chat decisions.
4. Model receives bounded context with source IDs.
5. Answer includes evidence links back to exact source objects.

### Journey B — voice task creation

1. User speaks: “Add a high-priority task to Project X to benchmark the sync layer tomorrow.”
2. STT creates text.
3. Intent parser creates structured `task.create` proposal.
4. Tool validator checks project and date.
5. Permission level is reversible-write; auto-execute if user enabled it.
6. Task is written; voice confirms the action.

### Journey C — coding agent

1. User opens repository.
2. Agent indexes files or refreshes changed files.
3. User asks for a bug fix.
4. Agent inspects repo and proposes a plan.
5. Agent applies patches using structured edits.
6. Tests run.
7. UI shows diff, test results, and agent explanation.
8. User accepts, edits, or rolls back.

### Journey D — research to decision

1. User asks a research question.
2. Research agent creates subquestions and source plan.
3. Browser/search tools collect evidence.
4. Claims are stored with source references.
5. Verifier checks contradictions and recency.
6. Agent produces decision brief.
7. User promotes it into a project decision and Obsidian note.

## Acceptance criteria for v1

V1 is successful when it can reliably perform these ten operations:

1. index an Obsidian vault;
2. answer cited questions over that vault;
3. configure at least five provider types plus generic OpenAI-compatible;
4. switch models per turn;
5. create and update tasks through chat;
6. display Git repository activity;
7. run a scoped coding agent that can patch and test;
8. create a cited research brief;
9. execute scheduled automations with audit logs;
10. receive HealthKit daily aggregates from an iOS companion.
