"""v0.4.5 The King Tut Cup, generalised in v0.4.7.5 (qp3) into park EVENTS that run in back-to-back 48-hour windows.

Every game in an event is an ante-up. You put VC on the line when the game starts; a win pays your stake back
plus the other side's stake (boosted by your event win streak, the same multiplier the park uses), on top of
the normal game VC. A loss or a quit keeps nothing of the stake. The leaderboard ranks the net VC earned in
the event during the window (everything the games paid out, minus every stake), against the AI hoopers of
your account's AI world who entered this window. When a window closes, the final standings pay out prizes
once: the top spot wins the event's grand-prize costume, plus exclusive gear and VC.

Which event is on is a schedule (server/events.json): the King Tut Cup until the end of its last window, then
The Jungle Ballers for one window, then (v0.4.8.5 quick patch) And The Beat Goes On for one window, then (quick patch 2)
The Monster Mash. An event that is off the schedule is disabled in the game (its park can't be entered, its
venue refuses games) but nothing of it is deleted: put it back on the schedule and it runs again. The window
numbers keep counting whatever event is on, so a window's standings and prizes belong to the event that was
running when it started (event_for_window).

The AI field is computed here, on the server, from the AI world's seed. Who enters, their skill tier and how
much they play are deterministic, so the board is the same every time you look, it fills in as the 48 hours
go by, and the standings that decide the prizes can't be edited on the client. The tier of each AI player
is derived exactly as the client derives it (mulberry32 + FNV-1a, see client/js/sim/world.js), so the board
and the park agree on who is a Park Legend.
"""
import json
import os
import math
import time

WINDOW = 48 * 3600
EPOCH = 1767225600  # 2026-01-01 00:00 UTC; windows run back to back from here
POOL = 900          # AI world size (client/js/sim/world.js POOL_SIZE)
ENTRY_PCT = 22      # share of the AI world that enters any given Cup
ANTES = (500, 1000, 2500, 5000, 10000)

# same shares and order as SKILL_TIERS in client/js/sim/world.js
TIER_SHARES = (0.2, 0.33, 0.26, 0.16, 0.05)
TIER_IDS = ("casual", "regular", "hooper", "elite", "legend")
TIER_SKILL = (0.2, 0.42, 0.62, 0.8, 0.94)
TIER_ANTE = ((0, 1), (0, 2), (1, 3), (2, 4), (3, 4))  # index range into ANTES

