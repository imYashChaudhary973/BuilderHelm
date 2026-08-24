import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { ZeroDatabase } from '@zero/db';
import type { Logger } from '@zero/observability';
import {
  BOARD_AGENT_CATALOG,
  boardPresetRecordSchema,
  kanbanCardSchema,
  kanbanProjectCreateInputSchema,
  kanbanProjectSchema,
  type BoardAgentDetection,
  type BoardPresetRecord,
  type BoardPresetSpec,
  type KanbanCard,
  type KanbanColumn,
  type KanbanProject,
} from '@zero/protocol';
import { normalizeError, utcNow, ZeroError, type CorrelationId } from '@zero/shared';

const execFileAsync = promisify(execFile);

interface StoredBoardPreset extends Record<string, unknown> {
  id: string;
  name: string;
  folder_path: string;
  pane_count: number;
  isolation: string;
  panes_json: string;
  created_at: string;
}

const presetColumns = `
  id,
  name,
  folder_path AS folderPath,
  pane_count AS paneCount,
  isolation,
  panes_json AS panesJson,
  created_at AS createdAt
`;

function toRecord(row: StoredBoardPreset): BoardPresetRecord {
  return boardPresetRecordSchema.parse({
    name: row.name,
    folderPath: row.folderPath,
    paneCount: row.paneCount,
    isolation: row.isolation,
    panes: JSON.parse(String(row.panesJson)),
    id: row.id,
    createdAt: row.createdAt,
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_CONSTRAINT')
  );
}

function assertExeumBranch(branch: string): void {
  if (!/^exeum\/[A-Za-z0-9._-]+$/.test(branch)) {
    throw new ZeroError('VALIDATION_FAILED', 'Only exeum/* pane branches can be landed');
  }
}

export class BoardService {
  constructor(
    private readonly database: ZeroDatabase,
    private readonly logger: Logger,
  ) {}

  listPresets(): BoardPresetRecord[] {
    return this.database
      .queryAll<StoredBoardPreset>(
        `SELECT ${presetColumns} FROM board_presets ORDER BY created_at DESC`,
      )
      .map(toRecord);
  }

  savePreset(preset: BoardPresetSpec, correlationId: CorrelationId): BoardPresetRecord {
    const record: BoardPresetRecord = {
      ...preset,
      id: randomUUID(),
      createdAt: utcNow(),
    };
    try {
      this.database.run(
        `INSERT INTO board_presets (
          id, name, folder_path, pane_count, isolation, panes_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.name,
          record.folderPath,
          record.paneCount,
          record.isolation,
          JSON.stringify(record.panes),
          record.createdAt,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ZeroError(
          'VALIDATION_FAILED',
          'A preset with this name already exists',
          { cause: error },
        );
      }
      throw new ZeroError('DATABASE_FAILED', 'The preset could not be saved', {
        cause: error,
      });
    }
    this.logger.info({
      event: 'board.preset_saved',
      correlationId,
      data: { presetId: record.id, name: record.name },
    });
    return record;
  }

  deletePreset(id: string, correlationId: CorrelationId): void {
    this.database.run('DELETE FROM board_presets WHERE id = ?', [id]);
    this.logger.info({
      event: 'board.preset_deleted',
      correlationId,
      data: { presetId: id },
    });
  }

  async detectAgents(): Promise<BoardAgentDetection[]> {
    const detections = await Promise.all(
      BOARD_AGENT_CATALOG.map(async (entry): Promise<BoardAgentDetection> => {
        if (entry.id === 'custom' || entry.id === 'shell' || entry.command.length === 0) {
          return { id: entry.id, label: entry.label, available: true, path: null };
        }
        // GUI-launched apps inherit a stripped PATH, so probe through a login shell.
        try {
          const { stdout } = await execFileAsync(
            process.env.SHELL ?? '/bin/zsh',
            ['-lc', `command -v ${entry.command}`],
            { timeout: 5000 },
          );
          const path = stdout.trim();
          return path.length > 0
            ? { id: entry.id, label: entry.label, available: true, path }
            : { id: entry.id, label: entry.label, available: false, path: null };
        } catch {
          return { id: entry.id, label: entry.label, available: false, path: null };
        }
      }),
    );
    return detections;
  }

  async createWorktree(
    repoPath: string,
    label: string,
    correlationId: CorrelationId,
  ): Promise<{ readonly path: string; readonly branch: string }> {
    const branch = `exeum/${label}`;
    const worktreeDir = join(dirname(repoPath), `${basename(repoPath)}-worktrees`, label);
    await mkdir(dirname(worktreeDir), { recursive: true });
    try {
      await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreeDir], {
        cwd: repoPath,
        timeout: 30_000,
      });
    } catch (error) {
      throw new ZeroError('TOOL_EXECUTION_FAILED', 'Git could not create the worktree', {
        cause: error,
        retryable: true,
      });
    }
    // Best-effort: local env files are untracked so git does not carry them over.
    try {
      const entries = await readdir(repoPath, { withFileTypes: true });
      await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.startsWith('.env'))
          .map((entry) =>
            copyFile(join(repoPath, entry.name), join(worktreeDir, entry.name)),
          ),
      );
    } catch (error) {
      this.logger.warn({
        event: 'board.worktree_env_copy_failed',
        correlationId,
        data: { worktreeDir, error: normalizeError(error).message },
      });
    }
    this.logger.info({
      event: 'board.worktree_created',
      correlationId,
      data: { repoPath, worktreeDir, label, branch },
    });
    return { path: worktreeDir, branch };
  }

  async readBranch(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd, timeout: 5000 },
      );
      const branch = stdout.trim();
      return branch.length > 0 && branch !== 'HEAD' ? branch : null;
    } catch {
      return null;
    }
  }

  async previewLand(
    repoPath: string,
    branch: string,
    correlationId: CorrelationId,
  ): Promise<{
    readonly branch: string;
    readonly base: string;
    readonly ahead: number;
    readonly files: readonly string[];
    readonly stat: string;
  }> {
    assertExeumBranch(branch);
    const current = await this.readBranch(repoPath);
    if (current === null) {
      throw new ZeroError('VALIDATION_FAILED', 'The folder is not a git repository');
    }
    if (current === branch) {
      throw new ZeroError('VALIDATION_FAILED', 'Cannot land a branch into itself');
    }
    const range = `${current}...${branch}`;
    const [{ stdout: countOut }, { stdout: namesOut }, { stdout: statOut }] =
      await Promise.all([
        execFileAsync('git', ['rev-list', '--count', `${current}..${branch}`], {
          cwd: repoPath,
          timeout: 15_000,
        }),
        execFileAsync('git', ['diff', '--name-only', range], {
          cwd: repoPath,
          timeout: 15_000,
        }),
        execFileAsync('git', ['diff', '--stat', range], {
          cwd: repoPath,
          timeout: 15_000,
        }),
      ]);
    const ahead = Number.parseInt(countOut.trim(), 10);
    if (!Number.isFinite(ahead)) {
      throw new ZeroError('TOOL_EXECUTION_FAILED', 'Could not count commits to land');
    }
    const files = namesOut.trim() === '' ? [] : namesOut.trim().split('\n');
    this.logger.info({
      event: 'board.branch_previewed',
      correlationId,
      data: { repoPath, branch, base: current, ahead, files },
    });
    return { branch, base: current, ahead, files, stat: statOut.trim() };
  }

  async landBranch(
    repoPath: string,
    branch: string,
    correlationId: CorrelationId,
  ): Promise<{ readonly landed: true; readonly head: string }> {
    assertExeumBranch(branch);
    const current = await this.readBranch(repoPath);
    if (current === null) {
      throw new ZeroError('VALIDATION_FAILED', 'The folder is not a git repository');
    }
    if (current === branch) {
      throw new ZeroError('VALIDATION_FAILED', 'Cannot land a branch into itself');
    }
    try {
      await execFileAsync(
        'git',
        ['merge', '--no-ff', '--no-edit', '-m', `Land ${branch}`, branch],
        { cwd: repoPath, timeout: 60_000 },
      );
    } catch (error) {
      await execFileAsync('git', ['merge', '--abort'], { cwd: repoPath }).catch(
        () => undefined,
      );
      throw new ZeroError(
        'TOOL_EXECUTION_FAILED',
        'Land failed; the repository was left clean',
        {
          cause: error,
        },
      );
    }
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: repoPath,
      timeout: 5000,
    });
    const head = stdout.trim();
    this.logger.info({
      event: 'board.branch_landed',
      correlationId,
      data: { repoPath, branch, head },
    });
    return { landed: true, head };
  }

  listProjects(): KanbanProject[] {
    return this.database
      .queryAll<{
        id: string;
        name: string;
        task_count: number;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT
           projects.id,
           projects.name,
           count(cards.id) AS task_count,
           projects.created_at,
           projects.updated_at
         FROM kanban_projects AS projects
         LEFT JOIN kanban_cards AS cards ON cards.workspace = projects.id
         GROUP BY projects.id
         ORDER BY projects.updated_at DESC, projects.created_at DESC`,
      )
      .map((row) =>
        kanbanProjectSchema.parse({
          id: row.id,
          name: row.name,
          taskCount: row.task_count,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }),
      );
  }

  createProject(name: string, correlationId: CorrelationId): KanbanProject {
    const input = kanbanProjectCreateInputSchema.parse({ name });
    const duplicate = this.database.queryOne<{ id: string }>(
      `SELECT id FROM kanban_projects WHERE name = ? COLLATE NOCASE`,
      [input.name],
    );
    if (duplicate !== undefined) {
      throw new ZeroError(
        'VALIDATION_FAILED',
        'A Board project with that name already exists',
      );
    }
    const now = utcNow();
    const project = kanbanProjectSchema.parse({
      id: randomUUID(),
      name: input.name,
      taskCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    this.database.run(
      `INSERT INTO kanban_projects (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      [project.id, project.name, project.createdAt, project.updatedAt],
    );
    this.logger.info({
      event: 'kanban.project_created',
      correlationId,
      data: { projectId: project.id },
    });
    return project;
  }

  listCards(workspace: string): KanbanCard[] {
    return this.database
      .queryAll<{
        id: string;
        workspace: string;
        title: string;
        column_name: string;
        created_at: string;
      }>(
        `SELECT id, workspace, title, column_name, created_at
         FROM kanban_cards
         WHERE workspace = ?
         ORDER BY created_at ASC`,
        [workspace],
      )
      .map((row) =>
        kanbanCardSchema.parse({
          id: row.id,
          workspace: row.workspace,
          title: row.title,
          column: row.column_name,
          createdAt: row.created_at,
        }),
      );
  }

  createCard(workspace: string, title: string, correlationId: CorrelationId): KanbanCard {
    if (
      this.database.queryOne<{ id: string }>(
        `SELECT id FROM kanban_projects WHERE id = ?`,
        [workspace],
      ) === undefined
    ) {
      throw new ZeroError(
        'VALIDATION_FAILED',
        'Select a Board project before adding tasks',
      );
    }
    const card = kanbanCardSchema.parse({
      id: randomUUID(),
      workspace,
      title,
      column: 'idea',
      createdAt: utcNow(),
    });
    this.database.transaction(() => {
      this.database.run(
        `INSERT INTO kanban_cards (id, workspace, title, column_name, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [card.id, card.workspace, card.title, card.column, card.createdAt],
      );
      this.database.run(`UPDATE kanban_projects SET updated_at = ? WHERE id = ?`, [
        card.createdAt,
        workspace,
      ]);
    });
    this.logger.info({
      event: 'kanban.card_created',
      correlationId,
      data: { cardId: card.id, workspace },
    });
    return card;
  }
  moveCard(id: string, column: KanbanColumn, correlationId: CorrelationId): KanbanCard {
    const updatedAt = utcNow();
    const row = this.database.transaction(() => {
      this.database.run(`UPDATE kanban_cards SET column_name = ? WHERE id = ?`, [
        column,
        id,
      ]);
      const found = this.database.queryOne<{
        id: string;
        workspace: string;
        title: string;
        column_name: string;
        created_at: string;
      }>(
        `SELECT id, workspace, title, column_name, created_at FROM kanban_cards WHERE id = ?`,
        [id],
      );
      if (found === undefined) {
        throw new ZeroError('VALIDATION_FAILED', 'That card is gone');
      }
      this.database.run(`UPDATE kanban_projects SET updated_at = ? WHERE id = ?`, [
        updatedAt,
        found.workspace,
      ]);
      return found;
    });
    this.logger.info({
      event: 'kanban.card_moved',
      correlationId,
      data: { cardId: id, column },
    });
    return kanbanCardSchema.parse({
      id: row.id,
      workspace: row.workspace,
      title: row.title,
      column: row.column_name,
      createdAt: row.created_at,
    });
  }
}
