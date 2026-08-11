# Evals, Testing & Observability

## Why this matters

A personal agent OS can look impressive while being unreliable. Build an eval suite from the beginning so model swaps do not silently break behavior.

## Test pyramid

### Unit tests

- parsers;
- provider normalization;
- capability resolver;
- permission engine;
- path sandbox;
- ranking functions;
- schemas;
- date parsing;
- cost calculations.

### Integration tests

- SQLite migrations;
- Obsidian indexing;
- provider mocks;
- local Git tools;
- agent → tool loop;
- automation retries;
- approval flow.

### End-to-end

- open app;
- connect test vault;
- ask cited question;
- create task;
- run coding patch in fixture repository;
- approve action;
- inspect audit receipt.

## Model-independent agent evals

Create a dataset of canonical tasks with objective checks.

### Retrieval eval

Prompt: “What was decided about feature X?”

Checks:

- correct source retrieved;
- answer does not fabricate;
- citation resolves;
- conflicting note handled correctly.

### Task action eval

Prompt: “Add a high-priority task to Project A for tomorrow.”

Checks:

- correct project;
- correct date;
- correct priority;
- one task created;
- action receipt exists.

### Coding eval

Fixture repo with known failing test.

Checks:

- patch scope;
- tests pass;
- no unrelated modifications;
- diff is valid;
- prohibited commands not used.

### Research eval

Checks:

- sources are relevant;
- dates captured;
- claims linked to sources;
- contradictory evidence surfaced;
- recommendation distinguishes evidence vs inference.

## Provider compatibility suite

Run against every configured model to discover:

- streaming behavior;
- tool calling;
- parallel tool calls;
- JSON/structured output;
- image handling;
- reasoning field behavior;
- max practical context;
- cancellation;
- error normalization.

Cache capability results with version/timestamp.

## Tracing

Every agent run gets a trace tree:

```text
agent.run
  context.build
    retrieval.lexical
    retrieval.vector
    retrieval.graph
  model.invoke
  tool.call
    permission.check
    execution
  model.invoke
  result.finalize
```

## Metrics

Track locally:

### Reliability

- task success rate;
- tool failure rate;
- retry rate;
- approval rejection rate;
- rollback rate.

### Retrieval

- no-result rate;
- source click-through;
- citation correction rate.

### Models

- latency;
- tokens;
- cost;
- model fallback rate;
- context length;
- tool-call schema errors.

### Coding

- tests-pass rate;
- iterations per task;
- files changed;
- rollback rate.

## Privacy-preserving telemetry

Default operational telemetry to local. If external product analytics are later added, make them explicit, minimal, and never include prompt/body/source content by default.
