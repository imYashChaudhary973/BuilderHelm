use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::database::{DbRow, ZeroDatabase};

#[derive(Debug, Clone)]
pub struct KnowledgeVaultWrite {
    pub id: String,
    pub root_path: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredKnowledgeVault {
    pub id: String,
    pub root_path: String,
    pub name: String,
    pub note_count: i64,
    pub last_indexed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct KnowledgeChunkWrite {
    pub id: String,
    pub ordinal: i64,
    pub heading: Option<String>,
    pub line_start: i64,
    pub line_end: i64,
    pub text: String,
    pub content_hash: String,
}

#[derive(Debug, Clone)]
pub struct KnowledgeDocumentWrite {
    pub id: String,
    pub relative_path: String,
    pub title: String,
    pub content_hash: String,
    pub modified_at_ms: f64,
    pub size_bytes: i64,
    pub frontmatter_json: String,
    pub tags_json: String,
    pub created_at: String,
    pub updated_at: String,
    pub chunks: Vec<KnowledgeChunkWrite>,
    pub links: Vec<(String, String, Option<String>, String, i64)>,
    pub entities: Vec<(String, String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredKnowledgeSource {
    pub id: String,
    pub vault_id: String,
    pub root_path: String,
    pub relative_path: String,
    pub title: String,
    pub content_hash: String,
    pub modified_at_ms: f64,
    pub size_bytes: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSearchRow {
    pub source_id: String,
    pub chunk_id: String,
    pub vault_id: String,
    pub relative_path: String,
    pub title: String,
    pub heading: Option<String>,
    pub line_start: i64,
    pub line_end: i64,
    pub text: String,
    pub score: f64,
}

fn map_row<T: for<'de> Deserialize<'de>>(row: DbRow) -> T {
    serde_json::from_value(Value::Object(row)).expect("row")
}

const VAULT_COLUMNS: &str = "knowledge_vaults.id, knowledge_vaults.root_path AS rootPath, knowledge_vaults.name, COUNT(knowledge_sources.id) AS noteCount, knowledge_vaults.last_indexed_at AS lastIndexedAt, knowledge_vaults.created_at AS createdAt, knowledge_vaults.updated_at AS updatedAt";

pub struct KnowledgeRepository<'a> {
    database: &'a ZeroDatabase,
}

impl<'a> KnowledgeRepository<'a> {
    pub fn new(database: &'a ZeroDatabase) -> Self {
        Self { database }
    }

    pub fn list_vaults(&self) -> Vec<StoredKnowledgeVault> {
        self.database
            .query_all(
                &format!("SELECT {VAULT_COLUMNS} FROM knowledge_vaults LEFT JOIN knowledge_sources ON knowledge_sources.vault_id = knowledge_vaults.id GROUP BY knowledge_vaults.id ORDER BY lower(knowledge_vaults.name), knowledge_vaults.id"),
                &[],
            )
            .into_iter()
            .map(map_row)
            .collect()
    }

    pub fn create_vault(&self, vault: &KnowledgeVaultWrite) {
        self.database.run(
            "INSERT INTO knowledge_vaults (id, root_path, name, last_indexed_at, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)",
            &[
                json!(vault.id),
                json!(vault.root_path),
                json!(vault.name),
                json!(vault.created_at),
                json!(vault.updated_at),
            ],
        );
    }

    pub fn list_sources(&self, vault_id: &str) -> Vec<StoredKnowledgeSource> {
        self.database
            .query_all(
                "SELECT knowledge_sources.id, knowledge_sources.vault_id AS vaultId, knowledge_vaults.root_path AS rootPath, knowledge_sources.relative_path AS relativePath, knowledge_sources.title, knowledge_sources.content_hash AS contentHash, knowledge_sources.modified_at_ms AS modifiedAtMs, knowledge_sources.size_bytes AS sizeBytes, knowledge_sources.created_at AS createdAt FROM knowledge_sources INNER JOIN knowledge_vaults ON knowledge_vaults.id = knowledge_sources.vault_id WHERE knowledge_sources.vault_id = ? ORDER BY knowledge_sources.relative_path",
                &[json!(vault_id)],
            )
            .into_iter()
            .map(map_row)
            .collect()
    }

    fn delete_fts_for_source(&self, source_id: &str) {
        self.database.run(
            "DELETE FROM knowledge_chunks_fts WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE source_id = ?)",
            &[json!(source_id)],
        );
    }

    pub fn sync_vault(
        &self,
        vault_id: &str,
        documents: &[KnowledgeDocumentWrite],
        indexed_at: &str,
    ) {
        let paths: Vec<_> = documents.iter().map(|d| d.relative_path.as_str()).collect();
        if paths.len()
            != paths
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
        {
            panic!("Knowledge documents must have unique relative paths");
        }
        self.database.transaction(|| {
            let existing = self.list_sources(vault_id);
            let incoming: std::collections::BTreeSet<_> =
                documents.iter().map(|d| d.relative_path.as_str()).collect();
            for source in &existing {
                if incoming.contains(source.relative_path.as_str()) {
                    continue;
                }
                self.delete_fts_for_source(&source.id);
                self.database
                    .run("DELETE FROM knowledge_sources WHERE id = ?", &[json!(source.id)]);
            }
            for document in documents {
                let current = existing.iter().find(|s| s.relative_path == document.relative_path);
                if current.is_some_and(|s| s.content_hash == document.content_hash) {
                    continue;
                }
                let source_id = current.map(|s| s.id.clone()).unwrap_or_else(|| document.id.clone());
                if current.is_none() {
                    self.database.run(
                        "INSERT INTO knowledge_sources (id, vault_id, relative_path, title, content_hash, modified_at_ms, size_bytes, frontmatter_json, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        &[
                            json!(source_id),
                            json!(vault_id),
                            json!(document.relative_path),
                            json!(document.title),
                            json!(document.content_hash),
                            json!(document.modified_at_ms),
                            json!(document.size_bytes),
                            json!(document.frontmatter_json),
                            json!(document.tags_json),
                            json!(document.created_at),
                            json!(document.updated_at),
                        ],
                    );
                } else {
                    self.database.run(
                        "UPDATE knowledge_sources SET title = ?, content_hash = ?, modified_at_ms = ?, size_bytes = ?, frontmatter_json = ?, tags_json = ?, updated_at = ? WHERE id = ? AND vault_id = ?",
                        &[
                            json!(document.title),
                            json!(document.content_hash),
                            json!(document.modified_at_ms),
                            json!(document.size_bytes),
                            json!(document.frontmatter_json),
                            json!(document.tags_json),
                            json!(document.updated_at),
                            json!(source_id),
                            json!(vault_id),
                        ],
                    );
                    self.delete_fts_for_source(&source_id);
                    self.database
                        .run("DELETE FROM knowledge_chunks WHERE source_id = ?", &[json!(source_id)]);
                    self.database
                        .run("DELETE FROM knowledge_links WHERE source_id = ?", &[json!(source_id)]);
                    self.database
                        .run("DELETE FROM knowledge_entities WHERE source_id = ?", &[json!(source_id)]);
                }
                for chunk in &document.chunks {
                    self.database.run(
                        "INSERT INTO knowledge_chunks (id, source_id, ordinal, heading, line_start, line_end, text, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        &[
                            json!(chunk.id),
                            json!(source_id),
                            json!(chunk.ordinal),
                            json!(chunk.heading),
                            json!(chunk.line_start),
                            json!(chunk.line_end),
                            json!(chunk.text),
                            json!(chunk.content_hash),
                        ],
                    );
                    self.database.run(
                        "INSERT INTO knowledge_chunks_fts (chunk_id, title, heading, text) VALUES (?, ?, ?, ?)",
                        &[
                            json!(chunk.id),
                            json!(document.title),
                            json!(chunk.heading.clone().unwrap_or_default()),
                            json!(chunk.text),
                        ],
                    );
                }
            }
            self.database.run(
                "UPDATE knowledge_vaults SET last_indexed_at = ?, updated_at = ? WHERE id = ?",
                &[json!(indexed_at), json!(indexed_at), json!(vault_id)],
            );
        });
    }

    pub fn search(&self, vault_id: &str, fts_query: &str, limit: i64) -> Vec<KnowledgeSearchRow> {
        self.database
            .query_all(
                "SELECT knowledge_sources.id AS sourceId, knowledge_chunks.id AS chunkId, knowledge_sources.vault_id AS vaultId, knowledge_sources.relative_path AS relativePath, knowledge_sources.title, knowledge_chunks.heading, knowledge_chunks.line_start AS lineStart, knowledge_chunks.line_end AS lineEnd, knowledge_chunks.text, -bm25(knowledge_chunks_fts, 0.0, 4.0, 2.0, 1.0) AS score FROM knowledge_chunks_fts INNER JOIN knowledge_chunks ON knowledge_chunks.id = knowledge_chunks_fts.chunk_id INNER JOIN knowledge_sources ON knowledge_sources.id = knowledge_chunks.source_id WHERE knowledge_chunks_fts MATCH ? AND knowledge_sources.vault_id = ? ORDER BY bm25(knowledge_chunks_fts, 0.0, 4.0, 2.0, 1.0), knowledge_chunks.id LIMIT ?",
                &[json!(fts_query), json!(vault_id), json!(limit)],
            )
            .into_iter()
            .map(map_row)
            .collect()
    }
}
