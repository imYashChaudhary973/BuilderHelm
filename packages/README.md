# Packages

Shared TypeScript packages contain product logic that is independent of a
specific UI surface.

| Package         | Responsibility                                 |
| --------------- | ---------------------------------------------- |
| `core`          | application services and orchestration         |
| `db`            | SQLite repositories and migrations             |
| `model-gateway` | optional provider API normalization            |
| `observability` | redacted structured logs                       |
| `protocol`      | domain, IPC, event, and future network schemas |
| `shared`        | identifiers, errors, time, and small utilities |
| `tools`         | tools, permissions, approvals, and receipts    |

Packages do not import application renderers. Privileged platform behavior stays
behind adapters owned by the desktop or future host application.
