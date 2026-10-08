import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { BuilderHelmError } from '@builderhelm/shared';

export type DatabaseValue = string | number | bigint | null | Uint8Array;

export interface BuilderHelmDatabase {
  execute(sql: string): void;
  run(sql: string, parameters?: readonly DatabaseValue[]): void;
  queryAll<T extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly DatabaseValue[],
  ): T[];
  queryOne<T extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly DatabaseValue[],
  ): T | undefined;
  transaction<T>(operation: () => T): T;
  close(): void;
}

export function openDatabase(location: string): BuilderHelmDatabase {
  if (location !== ':memory:') {
    mkdirSync(dirname(location), { recursive: true });
  }

  let sqlite: DatabaseSync;
  try {
    sqlite = new DatabaseSync(location);
    sqlite.exec('PRAGMA foreign_keys = ON;');
    // Usage reads run in a worker. WAL lets those reads coexist with app
    // writes; a short bounded wait covers its small ledger transactions.
    sqlite.exec('PRAGMA journal_mode = WAL;');
    sqlite.exec('PRAGMA busy_timeout = 100;');
    sqlite.exec('PRAGMA trusted_schema = OFF;');
  } catch (cause) {
    throw new BuilderHelmError(
      'DATABASE_FAILED',
      'Failed to open the BuilderHelm database',
      {
        cause,
        metadata: { location: location === ':memory:' ? ':memory:' : '[LOCAL_PATH]' },
      },
    );
  }

  let transactionActive = false;

  return {
    execute(sql) {
      sqlite.exec(sql);
    },
    run(sql, parameters = []) {
      sqlite.prepare(sql).run(...(parameters as SQLInputValue[]));
    },
    queryAll<T extends Record<string, unknown>>(sql: string, parameters = []): T[] {
      return sqlite.prepare(sql).all(...(parameters as SQLInputValue[])) as T[];
    },
    queryOne<T extends Record<string, unknown>>(
      sql: string,
      parameters = [],
    ): T | undefined {
      return sqlite.prepare(sql).get(...(parameters as SQLInputValue[])) as T | undefined;
    },
    transaction<T>(operation: () => T): T {
      if (transactionActive) {
        throw new BuilderHelmError(
          'DATABASE_FAILED',
          'Nested database transactions are not supported',
        );
      }

      transactionActive = true;
      sqlite.exec('BEGIN IMMEDIATE;');
      try {
        const result = operation();
        sqlite.exec('COMMIT;');
        return result;
      } catch (cause) {
        sqlite.exec('ROLLBACK;');
        throw cause;
      } finally {
        transactionActive = false;
      }
    },
    close() {
      sqlite.close();
    },
  };
}
