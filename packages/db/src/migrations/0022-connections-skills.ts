import type { Migration } from '../migration-runner.js';

export const connectionsSkillsMigration: Migration = {
  version: 22,
  name: 'connections-skills',
  up(database) {
    database.execute(`
      CREATE TABLE connections (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
        kind TEXT NOT NULL CHECK (kind IN ('apify', 'x-write')),
        transport TEXT NOT NULL CHECK (transport = 'https'),
        endpoint TEXT NOT NULL CHECK (length(endpoint) BETWEEN 8 AND 2048),
        auth_ref TEXT NOT NULL CHECK (length(auth_ref) BETWEEN 1 AND 200),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        schema_version TEXT NOT NULL CHECK (length(schema_version) BETWEEN 1 AND 128),
        schema_hash TEXT NOT NULL CHECK (length(schema_hash) BETWEEN 1 AND 64),
        tools_json TEXT NOT NULL CHECK (json_valid(tools_json)),
        last_test_at TEXT,
        last_test_ok INTEGER CHECK (last_test_ok IS NULL OR last_test_ok IN (0, 1)),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE connection_grants (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL CHECK (length(profile_id) BETWEEN 1 AND 80),
        tool_name TEXT NOT NULL CHECK (tool_name IN ('apify.research', 'x.publish')),
        schema_hash TEXT NOT NULL CHECK (length(schema_hash) BETWEEN 1 AND 64),
        created_at TEXT NOT NULL,
        UNIQUE (connection_id, profile_id, tool_name)
      ) STRICT;

      CREATE TABLE skills (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
        version TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 32),
        provenance TEXT NOT NULL CHECK (provenance IN ('local', 'reviewed')),
        body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
        capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE skill_bindings (
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL CHECK (length(profile_id) BETWEEN 1 AND 80),
        created_at TEXT NOT NULL,
        PRIMARY KEY (skill_id, profile_id)
      ) STRICT;

      CREATE TABLE connector_jobs (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        request_id TEXT NOT NULL UNIQUE CHECK (length(request_id) = 36),
        connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE RESTRICT,
        profile_id TEXT NOT NULL CHECK (length(profile_id) BETWEEN 1 AND 80),
        tool_name TEXT NOT NULL CHECK (tool_name IN ('apify.research', 'x.publish')),
        remote_job_id TEXT CHECK (remote_job_id IS NULL OR length(remote_job_id) BETWEEN 1 AND 200),
        status TEXT NOT NULL CHECK (status IN (
          'running', 'succeeded', 'failed', 'cancelled', 'outcomeUnknown'
        )),
        cost_limit_usd REAL NOT NULL CHECK (cost_limit_usd >= 0),
        destination TEXT NOT NULL CHECK (length(destination) BETWEEN 1 AND 300),
        report TEXT CHECK (report IS NULL OR length(report) <= 20000),
        sources_json TEXT NOT NULL CHECK (json_valid(sources_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX connector_jobs_profile_created_idx
      ON connector_jobs (profile_id, created_at DESC);
    `);
  },
};
