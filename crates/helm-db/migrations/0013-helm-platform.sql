      CREATE TABLE helm_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
        brief TEXT NOT NULL CHECK (length(trim(brief)) BETWEEN 1 AND 4000),
        engine TEXT NOT NULL CHECK (engine IN ('claude', 'codex', 'grok')),
        places_json TEXT NOT NULL CHECK (json_valid(places_json)),
        skill_ids_json TEXT NOT NULL CHECK (json_valid(skill_ids_json)),
        created_at TEXT NOT NULL
      ) STRICT;
    
      CREATE TABLE helm_routines (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES helm_agents(id),
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
        instruction TEXT NOT NULL CHECK (length(trim(instruction)) BETWEEN 1 AND 4000),
        every_minutes INTEGER NOT NULL CHECK (every_minutes BETWEEN 15 AND 10080),
        paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
        last_run_at TEXT,
        last_error TEXT
      ) STRICT;
    
      CREATE TABLE helm_plugins (
        id TEXT PRIMARY KEY CHECK (id = 'github'),
        connected INTEGER NOT NULL CHECK (connected IN (0, 1)),
        account TEXT
      ) STRICT;
    
INSERT INTO helm_plugins (id, connected, account) VALUES ('github', 0, NULL);