# final-standings prizes per event: (best rank, label, VC, items). The VC ladder is the same for every event;
# the cosmetics and animations are each event's own (nothing from one event is handed out by another)
PRIZES_KINGTUT = (
    (1, "King of the Cup", 150000, ("cup_mocap_top", "cup_mocap_tights", "cup_shoes_pharaoh", "cup_celly_pharaoh", "cup_band_scarab",
                                    "cup_gfx_ankh", "cup_gsnd_pharaoh")),
    (3, "Top 3", 60000, ("cup_shoes_pharaoh", "cup_celly_pharaoh", "cup_band_scarab", "cup_gfx_ankh", "cup_gsnd_pharaoh")),
    # v0.4.7.5: the green release exclusives (Pharaoh's Horn from the top 10, the Golden Ankh from the top 3)
    (10, "Top 10", 25000, ("cup_celly_pharaoh", "cup_band_scarab", "cup_gsnd_pharaoh")),
    (25, "Top 25", 10000, ("cup_band_scarab",)),
)
# v0.4.7.5 qp3 The Jungle Ballers: the gorilla costume for the winner, Toucan kicks, the Chest Beat, the Toucan
# feather band, the Banana Peel green release and the Jungle Bongos
PRIZES_JUNGLE = (
    (1, "King of the Jungle", 150000, ("jb_gorilla_top", "jb_gorilla_legs", "jb_shoes_toucan", "jb_celly_chestbeat", "jb_band_toucan",
                                       "jb_gfx_banana", "jb_gsnd_bongos")),
    (3, "Top 3", 60000, ("jb_shoes_toucan", "jb_celly_chestbeat", "jb_band_toucan", "jb_gfx_banana", "jb_gsnd_bongos")),
    (10, "Top 10", 25000, ("jb_celly_chestbeat", "jb_band_toucan", "jb_gsnd_bongos")),
    (25, "Top 25", 10000, ("jb_band_toucan",)),
)
# v0.4.8.5 quick patch And The Beat Goes On: the Beat Goes On tracksuit (windbreaker and track pants) for the winner, Boombox
# hi-tops, the Running Man, the Neon Terry headband, the Disco Ball green release and the Eight-O-Eight
PRIZES_BEAT = (
    (1, "King of the Beat", 150000, ("bg_tracksuit_top", "bg_tracksuit_pants", "bg_shoes_boombox", "bg_celly_runningman", "bg_band_terry",
                                     "bg_gfx_discoball", "bg_gsnd_808")),
    (3, "Top 3", 60000, ("bg_shoes_boombox", "bg_celly_runningman", "bg_band_terry", "bg_gfx_discoball", "bg_gsnd_808")),
    (10, "Top 10", 25000, ("bg_celly_runningman", "bg_band_terry", "bg_gsnd_808")),
    (25, "Top 25", 10000, ("bg_band_terry",)),
)
# v0.4.8.5 quick patch 2 The Monster Mash: the Bone Suit (a glow-in-the-dark skeleton bodysuit, top and tights) for the
# winner, Coffin hi-tops, the Zombie Shuffle, the Jack-o'-Lantern headband, the Jack-o'-Lantern green release (bats burst
# out of it on the make) and the Haunted Organ
PRIZES_MONSTER = (
    (1, "King of the Mash", 150000, ("mm_bones_top", "mm_bones_tights", "mm_shoes_coffin", "mm_celly_zombie", "mm_band_pumpkin",
                                     "mm_gfx_lantern", "mm_gsnd_organ")),
    (3, "Top 3", 60000, ("mm_shoes_coffin", "mm_celly_zombie", "mm_band_pumpkin", "mm_gfx_lantern", "mm_gsnd_organ")),
    (10, "Top 10", 25000, ("mm_celly_zombie", "mm_band_pumpkin", "mm_gsnd_organ")),
    (25, "Top 25", 10000, ("mm_band_pumpkin",)),
)
# v0.4.8.7 The Favelas: the Morro Kit (a striped football-style jersey and shorts with a painted-tile hem) for the winner,
# Ladeira hi-tops, the Passinho, the Bandana, the Pipa green release (paper kites burst up on the make) and the Cuica
PRIZES_FAVELA = (
    (1, "King of the Favelas", 150000, ("fv_morro_top", "fv_morro_shorts", "fv_shoes_ladeira", "fv_celly_passinho", "fv_band_bandana",
                                        "fv_gfx_pipa", "fv_gsnd_cuica")),
    (3, "Top 3", 60000, ("fv_shoes_ladeira", "fv_celly_passinho", "fv_band_bandana", "fv_gfx_pipa", "fv_gsnd_cuica")),
    (10, "Top 10", 25000, ("fv_celly_passinho", "fv_band_bandana", "fv_gsnd_cuica")),
    (25, "Top 25", 10000, ("fv_band_bandana",)),
)
PRIZES = PRIZES_KINGTUT  # (the original table; kept for the tests and for anything that still reads it)
EVENTS = {
    "kingtut": {"id": "kingtut", "venue": "kingtut", "name": "The King Tut Cup", "short": "King Tut Cup", "exclusive": "cup",
                "prizes": PRIZES_KINGTUT, "played": "Played the Cup", "blurb": "Glow-in-the-dark ante-ups among the pyramids."},
    "jungle": {"id": "jungle", "venue": "jungle", "name": "The Jungle Ballers", "short": "Jungle Ballers", "exclusive": "jungle",
               "prizes": PRIZES_JUNGLE, "played": "Played the Jungle", "blurb": "Ante-ups under the rainforest canopy, rain on every streak."},
    "beat": {"id": "beat", "venue": "beat", "name": "And The Beat Goes On", "short": "Beat Goes On", "exclusive": "beat",
             "prizes": PRIZES_BEAT, "played": "Played the Beat", "blurb": "Ante-ups in an 80s city at sundown, with its own soundtrack."},
    "monster": {"id": "monster", "venue": "monster", "name": "The Monster Mash", "short": "Monster Mash", "exclusive": "monster",
                "prizes": PRIZES_MONSTER, "played": "Played the Mash", "blurb": "Ante-ups on Halloween night in a haunted town."},
    "favela": {"id": "favela", "venue": "favela", "name": "The Favelas", "short": "The Favelas", "exclusive": "favela",
               "prizes": PRIZES_FAVELA, "played": "Played the Favelas", "blurb": "Ante-ups on the hillside: stacked houses, narrow alleys, dirtbikes in the streets."},
}
EVENT_VENUES = {e["venue"] for e in EVENTS.values()}
EVENT_BY_VENUE = {e["venue"]: e for e in EVENTS.values()}
SCHEDULE_FILE = os.path.join(os.path.dirname(__file__), "events.json")


