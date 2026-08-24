import {
  BOARD_AGENT_CATALOG,
  type BoardAgentDetection,
  type BoardAgentId,
  type BoardPaneStatus,
} from './board.js';

export const SWARM_ROLES = ['coordinator', 'builder', 'scout', 'reviewer'] as const;
export type SwarmRole = (typeof SWARM_ROLES)[number];

export const SWARM_PANE_COUNT = 8;
export const SWARM_BUDGET_MS = 20 * 60 * 1000;
export const SWARM_STUCK_MS = 90 * 1000;

export type SwarmMemberStatus = 'starting' | 'running' | 'stuck' | 'exited' | 'failed';
export type SwarmStuckAction = 'none' | 'nudge' | 'stop';

export type SwarmRunStatus = 'running' | 'stuck' | 'budget' | 'stopped' | 'done';

export interface SwarmAssignment {
  readonly role: SwarmRole;
  readonly agentId: BoardAgentId;
}

const DUTY: Record<SwarmRole, string> = {
  coordinator:
    'Split the job, track the other roles, and stop when the job is done. Do not implement the whole job yourself.',
  builder: 'Implement the job in this folder. Keep the diff small and ship working code.',
  scout: 'Explore the repo and report what matters. Do not implement unless asked.',
  reviewer: 'Review the Builder work. Name bugs and missing tests. Do not rewrite everything.',
};

export const SWARM_OPENCODE_MODEL = 'openrouter/stealth/ox-alpha';

export const SWARM_PRESETS = [
  { id: 'recon', size: 3 as const, label: 'Recon', seats: { coordinator: 1, builder: 1, scout: 1, reviewer: 0 } },
  { id: 'squad', size: 5 as const, label: 'Squad', seats: { coordinator: 1, builder: 2, scout: 1, reviewer: 1 } },
  { id: 'crew', size: 8 as const, label: 'Crew', seats: { coordinator: 1, builder: 5, scout: 1, reviewer: 1 } },
  { id: 'full', size: 12 as const, label: 'Full swarm', seats: { coordinator: 1, builder: 9, scout: 1, reviewer: 1 } },
] as const;
export type SwarmPresetId = (typeof SWARM_PRESETS)[number]['id'];

export const SWARM_SKILLS = [
  { id: 'commits', group: 'workflow', title: 'Incremental Commits', detail: 'Commit small, atomic changes.' },
  { id: 'refactor', group: 'workflow', title: 'Refactor Only', detail: 'Restructure without changing behavior.' },
  { id: 'monorepo', group: 'workflow', title: 'Monorepo Aware', detail: 'Respect package boundaries.' },
  { id: 'tdd', group: 'quality', title: 'Test-Driven', detail: 'Write tests first, then implement.' },
  { id: 'review', group: 'quality', title: 'Code Review', detail: 'Review all changes before merge.' },
  { id: 'docs', group: 'quality', title: 'Documentation', detail: 'Document all public APIs.' },
  { id: 'security', group: 'quality', title: 'Security Audit', detail: 'Check for vulnerabilities.' },
  { id: 'dry', group: 'quality', title: 'DRY Principle', detail: 'Eliminate code duplication.' },
  { id: 'a11y', group: 'quality', title: 'Accessibility', detail: 'Ensure UI meets WCAG.' },
  { id: 'ci', group: 'ops', title: 'Keep CI Green', detail: 'Ensure all checks pass.' },
  { id: 'migrations', group: 'ops', title: 'Migration Safe', detail: 'Ensure DB changes are safe.' },
  { id: 'perf', group: 'analysis', title: 'Performance', detail: 'Optimize for speed and cost.' },
] as const;
export type SwarmSkillId = (typeof SWARM_SKILLS)[number]['id'];
export type SwarmLaunchMode = 'safe' | 'skip';

export function swarmPresetRoles(id: SwarmPresetId): SwarmRole[] {
  const preset = SWARM_PRESETS.find((item) => item.id === id)!;
  const roles: SwarmRole[] = [];
  for (const role of SWARM_ROLES) {
    for (let n = 0; n < preset.seats[role]; n += 1) roles.push(role);
  }
  return roles;
}

