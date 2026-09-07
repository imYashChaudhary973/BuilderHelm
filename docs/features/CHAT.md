# Chat

Status: on `main`. Hosts installed ACP agents. The previous API-key gateway
remains in process; the Chat tab no longer calls it. The Agents mode hosts the
same pane per named profile — see [Agents roster](AGENTS.md) for that
contract.

## Goal

Talk to a coding agent the person already has installed, against a real project
folder, without BuilderHelm holding a provider credential.

## V1 scope

- Detect ACP agents on PATH; never install one.
- Start a session, stream a turn, cancel it.
- Persist threads locally. ACP session ids are continuation metadata.
- Resume via `session/load` when the agent offers it; otherwise history is ours
  and the agent starts fresh.
- Surface permission requests. Remember allow-always / reject-always per
  workspace and tool kind.
- Show diffs from tool calls. Apply writes new text; revert writes the recorded
  original. Revert is unavailable when the agent omitted `oldText`.
- Render the agent's own model / thought-level config options.
- Show auth-required with the methods the agent advertised. Sign-in stays in
  the agent's own flow.

## Boundaries

- BuilderHelm does not bill model usage.
- The renderer cannot choose argv. Configured command + args run in main.
- File access is confined to the session cwd.
- Unanswered permission requests fail closed after ten minutes.

## Acceptance

Permission rules and thread persistence are covered by unit tests. Handshake,
streaming, and inverted `fs` access are covered by the optional live test
(`BUILDERHELM_ACP_LIVE`). The Chat tab has not been clicked through a packaged
build.
