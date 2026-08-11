# Phase 2 progress report

- Date: 2026-08-10
- Branch: `phase-2/model-gateway-chat`
- Status: Implemented and verified on the Phase 2 branch

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
- Added fixed, schema-validated APIs for testing saved provider connections,
  discovering models, and listing stored models.
- Added renderer-safe result envelopes so unexpected main-process failures do
  not expose stack traces, paths, provider bodies, or other internal details.
- Enabled connection testing and model discovery in Models & Providers. The UI
  labels catalogs as last-discovered state and keeps unsupported protocol adapters
  visibly unavailable.
- Added a 15-second provider request deadline and bounded discovery responses to
  10,000 models.

### Canonical chat persistence

- Added strict provider-independent contracts for chat threads, ordered turns,
  optional provider continuation metadata, and normalized token usage.
- Added migration 3 with `chat_threads`, `chat_turns`, and `chat_usage` tables.
- Added atomic turn-and-usage persistence and restart-safe transcript loading.
- Snapshotted model references without foreign-keying history to the mutable
  provider catalog, so model refreshes and provider deletion cannot erase chat
  history.
- Added a core chat service that validates complete turns before writing and
  logs identifiers only, never message content or opaque continuation values.

### Streamed, multi-model chat

- Added a desktop chat route backed by canonical persisted threads and turns.
- Streams normalized text, tool proposals, usage, completion, and errors across
  a fixed main/preload/renderer boundary.
- Supports choosing a discovered streaming model per turn while retaining the
  exact model reference on each saved assistant turn.
- Supports cancellation through `AbortSignal`; partial cancelled responses are
  retained locally with an explicit cancelled finish reason.
- Committed and pushed as `d631994`.

### Native Anthropic Messages adapter

- Added native Anthropic Messages request and response translation, including
  top-level system content, user/assistant role conversion, client tools,
  structured output, effort controls, token usage, and finish reasons.
- Added SSE normalization for text, partial tool JSON, cumulative usage,
  completion, cancellation, early termination, and sanitized stream failures.
- Added bounded, cursor-based model discovery using Anthropic's returned labels,
  limits, and capability metadata without guessing unsupported capabilities.
- Enabled Anthropic connection testing and discovery in Models & Providers.
- Uses the native `x-api-key` and pinned `anthropic-version` headers without
  exposing the credential to SQLite, logs, IPC, or renderer state.

### Generic OpenAI-compatible and Ollama adapters

- Added a generic OpenAI-compatible Chat Completions adapter with explicit base
  URL routing, request normalization, SSE streaming, accumulated tool calls,
  normalized usage, model discovery, and fail-closed early termination.
- Added a native Ollama adapter for `/api/chat` and `/api/tags`, including NDJSON
  streaming, structured output, tool calls, thinking controls, local model
  discovery, and optional authorization for non-local deployments.
- Local Ollama defaults to `http://127.0.0.1:11434` and does not invent an
  authorization header when no token is configured.
- Enabled testing and discovery for both protocols in Models & Providers.

### Persisted capability overrides

- Added migration 4 for per-provider, per-model capability overrides that
  survive model catalog replacement.
- Preserves the latest provider-discovered capability baseline separately from
  manual differences, so resetting restores discovery rather than stale values.
- Added strict core, IPC, preload, and renderer contracts for all normalized
  boolean and token-limit capabilities.
- Added desktop controls with Auto, On, and Off states plus explicit reset.
- Capability changes and resets are appended to the existing audit log without
  storing credentials or message content.

### Dependency security

- Upgraded Electron to a patched release after the Phase 2 security gate found
  a production advisory.
- Committed and pushed as `a056060`.

## Security invariants retained

- Provider credentials remain in macOS Keychain and are resolved only after the
  provider, protocol, enabled state, and transport policy pass validation.
- Remote credentials require HTTPS; cleartext HTTP remains limited to loopback.
- SQLite, logs, IPC responses, renderer state, and persisted model metadata do
  not contain credential values.
- Failed discovery preserves the previously stored catalog transactionally.
- Unknown main-process errors are reduced to a stable generic IPC failure.

## Verification

| Gate                              | Result                           |
| --------------------------------- | -------------------------------- |
| `pnpm format:check`               | Passed                           |
| `pnpm lint`                       | Passed                           |
| `pnpm typecheck`                  | Passed                           |
| `pnpm test`                       | Passed: 27 files, 97 tests       |
| `pnpm build`                      | Passed                           |
| `pnpm smoke:desktop`              | Passed                           |
| Built preload Node-primitive scan | Passed: no `node:crypto` import  |
| `pnpm audit --prod`               | Passed: no known vulnerabilities |

Provider network behavior is covered with deterministic fetch fixtures. No paid
provider request or real provider credential was used for this checkpoint.

## Remaining delivery gates

1. Push this completed checkpoint and confirm pull-request CI.
2. Obtain human review before merge; merge remains a separate authorization.
