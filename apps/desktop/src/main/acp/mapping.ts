/**
 * ACP wire shapes into the BuilderHelm agent contract.
 *
 * Pure functions over parsed JSON, deliberately free of process or connection
 * concerns, because this is the layer most likely to be wrong and the only one
 * worth testing against recorded traffic.
 *
 * Two rules throughout:
 *
 * - **Tolerate what agents actually send.** Nearly every field in the ACP schema
 *   is optional, and agents populate wildly different subsets. An unknown or
 *   absent value becomes a conservative default, never an exception: a chat that
 *   dies on an unrecognised tool kind is worse than one that renders it as
 *   `other`.
 * - **Never invent capability.** If an agent does not offer allow-always, that
 *   is reported as absent so the caller can decide, rather than being
 *   synthesised here.
 */
import type {
  AgentCapabilities,
  AgentConfigCategory,
  AgentConfigOption,
  AgentContent,
  AgentPermissionDecision,
  AgentPermissionOption,
  AgentPlanEntry,
  AgentStopReason,
  AgentToolCall,
  AgentToolContent,
  AgentToolKind,
  AgentToolStatus,
} from '@builderhelm/protocol';

/** ACP protocol version this host speaks. */
export const ACP_PROTOCOL_VERSION = 1;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function flag(value: unknown): boolean {
  return value === true;
}

/**
 * ACP marks an optional capability by *presence*, so `{}` means supported and
 * absent means not. A plain truthiness check gets this backwards.
 */
function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function mapCapabilities(initializeResult: unknown): AgentCapabilities {
  const agent = record(record(initializeResult).agentCapabilities);
  const prompt = record(agent.promptCapabilities);
  const session = record(agent.sessionCapabilities);
  return {
    loadSession: flag(agent.loadSession),
    resumeSession: present(session.resume),
    promptImage: flag(prompt.image),
    promptAudio: flag(prompt.audio),
    promptEmbeddedContext: flag(prompt.embeddedContext),
  };
}

export function mapAuthMethods(
  initializeResult: unknown,
): { id: string; label: string; description: string | null }[] {
  const raw = record(initializeResult).authMethods;
  if (!Array.isArray(raw)) return [];
  const out: { id: string; label: string; description: string | null }[] = [];
  for (const entry of raw) {
    const method = record(entry);
    const id = text(method.id);
    if (id === null) continue;
    out.push({
      id,
      label: text(method.name) ?? id,
      description: text(method.description),
    });
  }
  return out;
}

/**
 * ACP's reserved category identifiers, which is how a model and a reasoning
 * level arrive. `thought_level` is the one the effort selector binds to.
 */
const CONFIG_CATEGORIES: Record<string, AgentConfigCategory> = {
  model: 'model',
  model_config: 'model-config',
  thought_level: 'thought-level',
  mode: 'mode',
};

export function mapConfigOptions(source: unknown): AgentConfigOption[] {
  const raw = record(source).configOptions;
  if (!Array.isArray(raw)) return [];
  const out: AgentConfigOption[] = [];
  for (const entry of raw) {
    const option = record(entry);
    const id = text(option.id);
    if (id === null) continue;
    const choicesRaw = Array.isArray(option.options) ? option.options : [];
    const flattened = choicesRaw.flatMap((choice) => {
      const group = record(choice);
      return Array.isArray(group.options)
        ? group.options.map((item) => ({
            ...record(item),
            providerGroup: text(group.name) ?? text(group.group),
          }))
        : [choice];
    });
    const choices = flattened.flatMap((choice) => {
      const item = record(choice);
      const value = item.value;
      if (typeof value !== 'string' || value.length === 0) return [];
      return [
        {
          value,
          label:
            text(item.providerGroup) === null
              ? (text(item.name) ?? value)
              : `${text(item.providerGroup)} · ${text(item.name) ?? value}`,
          description: text(item.description),
        },
      ];
    });
    const current = option.currentValue;
    out.push({
      id,
      label: text(option.name) ?? id,
      description: text(option.description),
      category: CONFIG_CATEGORIES[String(option.category)] ?? 'other',
      value: typeof current === 'boolean' ? current : (text(current) ?? ''),
      choices,
    });
  }
  return out;
}

const TOOL_KINDS: Record<string, AgentToolKind> = {
  read: 'read',
  edit: 'edit',
  delete: 'delete',
  move: 'move',
  search: 'search',
  execute: 'execute',
  think: 'think',
  fetch: 'fetch',
  other: 'other',
};

