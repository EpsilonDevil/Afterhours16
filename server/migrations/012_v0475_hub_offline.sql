-- v0.4.7.5 qp3 (Oct 12): playing offline for a while keeps your online account's link (and its sign-in) for when you
-- connect again. Every copy connects to the game's own online server by itself (online.json) unless you chose this.
ALTER TABLE hub_links ADD COLUMN offline INTEGER NOT NULL DEFAULT 0;
