# Agent runtime

Status: working locally, capability normalization needs hardening.

## Goal

Launch installed coding-agent CLIs without bundling a model or copying provider
credentials into BuilderHelm.

## V1 scope

- Detect compatible executables on the host PATH.
- Launch Claude Code, Codex, OpenCode, Grok, Gemini, Pi/OMP, plain shells, and custom commands.
- Record the exact executable, arguments, cwd, branch, worktree, start time, exit, and usage when available.
- Support interactive and structured/headless adapters where the provider exposes them.
- Stop the complete process tree and preserve the run record.

## Boundaries

- CLI availability and authentication are separate capabilities.
- Consumer subscriptions are not API credentials.
- Commands use fixed executables and validated argument arrays.
- Provider-specific parsing stays inside its adapter.
- A failed or exited pane is not reported as successful work.

## Acceptance

Each supported adapter launches, streams, receives instructions, exits cleanly,
reports unsupported capabilities honestly, and passes a real host smoke test.
