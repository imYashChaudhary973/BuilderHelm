# Editor

Status: basic workspace editor working.

## Goal

Inspect and make focused project edits without leaving the active workspace.

## V1 scope

- Workspace-scoped file tree shown first; the editor opens when a file is chosen.
- Text and Markdown editing.
- Save, save all, autosave, word wrap, dirty indicators, and external-change detection.
- Read-only previews for images, PDFs, and repository documentation.
- Diff-aware navigation from agents, Git, tests, notes, and review comments.

## Rules

- Canonicalize every path and enforce the workspace root.
- Reject binary writes and symlink escapes unless an explicit safe workflow owns them.
- Detect write conflicts instead of silently overwriting external changes.
- Large files use bounded previews.

## Acceptance

Common text files open, edit, save, and reload correctly; dirty state survives
navigation; external changes are surfaced; traversal and overwrite regressions
have focused tests.
