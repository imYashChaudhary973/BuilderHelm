# Phase 0/1 File-Level Implementation Plan

## Scope control

Phase 0 creates the repository spine and one bootable, security-checked desktop
health slice. Phase 1 adds secure provider configuration without making model
calls. Phase 2 and later contracts are out of scope.

## Phase 0 files

### Workspace and tooling

- `package.json` — root scripts, pinned package manager, engines, shared tooling.
- `pnpm-workspace.yaml` — workspace package discovery.
- `.npmrc` — frozen, reproducible pnpm behavior without lifecycle-policy
  bypasses.
- `tsconfig.base.json` — strict compiler policy and safe module defaults.
- `tsconfig.json` — project references for all implemented workspaces.
- `eslint.config.js` — TypeScript-aware lint rules and generated-file ignores.
- `.prettierrc.json`, `.prettierignore` — deterministic formatting.
- `.gitignore` — dependencies, build output, local databases, logs, and secrets.
- `.github/workflows/ci.yml` — read-only-token CI for format, lint, typecheck,
  tests, and build with third-party actions pinned to full commits.

### Shared foundation

- `packages/shared/package.json`, `packages/shared/tsconfig.json` — package
  boundary and build configuration.
- `packages/shared/src/id.ts` — locally generated UUIDv7-style record and
  correlation IDs.
- `packages/shared/src/time.ts` — validated UTC ISO timestamps.
- `packages/shared/src/error.ts` — stable `ZeroErrorCode`, safe metadata, and
  unknown-error normalization.
- `packages/shared/src/index.ts` — explicit public surface.
- `packages/shared/test/*.test.ts` — ID, time, and error invariants.

### Protocol boundary

- `packages/protocol/package.json`, `packages/protocol/tsconfig.json` — protocol
  package configuration with a one-way dependency on shared.
- `packages/protocol/src/events.ts` — Zod event envelope and event factory.
- `packages/protocol/src/ipc.ts` — fixed channel constants and health
  request/response schemas.
- `packages/protocol/src/index.ts` — explicit public surface.
- `packages/protocol/test/*.test.ts` — malformed IPC and event rejection tests.

### Database

- `packages/db/package.json`, `packages/db/tsconfig.json` — contained SQLite
  implementation boundary.
- `packages/db/src/database.ts` — connection lifecycle and safe execution
  wrapper.
- `packages/db/src/migration-runner.ts` — ordered, transactional, forward-only
  migrations with tamper/name mismatch checks.
- `packages/db/src/migrations/0001-phase-zero.ts` — initial application
  metadata schema.
- `packages/db/src/index.ts` — no driver types exported.
- `packages/db/test/migrations.test.ts` — clean database, idempotent rerun, and
  invalid sequence coverage.

### Observability

- `packages/observability/package.json`,
  `packages/observability/tsconfig.json` — logging package configuration.
- `packages/observability/src/redact.ts` — recursive sensitive-key and token
  redaction.
- `packages/observability/src/logger.ts` — structured JSON logger with level,
  event, timestamp, and correlation ID.
- `packages/observability/src/index.ts` — explicit public surface.
- `packages/observability/test/logger.test.ts` — secret-negative fixtures and
  structured-record tests.

### Core composition

- `packages/core/package.json`, `packages/core/tsconfig.json` — application-core
  package boundary.
- `packages/core/src/bootstrap.ts` — database migration, logger wiring, health
  response, and deterministic shutdown.
- `packages/core/src/index.ts` — explicit public surface.
- `packages/core/test/bootstrap.test.ts` — in-memory startup and shutdown smoke.

### Secure desktop shell

- `apps/desktop/package.json`, `apps/desktop/tsconfig*.json` — Electron, preload,
  and renderer build targets.
- `apps/desktop/electron.vite.config.ts` — three-process build configuration.
- `apps/desktop/src/main/security.ts` — testable secure web preferences and CSP.
- `apps/desktop/src/main/ipc.ts` — fixed, schema-validated IPC registration.
- `apps/desktop/src/main/index.ts` — app lifecycle, core startup, navigation
  denial, and safe teardown.
- `apps/desktop/src/preload/index.ts` — narrow `contextBridge` API only.
- `apps/desktop/src/renderer/index.html` — CSP defense in depth and app root.
- `apps/desktop/src/renderer/src/*` — minimal React status shell and CSS token
  layer.
- `apps/desktop/test/security.test.ts` — renderer privilege-setting assertions.

### Architecture tests and reports

- `tests/architecture/provider-boundary.test.ts` — fail on provider SDK imports
  outside `packages/model-gateway`.
- `tests/architecture/package-boundaries.test.ts` — fail on known upward or app
  imports from foundation packages.
- `docs/adr/0001-phase-zero-foundation.md` — runtime, package, database, and UI
  foundation decisions with tradeoffs.
- `PHASE_0_CLOSURE_REPORT.md` — exact evidence, status, gaps, and deferred work.

## Phase 0 verification commands

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:migrations
pnpm build
pnpm smoke:desktop
```

`smoke:desktop` must prove the Electron main process reaches the renderer-ready
health checkpoint and exits without exposing a generic privileged bridge. If a
headless environment prevents it, the closure report marks manual smoke as
blocked rather than treating the build as equivalent evidence.

## Phase 1 files

### Persistence and domain contracts

- `packages/db/src/migrations/0002-provider-settings.ts` — the six required
  Phase 1 table groups, constraints, and indexes.
- `packages/db/src/repositories/provider-repository.ts` — provider metadata CRUD
  with no credential value parameter or return field.
- `packages/db/src/repositories/model-repository.ts` — models and normalized
  capabilities.
- `packages/db/src/repositories/settings-repository.ts` — validated settings.
- `packages/db/src/repositories/audit-repository.ts` — append-only audit writes.
- `packages/core/src/secrets/secret-store.ts` — `SecretStore` interface.
- `packages/core/src/secrets/memory-secret-store.ts` — deterministic test fake.
- `apps/desktop/src/main/keychain-secret-store.ts` — macOS Keychain adapter,
  reachable only from the privileged process.
- `packages/core/src/providers/provider-service.ts` — configuration CRUD,
  secret handoff, rollback-on-failure behavior, and audit emission.
- `packages/protocol/src/providers.ts` — Zod input/output schemas that exclude
  credential values from reads.

### UI and bridge

- `apps/desktop/src/main/provider-ipc.ts` — fixed validated provider channels.
- `apps/desktop/src/preload/index.ts` — additive narrow provider methods.
- `apps/desktop/src/renderer/src/routes/settings/providers.tsx` — provider list
  and add/edit form.
- `apps/desktop/src/renderer/src/features/providers/*` — form schema, mutation,
  list, protocol selector, privacy controls, and disabled connection test.

### Phase 1 tests and evidence

- `packages/db/test/provider-repository.test.ts` — constraints and clean
  migration behavior.
- `packages/core/test/provider-service.test.ts` — CRUD, Keychain handoff,
  rollback, audit, and authorization-independent invariants.
- `apps/desktop/test/provider-ipc.test.ts` — invalid argument rejection and
  response validation.
- `tests/security/secret-persistence.test.ts` — credential sentinel absent from
  database bytes, logger output, snapshots, and serialized renderer state.
- `PHASE_1_CLOSURE_REPORT.md` — exact gate results and deferred Phase 2 work.

## Phase 1 exit gate

The phase is complete only when a user can save, list, edit, disable, and delete
provider configuration; the corresponding credential is stored in Keychain;
no secret value is persisted or logged; audit events are queryable; all
automated gates pass; and the macOS manual flow is verified. No provider API
request is required in this phase.
