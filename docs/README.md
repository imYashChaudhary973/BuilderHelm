# Documentation

## Start here

1. [Status](STATUS.md) — what the code does now
2. [Product](PRODUCT.md) — four modes, principles, naming
3. [UX](UX.md) — home, Space wizard, Swarm, chrome
4. [Stack](STACK.md) — TypeScript, Electron, phone pairing
5. [Settings](SETTINGS.md) — settings information architecture
6. [Roadmap](ROADMAP.md) — build order
7. [Agent rules](../AGENTS.md) — worktrees, commit, land
8. [ADRs](adr/README.md) — accepted engineering decisions

## Source hierarchy

When documents disagree:

1. Current code, tests, and migrations define runtime behavior.
2. `AGENTS.md` is the workflow contract.
3. `docs/STACK.md` is the language and platform decision.
4. `STATUS.md` is the implementation summary.
5. ADRs are accepted engineering decisions.
6. PRODUCT / UX / SETTINGS / ROADMAP are product intent.

There is no blueprint folder, no phase-report archive, and no DOCX source of truth.

## Maintenance

- Update `STATUS.md` when a surface ships or breaks.
- Update PRODUCT / UX / SETTINGS / ROADMAP when the intended product changes.
- Update `AGENTS.md` when commit or land rules change.
- Add an ADR for durable technical decisions. Supersede, do not rewrite.