export function swarmSkillLines(ids: readonly string[]): string {
  return SWARM_SKILLS.filter((skill) => ids.includes(skill.id))
    .map((skill) => `${skill.title}: ${skill.detail}`)
    .join('\n');
}

export function availableSwarmAgents(
  detections: readonly BoardAgentDetection[],
): BoardAgentId[] {
  return detections
    .filter((item) => item.available && item.id !== 'shell' && item.id !== 'custom')
    .map((item) => item.id);
}

export function assignSwarmPanes(
  agentIds: readonly BoardAgentId[],
  roles: readonly SwarmRole[] = SWARM_ROLES,
): SwarmAssignment[] {
  if (agentIds.length === 0 || roles.length === 0) return [];
  return roles.map((role, index) => ({
    role,
    agentId: agentIds[index % agentIds.length]!,
  }));
}

export function swarmBrief(role: SwarmRole, job: string): string {
  const clipped = job.trim().slice(0, 2_000);
  return `You are the ${role} in a BuilderHelm Swarm.\nJob: ${clipped}\n\n${DUTY[role]}\n`;
}
export function swarmRoleTasks(job: string): Record<SwarmRole, string> {
  const clipped = job.trim().slice(0, 200);
  const body = clipped || 'the swarm job';
  return {
    coordinator: `Coordinate: ${body}`,
    builder: `Build: ${body}`,
    scout: `Scout: ${body}`,
    reviewer: `Review: ${body}`,
  };
}

export function swarmPaneCommand(
  agentId: BoardAgentId,
  prompt: string,
  mode: SwarmLaunchMode = 'safe',
): string {
  const binary =
    BOARD_AGENT_CATALOG.find((entry) => entry.id === agentId)?.command || agentId;
  const skip = mode === 'skip';
  const prefix =
    agentId === 'gemini'
      ? 'gemini --skip-trust '
      : agentId === 'opencode'
        ? `opencode --model ${SWARM_OPENCODE_MODEL}${skip ? ' --auto' : ''} --prompt `
        : agentId === 'claude' && skip
          ? 'claude --dangerously-skip-permissions '
          : `${binary} `;
  const budget = Math.max(1, 4_000 - prefix.length - 2);
  const body = prompt.trim().slice(0, budget).replaceAll("'", "'\\''");
  return `${prefix}'${body}'`;
}


export const SWARM_NUDGE =
  'You have been silent. Report status in one line, then continue or say you are blocked.';


export function swarmStuckAction(input: {
  readonly status: SwarmMemberStatus;
  readonly nudgedAt: number | null;
  readonly now: number;
  readonly stuckAfterMs: number;
}): SwarmStuckAction {
  if (input.status !== 'stuck') return 'none';
  if (input.nudgedAt === null) return 'nudge';
  if (input.now - input.nudgedAt >= input.stuckAfterMs) return 'stop';
  return 'none';
}


export function swarmMemberStatus(input: {
  readonly paneStatus: BoardPaneStatus;
  readonly lastActivityAt: number;
  readonly now: number;
  readonly stuckAfterMs: number;
}): SwarmMemberStatus {
  if (input.paneStatus === 'exited' || input.paneStatus === 'failed') {
    return input.paneStatus;
  }
  if (input.paneStatus === 'starting') return 'starting';
  if (input.now - input.lastActivityAt >= input.stuckAfterMs) return 'stuck';
  return 'running';
}

export function swarmRunStatus(input: {
  readonly members: readonly SwarmMemberStatus[];
  readonly elapsedMs: number;
  readonly budgetMs: number;
  readonly stopped: boolean;
}): SwarmRunStatus {
  if (input.stopped) return 'stopped';
  if (input.elapsedMs >= input.budgetMs) return 'budget';
  if (input.members.length === 0) return 'running';
  if (input.members.every((item) => item === 'exited' || item === 'failed')) return 'done';
  if (input.members.some((item) => item === 'stuck')) return 'stuck';
  return 'running';
}
