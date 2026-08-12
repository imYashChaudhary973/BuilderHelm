import { phaseZeroMigration } from './0001-phase-zero.js';
import { providerSettingsMigration } from './0002-provider-settings.js';
import { chatPersistenceMigration } from './0003-chat-persistence.js';
import { modelCapabilityOverridesMigration } from './0004-model-capability-overrides.js';
import { obsidianKnowledgeMigration } from './0005-obsidian-knowledge.js';
import { toolsPermissionsActionsMigration } from './0006-tools-permissions-actions.js';

export const migrations = [
  phaseZeroMigration,
  providerSettingsMigration,
  chatPersistenceMigration,
  modelCapabilityOverridesMigration,
  obsidianKnowledgeMigration,
  toolsPermissionsActionsMigration,
] as const;

export {
  chatPersistenceMigration,
  modelCapabilityOverridesMigration,
  obsidianKnowledgeMigration,
  toolsPermissionsActionsMigration,
  phaseZeroMigration,
  providerSettingsMigration,
};
