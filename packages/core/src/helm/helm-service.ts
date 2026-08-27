import type { HelmRepository } from '@zero/db';
import {
  helmAgentSchema,
  helmConnectPluginInputSchema,
  helmCreateAgentInputSchema,
  helmCreateRoutineInputSchema,
  helmPluginSchema,
  helmRoutineSchema,
} from '@zero/protocol';
import type { HelmAgent, HelmPlugin, HelmRoutine } from '@zero/protocol';

import type { SecretStore } from '../secrets/secret-store.js';
const GITHUB_SECRET = 'plugin:github';

export class HelmService {
  constructor(
    private readonly repository: HelmRepository,
    private readonly secrets: SecretStore,
  ) {}

  listAgents(): HelmAgent[] {
    return this.repository.listAgents().map((row) => helmAgentSchema.parse(row));
  }

  createAgent(input: unknown): HelmAgent {
    const parsed = helmCreateAgentInputSchema.parse(input);
    return helmAgentSchema.parse(this.repository.createAgent(parsed));
  }

  listRoutines(): HelmRoutine[] {
    return this.repository.listRoutines().map((row) => helmRoutineSchema.parse(row));
  }

  createRoutine(input: unknown): HelmRoutine {
    const parsed = helmCreateRoutineInputSchema.parse(input);
    if (this.listAgents().every((agent) => agent.id !== parsed.agentId)) {
      throw new Error('Unknown teammate');
    }
    return helmRoutineSchema.parse(this.repository.createRoutine(parsed));
  }

  dueRoutines(nowMs: number): HelmRoutine[] {
    return this.repository.dueRoutines(nowMs);
  }

  markRoutineRun(id: string, error: string | null): void {
    this.repository.markRoutineRun(id, error);
  }

  listPlugins(): HelmPlugin[] {
    return [helmPluginSchema.parse(this.repository.getPlugin())];
  }

  async connectPlugin(input: unknown): Promise<HelmPlugin> {
    const parsed = helmConnectPluginInputSchema.parse(input);
    await this.secrets.set(GITHUB_SECRET, parsed.token);
    return helmPluginSchema.parse(this.repository.setPlugin(true, 'github'));
  }
}
