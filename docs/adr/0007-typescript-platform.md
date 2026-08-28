# ADR 0007: TypeScript product platform

- Status: Accepted
- Date: 2026-08-28
- Supersedes: the retired native-engine migration and hybrid-architecture plans.

## Context

BuilderHelm already has a working Electron/React renderer and TypeScript
services for terminals, projects, providers, chat, memory, permissions, tasks,
Git, and Swarm. A second native implementation duplicated those responsibilities
and added packaging, protocol-drift, testing, and maintenance cost before the
product had a measured need for another runtime.

## Decision

BuilderHelm uses:

- Electron for the desktop shell;
- React and Vite for the renderer;
- TypeScript for product code, packages, CLI, relay, and mobile source;
- Node.js 24 LTS for development and privileged JavaScript services;
- xterm.js plus node-pty for the terminal;
- SQLite for local durable state;
- React Native for the planned mobile companion.

No Rust engine, Cargo workspace, native UI rewrite, or second product core is
part of the architecture.

## Consequences

- One language and package graph carry the product while the team is small.
- CPU-heavy or crash-prone work moves to Node utility processes first.
- Performance work begins with measurement, event batching, backpressure,
  bounded buffers, and render discipline.
- Mobile is a remote client; it does not run local coding CLIs.
- A future standalone daemon requires a new ADR and measured product need.
