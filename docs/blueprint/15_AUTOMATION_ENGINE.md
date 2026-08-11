# Automation Engine

## Goal

Turn repetitive routines into transparent, permissioned workflows without turning the app into an unpredictable autonomous system.

## Automation object

```ts
interface AutomationDefinition {
  id: string;
  name: string;
  enabled: boolean;
  trigger: TriggerDefinition;
  conditions: ConditionDefinition[];
  steps: WorkflowStep[];
  permissionPolicy: AutomationPermissionPolicy;
  retryPolicy: RetryPolicy;
  notificationPolicy: NotificationPolicy;
}
```

## Trigger types

### Time

- cron-like schedule;
- once at a date/time;
- interval;
- “morning briefing” configured by user.

### Event

- task completed;
- project status changed;
- source changed;
- Git commit observed;
- health sync completed;
- new research artifact;
- app startup.

### Condition

A scheduled evaluator checks a condition and acts only when true.

## V1 workflow step types

- `tool` — deterministic tool invocation;
- `agent` — bounded agent task;
- `condition` — branch;
- `transform` — map structured data;
- `notify` — local notification;
- `approval` — pause for user.

## Example — daily project briefing

```yaml
name: Daily Builder Brief
trigger:
  type: schedule
  at: '08:30'
steps:
  - tool: project.list_active
  - tool: task.list_due
  - tool: git.recent_activity
  - agent: daily_planner
  - tool: briefing.save
  - notify: 'Daily brief is ready'
```

## Example — coding session closeout

Trigger: coding task marked complete.

Steps:

1. gather diff/test results;
2. agent summarizes session;
3. append work-log event;
4. suggest content idea if there is a meaningful lesson;
5. do **not** auto-publish.

## Example — knowledge maintenance

Trigger: vault changes settle for N seconds.

Steps:

1. re-index changed notes only;
2. extract candidate entities/links;
3. Memory Curator evaluates duplicates/conflicts;
4. auto-accept only operational low-risk metadata;
5. queue ambiguous durable facts for review.

## Reliability

Each step must be idempotent or have an idempotency key. Runs store checkpoints so a crash does not restart irreversible steps blindly.

## Scheduler implementation

For local-first v1:

- SQLite tables for schedules and run state;
- one local scheduler process inside Core;
- wake/reconcile pending jobs on app startup;
- persist next-run times;
- use system notifications for completed/failed workflows.

Do not introduce Redis or a distributed workflow engine until the product actually needs multi-node execution.

## Approval in automations

A user can grant a narrow standing approval such as:

> This automation may create local tasks in Project X.

It must not silently generalize to:

> Any agent may create/delete anything anywhere.

## Failure behavior

- retry transient errors;
- stop on validation/security failures;
- never repeat an external side effect unless idempotency is guaranteed;
- show clear failed step and recovery action.
