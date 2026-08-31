# Development notes

Status: shipped in v1.

## Goal

Capture durable development context beside the project without replacing the
repository or Memory source of truth.

## V1 scope

- Rich Markdown editing with slash commands.
- Inline links to files, lines, branches, tasks, runs, tests, screenshots, and pull requests.
- Inline redacted log excerpts.
- Autosave, history, search, export, and explicit project association.
- Convert selected note items into Board tasks or agent feedback.

## Rules

- Notes never store provider credentials or raw authentication data.
- Linked artifacts remain addressable rather than copied without bounds.
- Agent-generated content is labelled and remains editable by the user.
- Deleting a task or run does not silently destroy a note.

## Acceptance

Notes survive restart, autosave does not lose concurrent edits, links resolve,
and sensitive logs are redacted before insertion.
