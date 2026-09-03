import {
  noSleepModeSchema,
  type NoSleepMode,
  type NoSleepState,
} from '@builderhelm/protocol/no-sleep';
import { utcNow } from '@builderhelm/shared';

const MODE_KEY = 'noSleep.mode';

/**
 * The slice of SettingsRepository this service needs. Depending on the shape
 * rather than the concrete repository keeps the mode logic testable from the
 * desktop package, which does not depend on the database package.
 */
export interface NoSleepStore {
  read(key: string): string | undefined;
  write(key: string, valueJson: string, updatedAt: string): void;
}

/**
 * Persists the No Sleep mode and computes the desired blocker state from it.
 * Owns no OS calls: the desktop main process applies the mode with
 * powerSaveBlocker and reports `blockerActive` back through the read model,
 * so this service stays testable without Electron.
 *
 * Agent mode resolves to a blocker only while counted agent work is running;
 * the activity count arrives through `setAgentActive` from the main process.
 */
export class NoSleepService {
  private agentActive = false;

  constructor(private readonly repository: NoSleepStore) {}

  read(blockerActive = false): NoSleepState {
    return {
      mode: this.mode(),
      blockerActive,
      agentActive: this.agentActive,
    };
  }

  /**
   * Persists the requested mode and returns the state the desktop should now
   * apply. The caller passes whether it holds (or is about to hold) the
   * blocker for this mode.
   */
  set(mode: NoSleepMode, blockerActive: boolean): NoSleepState {
    this.repository.write(MODE_KEY, JSON.stringify(mode), utcNow());
    return { mode, blockerActive, agentActive: this.agentActive };
  }

  /** Re-applies the persisted mode after a restart; defaults to off. */
  mode(): NoSleepMode {
    const raw = this.repository.read(MODE_KEY);
    if (raw === undefined) return 'off';
    try {
      const parsed: unknown = JSON.parse(raw);
      const result = noSleepModeSchema.safeParse(parsed);
      return result.success ? result.data : 'off';
    } catch {
      return 'off';
    }
  }

  /** Whether the current mode wants a blocker held right now. */
  wantsBlocker(): boolean {
    return this.mode() === 'on' || (this.mode() === 'agent' && this.agentActive);
  }

  setAgentActive(active: boolean): boolean {
    if (this.agentActive === active) return false;
    this.agentActive = active;
    return true;
  }
}
