# Data Model

## Storage strategy

Use SQLite for operational data. Keep source-owned files (Obsidian and repositories) in place and reference them by stable source IDs.

## Core tables

### Configuration

```text
providers
models
model_capabilities
model_policies
settings
integration_connections
sync_cursors
```

### Conversation

```text
conversations
messages
message_attachments
model_invocations
tool_calls
tool_results
citations
```

### Agents

```text
agent_definitions
agent_runs
agent_steps
agent_handoffs
agent_evaluations
```

### Knowledge

```text
sources
documents
chunks
embeddings
entities
entity_aliases
entity_edges
facts
fact_sources
episodic_events
```

### Work

```text
projects
project_sources
repositories
tasks
milestones
blockers
decisions
work_sessions
```

### Automation

```text
automations
triggers
workflow_steps
automation_runs
automation_step_runs
```

### Health

```text
health_metric_types
health_daily_aggregates
health_workouts
health_sync_runs
```

### Content

```text
content_ideas
content_sources
content_drafts
content_variants
content_reviews
```

### Security/audit

```text
permission_policies
approval_requests
audit_events
secret_metadata
```

The `secret_metadata` table stores only provider/integration name, keychain item identifier, creation time, and last-used time — never secret values.

## Selected schema details

### `sources`

```sql
id TEXT PRIMARY KEY,
type TEXT NOT NULL,
uri TEXT NOT NULL,
title TEXT,
content_hash TEXT,
created_at TEXT,
updated_at TEXT,
classification TEXT NOT NULL,
metadata_json TEXT NOT NULL
```

### `chunks`

```sql
id TEXT PRIMARY KEY,
source_id TEXT NOT NULL,
ordinal INTEGER NOT NULL,
heading TEXT,
text TEXT NOT NULL,
token_count INTEGER,
start_offset INTEGER,
end_offset INTEGER,
content_hash TEXT NOT NULL
```

### `entities`

```sql
id TEXT PRIMARY KEY,
type TEXT NOT NULL,
canonical_name TEXT NOT NULL,
summary TEXT,
status TEXT NOT NULL,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL
```

### `entity_edges`

```sql
id TEXT PRIMARY KEY,
from_entity_id TEXT NOT NULL,
to_entity_id TEXT NOT NULL,
relation TEXT NOT NULL,
source_id TEXT,
confidence REAL NOT NULL,
valid_from TEXT,
valid_to TEXT
```

### `tasks`

```sql
id TEXT PRIMARY KEY,
project_id TEXT,
title TEXT NOT NULL,
description TEXT,
status TEXT NOT NULL,
priority TEXT NOT NULL,
due_at TEXT,
source TEXT NOT NULL,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL
```

### `model_invocations`

```sql
id TEXT PRIMARY KEY,
conversation_id TEXT,
agent_run_id TEXT,
provider_id TEXT NOT NULL,
model_ref TEXT NOT NULL,
started_at TEXT NOT NULL,
ended_at TEXT,
input_tokens INTEGER,
output_tokens INTEGER,
cached_tokens INTEGER,
estimated_cost REAL,
status TEXT NOT NULL,
error_code TEXT
```

### `audit_events`

```sql
id TEXT PRIMARY KEY,
event_type TEXT NOT NULL,
actor_type TEXT NOT NULL,
actor_id TEXT,
risk_level TEXT,
resource_refs_json TEXT,
before_json TEXT,
after_json TEXT,
approval_id TEXT,
created_at TEXT NOT NULL
```

## IDs

Use UUIDv7/ULID-style sortable IDs for local records. Do not use provider-generated IDs as primary keys.

## Time

Store UTC timestamps and retain source timezone when meaningful. UI renders in local timezone.

## Migrations

- schema migrations committed to repo;
- forward-only in normal builds;
- migration backup before destructive migration;
- startup health check.
