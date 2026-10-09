# Runtime capabilities

One honest record per installed coding agent: what is on this machine, how
BuilderHelm can launch it, and how much of that has been verified. The matrix
answers "can I run this?" without ever dressing an untested runtime as a
working one.

## Contract

- BuilderHelm never installs an agent (ADR 0008). Detection only _offers_
  commands found on `PATH`; the person decides.
- Each runtime carries one support tier:
  - `unavailable` — the command does not resolve on this machine.
  - `untested` — present, but no BuilderHelm-checked path has exercised it.
  - `terminal` — verified as an interactive PTY pane.
  - `structured-chat` — verified through ACP structured chat.
  - `orchestration-ready` — verified headless with schema output, resume, and
    usage reporting; the Swarm eligibility bar.
- Versions are probed from the binary itself (`--version`, `-v`, `version`);
  a binary that answers nothing is still present, just versionless.
- Verification evidence lives in code next to the transport it verifies (the
  gated real-CLI smoke, locally verified ACP invocations). A tier rises only
  when that evidence exists — never because an advert or a config file says so.
- A configured command that has disappeared stays visible as `unavailable`;
  it is never silently dropped.
- Each transport's executable resolves independently. Installing `claude` or
  `codex` does not establish the presence of `claude-agent-acp` or `codex-acp`.
  Only available transports contribute to the support tier. The reported binary
  path and version belong to the first available transport declaration.
- Agents profile setup and the shared Agents/Chats composer explain missing ACP
  adapters and direct installed terminal-only agents to Code. BuilderHelm does
  not download an adapter automatically.
- The renderer reads the matrix through one validated IPC call
  (`runtimes.capabilities()`); launch paths consume the same records in
  Phase 2, so the picker, the launcher, and the swarm gate cannot disagree.

## Current verification state

The command forms below record earlier verification, not an inventory of every
current host. On the Oct 9 reliability pass, Claude and Codex headless output
passed again; their ACP adapters were absent. OpenCode's installed ACP path
passed profile-instruction and model-continuity checks with two short free-model
turns (`BUILDERHELM_AGENT_CONTEXT_SMOKE=1`). Availability is always detected
again from the host's current PATH.

- Claude and Codex headless json-schema: orchestration-ready, proven by
  `packages/core/test/cli-real-smoke.test.ts` (`BUILDERHELM_CLI_SMOKE=1`).
- ACP initialize (no prompt): Gemini, OpenCode, Kimi, Grok, Codex (`codex-acp`
  1.10.0), Oh My Pi (`omp acp` 18.1.14). See
  [runtime-matrix.md](runtime-matrix.md).
- Claude ACP wrapper `claude-agent-acp`: unavailable here. Structured path is
  the CLI json-schema adapter, not ACP.
- Copilot: not installed; no ACP argv. Cursor 3.19.13: editor binary, no ACP.
- Pi: terminal/PTY first. `--mode rpc` untested. Codex `app-server` is
  quota-only and does not replace `codex-acp`.
- Every other detected runtime: `untested`, with path and version attached.

## Surfaces

- `packages/core/src/runtimes/runtime-capability-service.ts` owns probing and
  tier derivation; the desktop composes declarations from the board catalog
  and the ACP registry in
  `apps/desktop/src/main/runtime-capabilities.ts`.
- Renderer-visible via `window.builderHelm.runtimes.capabilities()`.
