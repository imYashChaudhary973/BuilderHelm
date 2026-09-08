# Runtime capability matrix

Tested on this host, 2026-09-08. Tiers are evidence, not ads. An advertised
model is not proof of account entitlement. Copilot was not installed. Cursor
3.19.13 is the editor binary — `cursor agent` talks to Cursor's own API, not
ACP. Native Codex `app-server` stays quota-only; chat uses `codex-acp`.

ACP initialize (JSON-RPC `initialize`, no prompt, no billed inference):

| Runtime            | Version | Transport | Result                                               |
| ------------------ | ------- | --------- | ---------------------------------------------------- |
| gemini `--acp`     | 0.58.0  | ACP       | protocolVersion 1                                    |
| opencode `acp`     | 1.18.29 | ACP       | protocolVersion 1, loadSession                       |
| kimi `acp`         | 0.39.1  | ACP       | protocolVersion 1, loadSession                       |
| grok `agent stdio` | 1.0.13  | ACP       | protocolVersion 1, loadSession                       |
| codex-acp          | 1.10.0  | ACP       | protocolVersion 1, loadSession                       |
| omp `acp`          | 18.1.14 | ACP       | protocolVersion 1, local credentials                 |
| claude-agent-acp   | —       | ACP       | **unavailable** (binary missing)                     |
| copilot            | —       | ACP       | **unavailable** (not installed; no ACP argv in code) |
| cursor             | 3.19.13 | ACP       | **no ACP** (`cursor agent` is not ACP)               |

Headless structured path (gated `BUILDERHELM_CLI_SMOKE=1`):

| Runtime | Path                                         | Result              |
| ------- | -------------------------------------------- | ------------------- |
| claude  | `--print --output-format json --json-schema` | orchestration-ready |
| codex   | `exec --output-schema`                       | orchestration-ready |

Pi 0.84.3: PTY/terminal first (`pi -p`). `--mode rpc` exists, **untested**.
Oh My Pi: PTY first, then separately verified `omp acp` (above).

Do not replace a working adapter because another transport exists.
