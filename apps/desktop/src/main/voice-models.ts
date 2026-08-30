import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { mkdtemp, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  VOICE_MODEL_PACKAGES,
  voiceModelPackage,
  type VoiceModelEvent,
  type VoiceModelId,
} from '@builderhelm/protocol/voice';
import { BuilderHelmError } from '@builderhelm/shared';

const execFileAsync = promisify(execFile);

export interface VoiceModelInventory {
  installed(id: VoiceModelId): boolean;
  bytesOnDisk(id: VoiceModelId): number | null;
  downloading(id: VoiceModelId): boolean;
  downloadable(id: VoiceModelId): boolean;
  paths(id: VoiceModelId): VoiceModelPaths | null;
}

export interface VoiceModelPaths {
  readonly root: string;
  readonly encoder: string;
  readonly decoder: string;
  readonly tokens: string;
  readonly joiner: string | null;
}

export type VoiceFetch = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<Response>;

/**
 * Owns on-disk local speech models: download with checksum, extract, cancel,
 * delete, and disk usage. The only network this process is allowed to use for
 * voice is `download`.
 */
export class VoiceModelManager implements VoiceModelInventory {
  private readonly inflight = new Map<VoiceModelId, AbortController>();

  constructor(
    private readonly rootDir: string,
    private readonly fetchImpl: VoiceFetch = fetch,
    private readonly packages: typeof VOICE_MODEL_PACKAGES = VOICE_MODEL_PACKAGES,
  ) {
    mkdirSync(rootDir, { recursive: true });
  }

  downloadable(id: VoiceModelId): boolean {
    return this.packages[id] !== undefined;
  }

  downloading(id: VoiceModelId): boolean {
    return this.inflight.has(id);
  }

  installed(id: VoiceModelId): boolean {
    return this.paths(id) !== null;
  }

  bytesOnDisk(id: VoiceModelId): number | null {
    const dir = join(this.rootDir, id);
    if (!existsSync(dir)) return null;
    return directoryBytes(dir);
  }

  diskUsage(): ReadonlyArray<{ readonly id: VoiceModelId; readonly bytes: number }> {
    return (Object.keys(this.packages) as VoiceModelId[])
      .map((id) => ({ id, bytes: this.bytesOnDisk(id) }))
      .filter((row): row is { id: VoiceModelId; bytes: number } => row.bytes !== null);
  }

  paths(id: VoiceModelId): VoiceModelPaths | null {
    const pack = this.packages[id];
    if (pack === undefined) return null;
    const root = join(this.rootDir, id);
    const encoder = join(root, pack.files.encoder);
    const decoder = join(root, pack.files.decoder);
    const tokens = join(root, pack.files.tokens);
    const joiner = pack.files.joiner === undefined ? null : join(root, pack.files.joiner);
    if (!existsSync(encoder) || !existsSync(decoder) || !existsSync(tokens)) {
      return null;
    }
    if (joiner !== null && !existsSync(joiner)) return null;
    return { root, encoder, decoder, tokens, joiner };
  }

  async download(
    id: VoiceModelId,
    onEvent: (event: VoiceModelEvent) => void,
  ): Promise<void> {
    const pack = this.packages[id] ?? voiceModelPackage(id);
    if (pack === undefined) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'This speech model has no install package on this host.',
      );
    }
    if (this.inflight.has(id)) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'That model is already downloading.',
      );
    }
    if (this.installed(id)) return;

    const controller = new AbortController();
    this.inflight.set(id, controller);
    const part = join(this.rootDir, `${id}.part`);
    try {
      const response = await this.fetchImpl(pack.url, { signal: controller.signal });
      if (!response.ok || response.body === null) {
        throw new BuilderHelmError(
          'INTEGRATION_OFFLINE',
          `Download failed (${response.status}).`,
        );
      }
      const total = Number(response.headers.get('content-length') ?? pack.bytes);
      const hash = createHash('sha256');
      let received = 0;
      const output = createWriteStream(part);
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          hash.update(value);
          received += value.byteLength;
          await new Promise<void>((resolve, reject) => {
            output.write(value, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
          onEvent({
            type: 'download.progress',
            modelId: id,
            receivedBytes: received,
            totalBytes: total,
          });
        }
      } finally {
        await new Promise<void>((resolve) => output.end(resolve));
      }
      const digest = hash.digest('hex');
      if (digest !== pack.sha256) {
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          'The downloaded archive failed its checksum.',
        );
      }
      const staging = await mkdtemp(join(tmpdir(), 'builderhelm-voice-'));
      await execFileAsync('tar', ['-xjf', part, '-C', staging]);
      const extracted = join(staging, pack.archiveRoot);
      if (!existsSync(extracted)) {
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          'The archive did not contain the expected model folder.',
        );
      }
      const dest = join(this.rootDir, id);
      rmSync(dest, { recursive: true, force: true });
      await rename(extracted, dest);
      rmSync(staging, { recursive: true, force: true });
      rmSync(part, { force: true });
      if (!this.installed(id)) {
        throw new BuilderHelmError(
          'VALIDATION_FAILED',
          'The archive was missing required model files.',
        );
      }
      onEvent({
        type: 'download.done',
        modelId: id,
        bytesOnDisk: this.bytesOnDisk(id) ?? 0,
      });
    } catch (error) {
      rmSync(part, { force: true });
      if (controller.signal.aborted) {
        onEvent({ type: 'download.cancelled', modelId: id });
        throw new BuilderHelmError('CANCELLED', 'Download cancelled.');
      }
      const message = error instanceof Error ? error.message : 'Download failed.';
      onEvent({ type: 'download.error', modelId: id, message });
      throw error;
    } finally {
      this.inflight.delete(id);
    }
  }

  cancel(id: VoiceModelId): boolean {
    const controller = this.inflight.get(id);
    if (controller === undefined) return false;
    controller.abort();
    return true;
  }

  delete(id: VoiceModelId): void {
    this.cancel(id);
    rmSync(join(this.rootDir, id), { recursive: true, force: true });
    rmSync(join(this.rootDir, `${id}.part`), { force: true });
  }
}

function directoryBytes(path: string): number {
  const stat = statSync(path);
  if (stat.isFile()) return stat.size;
  return readdirSync(path).reduce(
    (sum, name) => sum + directoryBytes(join(path, name)),
    0,
  );
}
