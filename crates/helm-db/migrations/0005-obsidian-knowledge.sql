      CREATE TABLE knowledge_vaults (
        id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        last_indexed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE knowledge_sources (
        id TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL REFERENCES knowledge_vaults(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        title TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        modified_at_ms REAL NOT NULL,
        size_bytes INTEGER NOT NULL,
        frontmatter_json TEXT NOT NULL CHECK (json_valid(frontmatter_json)),
        tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (vault_id, relative_path)
      ) STRICT;

      CREATE INDEX knowledge_sources_vault_id_idx
      ON knowledge_sources(vault_id);

      CREATE TABLE knowledge_chunks (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        heading TEXT,
        line_start INTEGER NOT NULL CHECK (line_start > 0),
        line_end INTEGER NOT NULL CHECK (line_end >= line_start),
        text TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        UNIQUE (source_id, ordinal)
      ) STRICT;

      CREATE INDEX knowledge_chunks_source_id_idx
      ON knowledge_chunks(source_id);

      CREATE VIRTUAL TABLE knowledge_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        title,
        heading,
        text,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE TABLE knowledge_links (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
        target TEXT NOT NULL,
        label TEXT,
        link_type TEXT NOT NULL CHECK (link_type IN ('wikilink', 'markdown')),
        line_number INTEGER NOT NULL CHECK (line_number > 0)
      ) STRICT;

      CREATE INDEX knowledge_links_source_id_idx
      ON knowledge_links(source_id);

      CREATE TABLE knowledge_entities (
        id TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL REFERENCES knowledge_vaults(id) ON DELETE CASCADE,
        canonical_name TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        UNIQUE (vault_id, canonical_name, source_id)
      ) STRICT;

      CREATE INDEX knowledge_entities_vault_name_idx
      ON knowledge_entities(vault_id, canonical_name);
    
