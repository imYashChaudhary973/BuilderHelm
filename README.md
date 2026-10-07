<p align="center">
  <img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:0C1218,50:1E66D8,100:13283A&height=190&section=header&text=BuilderHelm&fontSize=52&fontColor=FEFEFF&animation=fadeIn&fontAlignY=36&desc=Your%20agents.%20You%20at%20the%20helm.&descAlignY=60&descSize=18" alt="BuilderHelm — your agents, you at the helm" />
</p>

<p align="center">
  <img src="assets/brand/builderhelm/web/logo-transparent-512.png" width="88" alt="BuilderHelm logo">
</p>

<p align="center">
  <a href="https://git.io/typing-svg">
    <img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=600&size=20&duration=3200&pause=900&color=7FEDD4&center=true&vCenter=true&width=780&lines=Give+each+agent+its+own+branch.;Terminals%2C+files%2C+tests%2C+and+logs+in+one+place.;Review+the+work.+Ship+the+pull+request." alt="Give each agent its own branch. Review the work. Ship the pull request." />
  </a>
</p>

<p align="center">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-verified-1E66D8?style=for-the-badge&logo=apple&logoColor=white">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-43-47848F?style=for-the-badge&logo=electron&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white">
  <img alt="Node 24 LTS" src="https://img.shields.io/badge/Node-24_LTS-339933?style=for-the-badge&logo=nodedotjs&logoColor=white">
  <img alt="Status" src="https://img.shields.io/badge/Status-In_development-E8A33D?style=for-the-badge">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Agents-Claude%20Code%20%7C%20Codex%20%7C%20OpenCode%20%7C%20Grok%20%7C%20Gemini%20%7C%20Pi%2FOMP-1E66D8?style=for-the-badge" alt="Supported agents">
</p>

BuilderHelm is an agent development environment for developers who run several coding agents at once. It launches the CLI agents already installed on your machine and gives each run its own project context, terminal, Git branch, and optional worktree, so you can run, coordinate, review, and ship their work from one place.

BuilderHelm does not ship a model. Claude Code, Codex, OpenCode, Grok, Gemini, Pi/OMP, plain shells, and custom commands remain separate tools with their own authentication and terms.

---

## Product loop

```text
Task
  -> isolated branch/worktree
  -> agent terminal
  -> files, browser, tests, and logs
  -> human review or feedback
  -> commit and pull request
  -> CI, merge, and archive
```

---

## Features

- **Bring your own agents.** Launch any compatible CLI agent already installed on the host, or a plain shell or custom command. Each keeps its own login and terms.
- **Isolated by default.** Every run gets its own project context, Git branch, and optional worktree, so agents don't trip over each other's files.
- **Real terminals.** xterm.js rendering on top of node-pty, with bounded terminal events and a pane UI inspired by Ghostty.
- **Space.** One project with one or more live terminal panes.
- **Swarm.** Coordinated agents with roles, budgets, worktrees, review, and land. _In development._
- **Board.** Persistent project tasks and stages.
- **Memory.** Local knowledge retrieval with inspectable citations.
- **Editor.** Workspace-scoped files, tabs, save, and autosave.
- **Git.** Status, history, staging, commits, and branch review.
- **Human in control.** External writes, pushes, merges, and destructive actions stay with you.

---

## Surfaces

| Surface      | Purpose                                                             | Status         |
| ------------ | ------------------------------------------------------------------- | -------------- |
| Space        | One project with one or more live terminal panes                    | Working        |
| Swarm        | Coordinated agents with roles, budgets, worktrees, review, and land | In development |
| Board        | Persistent project tasks and stages                                 | Working        |
| Memory       | Local knowledge retrieval with inspectable citations                | Working        |
| Editor       | Workspace-scoped files, tabs, save, and autosave                    | Working        |
| Git          | Status, history, staging, commits, branch review                    | Working        |
| Browser      | Preview, inspect, select UI, and send evidence to agents            | Planned        |
| Review       | Diffs, tests, CI, feedback, conflicts, commits, and pull requests   | Planned        |
| Mobile       | Remote observation, instructions, and approvals                     | Planned        |
| Integrations | GitHub and Linear task intake and status sync                       | Planned        |

The exact implementation boundary is maintained in [Status](docs/STATUS.md).

---

## Quick start

1. **Install the prerequisites:** Node.js 24.18.0 or newer (24 LTS) and pnpm 11.16.0 through Corepack. macOS is the verified desktop runtime.
2. **Install at least one agent CLI**, such as Claude Code or Codex, and sign in to it as you normally would.
3. **Run the app:**

   ```bash
   git clone https://github.com/imYashChaudhary973/BuilderHelm.git
   cd BuilderHelm
   corepack enable
   pnpm install
   pnpm dev
   ```

