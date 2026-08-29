
import type { CoreRuntime } from '@builderhelm/core';
import { ipcChannels } from '@builderhelm/protocol/ipc';
import type { VoiceStatus } from '@builderhelm/protocol/voice';
import { createCorrelationId } from '@builderhelm/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (_event: unknown, input: unknown) => unknown>();

vi.mock('electron', async () => {
  const { electronSession } = await import('./electron-mock.js');
  return {
    ipcMain: {
      handle: (channel: string, handler: (_event: unknown, input: unknown) => unknown) =>
        handlers.set(channel, handler),
      removeHandler: (channel: string) => handlers.delete(channel),
    },
    session: electronSession,
    dialog: { showOpenDialog: vi.fn() },
  };
});

import { registerIpcHandlers } from '../src/main/ipc.js';
import { encodeWavPcm16 } from '../src/renderer/src/voice/pcm.js';

const whisper: VoiceStatus['models'][number] = {
  id: 'whisper-tiny',
  label: 'Whisper Tiny',
  engine: 'whisper',
  runtime: 'local',
  languages: 'English',
  detail: 'Offline English.',
  recommended: true,
  requiresApiKey: false,
  downloadBytes: 1,
  installed: true,
  downloadable: true,
  bytesOnDisk: 1,
  downloading: false,
  selectable: true,
};

const cloud: VoiceStatus['models'][number] = {
  id: 'gpt-4o-transcribe',
  label: 'GPT-4o Transcribe',
  engine: 'openai',
  runtime: 'cloud',
  languages: 'Multilingual',
  detail: 'Cloud.',
  recommended: false,
  requiresApiKey: true,
  downloadBytes: null,
  installed: false,
  downloadable: false,
  bytesOnDisk: null,
  downloading: false,
  selectable: true,
};

function voiceStatus(model: VoiceStatus['models'][number]): VoiceStatus {
  return {
    settings: {
      enabled: true,
      dictationMode: 'toggle',
      hotkey: 'CommandOrControl+Shift+V',
      microphoneId: null,
      modelId: model.id,
    },
    models: [model],
    openAiKeyPresent: model.runtime === 'cloud',
  };
}

function audio() {
  return {
    filename: 'clip.wav',
    audioBase64: Buffer.from(encodeWavPcm16(new Float32Array(1600).fill(0.4))).toString(
      'base64',
    ),
  };
}

describe('voice transcribe IPC', () => {
  beforeEach(() => handlers.clear());

  it('routes local models through the runtime wav path', async () => {
    const transcribeWav = vi.fn(async () => 'night falls');
    const transcribeCloud = vi.fn();
    const unregister = registerIpcHandlers(
      {
        voice: {
          status: async () => voiceStatus(whisper),
          transcribe: transcribeCloud,
        },
      } as unknown as CoreRuntime,
      undefined,
      undefined,
      {
        models: { installed: () => true } as never,
        runtime: { transcribeWav } as never,
      },
    );
    const handler = handlers.get(ipcChannels.voiceTranscribe)!;
    const result = await handler(
      {},
      { correlationId: createCorrelationId(), input: audio() },
    );
    expect(result).toEqual({ ok: true, value: { text: 'night falls' } });
    expect(transcribeWav).toHaveBeenCalledOnce();
    expect(transcribeCloud).not.toHaveBeenCalled();
    unregister();
  });

  it('routes cloud models through core and never writes a wav path from the renderer', async () => {
    const transcribeCloud = vi.fn(async () => ({ text: 'from the cloud' }));
    const transcribeWav = vi.fn();
    const unregister = registerIpcHandlers(
      {
        voice: {
          status: async () => voiceStatus(cloud),
          transcribe: transcribeCloud,
        },
      } as unknown as CoreRuntime,
      undefined,
      undefined,
      {
        models: { installed: () => false } as never,
        runtime: { transcribeWav } as never,
      },
    );
    const handler = handlers.get(ipcChannels.voiceTranscribe)!;
    const result = await handler(
      {},
      { correlationId: createCorrelationId(), input: audio() },
    );
    expect(result).toEqual({ ok: true, value: { text: 'from the cloud' } });
    expect(transcribeCloud).toHaveBeenCalledOnce();
    expect(transcribeWav).not.toHaveBeenCalled();
    unregister();
  });

  it('rejects extra fields and does not transcribe when dictation is off', async () => {
    const transcribeWav = vi.fn();
    const unregister = registerIpcHandlers(
      {
        voice: {
          status: async () => ({
            ...voiceStatus(whisper),
            settings: { ...voiceStatus(whisper).settings, enabled: false },
          }),
          transcribe: vi.fn(),
        },
      } as unknown as CoreRuntime,
      undefined,
      undefined,
      {
        models: { installed: () => true } as never,
        runtime: { transcribeWav } as never,
      },
    );
    const handler = handlers.get(ipcChannels.voiceTranscribe)!;
    const extra = await handler(
      {},
      { correlationId: createCorrelationId(), input: { ...audio(), extra: true } },
    );
    expect(extra).toMatchObject({ ok: false });
    const result = await handler(
      {},
      { correlationId: createCorrelationId(), input: audio() },
    );
    expect(result).toMatchObject({ ok: false });
    expect(transcribeWav).not.toHaveBeenCalled();
    unregister();
  });
});

