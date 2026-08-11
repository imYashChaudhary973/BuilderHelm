# Product Vision

## Mission

Build a private, extensible operating layer for a person’s life and work that can **remember, understand, retrieve, plan, and act** across their own information and tools.

The core user outcome is not “AI answers faster.” It is:

> I should spend less time finding context, switching apps, reconstructing what I was doing, repeating instructions, and performing mechanical digital work.

## Product thesis

Most productivity software stores information in isolated applications. AI chat products add intelligence but usually lack durable personal context and safe action capabilities. Zero OS combines:

- durable personal knowledge;
- live operational data;
- specialized agents;
- model choice;
- tool execution;
- permissioned automation;
- a unified interface.

The system should progressively reduce **context-switching cost**. It should know which project is active, what changed in the repository, which tasks matter today, what research is relevant, which notes contain the background, and which actions are safe to execute.

## Non-goals for v1

Zero OS is not:

- a replacement for macOS;
- a social network auto-poster;
- a system that autonomously sends external communications by default;
- a financial transaction bot;
- a medical diagnosis system;
- a fully autonomous computer-use agent with unrestricted OS access;
- a cloud-first SaaS storing the user’s life by default.

## Product principles

### 1. The OS owns state; models do not

Conversation history, facts, tasks, workflows, tool permissions, and audit logs belong to Zero OS. A model can disappear tomorrow without destroying the product.

### 2. Every important answer should have provenance

When Zero answers “What did I decide about Project X?”, it should cite the source note, task, commit, research artifact, or prior decision record used to answer.

### 3. Every action should have a receipt

An action receipt includes:

- agent;
- model;
- tool;
- requested action;
- arguments;
- approval state;
- result;
- files/entities affected;
- timestamp;
- rollback information when available.

### 4. Model selection is a policy, not a hard-coded name

Agents request capabilities such as `deep_reasoning`, `fast_local`, `coding`, `vision`, `tool_use`, or `long_context`. A policy resolver chooses the actual model based on user preferences, privacy, availability, cost, and capability.

### 5. Local-first by default, cloud when beneficial

Local storage should be enough for the core product. Cloud models and remote integrations are opt-in execution paths, not architectural dependencies.

### 6. Automation requires explicit trust boundaries

A voice instruction like “add a task” may be safely automatic. “Publish this”, “delete this repository”, “send this email”, or “run an unknown install script” must be gated.

## North-star experience

At the start of the day, Zero presents a concise briefing:

- top priorities based on deadlines and active projects;
- outstanding tasks and blockers;
- recent Git changes;
- calendar commitments;
- health/recovery summary from approved data;
- research or knowledge items worth resurfacing;
- agent/automation results requiring review.

During work, the user can type or speak:

- “What was my last decision on the onboarding flow?”
- “Show the commits I made yesterday and summarize what changed.”
- “Add a task to the finance app project to fix the receipt parser.”
- “Research three approaches to this problem and save a cited decision brief.”
- “Open this project in Code, inspect the failing tests, and propose a patch.”
- “Turn today’s build notes into drafts for X, Bluesky, and Mastodon, but do not publish.”

## Success metrics

Measure the product by outcomes, not chat volume:

- median time to retrieve known personal/project information;
- number of app switches avoided;
- percentage of agent actions completed successfully;
- action rollback rate;
- retrieval citation accuracy;
- task capture-to-completion rate;
- repeated-context reduction;
- daily active automations that save manual steps;
- coding task success rate with tests passing;
- user overrides of model routing;
- monthly model spend and local/cloud ratio.
