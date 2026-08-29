import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { copyFile, mkdir, readdir, realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { BuilderHelmDatabase } from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import {
  BOARD_AGENT_CATALOG,
  BOARD_WORKTREE_BRANCH_PREFIX,
  boardPresetRecordSchema,
  kanbanCardSchema,
  kanbanCreateInputSchema,
  kanbanDeleteInputSchema,
  kanbanProjectCreateInputSchema,
  kanbanProjectSchema,
  kanbanUpdateInputSchema,
  type BoardAgentDetection,
  type BoardPresetRecord,
  type BoardPresetSpec,
  type KanbanCard,
  type KanbanColumn,
  type KanbanProject,
} from '@builderhelm/protocol';
import {
  normalizeError,
  utcNow,
  BuilderHelmError,
  type CorrelationId,
} from '@builderhelm/shared';

const execFileAsync = promisify(execFile);

/** Real path, or the input when it cannot be resolved. Never throws. */
async function resolved(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/**
 * Resolves every command in one login shell.
 *
 * A GUI-launched app inherits a stripped PATH, so the probe has to go through a
 * login shell. Doing that per command meant one shell per catalogued agent,
 * twelve per call, each sourcing the user's shell profile and inheriting
 * whatever that profile starts in the background.
 *
 * Names are passed as positional arguments rather than interpolated into the
 * script, so nothing reaches the shell as code.
 */
const commandProbeScript =
  'for name in "$@"; do printf \'%s\\t%s\\n\' "$name" "$(command -v "$name" 2>/dev/null)"; done';

async function resolveCommandPaths(
  commands: readonly string[],
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (commands.length === 0) return resolved;
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      process.env.SHELL ?? '/bin/zsh',
      ['-lc', commandProbeScript, 'builderhelm-detect', ...commands],
      { timeout: 10_000 },
    ));
  } catch {
    // Probe failed as a whole: report nothing found rather than guessing.
    return resolved;
  }
  for (const line of stdout.split('\n')) {
    const separator = line.indexOf('\t');
    if (separator <= 0) continue;
    const path = line.slice(separator + 1).trim();
    if (path.length > 0) resolved.set(line.slice(0, separator), path);
  }
  return resolved;
}

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
    throw new BuilderHelmError(
      'VALIDATION_FAILED',
      'Only exeum/* pane branches can be landed',
    );
  }
}

