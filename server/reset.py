"""v0.4.8.6 quick patch: the season reset (David, Oct 18 2026: "Ensure all players accounts have their builds and VC totals
wiped; event items and etc etc. All players will be able to keep their accounts for logging into the game, but will be
logged in with 250k VC and nothing else. A completely fresh account.").

At SEASON_RESET["at"] (midnight Eastern going into Oct 19 2026, 04:00 UTC) every account on this save starts over, the
first time the service runs at or after that moment: at start-up, or on the first request after it (Service.maybe_reset,
called before every request, so nothing is ever served from the old save after the reset time). Each save (every
player's own copy, and the online server) resets itself once, in one transaction, recorded in the `resets` table. A
copy updated later resets the first time it starts.

Wiped, for every account: builds (characters) and their games (matches) and Pro Run careers; every item (store,
Daily Spin and event items; the free basics every new account gets are given back); the VC ledger, the wallet set to
SEASON_RESET["vc"]; Pro-Am teams; crews (offline crews and online crews with their members: disbanded, so they start
over with no XP); event entries (cup_entries); Daily Spin timers; locker-code redemptions; ICON build slots; the
saved request replies (requests); the AI world (ai_world: the next sign-in builds a brand-new world, its AI starting
from nothing, David's choice).
Kept: the account itself (username and password), sign-ins (sessions: nobody is signed out), real-player friends
(online_friends), the link to the online server (hub_links).

A copy of the whole save is made first (data/backups/pre-reset-<id>.db, next to the save), in case anything ever
needs to be looked at or brought back.
"""
import sqlite3
import time
from pathlib import Path

SEASON_RESET = {"id": "season-2026-10-19", "at": 1792382400, "vc": 250_000}  # (2026-10-19 04:00 UTC = 12:00 AM EDT)

# children before parents (foreign keys are on)
WIPE = ("matches", "prorun_careers", "characters", "inventory", "ledger", "requests", "cup_entries", "daily_spins",
        "locker_redemptions", "icon_slots", "proam_teams", "crews", "online_crew_members", "online_crews", "ai_world")
KEEP = ("accounts", "sessions", "online_friends", "hub_links", "wallets", "resets", "schema_migrations")


def done(db, reset=SEASON_RESET):
    return bool(db.query("SELECT 1 FROM resets WHERE id=?", (reset["id"],)))


def due(db, now=None, reset=SEASON_RESET):
    return (time.time() if now is None else now) >= reset["at"] and not done(db, reset)


def backup(db, reset=SEASON_RESET):
    """A copy of the whole save, next to it (backups/pre-reset-<id>.db). Returns its path, or None (in memory, or it
    couldn't be written: the reset goes ahead, the save's owner asked for it)."""
    if not db.path or db.path == ":memory:":
        return None
    try:
        folder = Path(db.path).resolve().parent / "backups"
        folder.mkdir(parents=True, exist_ok=True)
        dest = folder / f"pre-reset-{reset['id']}.db"
        if dest.exists():
            dest = folder / f"pre-reset-{reset['id']}-{int(time.time())}.db"
        out = sqlite3.connect(str(dest))
        try:
            with db.lock:
                db.conn.backup(out)
        finally:
            out.close()
        return str(dest)
    except Exception as e:  # (a full disk, a read-only folder)
        print(f"Season reset: the backup couldn't be written ({e}); resetting anyway.", flush=True)
        return None


# a game left open across the reset still holds the old AI world (friends, squad, every AI's games) and saves it back
# whenever it changes, until it reloads (and a game in progress holds the reload up): a world born before the reset (with
# an hour's grace for a PC clock that's off) is the old one. The service refuses to save one (save_ai_world: is_stale),
# and sweep_ai clears any that got written back before that fix, once per save (resets row "<id>:ai")
STALE_GRACE = 3600


def stale_world(world, reset=SEASON_RESET):
    born = world.get("born") if isinstance(world, dict) else None
    return not (isinstance(born, (int, float)) and not isinstance(born, bool) and born >= (reset["at"] - STALE_GRACE) * 1000)


def sweep_ai(db, now=None, reset=SEASON_RESET):
    """Once per save, after the reset: delete the AI worlds saved back from before it (the next sign-in builds a new
    one). Returns how many went, or None when it has run here already (or the reset hasn't happened)."""
    import json
    now = time.time() if now is None else now
    key = reset["id"] + ":ai"
    if not done(db, reset) or db.query("SELECT 1 FROM resets WHERE id=?", (key,)):
        return None
    with db.transaction() as c:
        if c.execute("SELECT 1 FROM resets WHERE id=?", (key,)).fetchone():
            return None
        gone = []
        for aid, data in c.execute("SELECT account_id, data FROM ai_world").fetchall():
            try:
                world = json.loads(data)
            except ValueError:
                world = None
            if stale_world(world, reset):
                gone.append(aid)
        for aid in gone:
            c.execute("DELETE FROM ai_world WHERE account_id=?", (aid,))
        c.execute("INSERT INTO resets VALUES(?,?,?,?)", (key, now, None, len(gone)))
    if gone:
        print(f"Season reset {reset['id']}: {len(gone)} AI world(s) saved back from before it cleared", flush=True)
    return len(gone)


def run(db, starter_items=(), now=None, reset=SEASON_RESET):
    """Reset every account on this save if the reset is due and hasn't happened here. Returns a summary dict, or None
    when there was nothing to do."""
    now = time.time() if now is None else now
    if not due(db, now, reset):
        return None
    path = backup(db, reset)
    with db.transaction() as c:
        if c.execute("SELECT 1 FROM resets WHERE id=?", (reset["id"],)).fetchone():
            return None  # (another thread got there first)
        counts = {}
        for table in WIPE:
            counts[table] = c.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            c.execute(f"DELETE FROM {table}")
        accounts = [r[0] for r in c.execute("SELECT id FROM accounts").fetchall()]
        for aid in accounts:
            c.execute("INSERT OR IGNORE INTO wallets VALUES(?,0)", (aid,))
            c.execute("UPDATE wallets SET balance=? WHERE account_id=?", (reset["vc"], aid))
            c.execute("INSERT INTO ledger(account_id,delta,balance_after,kind,reference,created_at) VALUES(?,?,?,?,?,?)",
                      (aid, reset["vc"], reset["vc"], "season_reset", f"reset:{reset['id']}", now))
            for item_id in starter_items:
                c.execute("INSERT OR IGNORE INTO inventory VALUES(?,?,?)", (aid, item_id, now))
        c.execute("INSERT INTO resets VALUES(?,?,?,?)", (reset["id"], now, path, len(accounts)))
    summary = {"id": reset["id"], "accounts": len(accounts), "backup": path, "wiped": counts}
    print(f"Season reset {reset['id']}: {len(accounts)} account(s) start over with {reset['vc']:,} VC"
          + (f" (backup: {path})" if path else ""), flush=True)
    return summary
