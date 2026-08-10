import { phaseZeroMigration } from './0001-phase-zero.js';
import { providerSettingsMigration } from './0002-provider-settings.js';
import { chatPersistenceMigration } from './0003-chat-persistence.js';

export const migrations = [
  phaseZeroMigration,
  providerSettingsMigration,
  chatPersistenceMigration,
] as const;

export { chatPersistenceMigration, phaseZeroMigration, providerSettingsMigration };