def load_schedule(path=SCHEDULE_FILE):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["schedule"]


SCHEDULE = load_schedule()


# v0.4.8.7: the park shuffle. A schedule row {"shuffle": [event ids], "from", "until", "after", "seed"} plays every event
# in the list once, one 48-hour window each, in a shuffled order, then reshuffles: no event plays twice in a round, and
# no event plays twice in a row across rounds (a round never starts with the event that ended the last one; the first
# round never starts with "after", the event before the shuffle). The order is seeded, so every server and every test
# agrees on it.
_BAGS = {}


def shuffle_bag(row, b):
    """The b-th round (a list of event ids) of a shuffle row."""
    ids = [e for e in row["shuffle"] if e in EVENTS]
    key = (tuple(ids), row.get("seed", ""), row.get("after"), row.get("from"))
    bags = _BAGS.setdefault(key, [])
    while len(bags) <= b:
        i = len(bags)
        rng = Mulberry(fnv(f"{row.get('seed', 'shuffle')}:{i}"))
        # (the first round finishes the one "after" began: the other events only, so every park plays before any repeats)
        order = [e for e in ids if not (i == 0 and e == row.get("after"))]
        for j in range(len(order) - 1, 0, -1):  # Fisher-Yates
            k = int(rng.next() * (j + 1))
            order[j], order[k] = order[k], order[j]
        prev = row.get("after") if i == 0 else bags[i - 1][-1]
        if len(order) > 1 and order[0] == prev:
            order[0], order[1] = order[1], order[0]
        bags.append(order)
    return bags[b]


