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
import { voiceSettingsMigration } from './0013-voice-settings.js';
import { voiceCloudConsentMigration } from './0014-voice-cloud-consent.js';
import { previewArtifactsMigration } from './0015-preview-artifacts.js';
import { previewToolArtifactsMigration } from './0016-preview-tool-artifacts.js';
import { previewAnnotationsMigration } from './0017-preview-annotations.js';
import { reviewPersistenceMigration } from './0018-review.js';
import { githubIssuesMigration } from './0019-github-issues.js';
import { linearIssuesMigration } from './0020-linear-issues.js';
import { notesMigration } from './0021-notes.js';
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
  voiceSettingsMigration,
  voiceCloudConsentMigration,
  previewArtifactsMigration,
  previewToolArtifactsMigration,
  previewAnnotationsMigration,
  reviewPersistenceMigration,
  githubIssuesMigration,
  linearIssuesMigration,
  notesMigration,
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
  voiceSettingsMigration,
  voiceCloudConsentMigration,
  previewArtifactsMigration,
  previewToolArtifactsMigration,
  previewAnnotationsMigration,
  reviewPersistenceMigration,
  githubIssuesMigration,
  linearIssuesMigration,
  notesMigration,
};
