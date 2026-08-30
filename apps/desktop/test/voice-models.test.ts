import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { VOICE_MODEL_PACKAGES, type VoiceModelEvent } from '@builderhelm/protocol/voice';
import { BuilderHelmError } from '@builderhelm/shared';
import { describe, expect, it } from 'vitest';

import { VoiceModelManager } from '../src/main/voice-models.js';

const whisper = VOICE_MODEL_PACKAGES['whisper-tiny'];
if (whisper === undefined) throw new Error('whisper-tiny package missing');

function fakeArchive(): { bytes: Uint8Array; sha256: string; root: string } {
  const staging = mkdtempSync(join(tmpdir(), 'voice-arch-'));
  const inner = join(staging, whisper.archiveRoot);
  mkdirSync(inner);
  writeFileSync(join(inner, whisper.files.encoder), 'encoder');
  writeFileSync(join(inner, whisper.files.decoder), 'decoder');
  writeFileSync(join(inner, whisper.files.tokens), 'tokens');
  const archive = join(staging, 'model.tar.bz2');
  execFileSync('tar', ['-cjf', archive, '-C', staging, whisper.archiveRoot]);
  const bytes = new Uint8Array(readFileSync(archive));
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    root: mkdtempSync(join(tmpdir(), 'voice-root-')),
  };
}

describe('voice model manager', () => {
  it('downloads, checksums, extracts, reports disk usage, and deletes', async () => {
    const fake = fakeArchive();
    const pack = {
      ...VOICE_MODEL_PACKAGES,
      'whisper-tiny': {
        ...whisper,
        url: 'http://models.test/whisper.tar.bz2',
        sha256: fake.sha256,
        bytes: fake.bytes.byteLength,
      },
    };
    const events: VoiceModelEvent[] = [];
    const manager = new VoiceModelManager(
      fake.root,
      async () =>
        new Response(fake.bytes, {
          headers: { 'content-length': String(fake.bytes.byteLength) },
        }),
      pack,
    );

    expect(manager.installed('whisper-tiny')).toBe(false);
    await manager.download('whisper-tiny', (event) => events.push(event));
    expect(manager.installed('whisper-tiny')).toBe(true);
    expect(manager.bytesOnDisk('whisper-tiny')).toBeGreaterThan(0);
    expect(manager.diskUsage()).toEqual([
      { id: 'whisper-tiny', bytes: manager.bytesOnDisk('whisper-tiny') },
    ]);
    expect(events.some((event) => event.type === 'download.progress')).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: 'download.done',
      modelId: 'whisper-tiny',
    });

    manager.delete('whisper-tiny');
    expect(manager.installed('whisper-tiny')).toBe(false);
    expect(manager.diskUsage()).toEqual([]);
  });

  it('rejects a second download of the same model and cancels an in-flight one', async () => {
    const fake = fakeArchive();
    const pack = {
      ...VOICE_MODEL_PACKAGES,
      'whisper-tiny': {
        ...whisper,
        url: 'http://models.test/whisper.tar.bz2',
        sha256: fake.sha256,
        bytes: fake.bytes.byteLength,
      },
    };
    let releaseHang: ((value: Uint8Array) => void) | undefined;
    const hang = new Promise<Uint8Array>((resolve) => {
      releaseHang = resolve;
    });
    const manager = new VoiceModelManager(
      fake.root,
      async (_url, init) => {
        const bytes = await hang;
        if (init?.signal?.aborted) {
          throw new DOMException('aborted', 'AbortError');
        }
        return new Response(bytes);
      },
      pack,
    );

    const first = manager.download('whisper-tiny', () => {});
    await expect(manager.download('whisper-tiny', () => {})).rejects.toBeInstanceOf(
      BuilderHelmError,
    );
    expect(manager.cancel('whisper-tiny')).toBe(true);
    releaseHang?.(fake.bytes);
    await expect(first).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(manager.installed('whisper-tiny')).toBe(false);
  });

  it('refuses a checksum mismatch', async () => {
    const fake = fakeArchive();
    const pack = {
      ...VOICE_MODEL_PACKAGES,
      'whisper-tiny': {
        ...whisper,
        url: 'http://models.test/whisper.tar.bz2',
        sha256: '0'.repeat(64),
        bytes: fake.bytes.byteLength,
      },
    };
    const manager = new VoiceModelManager(
      fake.root,
      async () => new Response(fake.bytes),
      pack,
    );
    await expect(manager.download('whisper-tiny', () => {})).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(manager.installed('whisper-tiny')).toBe(false);
  });
});
