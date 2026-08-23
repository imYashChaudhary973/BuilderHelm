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
  type BoardAgentDetection,
  type BoardPresetRecord,
  type BoardPresetSpec,
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
        if (entry.id === 'custom') {
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
  ): Promise<string> {
    const worktreeDir = join(dirname(repoPath), `${basename(repoPath)}-worktrees`, label);
    await mkdir(dirname(worktreeDir), { recursive: true });
    try {
      await execFileAsync(
        'git',
        ['worktree', 'add', '-b', `exeum/${label}`, worktreeDir],
        { cwd: repoPath, timeout: 30_000 },
      );
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
      data: { repoPath, worktreeDir, label },
    });
    return worktreeDir;
  }
}
