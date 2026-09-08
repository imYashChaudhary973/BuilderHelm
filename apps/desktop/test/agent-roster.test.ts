import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { AgentProfile, AgentThread } from '@builderhelm/protocol';
import {
  compactTokens,
  deriveStatus,
  latestThreadForProfile,
  recentProfiles,
} from '../src/renderer/src/routes/chat-status.js';

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    id: randomUUID(),
    acpSessionId: null,
    profileId: null,
    agent: { id: 'codex', label: 'Codex', command: 'codex-acp', args: [] },
    cwd: '/w',
    title: null,
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    ...overrides,
  };
}

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: `profile-${randomUUID()}`,
    name: 'Social Content Manager',
    mark: 'diamond',
    agent: { id: 'codex', label: 'Codex', command: 'codex-acp', args: [] },
    defaultCwd: null,
    launch: null,
    instructions: '',
    createdAt: '2026-09-07T00:00:00.000Z',
    lastOpenedAt: '2026-09-07T00:00:00.000Z',
    ...overrides,
  };
}

describe('deriveStatus', () => {
  it('puts an approval ahead of everything else', () => {
    expect(
      deriveStatus({
        streaming: true,
        permissionPending: true,
        authRequired: true,
      }),
    ).toBe('approval');
  });

  it('reports sign-in, working, and ready in order', () => {
    expect(
      deriveStatus({ streaming: true, permissionPending: false, authRequired: true }),
    ).toBe('signin');
    expect(
      deriveStatus({ streaming: true, permissionPending: false, authRequired: false }),
    ).toBe('working');
    expect(
      deriveStatus({ streaming: false, permissionPending: false, authRequired: false }),
    ).toBe('ready');
  });
});

describe('latestThreadForProfile', () => {
  it('returns the most recently updated thread of that profile only', () => {
    const mine = profile();
    const older = thread({
      profileId: mine.id,
      updatedAt: '2026-09-06T00:00:00.000Z',
    });
    const newer = thread({ profileId: mine.id, updatedAt: '2026-09-07T01:00:00.000Z' });
    const other = thread({ updatedAt: '2026-09-07T09:00:00.000Z' });

    expect(latestThreadForProfile([older, other, newer], mine.id)?.id).toBe(newer.id);
  });

  it('returns null when the profile has no threads', () => {
    expect(latestThreadForProfile([thread()], 'profile-nope')).toBeNull();
  });
});

describe('recentProfiles', () => {
  it('orders by last opened and truncates', () => {
    const a = profile({ lastOpenedAt: '2026-09-01T00:00:00.000Z' });
    const b = profile({ lastOpenedAt: '2026-09-07T00:00:00.000Z' });
    const c = profile({ lastOpenedAt: '2026-09-03T00:00:00.000Z' });
    expect(recentProfiles([a, b, c], 2).map((p) => p.id)).toEqual([b.id, c.id]);
  });
});

describe('compactTokens', () => {
  it('formats thousands and millions', () => {
    expect(compactTokens(21_594)).toBe('21.6k');
    expect(compactTokens(5_800_000)).toBe('5.8M');
    expect(compactTokens(940)).toBe('940');
  });
});
