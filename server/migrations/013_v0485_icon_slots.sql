-- v0.4.8.5 qp8: deleting builds. A build that held an ICON build slot (qp7: the slot is the account's for good) leaves it
-- open when it's deleted: one row per such build, counted with the builds that hold one (builds.build_slots, up to 8).
CREATE TABLE icon_slots (
 account_id TEXT NOT NULL REFERENCES accounts(id),
 character_id TEXT NOT NULL,
 name TEXT,
 deleted_at REAL NOT NULL,
 PRIMARY KEY (account_id, character_id)
);
