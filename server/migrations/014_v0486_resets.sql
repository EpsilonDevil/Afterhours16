-- v0.4.8.6 qp: the season resets this save has been through (server/reset.py): one row each, written in the same
-- transaction as the reset itself, so a reset happens exactly once per save
CREATE TABLE IF NOT EXISTS resets (
 id TEXT PRIMARY KEY,
 done_at REAL NOT NULL,
 backup TEXT,
 accounts INTEGER NOT NULL DEFAULT 0
);
