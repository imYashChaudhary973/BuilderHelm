import type { PreviewArtifactRepository } from '@builderhelm/db';
import {
  buildPageSnapshot,
  previewArtifactSchema,
  type PreviewArtifact,
  type PreviewArtifactKind,
  type PreviewSnapshotNode,
} from '@builderhelm/protocol/browser';
import { createId, utcNow } from '@builderhelm/shared';

export interface PreviewArtifactDraft {
  readonly runId?: string | null;
  readonly headSha: string;
  readonly kind: PreviewArtifactKind;
  readonly url: string;
  readonly viewport: 'desktop' | 'tablet' | 'phone';
  readonly nodes?: readonly PreviewSnapshotNode[] | null;
  readonly png?: Uint8Array | null;
  readonly detail?: string | null;
}

function encodePng(png: Uint8Array | null): string | null {
  if (png === null || png.byteLength === 0) return null;
  return Buffer.from(png).toString('base64');
}

export class PreviewArtifactService {
  constructor(private readonly repository: PreviewArtifactRepository) {}

  record(draft: PreviewArtifactDraft): PreviewArtifact {
    const detail =
      draft.kind === 'tool' || draft.kind === 'console' ? (draft.detail ?? '') : null;
    const artifact = previewArtifactSchema.parse({
      id: createId(),
      runId: draft.runId ?? null,
      headSha: draft.headSha,
      kind: draft.kind,
      url: draft.url,
      viewport: draft.viewport,
      nodes: draft.kind === 'snapshot' ? [...(draft.nodes ?? [])] : null,
      pngBase64: draft.kind === 'screenshot' ? encodePng(draft.png ?? null) : null,
      detail,
      createdAt: utcNow(),
    });
    this.repository.insert({
      id: artifact.id,
      runId: artifact.runId,
      headSha: artifact.headSha,
      kind: artifact.kind,
      url: artifact.url,
      viewport: artifact.viewport,
      bodyJson:
        artifact.kind === 'snapshot' ? JSON.stringify(artifact.nodes) : artifact.detail,
      png: draft.png ?? null,
      createdAt: artifact.createdAt,
    });
    return artifact;
  }

  list(filter: {
    readonly headSha?: string;
    readonly runId?: string | null;
  }): PreviewArtifact[] {
    return this.repository.list(filter).map((row) => {
      const snapshot = row.kind === 'snapshot' && row.bodyJson !== null;
      return previewArtifactSchema.parse({
        id: row.id,
        runId: row.runId,
        headSha: row.headSha,
        kind: row.kind,
        url: row.url,
        viewport: row.viewport,
        nodes: snapshot ? buildPageSnapshot(JSON.parse(row.bodyJson ?? '[]')) : null,
        pngBase64: encodePng(row.png),
        detail: snapshot || row.kind === 'screenshot' ? null : (row.bodyJson ?? null),
        createdAt: row.createdAt,
      });
    });
  }
}
