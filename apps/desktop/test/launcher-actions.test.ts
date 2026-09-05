import { describe, expect, it } from 'vitest';

import {
  filterLauncherActions,
  type LauncherAction,
} from '../src/renderer/src/launcher-actions.js';

const sample: LauncherAction[] = [
  {
    id: 'create.chat',
    group: 'create',
    label: 'Agent thread',
    keywords: ['chat', 'conversation'],
    available: true,
    detail: 'Open Chats',
    run: () => undefined,
  },
  {
    id: 'open.tasks',
    group: 'open',
    label: 'Tasks',
    keywords: ['board'],
    available: true,
    detail: 'Project board',
    run: () => undefined,
  },
];

describe('filterLauncherActions', () => {
  it('returns everything when the query is blank', () => {
    expect(filterLauncherActions(sample, '  ')).toHaveLength(2);
  });

  it('matches keywords, not only the visible label', () => {
    expect(filterLauncherActions(sample, 'board').map((action) => action.id)).toEqual([
      'open.tasks',
    ]);
  });
});
