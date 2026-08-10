# ADR 0003: Provider-independent model gateway

- Status: Accepted
- Date: 2026-08-09

## Context

Phase 2 adds multiple model providers without allowing SDK-specific objects,
conversation identifiers, errors, or streaming formats to leak into domain code.
The gateway also becomes the last policy boundary before a credential is
resolved and sent to a configured endpoint.

## Decision

1. Define messages, content parts, model requests, responses, tool calls, token
   usage, capabilities, finish reasons, and stream events in `@zero/protocol`.
2. Terminate all provider wire formats inside `@zero/model-gateway` adapters.
3. Keep canonical conversation messages provider-independent. Provider response
   IDs are optional continuation metadata and never replace canonical messages.
4. Check provider enablement, data-classification policy, and model capabilities
   before resolving a credential.
5. Permit credentials only over HTTPS or HTTP loopback URLs. This supports local
   Ollama-compatible servers without allowing cleartext credential transport to
   remote hosts.
6. Normalize provider failures into stable `ZeroError` codes without retaining
   response bodies that may contain sensitive data.
7. Use dependency-injected `fetch` implementations and fixtures for adapter
   contract tests. Normal CI does not require a paid provider call.
8. Use OpenAI's Responses API with `store: false` for the native OpenAI adapter.
   Zero remains the owner of canonical conversation state.
9. Use Anthropic's native Messages API with explicit API versioning, bounded
   cursor-based discovery, and canonical message-role translation. Use model
   capabilities returned by the provider and default missing fields to false.

## Consequences

- Chat, agents, and persistence can switch providers without rewriting domain
  objects.
- Privacy and capability failures occur before network access or secret lookup.
- Adapter tests can verify request, response, and stream mappings deterministically.
- Model discovery remains conservative until known metadata packs, probes, or
  manual capability overrides provide stronger evidence.
- Anthropic thinking blocks remain outside canonical chat output; only normalized
  token counts are retained for reasoning usage.
