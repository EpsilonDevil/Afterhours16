-- Presentation selection is persistent; every venue still uses the same solo 3v3 rules.
ALTER TABLE matches ADD COLUMN venue TEXT NOT NULL DEFAULT 'yard';
