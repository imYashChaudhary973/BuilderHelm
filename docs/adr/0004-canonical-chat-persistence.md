# ADR 0004: Canonical chat persistence

- Status: Accepted
- Date: 2026-08-10
- Reaffirmed: 2026-08-28 under the BuilderHelm product name.

## Context

Chat history must survive application restarts and model or provider switches.
Provider catalogs are mutable and can be replaced during discovery, so canonical
history cannot depend on catalog rows remaining present.

## Decision

Store provider-independent chat state in three SQLite tables:

- `chat_threads` owns thread identity and display metadata;
- `chat_turns` stores ordered canonical content and the model snapshot used for
  each completed assistant turn;
- `chat_usage` stores normalized token usage transactionally with its assistant
  turn.

Provider continuation IDs remain optional optimization metadata. Model and
provider references in history are snapshots, not foreign keys to the mutable
provider catalog. Turn content and metadata cross strict Zod and SQLite JSON
validation boundaries before persistence.

## Consequences

- Threads survive provider deletion and model rediscovery.
- Streamed chat rebuilds provider requests from BuilderHelm-owned canonical
  history and can select a different model for each turn.
- Provider-specific response objects, credentials, and wire payloads do not
  become canonical state.
- Completed assistant turns and their usage records are written atomically.
- A non-empty partial response is persisted when a stream is cancelled or fails.
  Incremental checkpointing during a live stream remains out of scope.

## Current implementation

- Introduced by migration 3, `chat-persistence`.
- Enforced by `packages/db/test/chat-repository.test.ts` and
  `packages/core/test/chat-stream-service.test.ts`.
