# Actions, Tools & Permission System

## Goal

Zero should be capable enough to act, but never rely on “the model seems trustworthy” as a security boundary.

## Tool contract

Every tool has:

- stable ID;
- human description;
- JSON/Zod input schema;
- output schema;
- risk level;
- required data scopes;
- timeout;
- idempotency behavior;
- rollback support;
- audit serializer.

Example:

```ts
const CreateTask = defineTool({
  id: 'task.create',
  risk: 'reversible_write',
  input: z.object({
    projectId: z.string(),
    title: z.string().min(1),
    dueAt: z.string().datetime().optional(),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
  }),
});
```

## Permission levels

### P0 — Read

Examples: search notes, read repo, list commits, view health aggregates.

Default: allowed after integration authorization.

### P1 — Draft / simulate

Examples: draft a post, propose a patch, prepare an email, build an automation preview.

Default: allowed.

### P2 — Reversible write

Examples: create a task, edit a local note, create a Git branch, update a project field.

Default: user can grant per-tool auto-approval.

### P3 — External side effect

Examples: send email, publish content, create remote issue, modify shared calendar.

Default: explicit confirmation unless the user has created a narrow automation rule for that exact action.

### P4 — Destructive / security-sensitive

Examples: delete repositories/files broadly, change credentials, install privileged software, modify security settings.

Default: confirmation every time; some actions should remain unavailable to agents.

### Permanently non-autonomous classes

Keep payments/transfers, credential disclosure, and similarly high-stakes transactions outside autonomous execution. Zero can organize information about them but should not make them “one voice command away.”

## Approval object

```ts
interface ApprovalRequest {
  id: string;
  toolId: string;
  summary: string;
  exactArguments: JsonValue;
  risk: PermissionLevel;
  affectedResources: ResourceRef[];
  reversible: boolean;
  expiresAt: string;
}
```

## Tool namespaces

### Knowledge

- `knowledge.search`
- `knowledge.open_source`
- `knowledge.create_note`
- `knowledge.link_entities`
- `memory.propose_fact`

### Tasks & projects

- `task.list`
- `task.create`
- `task.update`
- `project.get_status`
- `project.add_decision`

### Git/code

- `repo.search`
- `repo.read_file`
- `repo.apply_patch`
- `repo.git_diff`
- `repo.run_command`
- `repo.run_tests`
- `repo.create_worktree`

### Research/browser

- `web.search`
- `web.open`
- `browser.navigate`
- `browser.screenshot`
- `research.save_source`
- `research.save_claim`

### Content

- `content.create_idea`
- `content.create_draft`
- `content.create_variants`
- publishing tools disabled by default in v1.

### Health

- `health.query_daily`
- `health.query_trend`
- no diagnostic tool.

### System

- `automation.create_draft`
- `automation.enable`
- `notification.send_local`

## MCP

Treat MCP as the standard external tool bus where practical. Zero should be both:

- an MCP client capable of connecting to trusted servers;
- optionally an MCP server exposing selected Zero tools to other trusted AI clients.

Do not auto-trust tools discovered from a server. Store server identity, tool schemas, and permission policy separately.

## Prompt injection boundary

Content retrieved from websites, documents, repositories, or MCP tools is **data**, not authority. It must not be allowed to rewrite agent system rules or tool permissions.

Tool execution rules live outside the model prompt.

## Shell execution

Never expose a generic unrestricted shell tool directly to arbitrary agents. The coding executor should:

- run with workspace as cwd;
- reject `sudo` and privileged commands;
- enforce path rules;
- maintain command timeout;
- capture stdout/stderr;
- require approval for risky command classes;
- support an optional container sandbox;
- create a checkpoint before large changes.

## Action receipts

Every write or external action produces an immutable audit event with the before/after state where feasible.
