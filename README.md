<p align="center">
  <img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:080A07,50:6F7767,100:B6D475&height=190&section=header&text=BuilderHelm&fontSize=48&fontColor=EEF1E4&animation=fadeIn&fontAlignY=36&desc=Your%20agents.%20You%20at%20the%20helm.&descAlignY=60&descSize=18" alt="BuilderHelm — Your agents. You at the helm." />
</p>

<p align="center">
  <img src="apps/desktop/src/renderer/src/assets/logo.png" width="88" alt="BuilderHelm">
</p>

<p align="center">
  <a href="https://git.io/typing-svg">
    <img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=600&size=20&duration=3200&pause=900&color=B6D475&center=true&vCenter=true&width=780&lines=Your+agents.+You+at+the+helm.;Space.+Swarm.+Board.+Memory.;Local-first.+macOS.+TypeScript." alt="Your agents. You at the helm." />
  </a>
</p>

<p align="center">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-supported-B6D475?style=for-the-badge">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-39-111111?style=for-the-badge&logo=electron&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white">
  <img alt="Local-first" src="https://img.shields.io/badge/Privacy-Local--first-0D855E?style=for-the-badge">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-11-F69220?style=for-the-badge&logo=pnpm&logoColor=white">
</p>

BuilderHelm is a local-first desktop harness for macOS. You stay in one app: terminals, optional coding agents, tasks, memory, and chrome.

**Your agents. You at the helm.**

The npm workspace is still `zero-os`. That is a package name, not the product.

What runs today: [status](docs/STATUS.md). What it is for: [product](docs/PRODUCT.md).

---

## Modes

| Mode       | Status      | Job                                                          |
| ---------- | ----------- | ------------------------------------------------------------ |
| **Space**  | Live        | Folder + layout + optional agents → a grid of real terminals |
| **Swarm**  | In progress | One job, four roles, budget and stuck policy                 |
| **Board**  | Live        | Kanban. Not the terminal grid                                |
| **Memory** | Live        | Private Obsidian recall with citations                       |

Chrome that already ships: top bar (Space / Swarm / Board / Memory / Skills / Settings) and a left rail of stacked Spaces.

---

## Quick start

```bash
corepack enable
pnpm install
pnpm dev
```

macOS. Node.js 22.13+. pnpm 11.16 via Corepack.

Provider credentials go in the Keychain, not the repo or SQLite.

---

## Commands

| Command                            | Purpose                           |
| ---------------------------------- | --------------------------------- |
| `pnpm dev`                         | Electron development app          |
| `pnpm build`                       | Production desktop build          |
| `pnpm --filter @zero/desktop dist` | Unsigned `Zero.app`               |
| `pnpm test`                        | Vitest                            |
| `pnpm typecheck`                   | TypeScript project build          |
| `pnpm lint`                        | ESLint                            |
| `pnpm verify`                      | Format, lint, types, tests, build |
| `pnpm smoke:desktop`               | Boot-test the built app           |

---

## How it is put together

```text
Top bar     Space · Swarm · Board · Memory · Skills · Settings
Left rail   stacked Spaces
Content     home → wizard → live xterm grid
```

```text
apps/desktop/           Electron main, preload, React renderer
packages/core/          Application services
packages/db/            SQLite + migrations
packages/model-gateway  Provider adapters
packages/observability  Redacted logs
packages/protocol/      Domain and IPC schemas
packages/shared/        IDs, time, errors
packages/tools/         Tool registry and permissions
docs/                   Product, status, ADRs
```

---

## Documentation

| Document                     | What it covers                            |
| ---------------------------- | ----------------------------------------- |
| [Status](docs/STATUS.md)     | What the code does now                    |
| [Product](docs/PRODUCT.md)   | Modes, principles, naming                 |
| [UX](docs/UX.md)             | Home, Space wizard, chrome                |
| [Stack](docs/STACK.md)       | TypeScript + Electron. Not a Rust rewrite |
| [Roadmap](docs/ROADMAP.md)   | Build order                               |
| [Settings](docs/SETTINGS.md) | Intended settings IA                      |
| [Agent rules](AGENTS.md)     | Worktrees, commit, land                   |
| [ADRs](docs/adr/README.md)   | Accepted engineering decisions            |

---

## Not this project

Not a personal-life OS. Not HealthKit. Not a content studio. Not a cloud multi-user assistant.

<p align="center">
  <img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:B6D475,50:6F7767,100:080A07&height=120&section=footer" alt="" />
</p>
