import type { Migration } from '../migration-runner.js';

/**
 * First-run acknowledgement before any audio is uploaded to OpenAI. Local
 * models never consult this flag.
 */
export const voiceCloudConsentMigration: Migration = {
  version: 14,
  name: 'voice-cloud-consent',
  up(database) {
    database.execute(`
      ALTER TABLE voice_settings
      ADD COLUMN cloud_consent INTEGER NOT NULL DEFAULT 0
      CHECK (cloud_consent IN (0, 1));
    `);
  },
};
