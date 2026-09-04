/**
 * History that has to survive a restart, and the coalesce that keeps a
 * streamed turn from becoming thousands of rows.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { AgentDescriptor, AgentSessionEvent } from '@builderhelm/protocol';
import { AgentThreads, coalesce } from '../src/main/acp/threads.js';

function memoryStore(): {
  read(key: string): string | undefined;
  write(key: string, valueJson: string, updatedAt: string): void;
} {
  const rows = new Map<string, string>();
  return {
    read: (key) => rows.get(key),
    write: (key, valueJson) => {
      rows.set(key, valueJson);
    },
  };
}

const agent: AgentDescriptor = {
  id: 'gemini',
  label: 'Gemini',
  command: 'gemini',
  args: ['--acp'],
};

function delta(turnId: string, text: string): AgentSessionEvent {
  return { type: 'message.delta', sessionId: 's', turnId, text };
}

describe('coalesce', () => {
  it('joins consecutive deltas on the same turn', () => {
    const turnId = randomUUID();
    const events = coalesce([], delta(turnId, 'Hel'));
    expect(coalesce(events, delta(turnId, 'lo')).map((event) => event.type === 'message.delta' ? event.text : '')).toEqual([
      'Hello',
    ]);
  });

  it('does not join deltas from different turns', () => {
    const first = randomUUID();
    const second = randomUUID();
    const events = coalesce([delta(first, 'A')], delta(second, 'B'));
    expect(events).toHaveLength(2);
  });

  it('replaces a tool update with the same id rather than stacking them', () => {
    const turnId = randomUUID();
    const pending: AgentSessionEvent = {
      type: 'tool.updated',
      sessionId: 's',
      turnId,
      raw: null,
      call: {
        toolCallId: 't1',
        title: 'edit',
        kind: 'edit',
        status: 'pending',
        content: [],
        paths: ['/w/a.ts'],
      },
    };
    const done: AgentSessionEvent = {
      ...pending,
      call: { ...pending.call, status: 'completed' },
    };
    const events = coalesce(coalesce([], pending), done);
    expect(events).toHaveLength(1);
    expect(events[0]?.type === 'tool.updated' && events[0].call.status).toBe('completed');
  });
});

describe('AgentThreads', () => {
  it('survives the process that stored it', () => {
    const store = memoryStore();
    const first = new AgentThreads(store);
    const thread = first.create(agent, '/w');
    first.append(thread.id, {
      type: 'message.user',
      sessionId: 's',
      turnId: randomUUID(),
      text: 'Fix the login page',
    });
    first.attach(thread.id, 'acp-1');

    const reopened = new AgentThreads(store);
    const listed = reopened.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe('Fix the login page');
    expect(listed[0]?.acpSessionId).toBe('acp-1');
    expect(reopened.get(thread.id)?.events).toHaveLength(1);
  });

  it('keeps a thread after a corrupt events blob', () => {
    const store = memoryStore();
    const threads = new AgentThreads(store);
    const thread = threads.create(agent, '/w');
    store.write(`agent.thread.${thread.id}`, '{not json', new Date().toISOString());
    expect(threads.get(thread.id)?.events).toEqual([]);
  });
});
