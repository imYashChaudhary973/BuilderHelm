import type { VoiceSettings } from '@builderhelm/protocol/voice';

export interface HotkeyHost {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  broadcastPress(): void;
}

export class VoiceHotkeys {
  private current: string | null = null;

  constructor(private readonly host: HotkeyHost) {}

  sync(settings: VoiceSettings): void {
    this.clear();
    if (!settings.enabled || settings.dictationMode !== 'toggle') return;
    const ok = this.host.register(settings.hotkey, () => {
      this.host.broadcastPress();
    });
    if (ok) this.current = settings.hotkey;
  }

  dispose(): void {
    this.clear();
  }

  private clear(): void {
    if (this.current === null) return;
    this.host.unregister(this.current);
    this.current = null;
  }
}
