# Phase 2 progress report

- Date: 2026-08-10
- Branch: `phase-2/model-gateway-chat`
- Status: In progress

## Completed checkpoints

### Normalized model gateway

- Added provider-independent messages, requests, responses, stream events,
  capabilities, usage, tool calls, finish reasons, and error contracts.
- Added the model gateway policy boundary with provider enablement, data
  classification, model capability, cancellation, and secure-transport checks.
- Added the native OpenAI Responses adapter with `store: false`, streaming,
  model discovery, connection testing, and status-only error normalization.
- Committed and pushed as `83658b9`.

### Desktop connection and discovery slice

- Added transactional persistence for discovered model catalogs and normalized
  capabilities using the existing Phase 1 schema.
- Composed the gateway into the core without exposing credentials or provider
  wire types to the renderer.
- Added fixed, schema-validated APIs for testing a saved OpenAI connection,
  discovering models, and listing stored models.
- Added renderer-safe result envelopes so unexpected main-process failures do
  not expose stack traces, paths, provider bodies, or other internal details.
- Enabled connection testing and model discovery in Models & Providers. The UI
  labels catalogs as last-discovered state and keeps later protocol adapters
  visibly unavailable.
- Added a 15-second provider request deadline and bounded discovery responses to
  10,000 models.

## Security invariants retained

- Provider credentials remain in macOS Keychain and are resolved only after the
  provider, protocol, enabled state, and transport policy pass validation.
- Remote credentials require HTTPS; cleartext HTTP remains limited to loopback.
- SQLite, logs, IPC responses, renderer state, and persisted model metadata do
  not contain credential values.
- Failed discovery preserves the previously stored catalog transactionally.
- Unknown main-process errors are reduced to a stable generic IPC failure.

## Verification

| Gate | Result |
| --- | --- |
| `pnpm format:check` | Passed |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed: 19 files, 62 tests |
| `pnpm build` | Passed |
| `pnpm smoke:desktop` | Passed |
| Built preload Node-primitive scan | Passed: no `node:crypto` import |
| `pnpm audit --prod` | Passed: no known vulnerabilities |

Provider network behavior is covered with deterministic fetch fixtures. No paid
provider request or real provider credential was used for this checkpoint.

## Remaining Phase 2 work

1. Persist canonical chat threads, turns, and usage records.
2. Add a minimal streamed chat UI using the stored OpenAI model catalog.
3. Support model switching per turn while keeping Zero-owned canonical history.
4. Add Anthropic, generic OpenAI-compatible, and Ollama adapters.
5. Add capability metadata packs/manual overrides and finish the Phase 2
   closure gate.
