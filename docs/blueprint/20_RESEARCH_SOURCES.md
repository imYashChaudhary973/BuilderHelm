# Research Sources & Technical Validation

**Snapshot date:** 8 August 2026

This blueprint was checked against current official documentation. Provider capabilities change frequently, so model IDs and pricing should be discovered/configurable at runtime rather than embedded as durable product assumptions.

## Model interoperability

### LiteLLM

Official documentation describes a unified interface across 100+ LLMs, consistent output formats, routing/fallbacks, cost tracking, and a proxy/gateway mode. In Zero, LiteLLM is recommended as an optional compatibility adapter rather than a mandatory architectural dependency.

Source: LiteLLM official docs — Getting Started / Proxy.

### Vercel AI SDK

Official AI SDK documentation supports first-party providers, OpenAI-compatible providers, provider registries, and custom providers. This validates a TypeScript-native provider abstraction approach.

Sources: AI SDK — Choosing a Provider; OpenAI Compatible Providers; Provider Management.

### OpenAI

Official OpenAI API documentation supports streaming, function tools, web search, file-related tools, and remote MCP in the Responses API ecosystem.

Source: OpenAI Platform developer/API documentation.

### Anthropic / MCP

Anthropic documentation describes MCP as an open protocol for connecting models/apps to data sources and tools, and supports MCP across Anthropic products/APIs.

Source: Anthropic Model Context Protocol documentation.

## Providers mentioned for Zero

### Ollama

Official docs expose a local API and an Ollama Cloud API, plus OpenAI compatibility and Anthropic Messages compatibility. Ollama supports local and cloud models.

Sources: Ollama API Introduction; OpenAI Compatibility; Anthropic Compatibility; Cloud.

### DeepSeek

Official DeepSeek docs state API compatibility with OpenAI/Anthropic formats and document tool calls and Responses API compatibility.

Sources: DeepSeek API docs — First API Call; Tool Calls; Responses API.

### Kimi / Moonshot

Official Kimi platform docs state OpenAI API compatibility and tool use support.

Sources: Kimi API Platform — Quickstart; OpenAI Migration; Tool Use.

### xAI / Grok

Official xAI docs support function calling, server-side tools, and remote MCP; current docs also describe OpenAI-compatible surfaces for several capabilities.

Sources: xAI Developer Docs — Function Calling; Tools Overview; Remote MCP.

### Qwen / Alibaba Cloud Model Studio

Official Model Studio docs provide OpenAI-compatible APIs for Qwen, including Chat Completions and Responses interfaces.

Sources: Alibaba Cloud Model Studio — OpenAI Compatibility for Qwen; Responses compatibility.

### Z.AI / GLM

Official Z.AI developer docs expose OpenAI-compatible coding/general API endpoints and document current GLM APIs.

Sources: Z.AI Developer Docs — Quick Start; API Introduction; Tool Integration.

### Xiaomi MiMo

Official Xiaomi MiMo API docs state compatibility with both OpenAI and Anthropic API formats and document a Responses-compatible endpoint.

Sources: Xiaomi MiMo API — First API Call; OpenAI Responses API Compatibility.

### Tinker

Thinking Machines’ official Tinker docs expose beta OpenAI-compatible and Anthropic-compatible inference for model checkpoints, with documentation noting the current compatible inference is intended for testing/internal workflows rather than high-throughput production serving.

Sources: Tinker Documentation — OpenAI-Compatible API; Anthropic-Compatible API; Tinker overview.

## Local Apple Silicon inference

### MLX / MLX-LM

Apple’s MLX project targets machine learning on Apple Silicon. MLX-LM supports local generation and provides an HTTP server intended to be similar to the OpenAI chat API. Its server documentation explicitly warns that it only implements basic security checks and is not recommended as a production server.

Sources: `ml-explore/mlx`; `ml-explore/mlx-lm`; MLX-LM HTTP Model Server.

## Health

### Apple HealthKit

Apple describes HealthKit as a central repository for health/fitness data and requires explicit authorization for apps to read/write relevant health types. Apple provides query and background update APIs.

Sources: Apple Developer — HealthKit; Configuring HealthKit Access; Reading Data from HealthKit.

### NoiseFit

Noise’s official privacy material says that, where technology permits, users may transfer information to third parties such as Apple Health, Google Fit, or Strava. The official sources reviewed did not expose a stable public developer API for direct Zero ↔ NoiseFit integration.

Source: Noise / GoNoise privacy policy and support material.

## GitHub

GitHub’s official REST documentation exposes repository and commit APIs suitable for remote project metadata and activity.

Sources: GitHub Docs — REST API endpoints for commits and repositories.

## Secret storage

Apple’s Keychain Services documentation recommends Keychain for securely storing small secrets such as passwords and cryptographic keys.

Sources: Apple Developer — Keychain Services; Adding a Password to the Keychain.

## Electron security

Electron’s official security guidance recommends context isolation, process sandboxing, narrow APIs, and avoiding exposure of privileged primitives to untrusted renderer content.

Sources: Electron — Security; Context Isolation; contextBridge; Process Sandboxing.

## Obsidian

Obsidian uses Markdown notes, and its official URI documentation provides a supported way to open/search vaults and notes from external apps. Zero’s direct filesystem index preserves this portability while optionally using Obsidian URIs for navigation.

Sources: Obsidian Help — Obsidian URI; editing/Markdown documentation.
