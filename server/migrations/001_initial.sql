CREATE TABLE accounts (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
 password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
 expires_at REAL NOT NULL
);
CREATE TABLE wallets (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id),
 balance INTEGER NOT NULL CHECK(typeof(balance)='integer' AND balance >= 0)
);
CREATE TABLE ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL REFERENCES accounts(id),
 delta INTEGER NOT NULL, balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
 kind TEXT NOT NULL, reference TEXT NOT NULL, created_at REAL NOT NULL,
 UNIQUE(account_id, reference)
);
CREATE TABLE characters (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
 data TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE inventory (
 account_id TEXT NOT NULL REFERENCES accounts(id), item_id TEXT NOT NULL,
 acquired_at REAL NOT NULL, PRIMARY KEY(account_id, item_id)
);
CREATE TABLE requests (
 account_id TEXT NOT NULL REFERENCES accounts(id), key TEXT NOT NULL,
 fingerprint TEXT NOT NULL, response TEXT NOT NULL,
 created_at REAL NOT NULL, PRIMARY KEY(account_id, key)
);
CREATE TABLE matches (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
 character_id TEXT NOT NULL REFERENCES characters(id), status TEXT NOT NULL,
 seed INTEGER NOT NULL, state TEXT, result TEXT, created_at REAL NOT NULL,
 updated_at REAL NOT NULL
);
CREATE UNIQUE INDEX one_active_match ON matches(account_id) WHERE status='running';
CREATE INDEX match_history ON matches(account_id, created_at DESC);
CREATE INDEX account_characters ON characters(account_id);
