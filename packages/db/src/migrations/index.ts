import { phaseZeroMigration } from './0001-phase-zero.js';
import { providerSettingsMigration } from './0002-provider-settings.js';

export const migrations = [phaseZeroMigration, providerSettingsMigration] as const;

export { phaseZeroMigration, providerSettingsMigration };