def shuffle_event_at(row, t):
    """The event id a shuffle row plays at time t (t inside the row)."""
    n = len([e for e in row["shuffle"] if e in EVENTS])
    if not n:
        return None
    k = int((t - row["from"]) // WINDOW)
    first = len(shuffle_bag(row, 0))
    if k < first:
        return shuffle_bag(row, 0)[k]
    k -= first
    return shuffle_bag(row, 1 + k // n)[k % n]


def active_event(t=None, schedule=None):
    """The event on at time t (an EVENTS entry) or None when nothing is scheduled."""
    t = time.time() if t is None else t
    for row in (SCHEDULE if schedule is None else schedule):
        lo, hi = row.get("from"), row.get("until")
        if not ((lo is None or t >= lo) and (hi is None or t < hi)):
            continue
        ev = shuffle_event_at(row, t) if "shuffle" in row else row.get("event")
        if ev in EVENTS:
            return EVENTS[ev]
    return None


def event_for_window(w, schedule=None):
    """The event a window's standings and prizes belong to: the one on when the window started."""
    return active_event(window_bounds(w)[0] + 1, schedule)


def public_schedule(schedule=None, now=None):
    """v0.4.8.5 quick patch 4: the whole schedule as the client needs it ({event, venue, from, until}, in order, Unix
    seconds, None = open-ended), so a game left running across a handover knows the moment the next event takes over
    and sends the AI world's entrants to the new park on time (they used to keep going to the closed one)."""
    # v0.4.8.7: a shuffle row goes out as the plain windows it plays, from the window before now to SHUFFLE_AHEAD
    # windows ahead (the client refetches the schedule on every load, so it never runs off the end)
    out, now = [], time.time() if now is None else now
    for r in (SCHEDULE if schedule is None else schedule):
        if "shuffle" in r:
            lo, hi = r["from"], r.get("until")
            k0 = max(0, int((now - lo) // WINDOW) - 1)
            for k in range(k0, k0 + SHUFFLE_AHEAD):
                a = lo + k * WINDOW
                if hi is not None and a >= hi:
                    break
                ev = shuffle_event_at(r, a)
                if ev in EVENTS:
                    out.append({"event": ev, "venue": EVENTS[ev]["venue"], "from": a,
                                "until": a + WINDOW if hi is None else min(a + WINDOW, hi)})
        elif r.get("event") in EVENTS:
            out.append({"event": r["event"], "venue": EVENTS[r["event"]]["venue"], "from": r.get("from"), "until": r.get("until")})
    return out


SHUFFLE_AHEAD = 30  # windows (60 days)


def public_event(ev, w=None):
    """What the client gets to know about an event (id, venue, name) with the window it is in."""
    if not ev:
        return None
    w = window_at() if w is None else w
    start, end = window_bounds(w)
    return {"id": ev["id"], "venue": ev["venue"], "name": ev["name"], "short": ev["short"], "exclusive": ev["exclusive"], "window": w, "start": start, "end": end}


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


def prize_for(rank, field, event=None):
    """VC and items for a final rank in a field of `field` players (None when nothing is due)."""
    if rank is None:
        return None
    ev = event or EVENTS["kingtut"]
    for best, label, vc, items in ev["prizes"]:
        if rank <= best:
            return {"label": label, "vc": vc, "items": list(items)}
    if rank <= max(1, math.ceil(field / 2)):
        return {"label": "Top half", "vc": TOP_HALF_VC, "items": []}
    return {"label": ev["played"], "vc": PLAYED_VC, "items": []}


def prize_table(event):
    ev = event or EVENTS["kingtut"]
    return [{"best": b, "label": lab, "vc": vc, "items": list(it)} for b, lab, vc, it in ev["prizes"]] + [
        {"best": None, "label": "Top half", "vc": TOP_HALF_VC, "items": []}, {"best": None, "label": ev["played"], "vc": PLAYED_VC, "items": []}]


def blank_entry():
    return {"games": 0, "wins": 0, "net": 0, "staked": 0, "won_vc": 0, "streak": 0, "best_streak": 0, "claimed": False, "event": None}


# ---------- v0.4.8.5 qp7: what the AI world has won ----------
# The AI hoopers keep grinding the events whether you play them or not, and the ones who finish in a closed window's top 25
# get that rank's prizes, exactly as you would (GET /api/ai-world/unlocks, then sim/world.js setUnlocks: they wear them).
# The standings are worked out here, as everything about the AI field is, and they must be exactly standings()'s.
# standings() takes ~40-60 ms a window (FNV-1a over a fresh string for every hour and every game of ~200 entrants) and a
# world can be 140 windows old, so the closed windows go through fast_records: the same numbers, with each FNV string
# continued from the hash of its shared prefix ("ai-N|w|", "ai-N|cup|") instead of hashed again from the start, and the
# hour weights worked out once a window instead of once an entrant (~6 ms a window). tests/test_ai_unlocks.py checks it
# against ai_record field by field. A closed window's final top never changes again, so it's kept (_FINAL).
_M32, _FNV_P = 0xFFFFFFFF, 16777619


def _fnv_on(h, s):
    """FNV-1a, carried on from the state h (fnv(a + b) == _fnv_on(fnv(a), b))."""
    for ch in s:
        h = ((h ^ ord(ch)) * _FNV_P) & _M32
    return h


_ID_STATE = tuple(_fnv_on(2166136261, f"ai-{i}|") for i in range(POOL))  # fnv("ai-N|")
_CUP_STATE = tuple(_fnv_on(h, "cup|") for h in _ID_STATE)                 # fnv("ai-N|cup|"): is_entrant
_ACCT_STATE = tuple(_fnv_on(h, "acct") for h in _ID_STATE)                # fnv("ai-N|acct"): tier_of
_TIERS = {}   # seed -> every AI hooper's tier index (tier_of)
_FINAL = {}   # (seed, w) -> that closed window's AI top (FINAL_ROWS rows), in standings() order
FINAL_ROWS = 26  # (25 prize ranks, and one more so the board can still be read with you in it)
FINAL_CACHE_MAX = 6000


def _tiers(seed):
    t = _TIERS.get(seed)
    if t is None:
        out = []
        for h in _ACCT_STATE:
            x, a, k = Mulberry(h ^ seed).next(), 0.0, len(TIER_SHARES) - 1
            for i, share in enumerate(TIER_SHARES):
                a += share
                if x < a:
                    k = i
                    break
            out.append(k)
        if len(_TIERS) >= 64:
            _TIERS.clear()
        t = _TIERS[seed] = tuple(out)
    return t


def fast_records(seed, w, until=None):
    """[ai_record(seed, i, w, until) for i in entrants(w)], the same records in the same order, ~7x faster."""
    start, end = window_bounds(w)
    now = min(end, time.time() if until is None else until)
    hours = int(max(0, now - start) // 3600)
    P, S32 = _FNV_P, 4294967296.0
    # every hour of the window: its weight and the codes of "b|" (c2 -1 for a one-digit hour). The hash of
    # "ai-N|w|b|..." is that of "ai-N|w|" carried on; the 32-bit mask can wait to the end of each run of steps (a
    # product's low 32 bits only depend on its factors' low 32 bits). A fraction f = h / 2^32 compared with x is h
    # compared with x * 2^32, exactly (both sides scaled by a power of two)
    hrs = []
    for b in range(hours):
        cs = tuple(map(ord, f"{b}|"))
        hrs.append((_hour_weight(start + b * 3600), cs[0], cs[1], cs[2] if len(cs) > 2 else -1))
    kc = [tuple(map(ord, f"{k}|w")) for k in range(8)]  # (a busy hour plays at most 2: activity 1.35 x weight 1 x 0.75)
    wdig, wbar = tuple(map(ord, str(w))), tuple(map(ord, f"{w}|"))
    tiers = _tiers(seed)
    out = []
    for i in range(POOL):
        h = _CUP_STATE[i]
        for c in wdig:
            h = (h ^ c) * P
        if (h & _M32) % 100 >= ENTRY_PCT:
            continue
        s = _ID_STATE[i]
        for c in wbar:
            s = (s ^ c) * P
        s &= _M32
        tier = tiers[i]
        # (each expression exactly as ai_record writes it, so every float comes out the same)
        skill = min(0.98, max(0.08, TIER_SKILL[tier] + (_fnv_on(s, "skill") / 4294967296 - 0.5) * 0.12))
        activity = 0.25 + 1.1 * (_fnv_on(s, "act") / 4294967296) ** 1.3
        lo, hi = TIER_ANTE[tier]
        ante = ANTES[lo + int(_fnv_on(s, "ante") / 4294967296 * (hi - lo + 1)) if hi > lo else lo]
        p_win = 0.3 + 0.42 * skill
        win_at = p_win * S32
        games = wins = streak = best = 0
        net = 0
        for wt, c0, c1, c2 in hrs:
            g = activity * wt * 0.75
            hb = ((s ^ c0) * P ^ c1) * P
            if c2 >= 0:
                hb = (hb ^ c2) * P
            hb &= _M32
            gi = int(g)
            n = gi + (1 if (((hb ^ 110) * P) & _M32) < (g - gi) * S32 else 0)  # (110: "n")
            for k in range(n):
                games += 1
                a0, a1, a2 = kc[k]
                if ((((hb ^ a0) * P ^ a1) * P ^ a2) * P & _M32) < win_at:
                    wins += 1
                    streak += 1
                    best = max(best, streak)
                    mult = 1 + 0.30 * min(10, streak - 1)
                    net += int(ante * mult) + int(800 * mult)
                else:
                    streak = 0
                    net += 470 - ante
        out.append({"id": f"ai-{i}", "tier": TIER_IDS[tier], "games": games, "wins": wins, "best_streak": best, "net": int(net), "ante": ante})
    return out


def final_top(seed, w):
    """A closed window's final AI standings, best first, the first FINAL_ROWS rows of standings(seed, w) without you
    ({id, net, wins, games}): worked out once, then kept."""
    key = (seed, w)
    top = _FINAL.get(key)
    if top is None:
        rows = [r for r in fast_records(seed, w, window_bounds(w)[1]) if r["games"] > 0]
        rows.sort(key=lambda r: (-r["net"], -r["wins"], r["id"]))
        top = tuple({"id": r["id"], "net": r["net"], "wins": r["wins"], "games": r["games"]} for r in rows[:FINAL_ROWS])
        while len(_FINAL) >= FINAL_CACHE_MAX:
            _FINAL.pop(next(iter(_FINAL)))  # (the oldest first)
        _FINAL[key] = top
    return top


def ai_prizes(seed, born_s, mine=None, now=None):
    """{ai id: sorted item ids} the AI world of `seed` (born at born_s, Unix seconds) has won: every closed window from
    the one it was born in, whose event hands out prizes, ranks 1-25 getting prize_for's items. `mine`: the account's
    own entries {window: entry}; where you played a window (games > 0) you're on its board as standings() puts you,
    so an AI you beat for 1st gets the Top 3 prizes instead. (Ranks past 25 win VC only, so the field size never
    matters here.)"""
    now = time.time() if now is None else now
    mine = mine or {}
    out = {}
    for w in range(max(0, window_at(born_s)), window_at(now)):
        ev = event_for_window(w)
        if not ev:
            continue
        rows = list(final_top(seed, w))
        me = mine.get(w)
        if me and me.get("games", 0) > 0:
            rows.append({"id": "me", "net": int(me.get("net", 0)), "wins": me.get("wins", 0)})
            rows.sort(key=lambda r: (-r["net"], -r["wins"], r["id"]))
        for rank, r in enumerate(rows[:25], 1):
            if r["id"] != "me":
                items = (prize_for(rank, len(rows), ev) or {}).get("items")
                if items:
                    out.setdefault(r["id"], set()).update(items)
    return {k: sorted(v) for k, v in out.items()}
