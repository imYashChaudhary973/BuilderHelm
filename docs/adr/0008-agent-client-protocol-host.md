# ADR 0008: BuilderHelm is an Agent Client Protocol host

- Status: Accepted
- Date: 2026-09-04

## Context

Chat in BuilderHelm must let a person talk to a coding agent and have that agent
read and change their project. The models must be the ones the person already
pays for.

[ADR 0003](0003-model-gateway-boundary.md) already provides a provider-independent
model gateway, but it is built for a different relationship: BuilderHelm holds a
credential, resolves it, and calls a provider's HTTPS endpoint. That path bills
an API key. It cannot use a Claude, ChatGPT, or Google subscription, because
those are not API keys and the vendors do not expose them as such.

The agents people already have installed do have that access. Each one
authenticates itself and bills its own vendor relationship. Four of them speak
the Agent Client Protocol: JSON-RPC 2.0, newline-delimited, over the stdio of a
process the client spawns. Verified locally at `protocolVersion: 1` against
`gemini --acp` and `opencode acp`; `grok agent stdio` and Claude via
`@agentclientprotocol/claude-agent-acp` are the same protocol.

ACP already carries what a chat surface needs: streamed message and reasoning
chunks, tool calls whose content can be a diff, plans, token usage, a permission
request with allow-once and allow-always options, and model and reasoning-effort
selection through config options in the reserved `model` and `thought_level`
categories. It also inverts filesystem and terminal access: the **client** hosts
`fs/read_text_file`, `fs/write_text_file`, and `terminal/*`, and the agent asks.

There is also a licensing constraint. Vendors restrict third parties from
offering their consumer login or their subscription rate limits as a feature of
another product. Anthropic states this explicitly and has enforced it. The
restriction is on _offering and provisioning_ that access, not on a person
running their own installed binary with their own login.

## Decision

**BuilderHelm is a host for agents it does not own.** It speaks ACP as a generic
client and ships no vendor-specific integration.

1. **One protocol, no per-vendor code paths.** Support is ACP. An agent that
   does not speak ACP is not supported by the chat surface. Where a vendor also
   offers a richer native protocol, that is a later, additive decision recorded
   separately, never a second implementation of the same capability.
2. **The agent owns its runtime, authentication, model list, and billing.**
   BuilderHelm never reads, stores, forwards, or intermediates a provider
   credential. It never calls a provider's API. Sign-in happens inside the
   agent's own flow. Model and reasoning-effort choices are whatever the agent
   advertises over `session/set_config_option`; BuilderHelm curates no vendor's
   model lineup.
3. **The user supplies the agent.** BuilderHelm does not bundle, download, or
   auto-install any agent or adapter. An agent is a command on the user's
   machine plus arguments, recorded in settings. Detection may _offer_ a
   command it found on `PATH`; it never installs one.
4. **The child process inherits the environment verbatim.** BuilderHelm neither
   sets nor clears provider credential variables such as `ANTHROPIC_API_KEY`.
   Whichever authentication the user configured is the one that applies, and
   BuilderHelm does not steer usage toward a subscription or toward an API key.
   Where a config directory must be redirected for multi-account use, redirect
   the vendor's own config variable, never `HOME`, because relocating `HOME`
   moves the macOS keychain lookup and breaks the user's existing sign-in.
5. **BuilderHelm's subscription does not include model access.** It is priced
   for the workspace: terminals, editor, Git review, boards, retrieval, and
   orchestration. Billing, legal terms, retention, and data handling for an
   external agent are between the user and that agent's provider. This is
   stated in the product Terms, not only here.
6. **The workspace stays ours.** `fs/*` and `terminal/*` are answered by
   BuilderHelm against the user's real project, through the existing PTY and
   file services, under the existing approval rules. An agent gets no ambient
   filesystem authority.
7. **Every tool call that mutates or executes is approvable.** A
   `session/request_permission` is surfaced to the person, and their answer is
   returned. An agent that receives no answer must not proceed. Approval
   decisions are BuilderHelm's to persist, per workspace.

## Consequences

- Adding an agent is configuration, not code. The four verified agents and any
  future ACP agent arrive through the same path.
- The chat UI is agent-agnostic. Per-agent differences appear as capability
  flags from `initialize` and as config options, never as branches in a view.
- BuilderHelm cannot advertise any vendor's subscription as a BuilderHelm
  feature, and must not. That a person's own agent uses their own plan is a
  consequence of their configuration, and is described that way.
- Capability is uneven and must be surfaced honestly. Agents differ on session
  resume, on whether they offer `allow_always`, and on whether they advertise
  models at all. Missing capability is shown as missing, never emulated.
- ADR 0003 is unchanged and still governs API-key providers. The two paths stay
  separate: the model gateway resolves credentials and calls endpoints, the ACP
  host resolves no credentials and spawns a local process. Neither grows into
  the other.
- [ADR 0004](0004-canonical-chat-persistence.md) still owns chat history. An ACP
  session id is provider continuation metadata under that ADR, never canonical
  state, so a thread survives an agent being uninstalled.
- Spawning user-named commands is an execution boundary. It is confined to the
  main process, and the renderer can neither choose nor influence the argv.

## Replacement criteria

Replace this ADR if ACP stops being the common protocol among the agents
BuilderHelm supports, or if a vendor offers a first-party integration path whose
terms permit BuilderHelm to present that vendor's authentication or plan limits
as a product feature. Neither is true today.

## Current implementation

- Contract: `packages/protocol/src/agent-session.ts`.
- Verified against `gemini --acp` and `opencode acp` at `protocolVersion: 1`.
