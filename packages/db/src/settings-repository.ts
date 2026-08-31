import type { BuilderHelmDatabase } from './database.js';

interface StoredSetting extends Record<string, unknown> {
  value_json: string;
}

/**
 * Key/value store for per-install preferences that do not earn their own table.
 * The `settings` table has existed since the foundation migration and enforces
 * `json_valid(value_json)`, so a malformed write fails at the database instead
 * of surfacing later as an unparseable row.
 */
export class SettingsRepository {
  constructor(private readonly database: BuilderHelmDatabase) {}

  read(key: string): string | undefined {
    return this.database.queryOne<StoredSetting>(
      'SELECT value_json FROM settings WHERE key = ?',
      [key],
    )?.value_json;
  }

  write(key: string, valueJson: string, updatedAt: string): void {
    this.database.run(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
      [key, valueJson, updatedAt],
    );
  }
}
