# BuilderHelm documentation

This directory contains current product and engineering documentation. Runtime
behavior is defined by code and tests; documentation must be updated when that
behavior or the intended product changes.

## Start here

1. [Product](PRODUCT.md) — what BuilderHelm is and is not.
2. [Status](STATUS.md) — what is working, partial, and planned.
3. [Architecture](ARCHITECTURE.md) — process, package, data, and trust boundaries.
4. [Roadmap](ROADMAP.md) — ordered delivery plan.
5. [Development](DEVELOPMENT.md) — setup, worktrees, checks, and builds.
6. [Security](SECURITY.md) — execution, browser, secrets, remote, and approval rules.
7. [Feature contracts](features/README.md) — one document per product surface.
8. [Architecture decisions](adr/README.md) — durable accepted decisions.
9. [Migration](MIGRATION.md) — one-time steps for installs predating the reset.
10. [Legal](legal/README.md) — customer-facing EULA and Privacy Policy drafts.

## Source hierarchy

When sources disagree:

1. Verified code, tests, and migrations describe current behavior.
2. `AGENTS.md` defines repository workflow and agent safety.
3. `ARCHITECTURE.md` defines technical boundaries.
4. `STATUS.md` defines implementation status.
5. Accepted ADRs define durable decisions.
6. Product, feature, and roadmap documents define intent.

Superseded plans are removed instead of preserved beside current instructions.
