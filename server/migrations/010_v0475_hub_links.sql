-- v0.4.7.5 qp3: playing online from your own copy. Each of your accounts can be linked to a friend's hosted game (the
-- "hub": host[:port]) with the online account you made there; your players, VC and progress stay in this save.
CREATE TABLE hub_links (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id),
 hub TEXT NOT NULL,
 username TEXT,
 token TEXT,
 updated_at REAL NOT NULL
);
