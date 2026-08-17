# Zero OS

Zero OS is a local-first personal intelligence and action system for macOS. It
combines provider-independent chat, cited local knowledge, projects, tasks, and
permissioned tools in a secure Electron desktop application.

The product is under active development. See the
[current implementation status](docs/STATUS.md) for completed and in-progress
phases.

## Requirements

- macOS for the desktop runtime and Keychain-backed provider credentials
- Node.js 22.13 or newer
- pnpm 11.16 through Corepack

## Get started

```bash
corepack enable
pnpm install
pnpm dev
```

Provider credentials are stored in macOS Keychain. They are not stored in the
repository or SQLite database.

## Common commands

| Command              | Purpose                                       |
| -------------------- | --------------------------------------------- |
| `pnpm dev`           | Start the Electron development app            |
| `pnpm build`         | Create the production desktop build           |
| `pnpm test`          | Run the Vitest suite                          |
| `pnpm typecheck`     | Check all TypeScript projects                 |
| `pnpm lint`          | Run ESLint                                    |
| `pnpm format:check`  | Check repository formatting                   |
| `pnpm smoke:desktop` | Boot-test the built Electron app              |
| `pnpm verify`        | Run formatting, lint, types, tests, and build |

## Repository layout

```text
apps/desktop/          Electron main, preload, and React renderer
packages/core/         Application services and composition root
packages/db/           SQLite repositories and forward-only migrations
packages/model-gateway Provider-independent model adapters and policy checks
packages/observability Structured, redacted logging
packages/protocol/     Runtime-validated domain and IPC contracts
packages/shared/       IDs, time helpers, and stable errors
packages/tools/        Tool registry and permission policy
tests/                 Cross-package architecture and security tests
docs/                  Status, blueprint, ADRs, and historical reports
```

## Documentation

Start at the [documentation index](docs/README.md). The Markdown files in
`docs/blueprint/` are the canonical product and architecture baseline; the DOCX
file is a convenience export and may lag behind the Markdown sources.
