# Architecture Decision Records

ADRs preserve durable technical decisions and their consequences. Accepted ADRs
are historical records: supersede a decision with a new ADR instead of rewriting
the original outcome.

| ADR                                        | Status   | Decision                                                         |
| ------------------------------------------ | -------- | ---------------------------------------------------------------- |
| [0001](0001-phase-zero-foundation.md)      | Accepted | Phase 0 workspace, Electron, SQLite, IPC, IDs, and UI foundation |
| [0002](0002-secure-provider-settings.md)   | Accepted | Keychain-backed provider settings and secret boundary            |
| [0003](0003-model-gateway-boundary.md)     | Accepted | Provider-independent model gateway boundary                      |
| [0004](0004-canonical-chat-persistence.md) | Accepted | Provider-independent canonical chat persistence                  |

## Adding a decision

Use the next four-digit sequence and include `Status`, `Date`, `Context`,
`Decision`, and `Consequences`. Link superseding and superseded ADRs in both
documents.
