"""v0.4.5 The King Tut Cup: a glow-in-the-dark park event that runs in back-to-back 48-hour windows.

Every game in the Cup is an ante-up. You put VC on the line when the game starts; a win pays your stake back
plus the other side's stake (boosted by your Cup win streak, the same multiplier the park uses), on top of
the normal game VC. A loss or a quit keeps nothing of the stake. The leaderboard ranks the net VC earned in
the Cup during the window (everything the games paid out, minus every stake), against the AI hoopers of
your account's AI world who entered this window's Cup. When a window closes, the final standings pay out
prizes once: the top spot wins the glow-in-the-dark motion-capture suit, plus exclusive gear and VC.

The AI field is computed here, on the server, from the AI world's seed. Who enters, their skill tier and how
much they play are deterministic, so the board is the same every time you look, it fills in as the 48 hours
go by, and the standings that decide the prizes can't be edited on the client. The tier of each AI player
is derived exactly as the client derives it (mulberry32 + FNV-1a, see client/js/sim/world.js), so the board
and the park agree on who is a Park Legend.
"""
import math
import time

WINDOW = 48 * 3600
EPOCH = 1767225600  # 2026-01-01 00:00 UTC; windows run back to back from here
POOL = 900          # AI world size (client/js/sim/world.js POOL_SIZE)
ENTRY_PCT = 22      # share of the AI world that enters any given Cup
ANTES = (500, 1000, 2500, 5000, 10000)
VENUE = "kingtut"

# same shares and order as SKILL_TIERS in client/js/sim/world.js
TIER_SHARES = (0.2, 0.33, 0.26, 0.16, 0.05)
TIER_IDS = ("casual", "regular", "hooper", "elite", "legend")
TIER_SKILL = (0.2, 0.42, 0.62, 0.8, 0.94)
TIER_ANTE = ((0, 1), (0, 2), (1, 3), (2, 4), (3, 4))  # index range into ANTES

# final-standings prizes: (best rank, label, VC, items)
PRIZES = (
    (1, "King of the Cup", 150000, ("cup_mocap_top", "cup_mocap_tights", "cup_shoes_pharaoh", "cup_celly_pharaoh", "cup_band_scarab",
                                    "cup_gfx_ankh", "cup_gsnd_pharaoh")),
    (3, "Top 3", 60000, ("cup_shoes_pharaoh", "cup_celly_pharaoh", "cup_band_scarab", "cup_gfx_ankh", "cup_gsnd_pharaoh")),
    # v0.4.7.5: the green release exclusives (Pharaoh's Horn from the top 10, the Golden Ankh from the top 3)
    (10, "Top 10", 25000, ("cup_celly_pharaoh", "cup_band_scarab", "cup_gsnd_pharaoh")),
    (25, "Top 25", 10000, ("cup_band_scarab",)),
)
TOP_HALF_VC = 3000
PLAYED_VC = 1000


# ---------- the client's RNG, ported (32-bit mulberry32 and FNV-1a) ----------
def fnv(s):
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def _imul(a, b):
    return (a * b) & 0xFFFFFFFF


class Mulberry:
    def __init__(self, seed):
        self.s = (seed & 0xFFFFFFFF) or 0x9E3779B9

    def next(self):
        self.s = (self.s + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.s
        t = _imul(t ^ (t >> 15), t | 1)
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296


def frac(*parts):
    return fnv("|".join(str(p) for p in parts)) / 4294967296


# ---------- windows ----------
def window_at(t=None):
    t = time.time() if t is None else t
    return int((t - EPOCH) // WINDOW)


def window_bounds(w):
    start = EPOCH + w * WINDOW
    return start, start + WINDOW


# ---------- the AI field ----------
def tier_of(seed, ai_id):
    """Skill tier index of an AI hooper, exactly as AIWorld.account() picks it on the client."""
    r = Mulberry(fnv(ai_id + "|acct") ^ seed)
    x, a = r.next(), 0.0
    for i, share in enumerate(TIER_SHARES):
        a += share
        if x < a:
            return i
    return len(TIER_SHARES) - 1


def is_entrant(ai_id, w):
    """Shared with the client (world.js cupEntrant): who entered window w's Cup."""
    return fnv(f"{ai_id}|cup|{w}") % 100 < ENTRY_PCT


def entrants(w):
    return [f"ai-{i}" for i in range(POOL) if is_entrant(f"ai-{i}", w)]


def _hour_weight(t):
    # local hour of day: quiet overnight, busy in the evening
    h = time.localtime(t).tm_hour
    return (0.15, 0.08, 0.05, 0.05, 0.05, 0.08, 0.15, 0.25, 0.35, 0.45, 0.55, 0.6, 0.65, 0.65, 0.7, 0.8, 0.95, 1.0,
            1.0, 1.0, 0.95, 0.85, 0.6, 0.35)[h]


def ai_record(seed, ai_id, w, until=None):
    """An entrant's Cup run so far: games, wins, best streak and net VC, played hour by hour up to `until`."""
    start, end = window_bounds(w)
    now = min(end, time.time() if until is None else until)
    tier = tier_of(seed, ai_id)
    skill = min(0.98, max(0.08, TIER_SKILL[tier] + (frac(ai_id, w, "skill") - 0.5) * 0.12))
    activity = 0.25 + 1.1 * frac(ai_id, w, "act") ** 1.3          # games per busy hour
    lo, hi = TIER_ANTE[tier]
    ante = ANTES[lo + int(frac(ai_id, w, "ante") * (hi - lo + 1)) if hi > lo else lo]
    p_win = 0.3 + 0.42 * skill
    games = wins = streak = best = 0
    net = 0
    hours = int(max(0, now - start) // 3600)
    for b in range(hours):
        g = activity * _hour_weight(start + b * 3600) * 0.75
        n = int(g) + (1 if frac(ai_id, w, b, "n") < g - int(g) else 0)
        for k in range(n):
            games += 1
            if frac(ai_id, w, b, k, "w") < p_win:
                wins += 1
                streak += 1
                best = max(best, streak)
                mult = 1 + 0.30 * min(10, streak - 1)
                net += int(ante * mult) + int(800 * mult)
            else:
                streak = 0
                net += 470 - ante
    return {"id": ai_id, "tier": TIER_IDS[tier], "games": games, "wins": wins, "best_streak": best, "net": int(net), "ante": ante}


def standings(seed, w, me=None, until=None):
    """Everyone on window w's board, best first. `me` is the account's own record (or None)."""
    rows = [ai_record(seed, i, w, until) for i in entrants(w)]
    rows = [r for r in rows if r["games"] > 0]
    if me and me.get("games", 0) > 0:
        rows.append({"id": "me", "tier": None, "games": me["games"], "wins": me.get("wins", 0), "best_streak": me.get("best_streak", 0), "net": int(me.get("net", 0))})
    rows.sort(key=lambda r: (-r["net"], -r["wins"], r["id"]))
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return rows


def prize_for(rank, field):
    """VC and items for a final rank in a field of `field` players (None when nothing is due)."""
    if rank is None:
        return None
    for best, label, vc, items in PRIZES:
        if rank <= best:
            return {"label": label, "vc": vc, "items": list(items)}
    if rank <= max(1, math.ceil(field / 2)):
        return {"label": "Top half", "vc": TOP_HALF_VC, "items": []}
    return {"label": "Played the Cup", "vc": PLAYED_VC, "items": []}


def blank_entry():
    return {"games": 0, "wins": 0, "net": 0, "staked": 0, "won_vc": 0, "streak": 0, "best_streak": 0, "claimed": False}
