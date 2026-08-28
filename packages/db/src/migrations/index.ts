import { foundationMigration } from './0001-foundation.js';
import { providerSettingsMigration } from './0002-provider-settings.js';
import { chatPersistenceMigration } from './0003-chat-persistence.js';
import { modelCapabilityOverridesMigration } from './0004-model-capability-overrides.js';
import { obsidianKnowledgeMigration } from './0005-obsidian-knowledge.js';
import { toolsPermissionsActionsMigration } from './0006-tools-permissions-actions.js';
import { projectContinuityMigration } from './0007-project-continuity.js';
import { boardPresetsMigration } from './0008-board-presets.js';
import { kanbanCardsMigration } from './0009-kanban-cards.js';
import { kanbanProjectsMigration } from './0010-kanban-projects.js';
import { kanbanReviewCancelledMigration } from './0011-kanban-review-cancelled.js';
import { swarmPersistenceMigration } from './0012-swarm-persistence.js';

export const migrations = [
  foundationMigration,
  providerSettingsMigration,
  chatPersistenceMigration,
  modelCapabilityOverridesMigration,
  obsidianKnowledgeMigration,
  toolsPermissionsActionsMigration,
  projectContinuityMigration,
  boardPresetsMigration,
  kanbanCardsMigration,
  kanbanProjectsMigration,
  kanbanReviewCancelledMigration,
  swarmPersistenceMigration,
] as const;

export {
  chatPersistenceMigration,
  modelCapabilityOverridesMigration,
  obsidianKnowledgeMigration,
  toolsPermissionsActionsMigration,
  foundationMigration,
  providerSettingsMigration,
  projectContinuityMigration,
  boardPresetsMigration,
  kanbanCardsMigration,
  kanbanProjectsMigration,
  kanbanReviewCancelledMigration,
  swarmPersistenceMigration,
};
