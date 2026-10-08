-- v0.4.5: The King Tut Cup. One row per account per 48-hour Cup window: games, wins, streak, net VC earned
-- (payouts minus stakes) and whether the final-standings prizes were claimed.
CREATE TABLE cup_entries (
 account_id TEXT NOT NULL REFERENCES accounts(id),
 window INTEGER NOT NULL,
 data TEXT NOT NULL,
 updated_at REAL NOT NULL,
 PRIMARY KEY (account_id, window)
);
