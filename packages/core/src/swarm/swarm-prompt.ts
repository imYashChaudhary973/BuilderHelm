import type { SwarmRole } from '@zero/protocol';

/** Everything after this marker varies per task; everything before it caches. */
export const SWARM_PROMPT_TASK_MARKER = '--- task ---';

const DUTY: Record<SwarmRole, string> = {
  coordinator:
    'You coordinate. Split work, track progress, and stop when the mission is done.',
  builder:
    'You implement. Touch only the files this task owns, keep the diff small, and commit working code.',
  scout: 'You investigate and report. Do not change files unless the task says so.',
  reviewer:
    'You review. Name real bugs and missing tests. Do not rewrite the whole change.',
};

export interface SeatPromptSkill {
  readonly title: string;
  readonly directive: string;
}

export interface SeatPromptInput {
  readonly role: SwarmRole;
  readonly mission: string;
  readonly skills: readonly SeatPromptSkill[];
  readonly task: {
    readonly title: string;
    readonly detail: string | null;
    readonly files: readonly string[];
  };
  readonly directives: readonly string[];
  readonly contextPack?: string;
}

/**
 * Builds a seat prompt with a cache-friendly layout: the stable prefix (role
 * duty, skills, mission, context pack) comes first so providers can reuse a
 * cached prefix across every task in a run, and only the tail changes.
 */
export function buildSeatPrompt(input: SeatPromptInput): string {
  const prefix = [
    `Role: ${input.role}`,
    DUTY[input.role],
    '',
    input.skills.length > 0
      ? `Standing directives:\n${input.skills
          .map((skill) => `- ${skill.title}: ${skill.directive}`)
          .join('\n')}`
      : 'Standing directives: none',
    '',
    `Mission: ${input.mission.trim()}`,
    input.contextPack !== undefined && input.contextPack.length > 0
      ? `\nContext:\n${input.contextPack}`
      : '',
  ]
    .join('\n')
    .trimEnd();

  const tail = [
    SWARM_PROMPT_TASK_MARKER,
    `Task: ${input.task.title}`,
    input.task.detail !== null && input.task.detail.length > 0
      ? `Acceptance: ${input.task.detail}`
      : '',
    input.task.files.length > 0
      ? `Files you own (touch nothing else):\n${input.task.files
          .map((file) => `- ${file}`)
          .join('\n')}`
      : 'Files: decide from the mission, and stay narrow.',
    input.directives.length > 0
      ? `New directives from the operator:\n${input.directives
          .map((directive) => `- ${directive}`)
          .join('\n')}`
      : '',
    'Commit your work in this worktree when the task is done.',
  ]
    .filter((line) => line.length > 0)
    .join('\n');

  return `${prefix}\n\n${tail}`;
}
