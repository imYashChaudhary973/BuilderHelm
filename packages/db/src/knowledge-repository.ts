import type { ZeroDatabase } from './database.js';

export interface KnowledgeVaultWrite {
  readonly id: string;
  readonly rootPath: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredKnowledgeVault extends Record<string, unknown> {
  id: string;
  rootPath: string;
  name: string;
  noteCount: number;
  lastIndexedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunkWrite {
  readonly id: string;
  readonly ordinal: number;
  readonly heading: string | null;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly text: string;
  readonly contentHash: string;
}

export interface KnowledgeLinkWrite {
  readonly id: string;
  readonly target: string;
  readonly label: string | null;
  readonly linkType: 'wikilink' | 'markdown';
  readonly lineNumber: number;
}

export interface KnowledgeEntityWrite {
  readonly id: string;
  readonly canonicalName: string;
  readonly entityType: string;
}

export interface KnowledgeDocumentWrite {
  readonly id: string;
  readonly relativePath: string;
  readonly title: string;
  readonly contentHash: string;
  readonly modifiedAtMs: number;
  readonly sizeBytes: number;
  readonly frontmatterJson: string;
  readonly tagsJson: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly chunks: readonly KnowledgeChunkWrite[];
  readonly links: readonly KnowledgeLinkWrite[];
  readonly entities: readonly KnowledgeEntityWrite[];
}

export interface StoredKnowledgeSource extends Record<string, unknown> {
  id: string;
  vaultId: string;
  rootPath: string;
  relativePath: string;
  title: string;
  contentHash: string;
  modifiedAtMs: number;
  sizeBytes: number;
  createdAt: string;
}

export interface KnowledgeSearchRow extends Record<string, unknown> {
  sourceId: string;
  chunkId: string;
  vaultId: string;
  relativePath: string;
  title: string;
  heading: string | null;
  lineStart: number;
  lineEnd: number;
  text: string;
  score: number;
}

export interface StoredKnowledgeChunk extends KnowledgeSearchRow {
  rootPath: string;
  sourceContentHash: string;
}

const vaultColumns = `
  knowledge_vaults.id,
  knowledge_vaults.root_path AS rootPath,
  knowledge_vaults.name,
  COUNT(knowledge_sources.id) AS noteCount,
  knowledge_vaults.last_indexed_at AS lastIndexedAt,
  knowledge_vaults.created_at AS createdAt,
  knowledge_vaults.updated_at AS updatedAt
`;

export class KnowledgeRepository {
  constructor(private readonly database: ZeroDatabase) {}

  listVaults(): StoredKnowledgeVault[] {
    return this.database.queryAll<StoredKnowledgeVault>(`
      SELECT ${vaultColumns}
      FROM knowledge_vaults
      LEFT JOIN knowledge_sources ON knowledge_sources.vault_id = knowledge_vaults.id
      GROUP BY knowledge_vaults.id
      ORDER BY lower(knowledge_vaults.name), knowledge_vaults.id
    `);
  }

  findVaultById(id: string): StoredKnowledgeVault | undefined {
    return this.database.queryOne<StoredKnowledgeVault>(
      `SELECT ${vaultColumns}
       FROM knowledge_vaults
       LEFT JOIN knowledge_sources ON knowledge_sources.vault_id = knowledge_vaults.id
       WHERE knowledge_vaults.id = ?
       GROUP BY knowledge_vaults.id`,
      [id],
    );
  }

  findVaultByRootPath(rootPath: string): StoredKnowledgeVault | undefined {
    return this.database.queryOne<StoredKnowledgeVault>(
      `SELECT ${vaultColumns}
       FROM knowledge_vaults
       LEFT JOIN knowledge_sources ON knowledge_sources.vault_id = knowledge_vaults.id
       WHERE knowledge_vaults.root_path = ?
       GROUP BY knowledge_vaults.id`,
      [rootPath],
    );
  }

  createVault(vault: KnowledgeVaultWrite): void {
    this.database.run(
      `INSERT INTO knowledge_vaults (
        id, root_path, name, last_indexed_at, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?)`,
      [vault.id, vault.rootPath, vault.name, vault.createdAt, vault.updatedAt],
    );
  }

  listSources(vaultId: string): StoredKnowledgeSource[] {
    return this.database.queryAll<StoredKnowledgeSource>(
      `SELECT
        knowledge_sources.id,
        knowledge_sources.vault_id AS vaultId,
        knowledge_vaults.root_path AS rootPath,
        knowledge_sources.relative_path AS relativePath,
        knowledge_sources.title,
        knowledge_sources.content_hash AS sourceContentHash,
        knowledge_sources.content_hash AS contentHash,
        knowledge_sources.modified_at_ms AS modifiedAtMs,
        knowledge_sources.size_bytes AS sizeBytes,
        knowledge_sources.created_at AS createdAt
       FROM knowledge_sources
       INNER JOIN knowledge_vaults ON knowledge_vaults.id = knowledge_sources.vault_id
       WHERE knowledge_sources.vault_id = ?
       ORDER BY knowledge_sources.relative_path`,
      [vaultId],
    );
  }

  syncVault(
    vaultId: string,
    documents: readonly KnowledgeDocumentWrite[],
    indexedAt: string,
  ): void {
    if (
      new Set(documents.map((document) => document.relativePath)).size !==
      documents.length
    ) {
      throw new TypeError('Knowledge documents must have unique relative paths');
    }
    this.database.transaction(() => {
      const existing = new Map(
        this.listSources(vaultId).map((source) => [source.relativePath, source]),
      );
      const incoming = new Set(documents.map((document) => document.relativePath));

      for (const source of existing.values()) {
        if (incoming.has(source.relativePath)) continue;
        this.deleteFtsForSource(source.id);
        this.database.run('DELETE FROM knowledge_sources WHERE id = ?', [source.id]);
      }

      for (const document of documents) {
        const current = existing.get(document.relativePath);
        if (current?.contentHash === document.contentHash) continue;
        const sourceId = current?.id ?? document.id;
        if (current === undefined) {
          this.database.run(
            `INSERT INTO knowledge_sources (
              id, vault_id, relative_path, title, content_hash, modified_at_ms,
              size_bytes, frontmatter_json, tags_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              sourceId,
              vaultId,
              document.relativePath,
              document.title,
              document.contentHash,
              document.modifiedAtMs,
              document.sizeBytes,
              document.frontmatterJson,
              document.tagsJson,
              document.createdAt,
              document.updatedAt,
            ],
          );
        } else {
          this.database.run(
            `UPDATE knowledge_sources SET
              title = ?, content_hash = ?, modified_at_ms = ?, size_bytes = ?,
              frontmatter_json = ?, tags_json = ?, updated_at = ?
             WHERE id = ? AND vault_id = ?`,
            [
              document.title,
              document.contentHash,
              document.modifiedAtMs,
              document.sizeBytes,
              document.frontmatterJson,
              document.tagsJson,
              document.updatedAt,
              sourceId,
              vaultId,
            ],
          );
          this.deleteFtsForSource(sourceId);
          this.database.run('DELETE FROM knowledge_chunks WHERE source_id = ?', [
            sourceId,
          ]);
          this.database.run('DELETE FROM knowledge_links WHERE source_id = ?', [
            sourceId,
          ]);
          this.database.run('DELETE FROM knowledge_entities WHERE source_id = ?', [
            sourceId,
          ]);
        }

        for (const chunk of document.chunks) {
          this.database.run(
            `INSERT INTO knowledge_chunks (
              id, source_id, ordinal, heading, line_start, line_end, text, content_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              chunk.id,
              sourceId,
              chunk.ordinal,
              chunk.heading,
              chunk.lineStart,
              chunk.lineEnd,
              chunk.text,
              chunk.contentHash,
            ],
          );
          this.database.run(
            `INSERT INTO knowledge_chunks_fts (chunk_id, title, heading, text)
             VALUES (?, ?, ?, ?)`,
            [chunk.id, document.title, chunk.heading ?? '', chunk.text],
          );
        }
        for (const link of document.links) {
          this.database.run(
            `INSERT INTO knowledge_links (
              id, source_id, target, label, link_type, line_number
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [link.id, sourceId, link.target, link.label, link.linkType, link.lineNumber],
          );
        }
        for (const entity of document.entities) {
          this.database.run(
            `INSERT INTO knowledge_entities (
              id, vault_id, canonical_name, entity_type, source_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              entity.id,
              vaultId,
              entity.canonicalName,
              entity.entityType,
              sourceId,
              document.updatedAt,
            ],
          );
        }
      }

      this.database.run(
        `UPDATE knowledge_vaults
         SET last_indexed_at = ?, updated_at = ?
         WHERE id = ?`,
        [indexedAt, indexedAt, vaultId],
      );
    });
  }

  search(vaultId: string, ftsQuery: string, limit: number): KnowledgeSearchRow[] {
    return this.database.queryAll<KnowledgeSearchRow>(
      `SELECT
        knowledge_sources.id AS sourceId,
        knowledge_chunks.id AS chunkId,
        knowledge_sources.vault_id AS vaultId,
        knowledge_sources.relative_path AS relativePath,
        knowledge_sources.title,
        knowledge_chunks.heading,
        knowledge_chunks.line_start AS lineStart,
        knowledge_chunks.line_end AS lineEnd,
        knowledge_chunks.text,
        -bm25(knowledge_chunks_fts, 0.0, 4.0, 2.0, 1.0) AS score
       FROM knowledge_chunks_fts
       INNER JOIN knowledge_chunks ON knowledge_chunks.id = knowledge_chunks_fts.chunk_id
       INNER JOIN knowledge_sources ON knowledge_sources.id = knowledge_chunks.source_id
       WHERE knowledge_chunks_fts MATCH ? AND knowledge_sources.vault_id = ?
       ORDER BY bm25(knowledge_chunks_fts, 0.0, 4.0, 2.0, 1.0), knowledge_chunks.id
       LIMIT ?`,
      [ftsQuery, vaultId, limit],
    );
  }

  expandLinkedSources(
    vaultId: string,
    sourceIds: readonly string[],
    limit: number,
  ): KnowledgeSearchRow[] {
    if (sourceIds.length === 0 || limit <= 0) return [];
    const placeholders = sourceIds.map(() => '?').join(', ');
    return this.database.queryAll<KnowledgeSearchRow>(
      `SELECT
        target.id AS sourceId,
        knowledge_chunks.id AS chunkId,
        target.vault_id AS vaultId,
        target.relative_path AS relativePath,
        target.title,
        knowledge_chunks.heading,
        knowledge_chunks.line_start AS lineStart,
        knowledge_chunks.line_end AS lineEnd,
        knowledge_chunks.text,
        0.01 AS score
       FROM knowledge_links
       INNER JOIN knowledge_sources AS target
         ON target.vault_id = ? AND (
           lower(target.title) = lower(knowledge_links.target)
           OR lower(target.relative_path) = lower(knowledge_links.target)
           OR lower(target.relative_path) = lower(knowledge_links.target || '.md')
         )
       INNER JOIN knowledge_chunks
         ON knowledge_chunks.source_id = target.id AND knowledge_chunks.ordinal = 0
       WHERE knowledge_links.source_id IN (${placeholders})
         AND target.id NOT IN (${placeholders})
       GROUP BY target.id
       ORDER BY lower(target.title), target.id
       LIMIT ?`,
      [vaultId, ...sourceIds, ...sourceIds, limit],
    );
  }

  findChunk(sourceId: string, chunkId: string): StoredKnowledgeChunk | undefined {
    return this.database.queryOne<StoredKnowledgeChunk>(
      `SELECT
        knowledge_sources.id AS sourceId,
        knowledge_chunks.id AS chunkId,
        knowledge_sources.vault_id AS vaultId,
        knowledge_vaults.root_path AS rootPath,
        knowledge_sources.relative_path AS relativePath,
        knowledge_sources.title,
        knowledge_sources.content_hash AS sourceContentHash,
        knowledge_chunks.heading,
        knowledge_chunks.line_start AS lineStart,
        knowledge_chunks.line_end AS lineEnd,
        knowledge_chunks.text,
        0 AS score
       FROM knowledge_chunks
       INNER JOIN knowledge_sources ON knowledge_sources.id = knowledge_chunks.source_id
       INNER JOIN knowledge_vaults ON knowledge_vaults.id = knowledge_sources.vault_id
       WHERE knowledge_sources.id = ? AND knowledge_chunks.id = ?`,
      [sourceId, chunkId],
    );
  }

  private deleteFtsForSource(sourceId: string): void {
    this.database.run(
      `DELETE FROM knowledge_chunks_fts
       WHERE chunk_id IN (
         SELECT id FROM knowledge_chunks WHERE source_id = ?
       )`,
      [sourceId],
    );
  }
}
