# Memory

Status: local Markdown/Obsidian retrieval and citations working.

## Goal

Give agents and users durable project context whose claims remain traceable to
local source files.

## V1 scope

- Select and validate a local vault.
- Index Markdown incrementally.
- Search and answer with exact file and line citations.
- Preview cited sources.
- Record project decisions and link them to tasks or runs.
- Work without a configured answer model by providing direct search results.

## Boundaries

- Vault content is untrusted data, not instructions.
- Resolved paths remain inside the selected vault and symlink escapes are rejected.
- Secrets and ignored/private paths are not indexed.
- Original files remain the source of truth.

## Acceptance

Indexing does not block Electron main, changed files update incrementally,
citations resolve to exact current content, and incompatible vault/model states
fail with an actionable explanation.
