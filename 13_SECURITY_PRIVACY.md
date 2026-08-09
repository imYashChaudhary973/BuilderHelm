# Security & Privacy Architecture

## Threat model summary

Zero handles unusually sensitive data and also runs tools. The key threats are:

- API key theft;
- prompt injection from external content;
- unintended model data disclosure;
- malicious MCP/tool servers;
- overly broad filesystem access;
- unsafe shell execution;
- compromised renderer code gaining Node privileges;
- silent high-impact agent actions;
- audit/logs leaking sensitive content.

## Data classification

Every source/context object receives a classification:

1. `public`
2. `personal`
3. `sensitive`
4. `health`
5. `secret`

## Model egress policy

Example defaults:

| Classification |     Local model |              Remote model |
| -------------- | --------------: | ------------------------: |
| Public         |             Yes |                       Yes |
| Personal       |             Yes |    Yes, user-configurable |
| Sensitive      |             Yes | Opt-in/provider allowlist |
| Health         |             Yes |            Off by default |
| Secret         | Never in prompt |                     Never |

Before a request is sent, the Context Builder computes the highest classification in the context and checks the selected provider policy.

## Secrets

Store API keys and credentials in macOS Keychain. Apple documents Keychain Services as encrypted storage for small secrets such as passwords and cryptographic keys.

Rules:

- never store API keys in SQLite;
- never place keys in agent prompts;
- redact Authorization headers from logs;
- expose only `secretRef` identifiers to domain code;
- optionally require Touch ID for viewing/exporting credentials.

## Electron boundary

Follow Electron’s security model:

- `contextIsolation: true`;
- sandbox renderer;
- no Node integration in renderer;
- restrictive Content Security Policy;
- narrow `contextBridge` API;
- validate IPC arguments with Zod;
- never expose a generic IPC send primitive.

## Local HTTP services

Ollama/MLX/local core endpoints should bind to loopback by default. Never expose MLX-LM directly to the network; its own documentation notes its basic server is not designed as a production-hardened service.

## Prompt injection defense

### Rule 1

Retrieved content can propose information, never permissions.

### Rule 2

External instructions such as “ignore previous instructions”, “send this secret”, or “run this command” are treated as untrusted text.

### Rule 3

Tools are selected from the agent’s allowlist, then independently permission-checked.

### Rule 4

High-impact arguments are shown to the user before approval.

## MCP security

For each server store:

- server URL/command;
- trust level;
- authentication method;
- tool list hash;
- allowed tools;
- data scopes;
- permission overrides.

A changed tool schema should invalidate previous blanket approval until reviewed.

## Filesystem security

Maintain explicit roots and realpath checks. Deny path traversal outside registered roots.

## Coding execution

- no privileged commands;
- no hidden background shell;
- timeout every process;
- keep process tree for cancellation;
- mask env secrets;
- optional container sandbox;
- checkpoint before broad edits.

## Audit integrity

Write append-only audit records. User-facing deletion of history may remove content after confirmation, but the product should distinguish “clear conversation” from “erase action audit.”

## Backups

Provide:

- database backup;
- export of settings excluding secrets;
- re-index from source files;
- disaster recovery guide.

The index should be rebuildable. Source-owned data should not become trapped in Zero.
