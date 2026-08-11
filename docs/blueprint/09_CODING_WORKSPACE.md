# Coding Workspace — Multi-Model Codex-Style Harness

## Goal

Provide a first-class coding environment where the user can use **any compatible configured model** instead of being locked into one vendor.

## Core layout

### Left rail

- repositories/workspaces;
- agent tasks;
- changed files;
- branches/worktrees.

### Main area

Tabs for:

- agent conversation;
- code file;
- diff;
- plan;
- test output;
- browser preview.

### Bottom panel

- terminal;
- problems;
- logs;
- agent trace.

### Top toolbar

- model selector;
- reasoning mode;
- context usage;
- cost/session;
- permissions;
- run/stop.

## Agent loop

```text
Understand task
  -> inspect repository
  -> identify files/tests
  -> propose concise plan
  -> create checkpoint
  -> apply patch
  -> run formatter/linter/tests
  -> inspect failures
  -> iterate within limits
  -> present final diff + verification
```

## Repository context

Index locally:

- file tree;
- language/type;
- symbols;
- imports;
- references;
- README/docs;
- Git history;
- project configuration;
- tests.

Use ripgrep/lexical search first. Embeddings are useful for natural-language concept search but should not replace exact code search.

## Structured editing

Prefer patch operations over “rewrite whole file.”

Tool examples:

```ts
readFile(path, range?)
searchText(query, glob?)
listDirectory(path)
applyPatch(unifiedDiff)
createFile(path, content)
deleteFile(path) // confirmation depending on scope
runCommand(command, cwd)
gitDiff()
```

## Context assembly

A coding request context can include:

- user task;
- repository rules (`AGENTS.md`, project docs);
- relevant file excerpts;
- recent diff;
- test failure output;
- dependency docs;
- previous task decisions.

Do not send the entire repository unless the model and task truly require it.

## Model switching

The coding thread remains stable while models change.

Example workflow:

- cheap/local model: explore repository and find files;
- strong coding model: implement patch;
- different model: independent review;
- local model: summarize changes into work log.

Every turn records its model.

## Model-specific compatibility

Some reasoning models require provider-specific fields to be replayed across tool turns. The model gateway must preserve normalized and provider-specific continuation metadata where needed instead of assuming every “OpenAI-compatible” model behaves identically.

## Parallel agents

Use Git worktrees for isolated parallel tasks:

```text
main workspace
  ├─ worktree/task-a
  ├─ worktree/task-b
  └─ worktree/review
```

The orchestrator can assign separate agents without letting them overwrite each other’s working tree.

## Browser verification

For frontend tasks, provide a browser tool that can:

- open local dev server;
- inspect console errors;
- take screenshot;
- click/fill basic UI;
- compare expected elements.

This should be a specific browser capability, not unrestricted computer control.

## Command policy

Categorize commands:

### Safe/read-only

`git status`, `git diff`, `rg`, `ls`, test discovery.

### Workspace writes

formatters, tests that create local artifacts, package scripts.

### Network/install

package installation, curl, remote scripts — confirmation or explicit workspace policy.

### Privileged/destructive

`sudo`, broad deletes, credential commands — blocked or always-confirm.

## Coding session artifact

Every completed task writes a session record:

- request;
- plan;
- model(s);
- files changed;
- diff summary;
- commands run;
- tests;
- unresolved issues;
- checkpoint/commit references.

This becomes searchable project memory.