4. **Open a project, start a Space,** and launch an agent in a new branch or worktree.
5. **Review and ship.** Check the diff, run the tests, leave feedback, then commit and open the pull request.

---

## Stack

| Layer     | Technology                                                       |
| --------- | ---------------------------------------------------------------- |
| Shell     | Electron desktop app                                             |
| Renderer  | React and Vite                                                   |
| Language  | TypeScript across desktop, packages, CLI, relay, and mobile      |
| Runtime   | Node.js 24 LTS for development, CLI, relay, and desktop services |
| Terminal  | xterm.js rendering, node-pty local PTY processes                 |
| Storage   | SQLite for local durable state                                   |
| Contracts | Zod validation at every IPC and network boundary                 |
| Mobile    | React Native companion for iOS and Android (planned)             |

There is no Rust runtime, sidecar, crate, or native UI rewrite in the product architecture. See [Architecture](docs/ARCHITECTURE.md) and the accepted [TypeScript platform decision](docs/adr/0007-typescript-platform.md).

### Terminal

BuilderHelm uses xterm.js. The visual and interaction design is inspired by Ghostty, but Ghostty is not embedded. The terminal process and renderer stay separate:

```text
node-pty -> bounded terminal events -> xterm.js -> BuilderHelm pane UI
```

See [Terminal](docs/features/TERMINAL.md).

---

## Verify

```bash
pnpm check:architecture
pnpm check:licenses
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:desktop
pnpm verify        # runs the full gate
```

---

## Architecture

```text
apps/          runnable desktop and future client applications
assets/        reviewed brand and product assets
docs/          current product, architecture, feature, and operations docs
experiments/   disposable prototypes that are never product dependencies
infra/         deployment and relay infrastructure when those services exist
native/        narrowly scoped operating-system adapters; no product core
packages/      shared TypeScript domain, storage, protocol, and tool packages
patches/       reviewed third-party patches, currently empty
scripts/       repository automation and safety checks
tests/         repository-wide architecture and security tests
```

| Package                  | Responsibility                                     |
| ------------------------ | -------------------------------------------------- |
| `apps/desktop`           | Electron app, sandboxed renderer, desktop services |
| `apps/cli`               | Command-line client                                |
| `apps/relay`             | Relay for remote companions                        |
| `apps/mobile`            | React Native companion                             |
| `packages/core`          | Domain types and logic                             |
| `packages/db`            | SQLite storage and migrations                      |
| `packages/protocol`      | Validated IPC and network contracts                |
| `packages/model-gateway` | Model access boundary                              |
| `packages/tools`         | Tool definitions and execution                     |
| `packages/observability` | Logging and diagnostics                            |
| `packages/shared`        | Shared utilities                                   |

---

## Safety model

- The renderer is sandboxed and receives only narrow preload methods.
- Every IPC and network request is validated at runtime.
- Agent commands use fixed executables and argument arrays, not shell-built strings.
- Worktrees prevent ordinary file conflicts; they are not security sandboxes.
- Secrets remain in operating-system credential storage and never go to mobile.
- Models may propose actions. Application code authorizes and executes them.
- External writes, pushes, merges, and destructive actions remain human-controlled.

---

## Documentation

| Document                             | What it covers                                     |
| ------------------------------------ | -------------------------------------------------- |
| [Product](docs/PRODUCT.md)           | What BuilderHelm is and who it is for              |
| [Architecture](docs/ARCHITECTURE.md) | Module contracts and system design                 |
| [Status](docs/STATUS.md)             | What works today and what is planned               |
| [Roadmap](docs/ROADMAP.md)           | Where the project is going                         |
| [Development](docs/DEVELOPMENT.md)   | Setting up and working in the repo                 |
| [Features](docs/features/README.md)  | Space, Swarm, Board, Memory, Editor, Git, and more |
| [Security](docs/SECURITY.md)         | Threat model and safeguards                        |
| [Contributing](CONTRIBUTING.md)      | Rules for changing the repository                  |
| [AGENTS.md](AGENTS.md)               | Instructions for coding agents working here        |

---

## Status

BuilderHelm is in active development. Space, Board, Memory, Editor, and Git work today; Swarm is in progress, and Browser, Review, Mobile, and Integrations are planned. See [Status](docs/STATUS.md) for the exact boundary.

## License

BuilderHelm is private proprietary software. See [LICENSE](LICENSE).

<p align="center">
  <em>Your agents. You at the helm.</em>
</p>

<p align="center">
  <img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:1E66D8,50:13283A,100:0C1218&height=120&section=footer" alt="" />
</p>
