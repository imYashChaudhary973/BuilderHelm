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
- The renderer reads the matrix through one validated IPC call
  (`runtimes.capabilities()`); launch paths consume the same records in
  Phase 2, so the picker, the launcher, and the swarm gate cannot disagree.

## Current verification state

- Claude and Codex: orchestration-ready, proven by
  `packages/core/test/cli-real-smoke.test.ts` (run with
  `BUILDERHELM_CLI_SMOKE=1`).
- Gemini, OpenCode, and Kimi ACP invocations: structured-chat, verified
  locally against the installed CLIs (see the ACP registry notes).
- Every other detected runtime: `untested` by default, with the binary path
  and version attached. Untested is a waiting state, not a failure.

## Surfaces

- `packages/core/src/runtimes/runtime-capability-service.ts` owns probing and
  tier derivation; the desktop composes declarations from the board catalog
  and the ACP registry in
  `apps/desktop/src/main/runtime-capabilities.ts`.
- Renderer-visible via `window.builderHelm.runtimes.capabilities()`.
