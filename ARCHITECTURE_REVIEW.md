# Zero OS Architecture Review

## Review scope

This review covers the complete blueprint pack from `00_README.md` through
`20_RESEARCH_SOURCES.md`, read in the order listed by `BLUEPRINT_ORDER.txt`.
The starting folder contains only the blueprint documents and is not currently
a Git repository.

## System understanding

Zero OS is a single-user, local-first personal intelligence and action system.
Its durable product state belongs to Zero rather than to any model provider.
The desktop app is an unprivileged interface over a privileged local core; the
core owns persistence, context assembly, model routing, permissions, tool
execution, automation, and audit records.

The principal boundaries are:

1. The Electron renderer is sandboxed and can use only a narrow, validated
   preload API.
2. Domain packages see normalized model contracts, never provider SDK types.
3. Models propose actions; deterministic code validates authorization, input,
   scope, and risk before executing them.
4. SQLite owns operational state, while Obsidian notes and repositories remain
   source-owned and are indexed by stable provenance references.
5. Secrets live in macOS Keychain. SQLite, renderer state, prompts, fixtures,
   and logs contain only opaque secret references.
6. Every important operation carries a correlation ID and produces structured,
   redacted observability or an immutable audit record as appropriate.
7. Data classification is checked before context crosses a model or
   integration boundary.

The intended delivery method is a sequence of complete vertical slices:
foundation, secure provider configuration, model-independent chat, cited
Obsidian retrieval, permissioned actions, project/Git context, coding,
research, automation, voice, HealthKit, and content workflows.

## Assumptions

- The product name in the blueprint, **Zero OS**, is authoritative. The current
  folder name, `Axiom - PIOS`, is treated as a workspace label and is not
  renamed.
- This is a new implementation. There is no source tree, package manifest,
  lockfile, migration history, or Git history to preserve.
- macOS is the first supported runtime. Linux CI verifies portable foundation
  code and a production build, but cannot validate Keychain or macOS UI
  behavior.
- Phase 0 establishes only packages that contain working foundation code.
  Empty future packages and screens are deferred to the phase that needs them.
- The root-level blueprint files remain in place for this first patch so the
  user-provided paths and cross-references remain valid. A later documentation
  move should be a deliberate, mechanical change.
- SQLite is accessed through a small repository-owned adapter so the driver can
  be replaced without leaking driver types into domain code.

## Contradictions and resolutions

### Phase ownership of the shell and database

`17_ROADMAP.md` places the secure Electron boundary and SQLite migrations in
Phase 1, while `19_MASTER_BUILD_PROMPT.md` explicitly includes both in Phase 0.
The master prompt is the controlling build instruction, so the secure shell,
typed preload bridge, SQLite connection, and migration runner are Phase 0.
Phase 1 starts at persisted settings, provider/model tables, Keychain-backed
secrets, provider CRUD, and the provider settings UI.

### Phase 0 versus Phase 1 in the first task

The first task asks for a Phase 0/1 implementation plan but authorizes
implementation of the Phase 0 foundation. Phase 1 is therefore specified at
file level but not started until the Phase 0 closure gate is satisfied.

### Dependency-arrow notation

The recommended dependency diagram mixes left arrows and right arrows. This
implementation interprets an arrow as “consumer depends on dependency” and
uses this concrete direction:

```text
desktop -> core, protocol
core -> db, model-gateway, observability, protocol, shared
protocol -> shared
db -> shared
observability -> shared
model-gateway -> shared, protocol       # introduced when its contracts exist
agents -> model-gateway, tools, memory, protocol
```

No lower-level package may import from `apps/desktop` or from a higher-level
orchestration package.

### Required UI stack versus vertical-slice discipline

The blueprint names TanStack Router, TanStack Query, Zustand, and a Tailwind /
shadcn-style layer, but Phase 0 needs only a secure bootable shell. Adding
unused libraries would violate the blueprint's own YAGNI and vertical-slice
rules. Phase 0 uses React plus a small CSS token layer; routing, server-state,
and UI-state libraries are added in Phase 1 when the provider settings flow
uses them.

## Principal risks

