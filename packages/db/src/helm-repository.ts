import { randomUUID } from 'node:crypto';

import { utcNow } from '@zero/shared';

import type { ZeroDatabase } from './database.js';

export interface HelmAgentRow {
  readonly id: string;
  readonly name: string;
  readonly brief: string;
  readonly engine: 'claude' | 'codex' | 'grok';
  readonly places: readonly string[];
  readonly skillIds: readonly string[];
  readonly createdAt: string;
}

export interface HelmRoutineRow {
  readonly id: string;
  readonly agentId: string;
  readonly name: string;
  readonly instruction: string;
  readonly everyMinutes: number;
  readonly paused: boolean;
  readonly lastRunAt: string | null;
  readonly lastError: string | null;
}

export interface HelmPluginRow {
  readonly id: 'github';
  readonly connected: boolean;
  readonly account: string | null;
}

export class HelmRepository {
  constructor(private readonly database: ZeroDatabase) {}

  listAgents(): HelmAgentRow[] {
    return this.database
      .queryAll<{
        id: string;
        name: string;
        brief: string;
        engine: string;
        places_json: string;
        skill_ids_json: string;
        created_at: string;
      }>(
        `SELECT id, name, brief, engine, places_json, skill_ids_json, created_at
         FROM helm_agents ORDER BY created_at DESC`,
      )
      .map((row) => ({
        id: row.id,
        name: row.name,
        brief: row.brief,
        engine: row.engine as HelmAgentRow['engine'],
        places: JSON.parse(row.places_json) as string[],
        skillIds: JSON.parse(row.skill_ids_json) as string[],
        createdAt: row.created_at,
      }));
  }

  createAgent(input: {
    readonly name: string;
    readonly brief: string;
    readonly engine: HelmAgentRow['engine'];
    readonly places: readonly string[];
    readonly skillIds: readonly string[];
  }): HelmAgentRow {
    const agent: HelmAgentRow = {
      id: randomUUID(),
      name: input.name,
      brief: input.brief,
      engine: input.engine,
      places: [...input.places],
      skillIds: [...input.skillIds],
      createdAt: utcNow(),
    };
    this.database.run(
      `INSERT INTO helm_agents (id, name, brief, engine, places_json, skill_ids_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        agent.id,
        agent.name,
        agent.brief,
        agent.engine,
        JSON.stringify(agent.places),
        JSON.stringify(agent.skillIds),
        agent.createdAt,
      ],
    );
    return agent;
  }

  listRoutines(): HelmRoutineRow[] {
    return this.database
      .queryAll<{
        id: string;
        agent_id: string;
        name: string;
        instruction: string;
        every_minutes: number;
        paused: number;
        last_run_at: string | null;
        last_error: string | null;
      }>(
        `SELECT id, agent_id, name, instruction, every_minutes, paused, last_run_at, last_error
         FROM helm_routines ORDER BY name`,
      )
      .map((row) => ({
        id: row.id,
        agentId: row.agent_id,
        name: row.name,
        instruction: row.instruction,
        everyMinutes: row.every_minutes,
        paused: row.paused === 1,
        lastRunAt: row.last_run_at,
        lastError: row.last_error,
      }));
  }

  createRoutine(input: {
    readonly agentId: string;
    readonly name: string;
    readonly instruction: string;
    readonly everyMinutes: number;
  }): HelmRoutineRow {
    const routine: HelmRoutineRow = {
      id: randomUUID(),
      agentId: input.agentId,
      name: input.name,
      instruction: input.instruction,
      everyMinutes: input.everyMinutes,
      paused: false,
      lastRunAt: null,
      lastError: null,
    };
    this.database.run(
      `INSERT INTO helm_routines (id, agent_id, name, instruction, every_minutes, paused, last_run_at, last_error)
       VALUES (?, ?, ?, ?, ?, 0, NULL, NULL)`,
      [
        routine.id,
        routine.agentId,
        routine.name,
        routine.instruction,
        routine.everyMinutes,
      ],
    );
    return routine;
  }

  dueRoutines(nowMs: number): HelmRoutineRow[] {
    return this.listRoutines().filter((routine) => {
      if (routine.paused) return false;
      if (routine.lastRunAt === null) return true;
      const last = Date.parse(routine.lastRunAt);
      return nowMs - last >= routine.everyMinutes * 60_000;
    });
  }

  markRoutineRun(id: string, error: string | null): void {
    this.database.run(
      `UPDATE helm_routines SET last_run_at = ?, last_error = ? WHERE id = ?`,
      [utcNow(), error, id],
    );
  }

  getPlugin(): HelmPluginRow {
    const row = this.database.queryOne<{ connected: number; account: string | null }>(
      `SELECT connected, account FROM helm_plugins WHERE id = 'github'`,
    );
    return {
      id: 'github',
      connected: row?.connected === 1,
      account: row?.account ?? null,
    };
  }

  setPlugin(connected: boolean, account: string | null): HelmPluginRow {
    this.database.run(
      `UPDATE helm_plugins SET connected = ?, account = ? WHERE id = 'github'`,
      [connected ? 1 : 0, account],
    );
    return this.getPlugin();
  }
}
