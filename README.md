# BuilderHelm

**Your agents. You at the helm.**

BuilderHelm is an agent development environment for running, coordinating,
reviewing, and shipping work from multiple coding agents. It launches compatible
CLI agents already installed on the host and gives each run its own project
context, terminal, Git branch, and optional worktree.

BuilderHelm does not ship a model. Claude Code, Codex, OpenCode, Grok, Gemini,
Pi/OMP, plain shells, and custom commands remain separate tools with their own
authentication and terms.

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

## Stack

- Electron desktop shell
- React and Vite renderer
- TypeScript across the desktop, packages, CLI, relay, and mobile source
- Node.js 24 LTS for development, CLI, relay, and privileged desktop services
- xterm.js for terminal emulation and rendering
- node-pty for local PTY processes
- SQLite for local durable state
- Zod-validated contracts at every IPC and network boundary
- React Native for the planned iOS and Android companion

There is no Rust runtime, sidecar, crate, or native UI rewrite in the product
architecture. See [Architecture](docs/ARCHITECTURE.md) and the accepted
[TypeScript platform decision](docs/adr/0007-typescript-platform.md).

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

## Terminal decision

BuilderHelm uses xterm.js. The visual and interaction design is inspired by
Ghostty, but Ghostty is not embedded. The terminal process and renderer remain
separate:

```text
node-pty -> bounded terminal events -> xterm.js -> BuilderHelm pane UI
```

See [Terminal](docs/features/TERMINAL.md).

## Repository

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

## Development

Requirements:

- Node.js 24.18.0 or newer within the Node 24 LTS line
- pnpm 11.16.0 through Corepack
- macOS for the currently verified desktop runtime

```bash
corepack enable
pnpm install
pnpm dev
```

Useful checks:

```bash
pnpm check:architecture
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:desktop
pnpm verify
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing the repository and
[AGENTS.md](AGENTS.md) before assigning work to a coding agent.

## Safety model

- The renderer is sandboxed and receives only narrow preload methods.
- Every IPC and network request is validated at runtime.
- Agent commands use fixed executables and argument arrays, not shell-built strings.
- Worktrees prevent ordinary file conflicts; they are not security sandboxes.
- Secrets remain in operating-system credential storage and never go to mobile.
- Models may propose actions. Application code authorizes and executes them.
- External writes, pushes, merges, and destructive actions remain human-controlled.

## License

BuilderHelm is private proprietary software. See [LICENSE](LICENSE).
