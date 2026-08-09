# Internal API & Event Contracts

## IPC boundary

The renderer communicates with privileged code through a narrow preload API.

Example:

```ts
interface ZeroDesktopApi {
  chat: {
    send(input: SendMessageInput): Promise<void>;
    cancel(runId: string): Promise<void>;
  };
  projects: {
    list(): Promise<ProjectSummary[]>;
  };
  tools: {
    approve(id: string): Promise<void>;
    reject(id: string): Promise<void>;
  };
}
```

Do not expose raw `ipcRenderer` or filesystem primitives to the page.

## Runtime event envelope

```ts
interface ZeroEvent<T = JsonValue> {
  id: string;
  type: string;
  occurredAt: string;
  actor?: ActorRef;
  correlationId?: string;
  causationId?: string;
  payload: T;
}
```

## Important events

### Knowledge

- `source.discovered`
- `source.changed`
- `source.deleted`
- `index.completed`
- `fact.candidate_created`
- `fact.accepted`

### Projects

- `project.activated`
- `task.created`
- `task.completed`
- `decision.created`
- `repo.commit_observed`

### Agents

- `agent.run_started`
- `agent.step_started`
- `agent.tool_requested`
- `agent.run_completed`
- `agent.run_failed`

### Permissions

- `approval.requested`
- `approval.granted`
- `approval.denied`

### Health

- `health.sync_completed`
- `health.daily_updated`

### Automations

- `automation.triggered`
- `automation.completed`
- `automation.failed`

## Streaming chat protocol

Normalize streaming events:

```ts
type ChatStreamEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'reasoning.summary'; text: string }
  | { type: 'tool.proposed'; call: ToolCall }
  | { type: 'tool.result'; result: ToolResult }
  | { type: 'citation.added'; citation: Citation }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; finishReason: string }
  | { type: 'error'; error: ZeroError };
```

## Error taxonomy

Normalize provider/tool errors into stable categories:

- `AUTH_FAILED`
- `RATE_LIMITED`
- `MODEL_UNAVAILABLE`
- `MODEL_CAPABILITY_MISMATCH`
- `CONTEXT_TOO_LARGE`
- `TOOL_SCHEMA_INVALID`
- `TOOL_EXECUTION_FAILED`
- `PERMISSION_DENIED`
- `INTEGRATION_OFFLINE`
- `INDEX_STALE`
- `CANCELLED`

The UI can then provide useful recovery independent of provider.
