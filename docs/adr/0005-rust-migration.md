# ADR 0005: Migrate BuilderHelm to a single Rust codebase

- Status: **Superseded** on 2026-08-27 by the hybrid architecture decision (Rust engine + TypeScript platform, see [ADR 0006](0006-hybrid-architecture.md))
- Date: 2026-08-26
- Superseded decision: single-Rust-codebase migration
- Superseded plan: `docs/MIGRATION.md` (removed)

## Outcome

The migration was started and produced the Rust engine that now lives under
`crates/` (helm-core, helm-protocol, helm-db, helm-gateway, helm-pty,
helm-swarm, helm-host, helm-ui, helm-app) with a 218-fixture conformance
corpus. It did not reach renderer cutover.

On 2026-08-27 the direction was reversed after further research: a hybrid
architecture (Rust backend for the core engine and performance-critical
operations, TypeScript for the development environment, platform support, and
UI frameworks) replaces the single-Rust goal. The original migration plan was
withdrawn before Phase 4–6 (renderer cutover, platform packaging, archive)
executed.

## What survives

The Rust engine built under this decision remains the product's backend: the
typed IPC contract, conformance corpus, core services, and terminal/PTY stack.
What changed is that the TypeScript renderer keeps shipping and the full
renderer rewrite was abandoned.
