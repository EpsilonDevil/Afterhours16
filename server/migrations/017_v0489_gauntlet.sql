-- v0.4.8.9 The Gauntlet (docs/GAUNTLET.md; server/gauntlet.py): runs (issued at start, paid once at finish), each
-- account's nemesis world (the deck engine's, validated and kept here), the ICON builds sacrificed into the Gauntlet
-- (their build data kept as the converted player's record) and the park cards they brought the account.
CREATE TABLE IF NOT EXISTS gauntlet_runs (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 seed INTEGER NOT NULL,
 player TEXT NOT NULL,
 status TEXT NOT NULL,
 started_at REAL NOT NULL,
 finished_at REAL,
 result TEXT
);
CREATE INDEX IF NOT EXISTS gauntlet_runs_account ON gauntlet_runs(account_id, status);
CREATE TABLE IF NOT EXISTS gauntlet_worlds (
 account_id TEXT PRIMARY KEY,
 data TEXT NOT NULL,
 feed TEXT NOT NULL DEFAULT '[]',
 updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS gauntlet_players (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 character_id TEXT NOT NULL UNIQUE,
 data TEXT NOT NULL,
 created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS gauntlet_players_account ON gauntlet_players(account_id);
CREATE TABLE IF NOT EXISTS park_cards (
 account_id TEXT NOT NULL,
 n INTEGER NOT NULL,
 tier TEXT NOT NULL,
 attr TEXT NOT NULL,
 pct REAL NOT NULL,
 character_id TEXT NOT NULL,
 name TEXT,
 icon TEXT,
 created_at REAL NOT NULL,
 PRIMARY KEY (account_id, n)
);
