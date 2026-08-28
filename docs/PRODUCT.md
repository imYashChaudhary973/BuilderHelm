# Product

BuilderHelm is an agent development environment for running multiple coding
agents in parallel and turning their work into reviewed Git changes.

## Problem

Agent-assisted development is split across terminals, agent chats, editors,
browsers, Git tools, issue trackers, CI dashboards, and notes. Parallel agents
add branch collisions, duplicated work, hidden failures, and a review bottleneck.

## Product promise

BuilderHelm keeps the project context together:

- launch installed coding agents side by side;
- isolate independent changes with branches and Git worktrees;
- inspect terminal output, files, diffs, tests, screenshots, and CI;
- send targeted feedback back to an agent;
- approve high-impact actions;
- create commits and pull-request drafts from reviewed work;
- continue monitoring and directing the host from a mobile companion.

## Principles

1. **The user owns the workspace.** Agents are replaceable guests.
2. **Local first.** Repositories, credentials, and durable state remain on the host.
3. **Agents are optional.** Space, Board, Editor, Git, Browser, and Notes remain useful without AI.
4. **Parallel work is isolated.** Independent runs do not share a writable checkout.
5. **Evidence is part of completion.** A run reports what changed and how it was verified.
6. **Actions remain controlled.** Permission, approval, and receipt logic lives in application code.
7. **Bring your own provider.** BuilderHelm does not bundle or impersonate a model subscription.

## Main surfaces

- **Space** — direct terminal workspace for one project.
- **Swarm** — coordinated multi-agent mission with roles and budgets.
- **Board** — persistent human task planning.
- **Memory** — local cited project knowledge.
- **Editor** — files and notes in the active workspace.
- **Git and Review** — branch state, diffs, tests, feedback, commits, pull requests, and CI.
- **Browser** — preview and verify a UI, select elements, and send evidence to agents.
- **Mobile** — remotely observe, direct, approve, pause, and cancel host runs.

## Not BuilderHelm

- Not a model provider.
- Not a replacement operating system.
- Not an unrestricted remote shell product.
- Not a guarantee that Git worktrees securely sandbox untrusted code.
- Not a reason to automate merging without review.
