# Model Gateway — Multi-Provider Harness

## Goal

The chat and coding interfaces must treat a model as a capability endpoint, not as a brand-specific feature. A user can paste credentials for multiple providers and select any compatible model.

## Architecture

Use four integration tiers:

### Tier 1 — native adapters

Implement first-class adapters for providers whose APIs have meaningful provider-specific capabilities:

- OpenAI
- Anthropic
- Ollama local/cloud
- OpenRouter

Native adapters may expose features such as Responses APIs, server-side tools, prompt caching, reasoning controls, or native usage metadata.

### Tier 2 — generic OpenAI-compatible adapter

Many current providers expose OpenAI-compatible interfaces. The adapter should accept:

- provider ID;
- base URL;
- API key header style;
- optional custom headers;
- chat vs responses endpoint;
- model name;
- capability overrides.

This path can cover providers such as DeepSeek, Kimi, xAI, Qwen/Model Studio, Z.AI GLM, Xiaomi MiMo, and other compatible services, while still allowing native adapters later.

### Tier 3 — Anthropic-compatible adapter

Useful when a provider implements Anthropic Messages semantics more faithfully than OpenAI semantics, especially around thinking/tool-call replay.

### Tier 4 — gateway adapter

Optional LiteLLM gateway integration gives Zero a broad compatibility escape hatch and centralized routing/cost controls. It must remain optional so the desktop app does not require Python infrastructure.

## Why this design

Official documentation currently shows a broad convergence around OpenAI-compatible APIs: Ollama, DeepSeek, Kimi, Qwen Model Studio, GLM coding endpoints, Xiaomi MiMo, and Tinker inference all expose compatible interfaces in some form. Compatibility is not identical, so Zero must maintain a capability registry rather than assuming “OpenAI-compatible” means feature-equivalent.

## Provider configuration

```ts
interface ProviderConfig {
  id: string;
  label: string;
  protocol: 'openai' | 'anthropic' | 'ollama' | 'custom';
  baseUrl?: string;
  secretRef: string; // keychain reference, never the secret
  defaultHeaders?: Record<string, string>;
  enabled: boolean;
  allowSensitiveData: boolean;
  spendLimitMonthly?: number;
  metadata?: Record<string, unknown>;
}
```

## Model catalog

```ts
interface ModelCapabilities {
  text: boolean;
  vision: boolean;
  audioInput: boolean;
  toolCalling: boolean;
  parallelTools: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  reasoningControls: boolean;
  serverWebSearch: boolean;
  serverMcp: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
}

interface ModelRecord {
  ref: string; // providerId:modelId
  providerId: string;
  modelId: string;
  label: string;
  capabilities: ModelCapabilities;
  pricing?: PricingMetadata;
  privacyClass: 'local' | 'remote';
  tags: string[];
}
```

## Capability probing

Do not rely only on a hard-coded catalog. Support:

1. provider `/models` discovery when available;
2. known-provider metadata packs;
3. a low-cost capability probe;
4. manual user overrides;
5. runtime downgrade when the provider rejects a feature.

## Model routing policies

Agents request a **model policy**, not a model name.

Examples:

```yaml
policy: research_deep
requirements:
  toolCalling: true
  contextWindow: '>=128000'
preferences:
  - high_reasoning
  - strong_citations
privacy: remote_allowed
max_cost_usd: 1.50
fallback:
  - provider_priority
  - cheaper_model
```

```yaml
policy: private_fast
requirements:
  privacyClass: local
preferences:
  - low_latency
  - small_model
fallback: none
```

## Suggested model lanes

### Fast lane

Use local/small inexpensive models for:

- intent classification;
- tagging;
- title generation;
- query rewriting;
- simple extraction;
- task parsing;
- short summaries.

### Reasoning lane

Use stronger cloud or large local models for:

- architecture;
- research synthesis;
- complex planning;
- ambiguous decisions;
- multi-step tool workflows.

### Coding lane

Use the user’s preferred coding models with repository context, patch tools, tests, and model-specific context handling.

### Long-context lane

Use when a task genuinely needs large context; retrieval should still be preferred over dumping the entire vault.

## Local model strategy for a 24 GB Apple Silicon Mac

Treat local inference as a **privacy/latency/cost lane**, not as a requirement that every task be local. Quantized small-to-mid-size models are appropriate for routine tasks, summaries, extraction, classification, and some coding work. Frontier research and long-horizon coding can route to a cloud model when the user allows it.

Support both:

- Ollama local API;
- MLX-LM local server.

MLX-LM officially provides an HTTP server similar to the OpenAI chat API, but its own documentation cautions that the server is not intended as a hardened production server. Bind local inference to loopback and never expose it directly to a public interface.

## Mid-thread model switching

Conversation state belongs to Zero. For each turn:

1. retrieve canonical thread messages;
2. convert them to the target provider format;
3. include summarized tool history where necessary;
4. invoke selected model;
5. normalize response back into Zero format.

Provider-specific opaque response IDs may be stored as optimization metadata but must never become the only representation of the thread.

## Tool compatibility fallback

If the selected model cannot call tools and the user asks for an action:

- option A: explain the limitation and offer a compatible model;
- option B: automatically route the **action planning turn** to the configured action-capable fallback if the user enabled automatic routing.

The UI must show that a different model was used.

## Cost controls

Track:

- tokens/input/output;
- cached tokens where reported;
- provider cost metadata;
- per-thread cost;
- per-agent cost;
- daily/monthly budgets;
- local vs remote usage.

Do not make exact cost enforcement dependent solely on provider-reported pricing; allow user-defined pricing overrides.
