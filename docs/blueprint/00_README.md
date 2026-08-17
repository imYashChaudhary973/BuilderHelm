# Zero OS — Personal Intelligence & Action Operating System

**Blueprint version:** 1.0  
**Research snapshot:** 8 August 2026  
**Status:** Product and architecture baseline

This blueprint describes intended direction, not current delivery state. See
[Implementation Status](../STATUS.md) for what the repository implements now.
The numbered Markdown files are canonical; `Zero_OS_Master_Blueprint.docx` is a
convenience export and may lag behind them.

## What Zero OS is

Zero OS is a local-first personal operating system that unifies knowledge, projects, code, tasks, health data, research, content planning, automations, and AI agents behind one interface. It is not a chatbot with plugins. The durable product is the **memory + action + permission + workflow layer**; LLMs are replaceable reasoning engines.

The system is designed around five principles:

1. **Provider agnostic** — OpenAI, Anthropic, Ollama/Ollama Cloud, OpenRouter, DeepSeek, Kimi, GLM, Qwen, xAI/Grok, Xiaomi MiMo, Tinker inference, MLX/local endpoints, and future OpenAI-compatible or custom providers can coexist.
2. **Local first** — personal data, Obsidian files, indexes, audit history, tasks, and agent state stay on the Mac by default.
3. **Action capable** — agents can use tools and execute permitted actions, not merely answer questions.
4. **Human controlled** — high-impact actions require approval; all actions create an audit receipt.
5. **Composable** — agents, tools, model policies, integrations, and workflows are plugins with explicit contracts.

## Recommended implementation decision

Build the first production-quality version as a **macOS desktop app using Electron + React + TypeScript**, with a local TypeScript core and SQLite. Electron is chosen for v1 because a Codex-style coding workspace needs mature terminal/PTTY, filesystem, Git, process, and desktop integration. Keep the domain core UI-agnostic so a future native Swift or Tauri shell can reuse it.

Use a **TypeScript model abstraction layer** as the primary runtime. Native provider adapters handle the major providers; an OpenAI-compatible adapter covers the long tail; an optional LiteLLM gateway adapter provides an escape hatch for providers not yet implemented. MCP is the preferred external tool protocol.

## Documentation map

| File | Subject |
| --- | --- |
| [01](01_PRODUCT_VISION.md) | Product vision, principles, and success criteria |
| [02](02_PRD.md) | Product requirements and user journeys |
| [03](03_SYSTEM_ARCHITECTURE.md) | Technical architecture |
| [04](04_MODEL_GATEWAY.md) | Multi-provider model harness |
| [05](05_MEMORY_KNOWLEDGE_GRAPH.md) | Obsidian, retrieval, graph, and memory |
| [06](06_AGENT_RUNTIME.md) | Agent orchestration and specialist agents |
| [07](07_ACTIONS_TOOLS_PERMISSIONS.md) | Tools, approvals, and auditability |
| [08](08_VOICE_ASSISTANT.md) | Voice-to-action architecture |
| [09](09_CODING_WORKSPACE.md) | Multi-model coding environment |
| [10](10_INTEGRATIONS.md) | Obsidian, GitHub, HealthKit, NoiseFit, calendar, and browser integrations |
| [11](11_DATA_MODEL.md) | Database schema and domain objects |
| [12](12_INTERNAL_API_EVENTS.md) | IPC, API, and event contracts |
| [13](13_SECURITY_PRIVACY.md) | Secrets, data classification, and sandboxing |
| [14](14_UI_UX.md) | Navigation, screens, and interaction model |
| [15](15_AUTOMATION_ENGINE.md) | Schedules, triggers, and workflows |
| [16](16_EVALS_OBSERVABILITY.md) | Testing, model evals, traces, and costs |
| [17](17_ROADMAP.md) | Phased delivery plan |
| [18](18_STARTUP_PRODUCTIZATION.md) | Product boundaries and opportunities |
| [20](20_RESEARCH_SOURCES.md) | Sources used for technical decisions |

Document 19 was an initial bootstrap prompt. It was removed after its build
instructions became obsolete; the number is intentionally not reused.

## One sentence architecture

**Interfaces (desktop/voice/mobile) → Orchestrator → Context Builder + Model Gateway → Agent Runtime → Tool/Action Engine → Integrations → Local Knowledge/Data Layer, all wrapped by permissions, audit logs, and observability.**
