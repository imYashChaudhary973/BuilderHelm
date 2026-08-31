import type { BuilderHelmDatabase } from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import {
  noteCreateInputSchema,
  noteDeleteInputSchema,
  noteListInputSchema,
  noteSaveInputSchema,
  noteSchema,
  type Note,
} from '@builderhelm/protocol';
import {
  BuilderHelmError,
  createId,
  utcNow,
  type CorrelationId,
} from '@builderhelm/shared';

interface StoredNote extends Record<string, unknown> {
  id: string;
  workspace: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

const columns = `
  id,
  workspace,
  title,
  body,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

const secretPattern =
  /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]+|\bsk-[A-Za-z0-9_-]+|\blin_api_[A-Za-z0-9]+|\bBearer\s+\S+/gi;

export function redactSecrets(value: string): string {
  return value.replace(secretPattern, '[redacted]');
}

function toNote(row: StoredNote): Note {
  return noteSchema.parse(row);
}

export class NotesService {
  constructor(
    private readonly database: BuilderHelmDatabase,
    private readonly logger: Logger,
  ) {}

  list(workspace: string): Note[] {
    const input = noteListInputSchema.parse({ workspace });
    return this.database
      .queryAll<StoredNote>(
        `SELECT ${columns} FROM notes WHERE workspace = ? ORDER BY updated_at DESC`,
        [input.workspace],
      )
      .map(toNote);
  }

  search(
    query: string,
    limit = 20,
  ): { readonly id: string; readonly title: string; readonly workspace: string }[] {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];
    return this.database
      .queryAll<{ id: string; title: string; workspace: string }>(
        `SELECT id, title, workspace FROM notes
         WHERE instr(lower(title), ?) > 0 OR instr(lower(body), ?) > 0
         ORDER BY updated_at DESC
         LIMIT ?`,
        [needle, needle, Math.min(Math.max(limit, 1), 40)],
      )
      .map((row) => ({ id: row.id, title: row.title, workspace: row.workspace }));
  }

  create(workspace: string, correlationId: CorrelationId, title?: string): Note {
    const input = noteCreateInputSchema.parse({ workspace, title });
    const now = utcNow();
    const note = noteSchema.parse({
      id: createId(),
      workspace: input.workspace,
      title: input.title ?? 'Untitled note',
      body: '',
      createdAt: now,
      updatedAt: now,
    });
    this.database.run(
      `INSERT INTO notes (id, workspace, title, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [note.id, note.workspace, note.title, note.body, note.createdAt, note.updatedAt],
    );
    this.logger.info({
      event: 'notes.created',
      correlationId,
      data: { noteId: note.id, workspace: note.workspace },
    });
    return note;
  }

  save(id: string, title: string, body: string, correlationId: CorrelationId): Note {
    const input = noteSaveInputSchema.parse({ id, title, body: redactSecrets(body) });
    const current = this.database.queryOne<StoredNote>(
      `SELECT ${columns} FROM notes WHERE id = ?`,
      [input.id],
    );
    if (current === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'That note is gone');
    }
    const updatedAt = utcNow();
    this.database.run(
      `UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?`,
      [input.title, input.body, updatedAt, input.id],
    );
    this.logger.info({
      event: 'notes.saved',
      correlationId,
      data: { noteId: input.id },
    });
    return toNote({ ...current, title: input.title, body: input.body, updatedAt });
  }

  delete(id: string, correlationId: CorrelationId): { readonly deleted: true } {
    const input = noteDeleteInputSchema.parse({ id });
    const current = this.database.queryOne<{ id: string }>(
      `SELECT id FROM notes WHERE id = ?`,
      [input.id],
    );
    if (current === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'That note is gone');
    }
    this.database.run(`DELETE FROM notes WHERE id = ?`, [input.id]);
    this.logger.info({
      event: 'notes.deleted',
      correlationId,
      data: { noteId: input.id },
    });
    return { deleted: true };
  }
}
