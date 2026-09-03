import { powerSaveBlocker } from 'electron';

import type { NoSleepService } from '@builderhelm/core';
import type { NoSleepState } from '@builderhelm/protocol/no-sleep';
import { createCorrelationId } from '@builderhelm/shared';

/** The slice of the core logger this needs; avoids a package dependency. */
interface BlockerLogger {
  info(entry: { event: string; correlationId: string; data?: unknown }): void;
  warn(entry: { event: string; correlationId: string; data?: unknown }): void;
}

/**
 * Applies the No Sleep mode to the OS. The core service decides *whether* a
 * blocker is wanted; this owns the Electron `powerSaveBlocker` so exactly zero
 * or one exists at a time, and reports what it actually holds.
 *
 * On keeps the display awake too (`prevent-display-sleep`), which is what the
 * user asked "keep this computer awake continuously" to mean. Agent only
 * blocks idle system sleep (`prevent-app-suspension`), so a long run does not
 * sit burning a lit screen. Neither can beat a closed lid or an explicit
 * Apple-menu Sleep — that is a hardware/OS decision.
 */
export class PowerController {
  private blockerId: number | null = null;
  private blockerType: 'prevent-app-suspension' | 'prevent-display-sleep' | null = null;

  constructor(
    private readonly service: NoSleepService,
    private readonly logger: BlockerLogger,
  ) {}

  /** Applies the current mode + activity, then returns the full read model. */
  sync(): NoSleepState {
    const mode = this.service.mode();
    const wanted =
      mode === 'on'
        ? 'prevent-display-sleep'
        : mode === 'agent' && this.service.read(false).agentActive
          ? 'prevent-app-suspension'
          : null;
    this.apply(wanted);
    return this.service.read(this.isHeld());
  }

  /** Releases any held blocker; called from `before-quit`. */
  dispose(): void {
    this.stopBlocker();
  }

  private apply(wanted: 'prevent-app-suspension' | 'prevent-display-sleep' | null): void {
    if (wanted === this.blockerType && this.isHeld()) return;
    // A mode change can swap the type, and only one blocker may exist, so the
    // old one always goes first.
    this.stopBlocker();
    if (wanted === null) return;
    try {
      this.blockerId = powerSaveBlocker.start(wanted);
      this.blockerType = wanted;
      this.logger.info({
        event: 'no_sleep.blocker_started',
        correlationId: createCorrelationId(),
        data: { type: wanted, id: this.blockerId },
      });
    } catch (error) {
      this.blockerId = null;
      this.blockerType = null;
      this.logger.warn({
        event: 'no_sleep.blocker_failed',
        correlationId: createCorrelationId(),
        data: {
          type: wanted,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private isHeld(): boolean {
    return this.blockerId !== null && powerSaveBlocker.isStarted(this.blockerId);
  }

  private stopBlocker(): void {
    const id = this.blockerId;
    this.blockerId = null;
    this.blockerType = null;
    if (id === null) return;
    try {
      powerSaveBlocker.stop(id);
      this.logger.info({
        event: 'no_sleep.blocker_stopped',
        correlationId: createCorrelationId(),
        data: { id },
      });
    } catch (error) {
      this.logger.warn({
        event: 'no_sleep.blocker_stop_failed',
        correlationId: createCorrelationId(),
        data: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}
