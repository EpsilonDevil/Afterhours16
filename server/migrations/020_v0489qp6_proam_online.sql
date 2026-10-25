-- v0.4.8.9 qp6: Pro-Am teams online. A player who plays from his own copy through a hosted game or the online server
-- keeps his builds in his own save, so the team's service (the hub) can't read them: each member's game sends a card
-- for his build (name, position, overall, his Pro-Am rank) with every look at the team, kept here for the roster.
CREATE TABLE IF NOT EXISTS pa_cards (
 account_id TEXT PRIMARY KEY,
 data TEXT NOT NULL,
 updated_at REAL NOT NULL
);
