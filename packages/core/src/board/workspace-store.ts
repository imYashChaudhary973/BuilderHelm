import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { SettingsRepository, type BuilderHelmDatabase } from '@builderhelm/db';
import {
  workspaceRecordSchema,
  workspaceMetaSchema,
  editorDraftInputSchema,
  type WorkspaceRecord,
  type WorkspaceSnapshot,
  type WorkspaceMeta,
  type EditorDraftInput,
  type EditorDraft,
  type BoardCreateInput,
  type BoardSessionSummary,
} from '@builderhelm/protocol';
import { BuilderHelmError } from '@builderhelm/shared';
const exec = promisify(execFile);

/** Durable launch intent is written before worktrees or processes are created. */
export class WorkspaceStore {
  private readonly settings: SettingsRepository;
  constructor(private readonly db: BuilderHelmDatabase) {
    this.settings = new SettingsRepository(db);
  }
  async begin(input: BoardCreateInput): Promise<WorkspaceRecord> {
    let root: string;
    try {
      root = await realpath(input.folderPath);
      if (!(await stat(root)).isDirectory()) throw new Error();
    } catch {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'Choose an existing project folder.',
      );
    }
    let baseSha: string | null = null;
    try {
      baseSha = (
        await exec('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, timeout: 5000 })
      ).stdout.trim();
    } catch {
      if (input.isolation === 'worktree')
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          'Isolated runs need a Git repository with a commit. Choose a repository or explicitly select Shared folder.',
        );
    }
    const record: WorkspaceRecord = {
      id: randomUUID(),
      root,
      baseSha,
      request: { ...input, folderPath: root },
      state: 'provisioning',
      summary: null,
      locations: [],
      updatedAt: new Date().toISOString(),
    };
    this.save(record);
    return record;
  }
  get(id: string): WorkspaceRecord {
    const row = this.db.queryOne<{ record_json: string }>(
      'SELECT record_json FROM ade_workspaces WHERE id = ?',
      [id],
    );
    if (!row) throw new BuilderHelmError('VALIDATION_FAILED', 'Workspace not found.');
    return workspaceRecordSchema.parse(JSON.parse(row.record_json));
  }
  save(value: WorkspaceRecord): WorkspaceRecord {
    const record = workspaceRecordSchema.parse({
      ...value,
      updatedAt: new Date().toISOString(),
    });
    this.db.run(
      'INSERT INTO ade_workspaces VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, record_json=excluded.record_json, updated_at=excluded.updated_at',
      [record.id, record.state, JSON.stringify(record), record.updatedAt],
    );
    return record;
  }
  location(id: string, location: WorkspaceRecord['locations'][number]): void {
    const record = this.get(id);
    this.save({
      ...record,
      locations: [...record.locations.filter((x) => x.slot !== location.slot), location],
    });
  }
  finish(id: string, summary: BoardSessionSummary): void {
    this.save({ ...this.get(id), summary, state: 'running' });
    this.metadata(
      {
        root: summary.folderPath,
        label: summary.folderPath.split('/').at(-1) ?? summary.folderPath,
        color: '#e3e3dc',
      },
      true,
    );
    this.select(id);
  }
  interrupt(id: string): void {
    this.save({ ...this.get(id), state: 'interrupted' });
  }
  reconcile(): void {
    for (const row of this.db.queryAll<{ id: string }>(
      "SELECT id FROM ade_workspaces WHERE state IN ('running','provisioning')",
    ))
      this.interrupt(row.id);
  }
  snapshot(): WorkspaceSnapshot {
    const rows = this.db.queryAll<{ record_json: string }>(
      'SELECT record_json FROM ade_workspaces ORDER BY updated_at DESC LIMIT 1000',
    );
    const raw = this.settings.read('ade.active-workspace');
    const records = rows.map((row) =>
      workspaceRecordSchema.parse(JSON.parse(row.record_json)),
    );
    const activeId: unknown = raw === undefined ? null : JSON.parse(raw);
    const paneRaw =
      typeof activeId === 'string'
        ? this.settings.read(`ade.active-pane:${activeId}`)
        : undefined;
    const paneId: unknown = paneRaw === undefined ? null : JSON.parse(paneRaw);
    return {
      records,
      activePaneId:
        typeof paneId === 'string' &&
        records
          .find((r) => r.id === activeId)
          ?.summary?.panes.some((p) => p.paneId === paneId)
          ? paneId
          : null,
      metadata: this.db
        .queryAll<{ root: string; label: string; color: string }>(
          'SELECT root,label,color FROM ade_workspace_metadata ORDER BY root LIMIT 1000',
        )
        .map((row) => workspaceMetaSchema.parse(row)),
      activeId:
        typeof activeId === 'string' && records.some((r) => r.id === activeId)
          ? activeId
          : null,
    };
  }
  select(id: string | null, paneId?: string): void {
    if (id !== null) {
      const r = this.get(id);
      if (paneId !== undefined) {
        if (!r.summary?.panes.some((p) => p.paneId === paneId))
          throw new BuilderHelmError('VALIDATION_FAILED', 'Unknown pane.');
        this.settings.write(
          `ade.active-pane:${id}`,
          JSON.stringify(paneId),
          new Date().toISOString(),
        );
      }
    }
    this.settings.write(
      'ade.active-workspace',
      JSON.stringify(id),
      new Date().toISOString(),
    );
  }
  metadata(input: WorkspaceMeta, importOnly = false): void {
    const value = workspaceMetaSchema.parse(input);
    this.db.run(
      `INSERT INTO ade_workspace_metadata VALUES (?,?,?) ON CONFLICT(root) ${importOnly ? 'DO NOTHING' : 'DO UPDATE SET label=excluded.label,color=excluded.color'}`,
      [value.root, value.label, value.color],
    );
  }
  importLegacy(entries: readonly WorkspaceMeta[]): void {
    this.db.transaction(() => {
      for (const entry of entries) this.metadata(entry, true);
    });
  }
  closePane(id: string, paneId: string): void {
    const record = this.get(id);
    if (record.summary === null) return;
    const panes = record.summary.panes
      .filter((p) => p.paneId !== paneId)
      .map((p, slot) => ({ ...p, slot }));
    if (panes.length === 0) {
      this.save({ ...record, state: 'closed' });
      return;
    }
    this.save({
      ...record,
      summary: { ...record.summary, panes, paneCount: panes.length },
    });
  }
  order(id: string, ids: readonly string[]): void {
    const record = this.get(id);
    const summary = record.summary;
    if (
      !summary ||
      ids.length !== summary.panes.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !summary.panes.some((p) => p.paneId === id))
    )
      throw new BuilderHelmError('VALIDATION_FAILED', 'Invalid pane order.');
    this.save({
      ...record,
      summary: {
        ...summary,
        panes: ids.map((id, slot) => ({
          ...summary.panes.find((p) => p.paneId === id)!,
          slot,
        })),
      },
    });
  }
  has(id: string): boolean {
    return (
      this.db.queryOne<{ id: string }>('SELECT id FROM ade_workspaces WHERE id=?', [
        id,
      ]) !== undefined
    );
  }
  output(id: string, paneId: string, text?: string): string {
    if (text !== undefined && this.has(id))
      this.db.run(
        'INSERT INTO ade_terminal_output VALUES (?,?,?) ON CONFLICT(workspace_id,pane_id) DO UPDATE SET text=excluded.text',
        [id, paneId, text.slice(-262144)],
      );
    return (
      this.db.queryOne<{ text: string }>(
        'SELECT text FROM ade_terminal_output WHERE workspace_id=? AND pane_id=?',
        [id, paneId],
      )?.text ?? ''
    );
  }
  drafts(root: string): EditorDraft[] {
    return this.db.queryAll<{
      root: string;
      path: string;
      text: string;
      baseText: string;
      updatedAt: string;
    }>(
      'SELECT root,path,text,base_text AS baseText,updated_at AS updatedAt FROM ade_editor_drafts WHERE root=? ORDER BY updated_at DESC LIMIT 100',
      [root],
    );
  }
  draft(input: EditorDraftInput): void {
    const d = editorDraftInputSchema.parse(input);
    if (d.text === d.baseText) {
      this.db.run('DELETE FROM ade_editor_drafts WHERE root=? AND path=?', [
        d.root,
        d.path,
      ]);
      return;
    }
    this.db.run(
      'INSERT INTO ade_editor_drafts VALUES (?,?,?,?,?) ON CONFLICT(root,path) DO UPDATE SET text=excluded.text,base_text=excluded.base_text,updated_at=excluded.updated_at',
      [d.root, d.path, d.text, d.baseText, new Date().toISOString()],
    );
  }
  saved(root: string, path: string, text: string): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM ade_editor_drafts WHERE root=? AND path=? AND text=?', [
        root,
        path,
        text,
      ]);
      this.db.run('UPDATE ade_editor_drafts SET base_text=? WHERE root=? AND path=?', [
        text,
        root,
        path,
      ]);
    });
  }
}
