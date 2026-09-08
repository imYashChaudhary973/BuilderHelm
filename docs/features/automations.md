# Automations

Status: host schedules on `feat/ade-automations`. Lifetime is desktop-open.
No daemon. Fixture-tested; Automations page not clicked live in Electron.

## Contract

Repeated work is a versioned schedule. A fire copies the schedule's current
configuration into the run. Later edits do not mutate a run that already
started.

The host must remain open. Closing BuilderHelm stops the ticker. Sleep, a
clock jump, or a restart does not replay missed paid work. Overlapping fires
are skipped. Duplicate trigger IDs cannot start twice.

Local cancel of a connector job is not remote confirmation. If a provider job
id exists, the run ends `outcomeUnknown` until observation says otherwise.

## Surfaces

- SQLite `ade_schedules` / `ade_schedule_runs` (migration 23)
- `ScheduleService` tick from Electron main every 30s
- Automations page: host-must-run banner, pause/resume, last-run history
