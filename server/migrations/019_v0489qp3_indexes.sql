-- v0.4.8.9 qp3: indexes for lookups that scanned their whole table (EXPLAIN QUERY PLAN). Index-only: no table, column
-- or row changes. Rows with the same key still come back in rowid order, as the full scans returned them.
-- deleting a build (app.py) and the characters foreign-key check on it
CREATE INDEX IF NOT EXISTS matches_character ON matches(character_id);
-- an online crew's members (online.py), and the online_crews foreign-key check when a crew is removed
CREATE INDEX IF NOT EXISTS online_crew_members_crew ON online_crew_members(crew_id);
-- the expired-session sweep at every sign-in (database.py)
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
-- a player's Pro-Am join requests (proam.py)
CREATE INDEX IF NOT EXISTS pa_requests_account ON pa_requests(account_id);
-- the AI teams of a season (proam.py: the AI league's games, the nearest AI team for a series)
CREATE INDEX IF NOT EXISTS pa_teams_ai ON pa_teams(ai, season);
