# Agent runtime

Status: working locally on macOS with normalized capability metadata.

## Goal

Launch installed coding-agent CLIs without bundling a model or copying provider
credentials into BuilderHelm.

## V1 scope

- Detect compatible executables on the host PATH.
- Launch Claude Code, Codex, OpenCode, Grok, Gemini, Pi/OMP, plain shells, and custom commands.
- Record the exact executable, arguments, cwd, branch, worktree, start time, exit, and usage when available.
- Support interactive and structured/headless adapters where the provider exposes them.
- Stop the complete process tree and preserve the run record.

## Capability model

Every catalogued CLI publishes one immutable record covering interactive and
headless support, structured-output level, session resume, usage reporting, and
supported Swarm permission modes. Detection adds only host availability and the
resolved executable path; it does not mistake installation for authentication.

Runtime behavior stays out of the protocol. Core adapters own fixed argument
arrays, schema-constrained output parsing, and provider usage parsing. Claude,
Codex, and Grok advertise JSON Schema output; Codex uses its schema and final
message files behind the same planner interface used by inline-schema CLIs.

## Boundaries

- CLI availability and authentication are separate capabilities.
- Consumer subscriptions are not API credentials.
- Commands use fixed executables and validated argument arrays.
- Provider-specific parsing stays inside its adapter.
- A failed or exited pane is not reported as successful work.

## Acceptance

Each supported adapter launches, streams, receives instructions, exits cleanly,
reports unsupported capabilities honestly, and passes a real host smoke test.
