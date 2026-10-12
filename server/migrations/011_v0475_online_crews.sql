-- v0.4.7.5 qp3: crews with real players in them. A crew's founder (the crew lives in his own save) brings it online
-- here and adds his friends; their games add crew XP (pending_xp) that his game collects into his save.
CREATE TABLE online_crews (
 id TEXT PRIMARY KEY REFERENCES accounts(id),
 name TEXT NOT NULL,
 tag TEXT NOT NULL,
 color TEXT NOT NULL,
 level INTEGER NOT NULL DEFAULT 1,
 xp INTEGER NOT NULL DEFAULT 0,
 pending_xp INTEGER NOT NULL DEFAULT 0,
 updated_at REAL NOT NULL
);
CREATE TABLE online_crew_members (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id),
 crew_id TEXT NOT NULL REFERENCES online_crews(id),
 since REAL NOT NULL
);
