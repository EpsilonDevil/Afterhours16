-- v0.4.2: daily rewards wheel (one spin per account every 24 hours)
CREATE TABLE daily_spins (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id),
 last_spin REAL NOT NULL,
 spins INTEGER NOT NULL DEFAULT 0,
 last_prize TEXT
);
