# Zero OS — Personal Intelligence & Action Operating System

**Blueprint version:** 1.0  
**Research snapshot:** 8 August 2026  
**Status:** Build-ready architecture specification

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

- `01_PRODUCT_VISION.md` — mission, product principles, success criteria
- `02_PRD.md` — product requirements and user journeys
- `03_SYSTEM_ARCHITECTURE.md` — complete technical architecture
- `04_MODEL_GATEWAY.md` — multi-provider model harness
- `05_MEMORY_KNOWLEDGE_GRAPH.md` — Obsidian, RAG, graph, memory
- `06_AGENT_RUNTIME.md` — agent orchestration and specialist agents
- `07_ACTIONS_TOOLS_PERMISSIONS.md` — tools, approvals, auditability
- `08_VOICE_ASSISTANT.md` — voice-to-action architecture
- `09_CODING_WORKSPACE.md` — Codex-like multi-model coding environment
- `10_INTEGRATIONS.md` — Obsidian, GitHub, HealthKit, NoiseFit, calendar, browser
- `11_DATA_MODEL.md` — database schema and domain objects
- `12_INTERNAL_API_EVENTS.md` — IPC/API/event contracts
- `13_SECURITY_PRIVACY.md` — secrets, data classification, sandboxing
- `14_UI_UX.md` — navigation, screens, interaction model
- `15_AUTOMATION_ENGINE.md` — schedules, triggers, workflows
- `16_EVALS_OBSERVABILITY.md` — testing, model evals, agent traces, costs
- `17_ROADMAP.md` — phased execution plan
- `18_STARTUP_PRODUCTIZATION.md` — how internal modules can become products
- `19_MASTER_BUILD_PROMPT.md` — prompt for the coding agent
- `20_RESEARCH_SOURCES.md` — official sources used for technical decisions

## One sentence architecture

**Interfaces (desktop/voice/mobile) → Orchestrator → Context Builder + Model Gateway → Agent Runtime → Tool/Action Engine → Integrations → Local Knowledge/Data Layer, all wrapped by permissions, audit logs, and observability.**
