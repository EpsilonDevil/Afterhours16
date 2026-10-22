-- v0.4.8.9 qp1 Gauntlet replay checks (server/gauntlet.py, server/verify/gauntlet_replay.mjs): what a run's replay needs,
-- kept with the run when it starts (the seed, the player, the nemesis world and unlocks as they were), and whether its
-- payout was checked by replaying its choices (verified) with the replay's outcome hash.
ALTER TABLE gauntlet_runs ADD COLUMN start TEXT;
ALTER TABLE gauntlet_runs ADD COLUMN verified INTEGER;
ALTER TABLE gauntlet_runs ADD COLUMN replay_hash TEXT;
