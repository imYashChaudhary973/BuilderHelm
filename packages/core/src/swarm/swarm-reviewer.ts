import type { SwarmReviewVerdict } from '@builderhelm/protocol';

export interface SwarmReviewRequest {
  readonly taskTitle: string;
  readonly files: readonly string[];
  readonly diff: string;
}

/** A second pair of eyes after the deterministic gate, before the land queue. */
export interface SwarmReviewer {
  review(request: SwarmReviewRequest): Promise<SwarmReviewVerdict>;
}

export function buildReviewPrompt(request: SwarmReviewRequest): string {
  return [
    'Review this diff for a BuilderHelm swarm task.',
    'Approve when it is correct and complete. Ask for a fix only for real',
    'defects: wrong behavior, missing error handling, or missing tests for new',
    'logic. Style nits are not fix reasons.',
    '',
    `Task: ${request.taskTitle}`,
    request.files.length > 0 ? `Files owned: ${request.files.join(', ')}` : '',
    '',
    'Diff:',
    request.diff.slice(0, 60_000),
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}
