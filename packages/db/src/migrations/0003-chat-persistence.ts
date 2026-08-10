import type { Migration } from '../migration-runner.js';

export const chatPersistenceMigration: Migration = {
  version: 3,
  name: 'chat-persistence',
  up(database) {
    database.execute(`
      CREATE TABLE chat_threads (
        id TEXT PRIMARY KEY,
        title TEXT CHECK (title IS NULL OR length(trim(title)) BETWEEN 1 AND 200),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE chat_turns (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
        content_json TEXT NOT NULL CHECK (json_valid(content_json)),
        model_ref TEXT,
        finish_reason TEXT CHECK (
          finish_reason IS NULL OR finish_reason IN (
            'stop', 'length', 'tool_calls', 'content_filter',
            'cancelled', 'error', 'unknown'
          )
        ),
        provider_continuation_json TEXT CHECK (
          provider_continuation_json IS NULL OR json_valid(provider_continuation_json)
        ),
        created_at TEXT NOT NULL,
        UNIQUE (thread_id, ordinal),
        UNIQUE (thread_id, id),
        CHECK (
          (role = 'assistant' AND model_ref IS NOT NULL AND finish_reason IS NOT NULL)
          OR
          (role != 'assistant' AND model_ref IS NULL AND finish_reason IS NULL
            AND provider_continuation_json IS NULL)
        )
      ) STRICT;

      CREATE INDEX chat_turns_thread_id_idx
      ON chat_turns(thread_id, ordinal);

      CREATE TABLE chat_usage (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL UNIQUE,
        provider_id TEXT NOT NULL,
        model_ref TEXT NOT NULL CHECK (model_ref LIKE provider_id || ':%'),
        input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
        output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
        cached_input_tokens INTEGER CHECK (
          cached_input_tokens IS NULL OR cached_input_tokens >= 0
        ),
        reasoning_tokens INTEGER CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
        created_at TEXT NOT NULL,
        FOREIGN KEY (thread_id, turn_id)
          REFERENCES chat_turns(thread_id, id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX chat_usage_thread_id_idx
      ON chat_usage(thread_id, created_at, id);
      CREATE INDEX chat_usage_model_ref_idx
      ON chat_usage(model_ref, created_at, id);
    `);
  },
};
