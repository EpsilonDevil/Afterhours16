-- v0.4.8.8 The Pro-Am Overhaul (docs/PROAM-OVERHAUL.md; server/proam.py): seasons, Pro-Am teams (real and AI), their
-- members and join requests, series. A player's own season rank (division and RP) is kept on his build
-- (characters.data progression.pa), like the rest of his progress. The old proam_teams table (a player's own Pro-Am
-- branding, from before teams) is left as it is.
CREATE TABLE IF NOT EXISTS pa_seasons (
 n INTEGER PRIMARY KEY,
 start REAL NOT NULL,
 end REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS pa_teams (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 abbr TEXT NOT NULL,
 ai INTEGER NOT NULL DEFAULT 0,
 founder TEXT,
 season INTEGER NOT NULL,
 div INTEGER NOT NULL DEFAULT 0,
 rp INTEGER NOT NULL DEFAULT 0,
 data TEXT NOT NULL,
 created_at REAL NOT NULL,
 updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS pa_teams_name ON pa_teams(name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS pa_members (
 account_id TEXT PRIMARY KEY,
 team_id TEXT NOT NULL,
 joined_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS pa_members_team ON pa_members(team_id);
CREATE TABLE IF NOT EXISTS pa_requests (
 team_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 created_at REAL NOT NULL,
 PRIMARY KEY (team_id, account_id)
);
CREATE TABLE IF NOT EXISTS pa_series (
 id TEXT PRIMARY KEY,
 team_id TEXT NOT NULL,
 season INTEGER NOT NULL,
 div INTEGER NOT NULL,
 status TEXT NOT NULL,
 data TEXT NOT NULL,
 created_at REAL NOT NULL,
 updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS pa_series_team ON pa_series(team_id, status);
CREATE TABLE IF NOT EXISTS pa_state (
 k TEXT PRIMARY KEY,
 v TEXT NOT NULL
);
