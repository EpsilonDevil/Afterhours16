-- v0.4.7.5 qp3: playing online with friends. Friends between real players on this service (one row per direction):
-- 'friends' both ways, or 'requested' (I asked) / 'incoming' (they asked me).
CREATE TABLE online_friends (
 account_id TEXT NOT NULL REFERENCES accounts(id),
 friend_id TEXT NOT NULL REFERENCES accounts(id),
 status TEXT NOT NULL CHECK (status IN ('friends', 'requested', 'incoming')),
 created_at REAL NOT NULL,
 PRIMARY KEY (account_id, friend_id)
);
