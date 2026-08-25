import type { ZeroDatabase } from './database.js';

export interface SwarmRunWrite {
  readonly id: string;
  readonly name: string;
  readonly folderPath: string;
  readonly mission: string;
  readonly launchMode: string;
  readonly presetId: string;
  readonly skillIds: readonly string[];
  readonly boardSessionId: string | null;
  readonly status: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly budgetMs: number;
}

export interface SwarmSeatWrite {
  readonly id: string;
  readonly runId: string;
  readonly role: string;
  readonly agentId: string;
  readonly mode: string;
  readonly paneId: string | null;
  readonly worktreePath: string | null;
  readonly branch: string | null;
  readonly status: string;
  readonly tokensUsed: number;
  readonly costUsd: number;
}

export interface SwarmTaskWrite {
  readonly id: string;
  readonly runId: string;
  readonly seatId: string | null;
  readonly title: string;
  readonly detail: string | null;
  readonly files: readonly string[];
  readonly status: string;
  readonly dependsOn: readonly string[];
  readonly attempts: number;
  readonly landedCommit: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SwarmMessageWrite {
  readonly id: string;
  readonly runId: string;
  readonly seatId: string | null;
  readonly kind: string;
  readonly body: string;
  readonly createdAt: string;
}

interface StoredSwarmRun extends Record<string, unknown> {
  id: string;
  name: string;
  folder_path: string;
  mission: string;
  launch_mode: string;
  preset_id: string;
  skills_json: string;
  board_session_id: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  budget_ms: number;
}

interface StoredSwarmSeat extends Record<string, unknown> {
  id: string;
  run_id: string;
  role: string;
  agent_id: string;
  mode: string;
  pane_id: string | null;
  worktree_path: string | null;
  branch: string | null;
  status: string;
  tokens_used: number;
  cost_usd: number;
}

interface StoredSwarmTask extends Record<string, unknown> {
  id: string;
  run_id: string;
  seat_id: string | null;
  title: string;
  detail: string | null;
  files_json: string;
  status: string;
  depends_on_json: string;
  attempts: number;
  landed_commit: string | null;
  created_at: string;
  updated_at: string;
}

interface StoredSwarmMessage extends Record<string, unknown> {
  id: string;
  run_id: string;
  seat_id: string | null;
  kind: string;
  body: string;
  created_at: string;
}

function toRunWrite(row: StoredSwarmRun): SwarmRunWrite {
  return {
    id: row.id,
    name: row.name,
    folderPath: row.folder_path,
    mission: row.mission,
    launchMode: row.launch_mode,
    presetId: row.preset_id,
    skillIds: JSON.parse(row.skills_json) as string[],
    boardSessionId: row.board_session_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    budgetMs: row.budget_ms,
  };
}

function toSeatWrite(row: StoredSwarmSeat): SwarmSeatWrite {
  return {
    id: row.id,
    runId: row.run_id,
    role: row.role,
    agentId: row.agent_id,
    mode: row.mode,
    paneId: row.pane_id,
    worktreePath: row.worktree_path,
    branch: row.branch,
    status: row.status,
    tokensUsed: row.tokens_used,
    costUsd: row.cost_usd,
  };
}

function toTaskWrite(row: StoredSwarmTask): SwarmTaskWrite {
  return {
    id: row.id,
    runId: row.run_id,
    seatId: row.seat_id,
    title: row.title,
    detail: row.detail,
    files: JSON.parse(row.files_json) as string[],
    status: row.status,
    dependsOn: JSON.parse(row.depends_on_json) as string[],
    attempts: row.attempts,
    landedCommit: row.landed_commit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessageWrite(row: StoredSwarmMessage): SwarmMessageWrite {
  return {
    id: row.id,
    runId: row.run_id,
    seatId: row.seat_id,
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
  };
}

export class SwarmRepository {
  constructor(private readonly database: ZeroDatabase) {}

  createRun(run: SwarmRunWrite, seats: readonly SwarmSeatWrite[]): void {
    this.database.transaction(() => {
      this.database.run(
        `INSERT INTO swarm_runs (id, name, folder_path, mission, launch_mode, preset_id,
           skills_json, board_session_id, status, started_at, ended_at, budget_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          run.id,
          run.name,
          run.folderPath,
          run.mission,
          run.launchMode,
          run.presetId,
          JSON.stringify(run.skillIds),
          run.boardSessionId,
          run.status,
          run.startedAt,
          run.endedAt,
          run.budgetMs,
        ],
      );
      for (const seat of seats) {
        this.insertSeat(seat);
      }
    });
  }

  getRun(id: string): SwarmRunWrite | undefined {
    return this.database
      .queryAll<StoredSwarmRun>('SELECT * FROM swarm_runs WHERE id = ?', [id])
      .map(toRunWrite)
      .at(0);
  }

  listRuns(limit = 20): SwarmRunWrite[] {
    return this.database
      .queryAll<StoredSwarmRun>(
        'SELECT * FROM swarm_runs ORDER BY started_at DESC LIMIT ?',
        [limit],
      )
      .map(toRunWrite);
  }

  updateRun(id: string, status: string, endedAt: string | null): void {
    this.database.run('UPDATE swarm_runs SET status = ?, ended_at = ? WHERE id = ?', [
      status,
      endedAt,
      id,
    ]);
  }

  setBoardSession(id: string, boardSessionId: string): void {
    this.database.run('UPDATE swarm_runs SET board_session_id = ? WHERE id = ?', [
      boardSessionId,
      id,
    ]);
  }

  private insertSeat(seat: SwarmSeatWrite): void {
    this.database.run(
      `INSERT INTO swarm_seats (id, run_id, role, agent_id, mode, pane_id,
         worktree_path, branch, status, tokens_used, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        seat.id,
        seat.runId,
        seat.role,
        seat.agentId,
        seat.mode,
        seat.paneId,
        seat.worktreePath,
        seat.branch,
        seat.status,
        seat.tokensUsed,
        seat.costUsd,
      ],
    );
  }

  updateSeat(seat: SwarmSeatWrite): void {
    this.database.run(
      `UPDATE swarm_seats SET pane_id = ?, worktree_path = ?, branch = ?,
         status = ?, tokens_used = ?, cost_usd = ?
       WHERE id = ?`,
      [
        seat.paneId,
        seat.worktreePath,
        seat.branch,
        seat.status,
        seat.tokensUsed,
        seat.costUsd,
        seat.id,
      ],
    );
  }

  getSeat(id: string): SwarmSeatWrite | undefined {
    return this.database
      .queryAll<StoredSwarmSeat>('SELECT * FROM swarm_seats WHERE id = ?', [id])
      .map(toSeatWrite)
      .at(0);
  }

  listSeats(runId: string): SwarmSeatWrite[] {
    return this.database
      .queryAll<StoredSwarmSeat>('SELECT * FROM swarm_seats WHERE run_id = ?', [runId])
      .map(toSeatWrite);
  }

  insertTask(task: SwarmTaskWrite): void {
    this.database.run(
      `INSERT INTO swarm_tasks (id, run_id, seat_id, title, detail, files_json,
         status, depends_on_json, attempts, landed_commit, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.runId,
        task.seatId,
        task.title,
        task.detail,
        JSON.stringify(task.files),
        task.status,
        JSON.stringify(task.dependsOn),
        task.attempts,
        task.landedCommit,
        task.createdAt,
        task.updatedAt,
      ],
    );
  }

  updateTask(task: SwarmTaskWrite): void {
    this.database.run(
      `UPDATE swarm_tasks SET seat_id = ?, status = ?, attempts = ?,
         landed_commit = ?, updated_at = ?
       WHERE id = ?`,
      [
        task.seatId,
        task.status,
        task.attempts,
        task.landedCommit,
        task.updatedAt,
        task.id,
      ],
    );
  }

  listTasks(runId: string): SwarmTaskWrite[] {
    return this.database
      .queryAll<StoredSwarmTask>(
        'SELECT * FROM swarm_tasks WHERE run_id = ? ORDER BY created_at ASC',
        [runId],
      )
      .map(toTaskWrite);
  }

  appendMessage(message: SwarmMessageWrite): void {
    this.database.run(
      `INSERT INTO swarm_messages (id, run_id, seat_id, kind, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.runId,
        message.seatId,
        message.kind,
        message.body,
        message.createdAt,
      ],
    );
  }

  listMessages(runId: string, limit = 200): SwarmMessageWrite[] {
    return this.database
      .queryAll<StoredSwarmMessage>(
        `SELECT * FROM swarm_messages WHERE run_id = ?
         ORDER BY created_at DESC LIMIT ?`,
        [runId, limit],
      )
      .map(toMessageWrite)
      .reverse();
  }
}
