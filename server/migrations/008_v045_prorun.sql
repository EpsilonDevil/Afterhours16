-- v0.4.5: The Pro Run. One career per player (college, draft, seasons), saved whole as JSON.
CREATE TABLE prorun_careers (
 character_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES accounts(id),
 data TEXT NOT NULL,
 created_at REAL NOT NULL,
 updated_at REAL NOT NULL
);
