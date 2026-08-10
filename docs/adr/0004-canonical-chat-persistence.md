# ADR 0004: Canonical chat persistence

- Status: Accepted
- Date: 2026-08-10

## Context

Phase 2 needs chat history that survives application restarts and model or
provider switches. Provider catalogs are mutable and can be replaced during
discovery, so canonical history cannot depend on catalog rows remaining present.

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
- A later streamed-chat slice can rebuild provider requests from Zero-owned
  canonical history and select a different model for each turn.
- Provider-specific response objects, credentials, and wire payloads do not
  become canonical state.
- Completed assistant turns and their usage records are written atomically.
- Streaming partial-response checkpoints remain deferred to the streamed-chat
  slice.
