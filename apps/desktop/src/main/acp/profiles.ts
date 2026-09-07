/**
 * The roster of named agent profiles ("Social Content Manager", …).
 *
 * A profile is presentation and defaults around an AgentDescriptor: the name
 * and mark the roster shows, and the project folder its threads default to.
 * The descriptor still resolves to argv here in main — the profile editor
 * writes a validated record, never a command line.
 *
 * Stored in the same settings blob as the agent registry and threads; the
 * profiles list is small and rewritten whole.
 */
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import {
  agentProfileInputSchema,
  agentProfileSchema,
  type AgentProfile,
  type AgentProfileInput,
} from '@builderhelm/protocol';
import { BuilderHelmError } from '@builderhelm/shared';
import { z } from 'zod';

import type { RegistryStore } from './registry.js';

const PROFILES_KEY = 'agent.profiles';

const listSchema = z.array(agentProfileSchema).max(64);

export class AgentProfiles {
  constructor(private readonly settings: RegistryStore) {}

  list(): AgentProfile[] {
    const raw = this.settings.read(PROFILES_KEY);
    if (raw === undefined) return [];
    try {
      const parsed = listSchema.safeParse(JSON.parse(raw));
      return parsed.success ? [...parsed.data] : [];
    } catch {
      return [];
    }
  }

  find(profileId: string): AgentProfile | null {
    return this.list().find((profile) => profile.id === profileId) ?? null;
  }

  upsert(input: AgentProfileInput): AgentProfile {
    const parsed = agentProfileInputSchema.parse(input);
    if (parsed.defaultCwd !== null && !isAbsolute(parsed.defaultCwd)) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'The project folder must be an absolute path.',
        { metadata: { defaultCwd: parsed.defaultCwd } },
      );
    }

    const profiles = this.list();
    const now = new Date().toISOString();

    if (parsed.id === undefined) {
      const profile: AgentProfile = {
        id: `profile-${randomUUID()}`,
        name: parsed.name,
        mark: parsed.mark,
        agent: { ...parsed.agent, args: [...parsed.agent.args] },
        defaultCwd: parsed.defaultCwd,
        createdAt: now,
        lastOpenedAt: now,
      };
      const validated = agentProfileSchema.parse(profile);
      this.save([...profiles, validated]);
      return validated;
    }

    const at = profiles.findIndex((profile) => profile.id === parsed.id);
    if (at < 0) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'That agent profile was not found.',
        { metadata: { profileId: parsed.id } },
      );
    }
    const existing = profiles[at];
    if (existing === undefined) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'That agent profile was not found.',
      );
    }
    const updated: AgentProfile = agentProfileSchema.parse({
      ...existing,
      name: parsed.name,
      mark: parsed.mark,
      agent: { ...parsed.agent, args: [...parsed.agent.args] },
      defaultCwd: parsed.defaultCwd,
    });
    profiles[at] = updated;
    this.save(profiles);
    return updated;
  }

  remove(profileId: string): void {
    const remaining = this.list().filter((profile) => profile.id !== profileId);
    this.save(remaining);
  }

  private save(profiles: readonly AgentProfile[]): void {
    this.settings.write(
      PROFILES_KEY,
      JSON.stringify(
        profiles.map((profile) => ({
          ...profile,
          agent: { ...profile.agent, args: [...profile.agent.args] },
        })),
      ),
      new Date().toISOString(),
    );
  }
}
