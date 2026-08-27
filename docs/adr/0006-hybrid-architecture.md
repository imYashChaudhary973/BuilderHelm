# ADR 0006: Hybrid architecture — Rust engine, TypeScript platform

- Status: Accepted
- Date: 2026-08-27
- Supersedes: [ADR 0005](0005-rust-migration.md) (full migration to a single Rust codebase)
- Plan: [ADOPTION](../ADOPTION.md)

## Context

BuilderHelm started as an Electron + TypeScript app. On 2026-08-26 the decision
was made to migrate the entire product to a single Rust codebase ([ADR
0005](0005-rust-migration.md)). That migration ran through Phase 3: the Rust
engine (core services, protocol, database, PTY, swarm, host, conformance
corpus) exists and replays green, but the renderer never cut over.

Further research changed the picture. A full rewrite discards the working
TypeScript renderer and tooling that is a product strength, while the parts of
the workload that actually need native performance — the core engine, settings
management, agent workflows, PTY/terminal I/O — are exactly the parts already
ported to Rust.

## Decision

**Hybrid architecture.**

- **Rust backend (the core engine).** Owns the core engine, settings
  management, and the underlying agent workflows: model gateway, chat,
  knowledge retrieval, permissioned tools, PTY/terminal I/O, swarm
  orchestration, SQLite persistence, provider secrets. Memory-safe, fast,
  cross-platform, and enforced by the conformance corpus.
- **TypeScript platform.** Powers the development environment, the UI
  framework, cross-platform capability (macOS, Windows, Linux), and the
  coordination layer for AI-assisted development tools. The existing Electron
  renderer keeps shipping against the Rust core.

The product becomes a platform of integrated products: **BuilderHelm** (the
desk), **Swarm Builder**, an agent-native **terminal workflow builder**,
**Helm Code** (CLI-first coding engine), with **BuilderHelm Voice** and
**BuilderHelm MCP** planned. See [ADOPTION](../ADOPTION.md) for the adoption
plan and [PLATFORM](../PLATFORM.md) for the product map.

## Consequences

1. The renderer cutover phases of ADR 0005 are cancelled. The Electron
   renderer is the shipping UI, now backed by the Rust engine over the same
   schema-validated contract.
2. New performance-heavy and system-level work is Rust. New product surfaces,
   UI, and tooling are TypeScript-first.
3. The conformance corpus remains the oracle for the engine contract; both
   implementations must satisfy it.
4. `crates/` continues as the engine. `apps/desktop` continues as the
   platform shell. Neither is a throwaway.
5. Cross-platform (Windows/Linux) work targets the hybrid stack: the Rust
   engine must be portable, the TypeScript platform must not assume macOS.
