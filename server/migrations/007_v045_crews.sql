-- v0.4.5: Crews. One crew per account (name, tag, color, members picked from friends, crew XP and level).
CREATE TABLE crews (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id),
 data TEXT NOT NULL,
 created_at REAL NOT NULL,
 updated_at REAL NOT NULL
);
