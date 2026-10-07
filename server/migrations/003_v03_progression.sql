-- v0.3: client-simulated matches with server tickets, modes, Pro-Am teams.
ALTER TABLE matches ADD COLUMN mode TEXT NOT NULL DEFAULT 'park';
ALTER TABLE matches ADD COLUMN meta TEXT;
CREATE TABLE IF NOT EXISTS proam_teams (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id),
 data TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL
);
UPDATE matches SET status='cancelled', result='{"cancelled":true,"reason":"upgrade_v03","reward":0}' WHERE status='running';
