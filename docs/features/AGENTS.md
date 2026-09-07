# Agents roster

Status: working on `main` for macOS with ACP agents. Verified against Gemini
and Codex (`@agentclientprotocol/codex-acp`); the surface is agent-agnostic
per [ADR 0008](../adr/0008-agent-client-protocol-host.md).

## Goal

Give every installed coding agent a name, a mark, and a project, so the person
talks to "Social Content Manager — Powered by Codex" instead of configuring a
command line.

## V1 scope

- Named profiles: a display name, a mark, the backing CLI descriptor, and a
  default project folder. Created and edited through a dialog that offers only
  CLIs detection actually found on PATH; BuilderHelm never installs an agent.
- The Agents mode renders the roster (quick-access tiles, rows with live dots,
  a usage footer) beside the chat pane of the selected profile.
- Profile-backed sessions resolve argv in main from the stored descriptor; the
  renderer names a profile, never a command.
- Threads record the profile that started them; deleting a profile orphans its
  threads rather than destroying them, and any thread reopens after the agent
  is uninstalled.
- The composer renders exactly the config options the agent advertises —
  model, thought-level, and mode categories as chips, remaining categories
  under one overflow chip. An agent that advertises nothing shows no chips.
- Permission requests render inline on the tool cell they block, with a
  top-level bar as fallback; remembered allow/reject rules stay per workspace
  and tool kind.
- Live sessions are capped at eight. A project folder that is not on disk is
  refused by name before any process starts.

## Boundaries

- BuilderHelm does not bill model usage, hold provider credentials, or install
  agents. Sign-in happens in the agent's own flow.
- The renderer cannot choose argv. Profiles are stored and resolved in main.
- Chats run against the profile's project folder; there is no ambient
  filesystem authority and no per-agent permission rules yet (rules stay keyed
  by workspace and tool kind).
- Switching profiles is disabled while a turn runs; the underlying process
  keeps running and re-attaches when the thread reopens.

## Acceptance

Profile persistence, manager boundaries (ceiling, profile resolution, missing
folder), thread/profile back-compat, chip grouping, and roster helpers are
covered by unit tests. Desktop drive verified: dialog create/edit, roster
render, folder gating, restart persistence, a live Gemini turn, and the Codex
end to end — real chips, a file write through the hosted fs, and session
resume after a full app restart. The packaged build has not been
click-through.
