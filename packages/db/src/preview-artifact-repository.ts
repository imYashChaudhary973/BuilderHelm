import type { BuilderHelmDatabase } from './database.js';

export interface PreviewArtifactWrite {
  readonly id: string;
  readonly runId: string | null;
  readonly headSha: string;
  readonly kind: 'screenshot' | 'snapshot' | 'tool' | 'console' | 'annotation';
  readonly url: string;
  readonly viewport: 'desktop' | 'tablet' | 'phone';
  readonly bodyJson: string | null;
  readonly png: Uint8Array | null;
  readonly createdAt: string;
}

interface StoredPreviewArtifact extends Record<string, unknown> {
  id: string;
  run_id: string | null;
  head_sha: string;
  kind: 'screenshot' | 'snapshot' | 'tool' | 'console' | 'annotation';
  url: string;
  viewport: 'desktop' | 'tablet' | 'phone';
  body_json: string | null;
  png: Uint8Array | null;
  created_at: string;
}

function toWrite(row: StoredPreviewArtifact): PreviewArtifactWrite {
  return {
    id: row.id,
    runId: row.run_id,
    headSha: row.head_sha,
    kind: row.kind,
    url: row.url,
    viewport: row.viewport,
    bodyJson: row.body_json,
    png: row.png,
    createdAt: row.created_at,
  };
}

export class PreviewArtifactRepository {
  constructor(private readonly database: BuilderHelmDatabase) {}

  insert(artifact: PreviewArtifactWrite): void {
    this.database.run(
      `INSERT INTO preview_artifacts (
         id, run_id, head_sha, kind, url, viewport, body_json, png, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        artifact.id,
        artifact.runId,
        artifact.headSha,
        artifact.kind,
        artifact.url,
        artifact.viewport,
        artifact.bodyJson,
        artifact.png,
        artifact.createdAt,
      ],
    );
  }

  list(filter: {
    readonly headSha?: string;
    readonly runId?: string | null;
  }): PreviewArtifactWrite[] {
    if (filter.runId !== undefined && filter.runId !== null) {
      return this.database
        .queryAll<StoredPreviewArtifact>(
          `SELECT * FROM preview_artifacts WHERE run_id = ?
           ORDER BY created_at DESC LIMIT 50`,
          [filter.runId],
        )
        .map(toWrite);
    }
    if (filter.headSha !== undefined) {
      return this.database
        .queryAll<StoredPreviewArtifact>(
          `SELECT * FROM preview_artifacts WHERE head_sha = ?
           ORDER BY created_at DESC LIMIT 50`,
          [filter.headSha],
        )
        .map(toWrite);
    }
    return this.database
      .queryAll<StoredPreviewArtifact>(
        `SELECT * FROM preview_artifacts ORDER BY created_at DESC LIMIT 50`,
      )
      .map(toWrite);
  }
}
