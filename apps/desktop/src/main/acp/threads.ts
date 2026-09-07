/**
 * Canonical agent-chat history. The ACP session id is continuation metadata
 * (ADR 0004 / 0008): a thread still opens after the agent is uninstalled.
 *
 * ponytail: whole-transcript rewrite in the settings JSON blob. Move to an
 * append-only table if chats get long enough that the rewrite shows up.
 */
import { randomUUID } from 'node:crypto';

import {
  agentSessionEventSchema,
  type AgentDescriptor,
  type AgentSessionEvent,
  type AgentThread,
} from '@builderhelm/protocol';
import { z } from 'zod';

const INDEX_KEY = 'agent.thread-index';

function eventsKey(id: string): string {
  return `agent.thread.${id}`;
}

const metaSchema = z
  .object({
    id: z.string().uuid(),
    acpSessionId: z.string().min(1).max(512).nullable(),
    agent: z
      .object({
        id: z.string().min(1).max(64),
        label: z.string().min(1).max(80),
        command: z.string().min(1).max(4096),
        args: z.array(z.string().max(4096)).max(64),
      })
      .strict(),
    cwd: z.string().min(1).max(4096),
    /** Roster profile that started the thread; null for ad hoc threads. */
    profileId: z.string().max(64).nullable().default(null),
    title: z.string().min(1).max(200).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const indexSchema = z.array(metaSchema);
type Meta = z.infer<typeof metaSchema>;

export interface ThreadStore {
  read(key: string): string | undefined;
  write(key: string, valueJson: string, updatedAt: string): void;
}

export class AgentThreads {
  constructor(private readonly settings: ThreadStore) {}

  list(): AgentThread[] {
    return this.loadIndex()
      .map(toThread)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): { thread: AgentThread; events: AgentSessionEvent[] } | null {
    const meta = this.loadIndex().find((entry) => entry.id === id);
    if (meta === undefined) return null;
    return { thread: toThread(meta), events: this.events(id) };
  }

  create(
    agent: AgentDescriptor,
    cwd: string,
    profileId: string | null = null,
  ): AgentThread {
    const now = new Date().toISOString();
    const meta: Meta = {
      id: randomUUID(),
      acpSessionId: null,
      agent: { ...agent, args: [...agent.args] },
      cwd,
      profileId,
      title: null,
      createdAt: now,
      updatedAt: now,
    };
    this.saveIndex([...this.loadIndex(), meta]);
    this.saveEvents(meta.id, []);
    return toThread(meta);
  }

  attach(id: string, acpSessionId: string): void {
    this.patch(id, (meta) => ({ ...meta, acpSessionId }));
  }

  events(id: string): AgentSessionEvent[] {
    const raw = this.settings.read(eventsKey(id));
    if (raw === undefined) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((entry) => {
        const event = agentSessionEventSchema.safeParse(entry);
        return event.success ? [event.data] : [];
      });
    } catch {
      return [];
    }
  }

  append(id: string, event: AgentSessionEvent): void {
    this.saveEvents(id, coalesce(this.events(id), event));
    this.patch(id, (meta) => {
      const title =
        meta.title ?? (event.type === 'message.user' ? firstLine(event.text) : null);
      const acpSessionId =
        event.type === 'session.started' ? event.sessionId : meta.acpSessionId;
      return { ...meta, title, acpSessionId, updatedAt: new Date().toISOString() };
    });
  }

  private loadIndex(): Meta[] {
    const raw = this.settings.read(INDEX_KEY);
    if (raw === undefined) return [];
    try {
      const parsed = indexSchema.safeParse(JSON.parse(raw));
      return parsed.success ? [...parsed.data] : [];
    } catch {
      return [];
    }
  }

  private saveIndex(index: readonly Meta[]): void {
    this.settings.write(INDEX_KEY, JSON.stringify(index), new Date().toISOString());
  }

  private saveEvents(id: string, events: readonly AgentSessionEvent[]): void {
    this.settings.write(eventsKey(id), JSON.stringify(events), new Date().toISOString());
  }

  private patch(id: string, update: (meta: Meta) => Meta): void {
    const index = this.loadIndex();
    const at = index.findIndex((entry) => entry.id === id);
    if (at < 0) return;
    const current = index[at];
    if (current === undefined) return;
    index[at] = update(current);
    this.saveIndex(index);
  }
}

export function coalesce(
  events: readonly AgentSessionEvent[],
  event: AgentSessionEvent,
): AgentSessionEvent[] {
  const last = events.at(-1);
  if (
    last !== undefined &&
    (event.type === 'message.delta' || event.type === 'thought.delta') &&
    last.type === event.type &&
    last.turnId === event.turnId
  ) {
    return [...events.slice(0, -1), { ...last, text: last.text + event.text }];
  }
  if (event.type === 'tool.updated') {
    const index = events.findLastIndex(
      (entry) =>
        entry.type === 'tool.updated' &&
        entry.turnId === event.turnId &&
        entry.call.toolCallId === event.call.toolCallId,
    );
    if (index >= 0) {
      const next = events.slice();
      next[index] = event;
      return next;
    }
  }
  return [...events, event];
}

function firstLine(value: string): string | null {
  const line = value.trim().split('\n')[0] ?? '';
  if (line.length === 0) return null;
  return line.length <= 200 ? line : `${line.slice(0, 197)}…`;
}

function toThread(meta: Meta): AgentThread {
  return {
    ...meta,
    agent: { ...meta.agent, args: [...meta.agent.args] },
  };
}
