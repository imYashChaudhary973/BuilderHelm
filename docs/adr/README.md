# Architecture decisions

Only current durable decisions live here. Abandoned migration plans and
superseded implementation checklists are removed to prevent agents from acting
on stale instructions.

| ADR                                        | Status   | Decision                                                                |
| ------------------------------------------ | -------- | ----------------------------------------------------------------------- |
| [0002](0002-secure-provider-settings.md)   | Accepted | Provider metadata in SQLite, credential values only in the OS keychain  |
| [0003](0003-model-gateway-boundary.md)     | Accepted | Provider wire formats terminate inside model-gateway adapters           |
| [0004](0004-canonical-chat-persistence.md) | Accepted | Chat history is provider-independent and survives catalog changes       |
| [0007](0007-typescript-platform.md)        | Accepted | Electron, React, Vite, Node.js, and TypeScript are the product platform |

Numbers are never reused. 0001, 0005, and 0006 are retired: 0001 described a
superseded foundation phase, and 0005 and 0006 proposed the native-engine
migration that [0007](0007-typescript-platform.md) replaces. Their text is
available in Git history and must not be reintroduced as guidance.

New ADRs include status, date, context, decision, consequences, and replacement
criteria. If a decision changes, update this index and remove conflicting plans.
