import { phaseZeroMigration } from './0001-phase-zero.js';
import { providerSettingsMigration } from './0002-provider-settings.js';
import { chatPersistenceMigration } from './0003-chat-persistence.js';
import { modelCapabilityOverridesMigration } from './0004-model-capability-overrides.js';

export const migrations = [
  phaseZeroMigration,
  providerSettingsMigration,
  chatPersistenceMigration,
  modelCapabilityOverridesMigration,
] as const;

export {
  chatPersistenceMigration,
  modelCapabilityOverridesMigration,
  phaseZeroMigration,
  providerSettingsMigration,
};
