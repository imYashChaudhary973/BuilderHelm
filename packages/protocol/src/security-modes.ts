/**
 * Execution mode, access scope, and approval policy are three axes.
 * Swarm's safe/auto/full is a preset across them, not a fourth engine.
 *
 * A prompt-only instruction is never described as enforced Plan. Host
 * ACP policy and CLI flags are the enforcement; worktrees are not a sandbox.
 */
import type {
  AgentConfigOption,
  AgentPermissionDecision,
  AgentToolKind,
} from './agent-session.js';
import type { BoardAgentId, BoardAgentLaunchMode } from './board.js';

export const ACCESS_SCOPES = ['ask', 'read', 'workspace', 'full'] as const;
export type AccessScope = (typeof ACCESS_SCOPES)[number];

export const EXECUTION_MODES = ['plan', 'build'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const APPROVAL_POLICIES = ['ask', 'accept-edits', 'bypass'] as const;
export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number];

export const MODE_ENFORCEMENTS = ['runtime', 'prompt-only', 'unsupported'] as const;
export type ModeEnforcement = (typeof MODE_ENFORCEMENTS)[number];

export interface LaunchModeAxes {
  readonly execution: ExecutionMode;
  readonly access: AccessScope;
  readonly approval: ApprovalPolicy;
}

/** Visible Swarm presets. Full is never inferred; it is this explicit choice. */
export function launchModeAxes(mode: BoardAgentLaunchMode): LaunchModeAxes {
  if (mode === 'safe') {
    return { execution: 'plan', access: 'read', approval: 'ask' };
  }
  if (mode === 'auto') {
    return { execution: 'build', access: 'workspace', approval: 'accept-edits' };
  }
  return { execution: 'build', access: 'full', approval: 'bypass' };
}

/**
 * How this host actually enforces a advertised swarm mode. `unsupported`
 * means the catalog must not list it. `prompt-only` means we launch without
 * a read-only/plan/sandbox flag and must not claim Plan is enforced.
 */
export function runtimeModeEnforcement(
  agentId: BoardAgentId,
  mode: BoardAgentLaunchMode,
): ModeEnforcement {
  if (
    agentId === 'claude' ||
    agentId === 'codex' ||
    agentId === 'grok' ||
    agentId === 'gemini'
  ) {
    return 'runtime';
  }
  if (agentId === 'opencode') {
    if (mode === 'safe') return 'unsupported';
    if (mode === 'full') return 'runtime';
    return 'prompt-only';
  }
  if (agentId === 'kimi') {
    if (mode === 'safe') return 'unsupported';
    return 'runtime';
  }
  if (agentId === 'omp') {
    if (mode === 'safe') return 'unsupported';
    return 'runtime';
  }
  if (agentId === 'pi') {
    if (mode === 'full') return 'unsupported';
    if (mode === 'safe') return 'unsupported';
    return 'runtime';
  }
  return 'unsupported';
}

/**
 * ACP config chips are the runtime's. Host policy follows only known
 * plan / accept-edits / bypass values; anything else stays `ask` so we
 * never treat an unknown chip as Full.
 */
export function accessFromConfig(
  options: readonly Pick<AgentConfigOption, 'category' | 'value'>[],
): AccessScope {
  const mode = options.find((option) => option.category === 'mode');
  if (mode === undefined || typeof mode.value !== 'string') return 'ask';
  const value = mode.value.toLowerCase();
  if (
    value.includes('plan') ||
    value.includes('read-only') ||
    value.includes('read_only')
  ) {
    return 'read';
  }
  if (
    value.includes('bypass') ||
    value.includes('yolo') ||
    value.includes('danger') ||
    value.includes('full-access')
  ) {
    return 'full';
  }
  if (
    value.includes('acceptedit') ||
    value.includes('accept_edit') ||
    value.includes('accept-edit') ||
    value.includes('auto_edit') ||
    value.includes('auto-edit')
  ) {
    return 'workspace';
  }
  return 'ask';
}

export function hostAllowsFsWrite(access: AccessScope): boolean {
  return access !== 'read';
}

/**
 * What the host will do with one tool kind under the current access scope.
 * Accept-edits allows file edits only. Plan denies mutation even if a
 * remembered always-allow exists — that check is in `resolveAgentPermission`.
 */
export function hostPermissionForKind(
  access: AccessScope,
  kind: AgentToolKind,
): 'allow' | 'ask' | 'deny' {
  const readLike = kind === 'read' || kind === 'search' || kind === 'think';
  if (access === 'read') return readLike ? 'allow' : 'deny';
  if (access === 'full') return 'allow';
  if (access === 'workspace') {
    if (readLike || kind === 'edit') return 'allow';
    return 'ask';
  }
  return 'ask';
}

export function resolveAgentPermission(input: {
  readonly access: AccessScope;
  readonly kind: AgentToolKind;
  readonly remembered: 'allow-always' | 'reject-always' | null;
}): AgentPermissionDecision | 'ask' {
  const host = hostPermissionForKind(input.access, input.kind);
  if (host === 'deny') return 'reject-once';
  if (input.remembered === 'reject-always') return 'reject-always';
  if (input.remembered === 'allow-always') return 'allow-always';
  if (host === 'allow') return 'allow-once';
  return 'ask';
}