export class BoardService {
  constructor(
    private readonly database: BuilderHelmDatabase,
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
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          'A preset with this name already exists',
          { cause: error },
        );
      }
      throw new BuilderHelmError('DATABASE_FAILED', 'The preset could not be saved', {
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
    const probed = BOARD_AGENT_CATALOG.filter(
      (entry) =>
        entry.id !== 'custom' && entry.id !== 'shell' && entry.command.length > 0,
    );
    const paths = await resolveCommandPaths(probed.map((entry) => entry.command));
    return BOARD_AGENT_CATALOG.map((entry): BoardAgentDetection => {
      const metadata = {
        id: entry.id,
        label: entry.label,
        capabilities: entry.capabilities,
      };
      if (entry.id === 'custom' || entry.id === 'shell' || entry.command.length === 0) {
        return { ...metadata, available: true, path: null };
      }
      const path = paths.get(entry.command) ?? '';
      return path.length > 0
        ? { ...metadata, available: true, path }
        : { ...metadata, available: false, path: null };
    });
  }

  async createWorktree(
    repoPath: string,
    label: string,
    correlationId: CorrelationId,
  ): Promise<{ readonly path: string; readonly branch: string }> {
    const branch = `${BOARD_WORKTREE_BRANCH_PREFIX}${label}`;
    const worktreeDir = join(dirname(repoPath), `${basename(repoPath)}-worktrees`, label);
    await mkdir(dirname(worktreeDir), { recursive: true });
    try {
      await execFileAsync('git', ['worktree', 'add', '-b', branch, worktreeDir], {
        cwd: repoPath,
        timeout: 30_000,
      });
    } catch (error) {
      throw new BuilderHelmError(
        'TOOL_EXECUTION_FAILED',
        'Git could not create the worktree',
        {
          cause: error,
          retryable: true,
        },
      );
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

  /**
   * Pane worktrees this repository still has on disk.
   *
   * Only branches carrying the BuilderHelm prefix are reported. A developer's
   * own checkouts sit in the same parent directory, so the path proves nothing
   * and must never be used to decide ownership.
   */
  async listPaneWorktrees(
    repoPath: string,
  ): Promise<{ path: string; branch: string; dirty: boolean }[]> {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
        cwd: repoPath,
        timeout: 15_000,
      }));
    } catch {
      return [];
    }
    const found: { path: string; branch: string }[] = [];
    let path: string | null = null;
    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length).trim();
      else if (line.startsWith('branch ') && path !== null) {
        // Porcelain reports a full ref; the prefix check needs the short name.
        const branch = line
          .slice('branch '.length)
          .trim()
          .replace(/^refs\/heads\//, '');
        if (branch.startsWith(BOARD_WORKTREE_BRANCH_PREFIX)) found.push({ path, branch });
        path = null;
      }
    }
    return Promise.all(
      found.map(async (entry) => ({ ...entry, dirty: await this.isDirty(entry.path) })),
    );
  }

  /** Uncommitted work, including untracked files, that removal would destroy. */
  private async isDirty(worktreePath: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['status', '--porcelain', '--untracked-files=normal'],
        { cwd: worktreePath, timeout: 15_000 },
      );
      return stdout.trim().length > 0;
    } catch {
      // Unreadable worktree: treat as dirty so it is never removed blindly.
      return true;
    }
  }

  /**
   * Removes one pane worktree and, when safe, its branch.
   *
   * `git branch -d` refuses to delete a branch holding unmerged commits, so
   * agent work that was committed but never landed survives even though its
   * worktree directory is reclaimed.
   */
  async removePaneWorktree(
    repoPath: string,
    worktreePath: string,
    branch: string | null,
    correlationId: CorrelationId,
  ): Promise<void> {
    await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
      cwd: repoPath,
      timeout: 15_000,
    }).catch(() => undefined);
    // Prune first: a stale administrative entry blocks branch deletion.
    await execFileAsync('git', ['worktree', 'prune'], {
      cwd: repoPath,
      timeout: 15_000,
    }).catch(() => undefined);
    if (branch !== null && branch.startsWith(BOARD_WORKTREE_BRANCH_PREFIX)) {
      await execFileAsync('git', ['branch', '-d', branch], {
        cwd: repoPath,
        timeout: 15_000,
      }).catch(() => undefined);
    }
    this.logger.info({
      event: 'board.worktree_removed',
      correlationId,
      data: { repoPath, worktreePath, branch },
    });
  }

  /**
   * Reclaims pane worktrees left behind by a crashed or killed run.
   *
   * Called at startup, where no session is live yet, so every pane worktree on
   * disk is a stray. Dirty ones are reported and kept: a crash is exactly when
   * uncommitted agent work is most likely to be the only copy.
   */
  async reconcilePaneWorktrees(
    repoPath: string,
    keepPaths: readonly string[],
    correlationId: CorrelationId,
  ): Promise<{ removed: string[]; keptDirty: string[] }> {
    const removed: string[] = [];
    const keptDirty: string[] = [];
    // `git worktree list` reports resolved paths, while a caller holds the path
    // it constructed. On macOS those differ by the /var -> /private/var symlink,
    // and comparing them raw would treat a live worktree as a stray.
    const keep = new Set(await Promise.all(keepPaths.map((path) => resolved(path))));
    for (const entry of await this.listPaneWorktrees(repoPath)) {
      if (keep.has(await resolved(entry.path))) continue;
      if (entry.dirty) {
        keptDirty.push(entry.path);
        continue;
      }
      await this.removePaneWorktree(repoPath, entry.path, entry.branch, correlationId);
      removed.push(entry.path);
    }
    if (removed.length > 0 || keptDirty.length > 0) {
      this.logger.info({
        event: 'board.worktrees_reconciled',
        correlationId,
        data: { repoPath, removed: removed.length, keptDirty },
      });
    }
    return { removed, keptDirty };
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

  /**
   * Makes a folder a git repository with an empty initial commit when it is
   * not one already, so swarm worktrees have a HEAD to branch from.
   */
  async ensureRepository(
    cwd: string,
  ): Promise<{ readonly initialized: boolean; readonly branch: string }> {
    const existing = await this.readBranch(cwd);
    if (existing !== null) return { initialized: false, branch: existing };
    await execFileAsync('git', ['init'], { cwd, timeout: 15_000 });
    await execFileAsync(
      'git',
      [
        '-c',
        'user.name=BuilderHelm',
        '-c',
        'user.email=swarm@builderhelm.local',
        'commit',
        '--allow-empty',
        '-m',
        'BuilderHelm: initial commit',
      ],
      { cwd, timeout: 15_000 },
    );
    const branch = await this.readBranch(cwd);
    if (branch === null) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'Could not initialize a git repository in this folder',
      );
    }
    return { initialized: true, branch };
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
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'The folder is not a git repository',
      );
    }
    if (current === branch) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Cannot land a branch into itself');
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
      throw new BuilderHelmError(
        'TOOL_EXECUTION_FAILED',
        'Could not count commits to land',
      );
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
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'The folder is not a git repository',
      );
    }
    if (current === branch) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Cannot land a branch into itself');
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
      throw new BuilderHelmError(
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
      throw new BuilderHelmError(
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

  createCard(
    workspace: string,
    title: string,
    correlationId: CorrelationId,
    column: KanbanColumn = 'idea',
  ): KanbanCard {
    if (
      this.database.queryOne<{ id: string }>(
        `SELECT id FROM kanban_projects WHERE id = ?`,
        [workspace],
      ) === undefined
    ) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'Select a Board project before adding tasks',
      );
    }
    const input = kanbanCreateInputSchema.parse({ workspace, title, column });
    const card = kanbanCardSchema.parse({
      id: randomUUID(),
      workspace: input.workspace,
      title: input.title,
      column: input.column ?? 'idea',
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
      data: { cardId: card.id, workspace, column: card.column },
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
        throw new BuilderHelmError('VALIDATION_FAILED', 'That card is gone');
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
  updateCard(id: string, title: string, correlationId: CorrelationId): KanbanCard {
    const input = kanbanUpdateInputSchema.parse({ id, title });
    const updatedAt = utcNow();
    const row = this.database.transaction(() => {
      this.database.run(`UPDATE kanban_cards SET title = ? WHERE id = ?`, [
        input.title,
        input.id,
      ]);
      const found = this.database.queryOne<{
        id: string;
        workspace: string;
        title: string;
        column_name: string;
        created_at: string;
      }>(
        `SELECT id, workspace, title, column_name, created_at FROM kanban_cards WHERE id = ?`,
        [input.id],
      );
      if (found === undefined) {
        throw new BuilderHelmError('VALIDATION_FAILED', 'That card is gone');
      }
      this.database.run(`UPDATE kanban_projects SET updated_at = ? WHERE id = ?`, [
        updatedAt,
        found.workspace,
      ]);
      return found;
    });
    this.logger.info({
      event: 'kanban.card_updated',
      correlationId,
      data: { cardId: input.id },
    });
    return kanbanCardSchema.parse({
      id: row.id,
      workspace: row.workspace,
      title: row.title,
      column: row.column_name,
      createdAt: row.created_at,
    });
  }

  deleteCard(id: string, correlationId: CorrelationId): { deleted: true } {
    const input = kanbanDeleteInputSchema.parse({ id });
    const updatedAt = utcNow();
    this.database.transaction(() => {
      const found = this.database.queryOne<{ workspace: string }>(
        `SELECT workspace FROM kanban_cards WHERE id = ?`,
        [input.id],
      );
      if (found === undefined) {
        throw new BuilderHelmError('VALIDATION_FAILED', 'That card is gone');
      }
      this.database.run(`DELETE FROM kanban_cards WHERE id = ?`, [input.id]);
      this.database.run(`UPDATE kanban_projects SET updated_at = ? WHERE id = ?`, [
        updatedAt,
        found.workspace,
      ]);
    });
    this.logger.info({
      event: 'kanban.card_deleted',
      correlationId,
      data: { cardId: input.id },
    });
    return { deleted: true };
  }
}
