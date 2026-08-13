import type { Migration } from '../migration-runner.js';

export const modelCapabilityOverridesMigration: Migration = {
  version: 4,
  name: 'model-capability-overrides',
  up(database) {
    database.execute(`
      CREATE TABLE model_capability_overrides (
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        overrides_json TEXT NOT NULL CHECK (json_valid(overrides_json)),
        base_capabilities_json TEXT NOT NULL CHECK (json_valid(base_capabilities_json)),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, model_id)
      ) STRICT;

      CREATE INDEX model_capability_overrides_provider_id_idx
      ON model_capability_overrides(provider_id);
    `);
  },
};