const TOOL_STATUSES: Record<string, AgentToolStatus> = {
  pending: 'pending',
  in_progress: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

export function mapContent(source: unknown): AgentContent | null {
  const block = record(source);
  switch (block.type) {
    case 'text': {
      const value = block.text;
      return typeof value === 'string' ? { type: 'text', text: value } : null;
    }
    case 'image': {
      const data = text(block.data);
      const mimeType = text(block.mimeType);
      if (data === null || mimeType === null) return null;
      return { type: 'image', mimeType, data };
    }
    case 'resource_link': {
      const uri = text(block.uri);
      if (uri === null) return null;
      return { type: 'resource-link', uri, name: text(block.name) ?? uri };
    }
    // An embedded `resource` carries the text inline; flattening it keeps the
    // transcript renderable without a second content variant.
    case 'resource': {
      const resource = record(block.resource);
      const inline = text(resource.text);
      if (inline !== null) return { type: 'text', text: inline };
      const uri = text(resource.uri);
      return uri === null ? null : { type: 'resource-link', uri, name: uri };
    }
    default:
      return null;
  }
}

function mapToolContent(source: unknown): AgentToolContent | null {
  const item = record(source);
  switch (item.type) {
    case 'content': {
      const content = mapContent(item.content);
      return content === null ? null : { type: 'content', content };
    }
    case 'diff': {
      const path = text(item.path);
      if (path === null) return null;
      const newText = item.newText;
      return {
        type: 'diff',
        path,
        oldText: typeof item.oldText === 'string' ? item.oldText : null,
        newText: typeof newText === 'string' ? newText : '',
      };
    }
    case 'terminal': {
      const terminalId = text(item.terminalId);
      return terminalId === null ? null : { type: 'terminal', terminalId };
    }
    default:
      return null;
  }
}

/**
 * Builds a tool call from `tool_call` or `tool_call_update`.
 *
 * Only `toolCallId` is required on an update, so a previous snapshot is merged
 * to avoid a completed call losing its title and diff on the event that marks it
 * complete. That regression is invisible in a happy-path demo and obvious the
 * moment a real edit lands.
 */
export function mapToolCall(
  source: unknown,
  previous?: AgentToolCall,
): AgentToolCall | null {
  const call = record(source);
  const toolCallId = text(call.toolCallId) ?? previous?.toolCallId ?? null;
  if (toolCallId === null) return null;

  const rawContent = Array.isArray(call.content) ? call.content : null;
  const content =
    rawContent === null
      ? (previous?.content ?? [])
      : rawContent.flatMap((entry) => {
          const mapped = mapToolContent(entry);
          return mapped === null ? [] : [mapped];
        });

  const rawLocations = Array.isArray(call.locations) ? call.locations : null;
  const paths =
    rawLocations === null
      ? (previous?.paths ?? [])
      : rawLocations.flatMap((entry) => {
          const path = text(record(entry).path);
          return path === null ? [] : [path];
        });

  const kind = TOOL_KINDS[String(call.kind)];
  const status = TOOL_STATUSES[String(call.status)];
  return {
    toolCallId,
    title: text(call.title) ?? previous?.title ?? '',
    kind: kind ?? previous?.kind ?? 'other',
    status: status ?? previous?.status ?? 'pending',
    content,
    paths,
  };
}

export function mapPlan(source: unknown): AgentPlanEntry[] {
  const raw = record(source).entries;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const item = record(entry);
    const content = text(item.content);
    if (content === null) return [];
    const status = item.status;
    return [
      {
        content,
        status:
          status === 'in_progress'
            ? 'running'
            : status === 'completed'
              ? 'completed'
              : 'pending',
      },
    ];
  });
}

const PERMISSION_DECISIONS: Record<string, AgentPermissionDecision> = {
  allow_once: 'allow-once',
  allow_always: 'allow-always',
  reject_once: 'reject-once',
  reject_always: 'reject-always',
};

export function mapPermissionOptions(source: unknown): AgentPermissionOption[] {
  const raw = record(source).options;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const option = record(entry);
    const optionId = text(option.optionId);
    if (optionId === null) return [];
    const decision = PERMISSION_DECISIONS[String(option.kind)];
    if (decision === undefined) return [];
    return [{ optionId, label: text(option.name) ?? optionId, decision }];
  });
}

/**
 * Picks the option to send for a decision, degrading when an agent does not
 * offer it. Grok frequently omits `allow_always`; a person who chose "always"
 * still expects the action to proceed, so it falls back to allowing once and the
 * caller persists the rule on our side instead.
 */
export function choosePermissionOption(
  options: readonly AgentPermissionOption[],
  decision: AgentPermissionDecision,
): AgentPermissionOption | null {
  const exact = options.find((option) => option.decision === decision);
  if (exact !== undefined) return exact;
  const fallback: Partial<Record<AgentPermissionDecision, AgentPermissionDecision>> = {
    'allow-always': 'allow-once',
    'reject-always': 'reject-once',
  };
  const alternative = fallback[decision];
  if (alternative === undefined) return null;
  return options.find((option) => option.decision === alternative) ?? null;
}

const STOP_REASONS: Record<string, AgentStopReason> = {
  end_turn: 'end-turn',
  max_tokens: 'max-tokens',
  max_turn_requests: 'max-turn-requests',
  refusal: 'refusal',
  cancelled: 'cancelled',
};

export function mapStopReason(source: unknown): AgentStopReason {
  return STOP_REASONS[String(record(source).stopReason)] ?? 'end-turn';
}

export function mapUsage(source: unknown): {
  usedTokens: number | null;
  contextWindow: number | null;
} {
  const update = record(source);
  const used = update.used;
  const size = update.size;
  return {
    usedTokens:
      typeof used === 'number' && Number.isFinite(used) ? Math.trunc(used) : null,
    contextWindow: typeof size === 'number' && size > 0 ? Math.trunc(size) : null,
  };
}

/** Content blocks for a prompt. Text and resource links are always accepted. */
export function toWireContent(content: AgentContent): Record<string, unknown> {
  switch (content.type) {
    case 'text':
      return { type: 'text', text: content.text };
    case 'image':
      return { type: 'image', mimeType: content.mimeType, data: content.data };
    case 'resource-link':
      return { type: 'resource_link', uri: content.uri, name: content.name };
  }
}
