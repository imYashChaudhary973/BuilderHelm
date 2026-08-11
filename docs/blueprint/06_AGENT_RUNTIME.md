# Agent Runtime

## Principle

An agent is a policy-controlled worker with a role, memory scope, model policy, tools, output contract, and permission ceiling.

## Agent definition

```yaml
id: research.primary
name: Researcher
purpose: Produce source-grounded research briefs.
model_policy: research_deep
memory_scopes:
  - projects
  - knowledge
allowed_tools:
  - web.search
  - web.open
  - browser.navigate
  - knowledge.search
  - research.save_source
  - research.save_claim
permission_ceiling: reversible_write
output_schema: ResearchBrief
escalation:
  - condition: insufficient_evidence
    action: request_more_sources
```

## Runtime loop

Use a bounded plan/act/observe loop:

1. **Understand** — classify the request and required outcome.
2. **Scope** — determine relevant project/data and privacy class.
3. **Plan** — produce a short internal execution plan or structured steps.
4. **Act** — call permitted tools.
5. **Observe** — evaluate tool output.
6. **Continue or stop** — bounded by max steps, cost, time, and permissions.
7. **Deliver** — produce result with evidence and action receipts.
8. **Reflect** — optional short post-run evaluation stored separately from user-facing output.

Do not implement uncontrolled recursive agent spawning.

## Orchestration model

Use **deterministic routing first**, Chief-of-Staff reasoning second.

Examples:

- “add task” → direct task intent handler;
- “show recent commits” → direct Git query;
- “research this market” → Research Agent;
- “fix this code” → Coding Agent;
- multi-domain ambiguous request → Chief of Staff.

This reduces cost and makes simple actions reliable.

## Initial agent registry

### Chief of Staff

- interprets cross-domain requests;
- creates plans;
- delegates to specialist agents;
- consolidates results;
- cannot exceed child permission ceilings.

### Memory Curator

- identifies durable memory candidates;
- merges duplicates;
- tracks contradictions;
- creates/suggests entity links;
- never invents facts without sources.

### Daily Planner

- combines tasks, deadlines, calendar, project status, and recent work;
- proposes priorities;
- does not silently move deadlines.

### Project Manager

- maintains project status;
- identifies blockers and next actions;
- summarizes progress from tasks + Git + notes.

### Researcher

- decomposes research;
- searches sources;
- stores claims/evidence;
- cites conclusions.

### Research Verifier

- checks source quality, dates, conflicting claims, and missing evidence;
- cannot rewrite evidence to fit a desired conclusion.

### Coding Agent

- reads repository;
- plans changes;
- applies structured patches;
- runs approved commands/tests;
- returns diff and verification.

### Code Reviewer

- independently reviews patch for correctness, regressions, security, and maintainability;
- should use a different model policy when practical.

### Content Strategist

- derives ideas from projects/research/work logs;
- maintains content calendar and themes.

### Platform Writers

Separate agent configs for:

- X
- Mastodon
- Bluesky
- Instagram concepts/captions
- YouTube long-form concepts
- Shorts/Reels concepts
- livestream topics

All share a common personal voice profile but have platform-specific constraints.

### Growth Researcher

- studies developer communities, product positioning, audience questions, and competing products;
- produces research and experiments;
- does not auto-spam or auto-engage accounts.

### Health Analyst

- summarizes user-approved metrics and trends;
- generates non-diagnostic insights;
- cannot make medical diagnoses.

### Automation Planner

- converts repeated manual routines into proposed workflows;
- must show trigger, actions, permissions, failure handling, and expected value before activation.

## Agent skills

Tools are capabilities; skills are reusable operating procedures.

Example research skills:

- formulate-search-plan;
- source-quality-check;
- compare-claims;
- recency-check;
- evidence-table;
- decision-brief;

Example coding skills:

- repository-onboarding;
- bug-triage;
- minimal-patch;
- test-selection;
- UI-browser-verification;
- security-review;

Skills are Markdown/YAML instruction packages versioned in the repo, not hidden prompts embedded in code.

## Agent handoffs

Use typed handoff artifacts rather than free-form chat whenever possible.

Example:

```ts
interface ResearchHandoff {
  question: string;
  findings: Finding[];
  unresolvedQuestions: string[];
  recommendedDecision?: string;
  sourceIds: string[];
}
```

## Limits

Every run has:

- max tool steps;
- max tokens;
- max estimated cost;
- timeout;
- permission ceiling;
- allowed data scopes.

An agent exceeding limits stops gracefully and reports what remains.
