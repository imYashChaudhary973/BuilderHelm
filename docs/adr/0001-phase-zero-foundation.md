# ADR 0001: Phase 0 foundation choices

- Status: Accepted
- Date: 2026-08-09

## Context

Zero OS begins from a blueprint-only folder. Phase 0 needs a secure Electron
shell, strict TypeScript packages, SQLite migrations, typed IPC, stable local
IDs, errors, structured redacted logs, architecture guardrails, and CI without
creating empty future abstractions.

## Decision

1. Use a pnpm TypeScript workspace with project references and explicit package
   manifests.
2. Create only `shared`, `protocol`, `db`, `observability`, and `core` in Phase 0. Add later bounded-context packages with their first working slice.
3. Use the runtime's `node:sqlite` API behind `packages/db`. This avoids a native
   addon and Electron ABI rebuild in the foundation while keeping replacement
   local to one package.
4. Use React with a small CSS token layer for the Phase 0 shell. Add TanStack
   Router, TanStack Query, Zustand, and the fuller component system with the
   Phase 1 settings workflow that needs them.
5. Use Zod at IPC/event boundaries and keep every renderer bridge method
   explicit.
6. Generate UUIDv7-style IDs locally and store UTC ISO timestamps.

## Consequences

- The initial repository stays small and every package has executable behavior.
- The Node/Electron runtime version must include `node:sqlite`. The adapter and
  migration tests make a future driver replacement contained.
- Phase 0 cannot demonstrate routing or provider configuration; those remain
  explicit Phase 1 work rather than placeholder code.
- A build is insufficient proof of desktop security, so source-level security
  tests and a real Electron boot smoke test are both required.
