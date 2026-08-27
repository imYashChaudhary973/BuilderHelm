      CREATE TABLE board_presets (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 80),
        folder_path TEXT NOT NULL CHECK (length(folder_path) BETWEEN 1 AND 4096),
        pane_count INTEGER NOT NULL CHECK (pane_count IN (1, 2, 4, 6, 8, 10, 12)),
        isolation TEXT NOT NULL CHECK (isolation IN ('shared', 'worktree')),
        panes_json TEXT NOT NULL CHECK (length(panes_json) BETWEEN 2 AND 100000),
        created_at TEXT NOT NULL
      ) STRICT;
    
