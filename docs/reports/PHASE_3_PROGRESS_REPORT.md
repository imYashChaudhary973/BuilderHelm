# Phase 3 progress report

- Date: 2026-08-10
- Branch: `phase-3/obsidian-memory`
- Status: Implemented, verified, and published for review

## Completed checkpoints

### Read-only Obsidian vault registration

- Added a trusted Electron folder picker; renderer requests cannot supply a vault
  path.
- Requires the selected directory to contain `.obsidian` and stores its canonical
  real path only in the main-process database boundary.
- Recursively indexes Markdown while excluding Obsidian configuration, trash,
  Git metadata, dependencies, oversized notes, binary content, and symlinks.
- Enforces canonical root containment again when a cited source is opened.

### Markdown knowledge index

- Added migration 5 for vaults, stable sources, chunks, FTS5 text search, links,
  and basic note entities.
- Parses bounded frontmatter properties, headings, body and frontmatter tags,
  wikilinks, Markdown note links, and exact source line ranges.
- Uses content hashes for incremental database replacement, retaining stable source
  IDs for changed notes and removing deleted notes transactionally.
- Added a provider interface for future embeddings without making Phase 3 depend on
  an embedding model or external service.

### Reliable vault change detection

- Added one bounded metadata-polling timer per registered vault to detect Markdown
  additions, changes, and deletions.
- Avoids recursive OS watchers, which exceeded file-descriptor limits in the macOS
  test environment.
- Reuses the same size, note-count, symlink, and directory exclusion rules as the
  indexer and keeps the last valid index if a refresh fails.

### Retrieval and cited answers

- Added local FTS5 retrieval with linked-note graph expansion.
- Sends only bounded retrieved context to the selected text-streaming model and
  treats currently unclassified vault context as personal, sensitive, and health
  data at the provider policy gate. Local models remain available; remote models
  require explicit opt-in for every restricted class.
- Treats note content as untrusted data and does not expose tools or execute note
  instructions during answer generation.
- Rejects model citation labels that do not resolve to retrieved sources and adds
  source labels when the model omits them.
- Returns stable source and chunk IDs with note path, heading, exact line range, and
  excerpt for every citation.
- Fails closed if the underlying note changes before a citation is opened.

### Desktop knowledge flow

- Enabled the Knowledge route and vault/model selection UI.
- Added manual index refresh, cited question answering, citation cards, and an exact
  source viewer with line numbers, highlighting, and automatic scrolling.
- Added clear empty, unavailable-model, refresh, stale-source, and request failure
  states.

## Security invariants retained

- Vault roots and arbitrary note paths never cross the renderer-controlled IPC
  boundary.
- SQL inputs remain parameterized, including FTS query values and graph lookups.
- Symlinks and canonical path escapes are excluded; vault reads are Markdown-only
  and bounded to 2,000,000 bytes per note and 10,000 notes per vault.
- Note bodies and user questions are not written to application logs.
- Unknown main-process errors remain sanitized before reaching the renderer.
- No credentials are added to source, SQLite, logs, IPC payloads, or renderer state.
- The model gateway never permits content classified as `secret` to enter a model
  prompt, including local-model prompts.

## Verification

| Gate                                            | Result                               |
| ----------------------------------------------- | ------------------------------------ |
| `corepack pnpm format:check`                    | Passed                               |
| `corepack pnpm lint`                            | Passed                               |
| `corepack pnpm typecheck`                       | Passed                               |
| `corepack pnpm test`                            | Passed: 32 files, 112 tests          |
| `corepack pnpm --filter @zero/desktop build`    | Passed                               |
| `corepack pnpm --filter @zero/desktop smoke`    | Passed                               |
| `corepack pnpm audit --prod --audit-level high` | Passed: no known vulnerabilities     |
| Changed-file secret and dangerous-sink scan     | Passed: no credential material found |

The end-to-end cited-answer test uses a temporary fixture vault and deterministic
model stream. It proves selection, parsing, persistence, lexical and graph retrieval,
answer generation, citation resolution, stale-source rejection, and watcher-driven
add/change/delete indexing without sending personal notes to a paid provider.

## Delivery status

- Committed as `0aaecc9` and pushed to
  `origin/phase-3/obsidian-memory`.
- Published as [draft PR #2](https://github.com/imYashChaudhary973/Axiom-Zero/pull/2),
  stacked on `phase-2/model-gateway-chat`.
- Pull-request CI passed and GitHub reports the PR as mergeable.
- Manual acceptance used an isolated two-note test vault and a configured local
  model. The Knowledge screen indexed both notes, returned a grounded answer with
  two citations, and opened the exact cited source lines.

## Remaining delivery gates

1. Obtain human review and mark draft PR #2 ready after its Phase 2 base is
   accepted.
2. Merge in stack order after PR #1: Phase 2 (#1), then Phase 3 (#2).
3. A real-vault exercise remains optional because deterministic acceptance and the
   isolated local-model UI flow already cover the Phase 3 exit criteria.
