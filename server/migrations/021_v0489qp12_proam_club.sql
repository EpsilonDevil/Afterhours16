-- v0.4.8.9 qp12: the Pro-Am club (the team) takes AI members and invites. An AI member is an AI hooper of the AI world
-- the team lives in (its id there), on one team at most; the client's snapshot of him (name, build, look) is kept for
-- the roster. An invite is a real player asked by a member; he accepts or declines it from his Pro-Am menu.
CREATE TABLE IF NOT EXISTS pa_ai_members (
 ai_id TEXT PRIMARY KEY,
 team_id TEXT NOT NULL,
 data TEXT NOT NULL,
 added_by TEXT,
 joined_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS pa_ai_members_team ON pa_ai_members(team_id);
CREATE TABLE IF NOT EXISTS pa_invites (
 team_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 from_id TEXT NOT NULL,
 created_at REAL NOT NULL,
 PRIMARY KEY (team_id, account_id)
);
CREATE INDEX IF NOT EXISTS pa_invites_account ON pa_invites(account_id);
