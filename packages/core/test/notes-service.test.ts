import {
  migrations,
  openDatabase,
  runMigrations,
  type BuilderHelmDatabase,
} from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import { createCorrelationId } from '@builderhelm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { BoardService } from '../src/board/board-service.js';
import { NotesService, redactSecrets } from '../src/notes/notes-service.js';

const databases: BuilderHelmDatabase[] = [];
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function setup(): { board: BoardService; notes: NotesService } {
  const database = openDatabase(':memory:');
  databases.push(database);
  runMigrations(database, migrations);
  return {
    board: new BoardService(database, logger),
    notes: new NotesService(database, logger),
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('redactSecrets', () => {
  it('strips tokens before they can be stored', () => {
    expect(redactSecrets('token ghp_abcdefghijklmnopqrstuv sk-abcdef Bearer abc')).toBe(
      'token [redacted] [redacted] [redacted]',
    );
  });
});

describe('NotesService', () => {
  it('saves redacted body and finds the note by title', () => {
    const { board, notes } = setup();
    const project = board.createProject('BuilderHelm', createCorrelationId());
    const created = notes.create(project.id, createCorrelationId(), 'Launch notes');
    const saved = notes.save(
      created.id,
      'Launch notes',
      'Use ghp_abcdefghijklmnopqrstuv in CI',
      createCorrelationId(),
    );
    expect(saved.body).toContain('[redacted]');
    expect(saved.body).not.toContain('ghp_');
    expect(notes.search('launch').map((note) => note.id)).toEqual([created.id]);
    expect(notes.delete(created.id, createCorrelationId())).toEqual({ deleted: true });
    expect(notes.list(project.id)).toEqual([]);
  });
});