| Risk                                                  | Consequence                                   | Current mitigation                                                                                             |
| ----------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Electron privilege escalation through renderer or IPC | Secrets and local files could be exposed      | Sandbox, context isolation, Node disabled, fixed bridge methods, Zod validation, navigation/window denial, CSP |
| Secret leakage through logs or persistence            | Provider credentials compromised              | Redacting logger now; Keychain-only secret contract and secret-negative tests in Phase 1                       |
| Provider types leaking into domain code               | Model replacement becomes expensive           | Package boundary plus an architecture test that scans imports outside `model-gateway`                          |
| SQLite API/driver drift                               | Startup or migration failure                  | Driver contained in `packages/db`; clean-database migration tests; pinned runtime policy                       |
| Migration failure or partial application              | Corrupt operational state                     | Ordered forward-only migrations, transaction per migration, version/name consistency checks                    |
| Audit and operational logs conflated                  | Sensitive content may be retained incorrectly | Observability logger and immutable audit repository remain separate concepts                                   |
| Prompt injection from indexed or remote content       | Unauthorized action or data exfiltration      | Retrieved content is data only; permission checks and tool allowlists remain deterministic code                |
| Scope creep across many promised workspaces           | Many empty screens with no reliable loop      | One phase and one verifiable vertical slice at a time                                                          |
| Native-only behavior untested in Linux CI             | Keychain or desktop behavior can regress      | Platform adapters with in-memory fakes; explicit macOS smoke gate before phase closure                         |

## Proposed repository structure

The repository grows only as each package gains real code:

```text
apps/
  desktop/
    src/main/
    src/preload/
    src/renderer/
packages/
  shared/          # IDs, UTC time, correlation IDs, ZeroError
  protocol/        # Zod IPC and event contracts
  db/              # SQLite adapter and migration runner
  observability/   # structured redacting logger
  core/            # composition root and health service
tests/
  architecture/    # dependency and provider-import guardrails
docs/
  adr/             # durable architecture decisions
.github/workflows/
```

`model-gateway`, `tools`, `memory`, `integrations`, `automations`, and `agents`
are created when their first usable contract or slice is implemented, not as
empty placeholders. `apps/ios-companion` starts with the HealthKit phase.

## Exact Phase 0 sequence

1. Add pnpm workspace configuration, a pinned runtime policy, strict shared
   TypeScript configuration, formatting, linting, Vitest, and root commands.
2. Implement `packages/shared` with UUIDv7-style IDs, UTC timestamps,
   correlation IDs, and the stable `ZeroError` taxonomy.
3. Implement `packages/protocol` with Zod-validated event envelopes and the
   first fixed IPC health contract.
4. Implement `packages/observability` with JSON structured output and recursive
   key/value redaction.
5. Implement `packages/db` with a contained SQLite connection, ordered
   forward-only migration runner, and a Phase 0 metadata migration.
6. Implement `packages/core` as the composition root that opens the database,
   runs migrations, exposes health state, and closes resources.
7. Implement the Electron main, preload, and React renderer processes with the
   secure web preferences, restrictive CSP, and fixed health bridge.
8. Add unit, integration, migration, IPC-security, and architecture-boundary
   tests.
9. Add least-privilege CI that runs format check, lint, typecheck, tests, and
   production build.
10. Run the full gate plus a targeted desktop boot smoke test and record exact
    evidence in `PHASE_0_CLOSURE_REPORT.md`.

## Exact Phase 1 sequence

1. Add the Phase 1 SQL migration for `providers`, `models`,
   `model_capabilities`, `settings`, `secret_metadata`, and `audit_events`,
   including constraints and indexes.
2. Add repositories in `packages/db` whose public contracts contain no SQLite
   driver types and no secret values.
3. Define `SecretStore` in `packages/core` (or a dedicated security package
   when a second consumer justifies it), with an in-memory test fake and a
   macOS Keychain adapter in the privileged process.
4. Define extensible provider protocol, privacy, header-metadata, and model
   capability schemas. Store only `secretRef`.
5. Implement provider configuration CRUD and audit each create, update, enable,
   disable, and delete operation with a correlation ID.
6. Extend the preload API with narrow provider-list/create/update/delete
   methods; validate every request and response at both sides of IPC.
7. Build the Settings -> Models & Providers vertical slice. Send API key input
   directly to the privileged secret service and clear it immediately after a
   successful save.
8. Add negative tests proving secret strings do not enter SQLite, renderer
   serialized state, logs, snapshots, or fixtures.
9. Run the full quality gate and a manual add/edit/delete provider smoke test.
10. Write `PHASE_1_CLOSURE_REPORT.md`; leave connection testing disabled until
    Phase 2 unless a contract-only fake makes it useful.

## Blockers

There is no architecture blocker to Phase 0. Package installation requires
network access, and a true Electron window smoke test requires macOS GUI launch
permission. Neither affects writing the foundation; both are explicit
verification gates and must be reported if unavailable.
