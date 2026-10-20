-- v0.4.8.7: the one AI world everybody connected to this service plays in (server/app.py shared_world): its seed and its
-- birth (ms). A single row; a new one after a season reset (a world born before it is the old one)
CREATE TABLE IF NOT EXISTS shared_world (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 seed INTEGER NOT NULL,
 born REAL NOT NULL,
 created_at REAL NOT NULL
);
