/**
 * Which agents this machine can run, and how to launch them.
 *
 * [ADR 0008](../../../../../docs/adr/0008-agent-client-protocol-host.md) draws a
 * hard line here: BuilderHelm never installs an agent. Detection *offers* a
 * command it found on `PATH`, and the person decides. Nothing is downloaded,
 * bundled, or auto-configured, and no vendor gets a special code path.
 *
 * The known list below is convenience, not integration: it is the argv that
 * turns each agent's own CLI into an ACP server, so a person does not have to
 * look it up. An agent absent from this list is configured by hand and works
 * identically, which is the test of whether the host is really generic.
 */
import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

import type { AgentDescriptor } from '@builderhelm/protocol';
import { z } from 'zod';

/**
 * The ACP invocation for agents that ship one, verified locally:
 * `gemini --acp`, `opencode acp`, and `kimi acp`. Grok and Claude are
 * documented rather than verified here, Claude via the adapter its own registry
 * entry points at.
 */
const KNOWN: readonly {
  id: string;
  label: string;
  command: string;
  args: readonly string[];
}[] = [
  { id: 'gemini', label: 'Gemini', command: 'gemini', args: ['--acp'] },
  { id: 'opencode', label: 'OpenCode', command: 'opencode', args: ['acp'] },
  { id: 'grok', label: 'Grok', command: 'grok', args: ['agent', 'stdio'] },
  { id: 'claude', label: 'Claude', command: 'claude-agent-acp', args: [] },
  { id: 'codex', label: 'Codex', command: 'codex-acp', args: [] },
  { id: 'kimi', label: 'Kimi', command: 'kimi', args: ['acp'] },
];

const SETTINGS_KEY = 'agent.configured';

const configuredSchema = z.array(
  z
    .object({
      id: z.string().min(1).max(64),
      label: z.string().min(1).max(80),
      command: z.string().min(1).max(4096),
      args: z.array(z.string().max(4096)).max(64),
    })
    .strict(),
);

export interface RegistryStore {
  read(key: string): string | undefined;
  write(key: string, valueJson: string, updatedAt: string): void;
}

/** A known agent and whether its command resolves on this machine. */
export interface AgentCandidate {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly available: boolean;
  readonly path: string | null;
  /** True once the person has added it, so the UI can distinguish offer from choice. */
  readonly configured: boolean;
}

export class AgentRegistry {
  constructor(private readonly settings: RegistryStore) {}

  /**
   * Everything configured, plus every known agent found on `PATH`. A configured
   * agent is listed even when its command has since disappeared, because
   * silently dropping it would look like data loss.
   */
  async candidates(): Promise<AgentCandidate[]> {
    const configured = this.configured();
    const byId = new Map(configured.map((agent) => [agent.id, agent]));
    const out: AgentCandidate[] = [];

    for (const agent of configured) {
      const path = await which(agent.command);
      out.push({ ...agent, available: path !== null, path, configured: true });
    }
    for (const known of KNOWN) {
      if (byId.has(known.id)) continue;
      const path = await which(known.command);
      if (path === null) continue;
      out.push({ ...known, available: true, path, configured: false });
    }
    return out;
  }

  configured(): AgentDescriptor[] {
    const raw = this.settings.read(SETTINGS_KEY);
    if (raw === undefined) return [];
    try {
      const parsed = configuredSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return [];
      return parsed.data.map((agent) => ({ ...agent, args: [...agent.args] }));
    } catch {
      return [];
    }
  }

  resolve(agentId: string): AgentDescriptor | null {
    const found = this.configured().find((agent) => agent.id === agentId);
    if (found !== undefined) return found;
    // A known agent on PATH is runnable before it is explicitly added, so the
    // first session does not require a settings trip.
    const known = KNOWN.find((agent) => agent.id === agentId);
    return known === undefined ? null : { ...known, args: [...known.args] };
  }

  add(agent: AgentDescriptor): void {
    const next = this.configured().filter((entry) => entry.id !== agent.id);
    next.push(agent);
    this.save(next);
  }

  remove(agentId: string): void {
    this.save(this.configured().filter((agent) => agent.id !== agentId));
  }

  private save(agents: readonly AgentDescriptor[]): void {
    this.settings.write(
      SETTINGS_KEY,
      JSON.stringify(agents.map((agent) => ({ ...agent, args: [...agent.args] }))),
      new Date().toISOString(),
    );
  }
}

/**
 * Resolves a command the way a shell would, without a shell.
 *
 * Spawning `which` would mean handing a user-supplied string to a shell, and an
 * absolute path is checked directly so a hand-configured agent outside `PATH`
 * still resolves.
 */
export async function which(command: string): Promise<string | null> {
  if (command.length === 0) return null;
  if (command.includes('/')) return (await executable(command)) ? command : null;
  const path = process.env['PATH'] ?? '';
  for (const dir of path.split(delimiter)) {
    if (dir.length === 0) continue;
    const candidate = join(dir, command);
    if (await executable(candidate)) return candidate;
  }
  return null;
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
