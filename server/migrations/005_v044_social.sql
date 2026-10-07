-- v0.4.4: locker codes (per-account redemption counts) and the persistent AI world (friends, squad,
-- AI players' growth) for the social phone
CREATE TABLE locker_redemptions (
 account_id TEXT NOT NULL REFERENCES accounts(id),
 code TEXT NOT NULL,
 count INTEGER NOT NULL DEFAULT 0,
 last_at REAL NOT NULL,
 PRIMARY KEY (account_id, code)
);
CREATE TABLE ai_world (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id),
 data TEXT NOT NULL,
 updated_at REAL NOT NULL
);
