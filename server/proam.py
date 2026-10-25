"""v0.4.8.8 The Pro-Am Overhaul, the meta layer (docs/PROAM-OVERHAUL.md: the contract every agent builds against).

* Seasons (§1): 45 days. Season 1 starts the first time this server runs v0.4.8.8 (kept in pa_seasons); each one ends at
  12:00 AM US Eastern on the 45th day after the day it started, and the next starts then. A build's season state
  (progression.pa) and a team's are moved on lazily, the first time they're looked at in the new season: the old
  season's record is kept, its reward given (season_rewards), and everybody starts again in Bronze 1 at 0 RP.
* Divisions and RP (§2): Bronze 3, Silver 5, Gold 7, Platinum 7 (and 7 each for the three tiers after it, for later), one
  flat ladder (DIVS). RP is 0..100 within a division: a game's RP is the v0.4.8.5 formula (progression.proam_rp_change)
  at 0.7, 100 promotes at once with the rest carried over, and a game never demotes.
* Series (§3): Bronze first to 2 of 3, Silver 3 of 5, Gold and up 5 of 7, over as soon as it's certain. A win moves the
  team up a division and everyone who played in it up from the team's division, and pays a bonus; a loss puts everyone
  at 0 RP, and a player (or the team) who was at 0 already goes down a division. Each game is matched on its own (a real
  team within 2 divisions waiting, up to 45 s; else the AI team nearest), home and away by turns from home.
* Teams (§4): real ones (up to 10 people, one team an account, open or invite-only, the founder owns the settings) and
  at least 24 AI ones with league identities, rostered from this server's shared AI world (its ids, by the skill tier
  cup.tier_of mirrors: the game shows their names, builds and looks), moving with their results and simulated against
  each other now and then.
* The draft (§5): 5 AI players for the open spots, from a pool this server draws (near the team's division, none in an
  AI team's five), 3 free refreshes a series.
* Rank rewards (§6): the VC and Rep boost of the build's current tier (never stacked: progression.rank_boost), its
  tier's items for good, and at the season's end a season-stamped banner (and the chain for Gold and up).

Everything here is plain functions on an sqlite connection inside the caller's transaction, plus Matchmaker (in
memory, the queue). app.py has the routes.
"""
import calendar
import datetime
import json
import time
import uuid

from . import builds, cup, progression

# ---------------- divisions ----------------
TIERS = (("bronze", "Bronze", 3), ("silver", "Silver", 5), ("gold", "Gold", 7), ("platinum", "Platinum", 7),
         ("diamond", "Diamond", 7), ("master", "Master", 7), ("grandmaster", "Grandmaster", 7))
DIVS = tuple((t, d) for t, (_, _, n) in enumerate(TIERS) for d in range(n))  # flat index -> (tier, division 0-based)
TOP = len(DIVS) - 1
TIER_START = tuple(sum(n for _, _, n in TIERS[:t]) for t in range(len(TIERS)))
PLAYABLE_TOP = TIER_START[4] - 1  # (the last Platinum division: Diamond and up are for later)
GOLD, PLATINUM = 2, 3


def div_index(tier, div):
    """The flat index of a tier (0..6) and its division (1-based)."""
    return TIER_START[tier] + max(0, min(TIERS[tier][2], div) - 1)


def div_info(i):
    i = max(0, min(TOP, int(i or 0)))
    t, d = DIVS[i]
    tid, name, n = TIERS[t]
    return {"index": i, "tier": t, "tier_id": tid, "tier_name": name, "div": d + 1, "divs": n, "label": f"{name} {d + 1}"}


def tier_of(i):
    return DIVS[max(0, min(TOP, int(i or 0)))][0]


def promote(i):
    return min(TOP, i + 1)


def demote(i):
    return max(0, i - 1)  # (a tier's first division drops to the one before's last; Bronze 1 is the floor)


# ---------------- seasons ----------------
SEASON_DAYS = 45


def _nth_sunday(year, month, n):
    first = datetime.date(year, month, 1)
    return first + datetime.timedelta(days=(6 - first.weekday()) % 7 + 7 * (n - 1))


def et_offset(ts):
    """US Eastern's offset from UTC (hours) at a moment: -4 from 2 AM on the second Sunday of March to 2 AM on the first
    Sunday of November, else -5 (worked out here: a Windows Python may have no time zone database)."""
    y = datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).year
    on = calendar.timegm(_nth_sunday(y, 3, 2).timetuple()) + 7 * 3600    # 2 AM EST = 07:00 UTC
    off = calendar.timegm(_nth_sunday(y, 11, 1).timetuple()) + 6 * 3600  # 2 AM EDT = 06:00 UTC
    return -4 if on <= ts < off else -5


def et_midnight(date):
    """The moment 12:00 AM US Eastern begins a calendar date."""
    base = calendar.timegm(date.timetuple())  # (midnight UTC of that date)
    return base - et_offset(base + 5 * 3600) * 3600


def et_date(ts):
    return datetime.datetime.fromtimestamp(ts + et_offset(ts) * 3600, datetime.timezone.utc).date()


def season_end(start):
    """12:00 AM US Eastern on the 45th day after the day the season started."""
    return et_midnight(et_date(start) + datetime.timedelta(days=SEASON_DAYS))


def current_season(c, now=None):
    """{n, start, end} of the season on now: Season 1 begins the first time this is asked (the first boot of v0.4.8.8),
    each next one the moment the one before ends."""
    now = time.time() if now is None else now
    row = c.execute("SELECT n, start, end FROM pa_seasons ORDER BY n DESC LIMIT 1").fetchone()
    if not row:
        c.execute("INSERT INTO pa_seasons(n,start,end) VALUES(1,?,?)", (now, season_end(now)))
        row = (1, now, season_end(now))
    n, start, end = row[0], row[1], row[2]
    while now >= end:  # (the next season starts the moment this one ends)
        n, start, end = n + 1, end, season_end(end)
        c.execute("INSERT OR IGNORE INTO pa_seasons(n,start,end) VALUES(?,?,?)", (n, start, end))
    return {"n": n, "start": start, "end": end}


def season_public(s, now=None):
    now = time.time() if now is None else now
    return {**s, "left": max(0, s["end"] - now), "label": f"Season {s['n']}"}


# ---------------- a player's own rank (a build's progression.pa) ----------------
RP_MAX = 100
RP_K = 0.7          # the v0.4.8.5 game RP at 0.7: a typical win +12..+25
FORFEIT_RP = 20     # forfeit, or a game left running when the next starts: as before
DIV_RATING = 75     # the rating scale the Elo part runs on: a division is 75 of it (43 divisions ~ 0..3200)


def rating(i, rp=50):
    return int(max(0, min(TOP, i)) * DIV_RATING + max(0, min(RP_MAX, rp)) * DIV_RATING / RP_MAX)


def blank_state(season):
    return {"season": season, "div": 0, "rp": 0, "high": 0, "sw": 0, "sl": 0, "gw": 0, "gl": 0}


def player_state(char, season):
    """The build's rank this season (a new season starts it again in Bronze 1 at 0 RP, the old one's record kept in
    progression.pa_seasons). -> (state, [records of the seasons that just closed: their rewards are due])."""
    prog = char.setdefault("progression", {})
    if "pa_history" not in prog:
        # (the Pro-Am RP and rank from before Season 1: history only, on its profile)
        old = prog.get("proam") or {}
        rp = old.get("rp") if isinstance(old.get("rp"), int) else None
        prog["pa_history"] = {"rp": rp, "best_rp": old.get("best_rp"), "rank": progression.proam_rank(rp)["name"] if rp is not None else None,
                              "games": old.get("games", 0), "wins": old.get("wins", 0)}
    pa = prog.get("pa")
    closed = []
    if not isinstance(pa, dict) or not isinstance(pa.get("season"), int):
        pa = prog["pa"] = blank_state(season)
    elif pa["season"] < season:
        rec = {"season": pa["season"], "high": pa.get("high", 0), "high_label": div_info(pa.get("high", 0))["label"], "sw": pa.get("sw", 0),
               "sl": pa.get("sl", 0), "gw": pa.get("gw", 0), "gl": pa.get("gl", 0), "final": pa.get("div", 0)}
        prog.setdefault("pa_seasons", []).append(rec)
        closed.append(rec)
        pa = prog["pa"] = blank_state(season)
    for k, v in blank_state(season).items():
        if not isinstance(pa.get(k), int) or isinstance(pa.get(k), bool):
            pa[k] = v
    pa["div"], pa["rp"] = max(0, min(TOP, pa["div"])), max(0, min(RP_MAX, pa["rp"]))
    return pa, closed


def public_state(pa):
    i = div_info(pa.get("div", 0))
    return {**i, "season": pa.get("season"), "rp": pa.get("rp", 0), "high": div_info(pa.get("high", 0))["label"],
            "series": [pa.get("sw", 0), pa.get("sl", 0)], "record": [pa.get("gw", 0), pa.get("gl", 0)]}


def game_rp(div, rp, opp_div, won, stats, secs):
    """A Pro-Am game's RP for a player: the v0.4.8.5 parts (result, the Elo against the other team's division, how he
    played) at RP_K, a win at least +3."""
    ch = progression.proam_rp_change(rating(div, rp), rating(opp_div), won, stats, secs)
    parts = {k: progression._jsround(ch[k] * RP_K) for k in ("result", "competition", "performance")}
    total = progression._jsround(ch["total"] * RP_K)
    total = max(3, total) if won else min(-1, total)
    return {**parts, "adjust": total - sum(parts.values()), "total": total}


def apply_game(pa, delta, won):
    """A game's RP on the build: 100 promotes at once (what's over carries), never below 0, never a demotion.
    -> {div_before, div_after, rp_before, rp_after, delta, promoted}"""
    before_div, before_rp = pa["div"], pa["rp"]
    rp = before_rp + int(delta)
    if rp >= RP_MAX:
        if pa["div"] < TOP:
            pa["div"], rp = promote(pa["div"]), rp - RP_MAX
        rp = min(rp, RP_MAX)
    pa["rp"] = max(0, rp)
    pa["gw" if won else "gl"] += 1
    pa["high"] = max(pa["high"], pa["div"])
    return {"div_before": before_div, "div_after": pa["div"], "rp_before": before_rp, "rp_after": pa["rp"], "delta": pa["rp"] - before_rp + (RP_MAX if pa["div"] > before_div else 0),
            "promoted": pa["div"] > before_div, "label": div_info(pa["div"])["label"]}


def series_won_player(pa, team_div):
    """A series won: up from the team's division (one already above it stays where he is)."""
    before = pa["div"]
    pa["div"] = max(pa["div"], promote(team_div))
    pa["sw"] += 1
    pa["high"] = max(pa["high"], pa["div"])
    return {"div_before": before, "div_after": pa["div"], "promoted": pa["div"] > before}


def series_lost_player(pa):
    """A series lost: to 0 RP; one who was at 0 already goes down a division."""
    before = pa["div"]
    if pa["rp"] == 0:
        pa["div"] = demote(pa["div"])
    pa["rp"] = 0
    pa["sl"] += 1
    return {"div_before": before, "div_after": pa["div"], "demoted": pa["div"] < before}


# ---------------- rank rewards (§6) ----------------
BOOST = (0.0, 0.02, 0.04, 0.05, 0.05, 0.05, 0.05)  # (Diamond and up: for later; until then Platinum's)
RANK_ITEMS = {GOLD: ("pa_chain_gold", "pa_shoes_gold_canvas"), PLATINUM: ("pa_watch_platinum", "pa_headband_platinum")}


def rank_items_for(div):
    t = tier_of(div)
    return [i for tier, ids in RANK_ITEMS.items() if t >= tier for i in ids]


def season_items(n, tier):
    """The season's own: a banner stamped with the tier reached (every tier), and the chain's season variant (Gold and up)."""
    out = [f"pa_banner_s{n}_{TIERS[tier][0]}"]
    if tier >= GOLD:
        out.append(f"pa_chain_gold_s{n}")
    return out


# the season chain looks like the Gold PRO-AM chain (catalog.json pa_chain_gold: char/looks.js paints the nameplate), with
# its season stamped under the letters
PA_CHAIN_LOOK = {"color": "#f0b63a", "link": "figaro", "thick": 0.0044, "drop": 0.084, "pendant": "plate", "letters": "PRO-AM", "v0487chain": True}


def season_catalog(upto):
    """The season items for Seasons 1..upto, as catalog items (each exclusive to its season: never given again)."""
    out = []
    for n in range(1, max(1, upto) + 1):
        for t, (tid, name, _) in enumerate(TIERS[:4]):
            out.append({"id": f"pa_banner_s{n}_{tid}", "name": f"Season Banner: S{n} · {name}", "slot": "banner", "category": "proam", "price": 0,
                        "exclusive": "proam", "season": n, "tier": tid, "min_overall": 0, "rep_required": 0, "min_attr": {}, "original_2k_asset": False,
                        "description": f"Season {n} of Pro-Am, finished at {name}: your introduction card carries it. Won, not bought."})
        out.append({**PA_CHAIN_LOOK, "id": f"pa_chain_gold_s{n}", "name": f"PRO-AM Chain: Season {n}", "slot": "chain", "category": "accessory", "price": 0, "exclusive": "proam",
                    "season": n, "min_overall": 0, "rep_required": 0, "min_attr": {}, "original_2k_asset": False, "style": "proam_s", "stamp": f"S{n}",
                    "description": f"The gold PRO-AM chain, stamped with Season {n} under the letters: for reaching Gold or higher that season. Won, not bought."})
    return out


# ---------------- series (§3) ----------------
SERIES_BONUS = (1500, 3000, 5000)
QUEUE_WAIT = 45.0
MATCH_SPAN = 2
# (the World agent's twelve: client/js/world/proamparks.js PROAM_IDS, server/venues.json proam_<id>; tests check they match)
PARKS = ("overpass", "longbeach", "aau", "rooftop", "projects", "riverside", "warehouse", "schoolyard", "cage", "rec", "desert", "market")


def series_shape(div):
    t = tier_of(div)
    return (3, 2) if t == 0 else (5, 3) if t == 1 else (7, 5)


def series_bonus(div):
    return SERIES_BONUS[min(2, tier_of(div))]


def series_outcome(s):
    """'won' when the wins are in, 'lost' when too few games are left to get them, else None."""
    length, need = s["length"], s["need"]
    if s["wins"] >= need:
        return "won"
    if s["losses"] > length - need:
        return "lost"
    return None


def new_series(team, season, now):
    length, need = series_shape(team["div"])
    return {"id": str(uuid.uuid4()), "team_id": team["id"], "season": season, "div": team["div"], "status": "running",
            "length": length, "need": need, "wins": 0, "losses": 0, "games": [], "refreshes": 0, "draft": None, "picks": {}, "players": {}, "created_at": now}


def venue_for(home, team, opp, n):
    """The home team's home court; a team with none gets one of the 12 by the game (§7). venue: proam_<park>."""
    host = team if home else opp
    park = (host.get("data") or {}).get("court")
    if park not in PARKS:
        park = PARKS[cup.fnv(f"{host['id']}|{n}|court") % len(PARKS)]
    return "proam_" + park


def add_game(s, team, opp, kind, now):
    n = len(s["games"]) + 1
    home = n % 2 == 1  # (home first, then by turns)
    g = {"n": n, "home": home, "opponent": {"kind": kind, "id": opp["id"], "name": opp["name"], "abbr": opp["abbr"], "div": opp["div"]},
         "venue": venue_for(home, team, opp, n), "result": None, "score": None, "at": now}
    s["games"].append(g)
    return g


# ---------------- teams (§4) ----------------
MAX_MEMBERS = 10
AI_TEAMS = 28
LOGOS = ("bolt", "crown", "flame", "star", "shield", "hex", "circle", "diamond", "wolf", "eagle", "skull", "wave")
# the league's teams (client/js/sim/league.js TEAMS: tests/v0488proam.test.mjs checks they match), for the AI teams
LEAGUE = (("hbv", "Harborview Gulls", "HBV", "#1f6f8b", "#f2c14e", "circle"), ("irv", "Ironvale Forge", "IRV", "#2e3135", "#e8590c", "hex"),
          ("ksp", "Kingsport Monarchs", "KSP", "#5b2a86", "#e8c15a", "crown"), ("ngh", "Northgate Huskies", "NGH", "#22364f", "#c9d6df", "shield"),
          ("mph", "Maple Hollow Lumberjacks", "MPH", "#8a2b2b", "#f4f1ea", "diamond"), ("sba", "Seaboard Admirals", "SBA", "#0b2545", "#d9d4c8", "star"),
          ("rvb", "Riverbend Otters", "RVB", "#2f6b4a", "#f2c14e", "circle"), ("grf", "Granite Falls Rams", "GRF", "#5d636b", "#ffd84a", "shield"),
          ("btn", "Brickton Brawlers", "BTN", "#b5482f", "#1d1f24", "bolt"), ("lsh", "Lakeshore Herons", "LSH", "#0d8a8f", "#f4f1ea", "diamond"),
          ("cph", "Capitol Heights Senators", "CPH", "#1c3557", "#c8322f", "star"), ("stp", "Steelport Smokestacks", "STP", "#3a3f47", "#f28c28", "hex"),
          ("pnc", "Pinecrest Owls", "PNC", "#1f4d2e", "#e8e3d8", "circle"), ("bay", "Bayline Barracudas", "BAY", "#00577d", "#ff8a2a", "bolt"),
          ("crp", "Crown Point Royals", "CRP", "#3d1f6f", "#e8c15a", "crown"), ("ewk", "Eastwick Comets", "EWK", "#0a1a3a", "#ff4f3d", "star"),
          ("svs", "Sunvale Scorchers", "SVS", "#e8590c", "#2a1a4a", "bolt"), ("dwd", "Dust Wells Devils", "DWD", "#c8962f", "#3b2e1c", "diamond"),
          ("rwe", "Redwood Elk", "RWE", "#7a2e1f", "#d9c7a0", "shield"), ("gcp", "Gold Coast Prospectors", "GCP", "#c8961d", "#1d2024", "crown"),
          ("mvr", "Mesa Verde Rattlers", "MVR", "#8d6e3f", "#2f4f45", "hex"), ("cas", "Cascade Peaks Climbers", "CAS", "#2457c5", "#f4f1ea", "shield"),
          ("pcs", "Pacific Crest Surf", "PCS", "#0d8a8f", "#ffd84a", "circle"), ("sbm", "Silver Basin Miners", "SBM", "#8d98a6", "#1d2024", "hex"),
          ("hps", "High Plains Stampede", "HPS", "#7f1d1d", "#f2c14e", "star"), ("ccc", "Canyon City Condors", "CCC", "#e05a2f", "#2a2c31", "diamond"),
          ("prb", "Prairie Bandits", "PRB", "#1d3557", "#e63946", "bolt"), ("nvv", "Neon Valley Voltage", "NVV", "#7a2bd1", "#39ff88", "bolt"),
          ("trr", "Twin Rivers Rapids", "TRR", "#2f6b8a", "#e8e3d8", "circle"), ("mtm", "Monterra Matadors", "MTM", "#b8322f", "#f4d58d", "crown"),
          ("sws", "Saltwater Sharks", "SWS", "#3b5873", "#e8e3d8", "shield"), ("hlf", "Highland Falcons", "HLF", "#2b2f36", "#c8322f", "star"))


Invalid = builds.Invalid  # (the service answers it 400 with the message, as every other check)


def _team_row(r):
    if not r:
        return None
    return {"id": r["id"], "name": r["name"], "abbr": r["abbr"], "ai": bool(r["ai"]), "founder": r["founder"], "season": r["season"], "div": r["div"], "rp": r["rp"],
            "data": json.loads(r["data"] or "{}"), "created_at": r["created_at"]}


def load_team(c, team_id):
    return _team_row(c.execute("SELECT * FROM pa_teams WHERE id=?", (team_id,)).fetchone())


def save_team(c, t, now=None):
    c.execute("UPDATE pa_teams SET name=?, abbr=?, founder=?, season=?, div=?, rp=?, data=?, updated_at=? WHERE id=?",
              (t["name"], t["abbr"], t["founder"], t["season"], t["div"], t["rp"], json.dumps(t["data"]), (time.time() if now is None else now), t["id"]))


def team_of(c, aid):
    r = c.execute("SELECT team_id FROM pa_members WHERE account_id=?", (aid,)).fetchone()
    return r[0] if r else None


def members(c, team_id):
    return [r[0] for r in c.execute("SELECT account_id FROM pa_members WHERE team_id=? ORDER BY joined_at, account_id", (team_id,))]


def _hex(v, name):
    if not isinstance(v, str) or len(v) != 7 or v[0] != "#" or any(ch not in "0123456789abcdefABCDEF" for ch in v[1:]):
        raise Invalid(f"{name} must be a color like #2457c5.")
    return v.lower()


def clean_settings(data, partial=False):
    """The team's look and rules from a request: name, abbr, colors, logo, jersey, home court, open."""
    out = {}
    if not isinstance(data, dict):
        raise Invalid("Team settings are missing.")
    if "name" in data or not partial:
        name = " ".join(str(data.get("name") or "").split())
        if not 3 <= len(name) <= 22:
            raise Invalid("A team name is 3-22 characters.")
        out["name"] = name
    if "abbr" in data or not partial:
        abbr = str(data.get("abbr") or "").strip().upper()
        if not 2 <= len(abbr) <= 4 or not abbr.isalnum() or not abbr.isascii():
            raise Invalid("An abbreviation is 2-4 letters or numbers.")
        out["abbr"] = abbr
    if "primary" in data or not partial:
        out["primary"] = _hex(data.get("primary", "#2457c5"), "The main color")
    if "secondary" in data or not partial:
        out["secondary"] = _hex(data.get("secondary", "#f2c14e"), "The second color")
    if "logo" in data or not partial:
        logo = data.get("logo", "bolt")
        if logo not in LOGOS:
            raise Invalid("Choose one of the logos.")
        out["logo"] = logo
    if "jersey" in data or not partial:
        j = data.get("jersey", "classic")
        if j not in ("classic", "stripe", "split", "gradient"):
            raise Invalid("Choose one of the jerseys.")
        out["jersey"] = j
    if "court" in data or not partial:
        court = data.get("court")
        if court is not None and court not in PARKS:
            raise Invalid("Choose one of the 12 parks as your home court (or none: a different one every home game).")
        out["court"] = court
    if "open" in data or not partial:
        if not isinstance(data.get("open", True), bool):
            raise Invalid("open is true or false.")
        out["open"] = data.get("open", True)
    if "custom" in data:
        out["custom"] = clean_custom(data["custom"])
    return out


# v0.4.8.8 §8 Gold extras: the clubhouse's look (world/proamhubs.js HUB_FLOORS / walls / HUB_LOGOS), set by the founder of a
# Gold or higher team
CUSTOM_FLOORS = ("natural", "honey", "ebony", "whitewash", "slate")
CUSTOM_WALLS = ("brick", "block", "panel", "concrete", "team")


def clean_custom(cu):
    if not isinstance(cu, dict) or set(cu) - {"floor", "walls", "logo", "colors"}:
        raise Invalid("The clubhouse look is floor, walls, logo and colors.")
    if cu.get("floor", "natural") not in CUSTOM_FLOORS:
        raise Invalid("Choose one of the floors.")
    if cu.get("walls", "brick") not in CUSTOM_WALLS:
        raise Invalid("Choose one of the walls.")
    if cu.get("logo", "bolt") not in LOGOS:
        raise Invalid("Choose one of the logos.")
    cols = cu.get("colors", ["#2457c5", "#f2c14e"])
    if not isinstance(cols, list) or len(cols) != 2:
        raise Invalid("The clubhouse colors are two: the main one and the second.")
    return {"floor": cu.get("floor", "natural"), "walls": cu.get("walls", "brick"), "logo": cu.get("logo", "bolt"),
            "colors": [_hex(cols[0], "The clubhouse's main color"), _hex(cols[1], "The clubhouse's second color")]}


def _name_taken(c, name, abbr, skip=None):
    for r in c.execute("SELECT id FROM pa_teams WHERE (name=? COLLATE NOCASE) AND id IS NOT ?", (name, skip)):
        return True
    return False


def create_team(c, aid, data, season, now=None):
    now = (time.time() if now is None else now)
    if team_of(c, aid):
        raise Invalid("You're on a Pro-Am team already: leave it first.")
    s = clean_settings(data)
    if _name_taken(c, s["name"], s["abbr"]):
        raise Invalid("That team name is taken on this server.")
    tid = str(uuid.uuid4())
    d = {k: s[k] for k in ("primary", "secondary", "logo", "jersey", "court", "open")}
    d.update({"record": [0, 0], "series": [0, 0], "history": []})
    c.execute("INSERT INTO pa_teams(id,name,abbr,ai,founder,season,div,rp,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
              (tid, s["name"], s["abbr"], 0, aid, season, 0, 0, json.dumps(d), now, now))
    c.execute("INSERT INTO pa_members(account_id,team_id,joined_at) VALUES(?,?,?)", (aid, tid, now))
    return load_team(c, tid)


def update_team(c, aid, team_id, data, now=None):
    t = load_team(c, team_id)
    if not t or t["ai"]:
        raise Invalid("Team not found.")
    if t["founder"] != aid:
        raise Invalid("Only the team's founder changes its settings.")
    s = clean_settings(data, partial=True)
    if "custom" in s and tier_of(t["div"]) < GOLD:
        raise Invalid("The clubhouse look opens at Gold.")
    if "name" in s and _name_taken(c, s["name"], None, skip=team_id):
        raise Invalid("That team name is taken on this server.")
    t["name"], t["abbr"] = s.pop("name", t["name"]), s.pop("abbr", t["abbr"])
    t["data"].update(s)
    save_team(c, t, now)
    return t


def join_team(c, aid, team_id, now=None):
    """Open: in. Invite-only: a request the founder accepts. -> 'joined' | 'requested'"""
    now = (time.time() if now is None else now)
    t = load_team(c, team_id)
    if not t or t["ai"]:
        raise Invalid("Team not found.")
    if team_of(c, aid):
        raise Invalid("You're on a Pro-Am team already: leave it first.")
    if len(members(c, team_id)) >= MAX_MEMBERS:
        raise Invalid(f"That team is full ({MAX_MEMBERS} players).")
    if not t["data"].get("open", True):
        c.execute("INSERT OR IGNORE INTO pa_requests(team_id,account_id,created_at) VALUES(?,?,?)", (team_id, aid, now))
        return "requested"
    c.execute("INSERT INTO pa_members(account_id,team_id,joined_at) VALUES(?,?,?)", (aid, team_id, now))
    c.execute("DELETE FROM pa_requests WHERE account_id=?", (aid,))
    return "joined"


def answer_request(c, founder, team_id, aid, accept, now=None):
    t = load_team(c, team_id)
    if not t or t["founder"] != founder:
        raise Invalid("Only the team's founder answers requests.")
    if not c.execute("SELECT 1 FROM pa_requests WHERE team_id=? AND account_id=?", (team_id, aid)).fetchone():
        raise Invalid("No such request.")
    c.execute("DELETE FROM pa_requests WHERE team_id=? AND account_id=?", (team_id, aid))
    if not accept:
        return "declined"
    if team_of(c, aid):
        return "taken"  # (he joined another team meanwhile)
    if len(members(c, team_id)) >= MAX_MEMBERS:
        raise Invalid(f"The team is full ({MAX_MEMBERS} players).")
    c.execute("INSERT INTO pa_members(account_id,team_id,joined_at) VALUES(?,?,?)", (aid, team_id, (time.time() if now is None else now)))
    c.execute("DELETE FROM pa_requests WHERE account_id=?", (aid,))
    return "joined"


def leave_team(c, aid, now=None):
    """Off the team (his own RP and division stay his). A founder who leaves hands the team to the longest-serving
    member; the last one out ends the team."""
    tid = team_of(c, aid)
    if not tid:
        raise Invalid("You're not on a Pro-Am team.")
    c.execute("DELETE FROM pa_members WHERE account_id=?", (aid,))
    t = load_team(c, tid)
    left = members(c, tid)
    if not left:
        c.execute("DELETE FROM pa_teams WHERE id=?", (tid,))
        c.execute("DELETE FROM pa_requests WHERE team_id=?", (tid,))
        c.execute("UPDATE pa_series SET status='void', updated_at=? WHERE team_id=? AND status='running'", ((time.time() if now is None else now), tid))
        return {"team": None}
    if t["founder"] == aid:
        t["founder"] = left[0]
        save_team(c, t, now)
    return {"team": tid, "founder": t["founder"]}


def kick(c, founder, team_id, aid, now=None):
    t = load_team(c, team_id)
    if not t or t["founder"] != founder:
        raise Invalid("Only the team's founder removes players.")
    if aid == founder:
        raise Invalid("The founder can't remove himself: hand the team on, or leave it.")
    if c.execute("DELETE FROM pa_members WHERE account_id=? AND team_id=?", (aid, team_id)).rowcount == 0:
        raise Invalid("He isn't on the team.")


def hand_on(c, founder, team_id, aid, now=None):
    t = load_team(c, team_id)
    if not t or t["founder"] != founder:
        raise Invalid("Only the team's founder hands it on.")
    if aid not in members(c, team_id):
        raise Invalid("He isn't on the team.")
    t["founder"] = aid
    save_team(c, t, now)


def search(c, q, limit=30):
    """Every team on this server, real and AI, by name or abbreviation."""
    q = " ".join(str(q or "").split())[:24]
    like = f"%{q}%"
    rows = c.execute("SELECT * FROM pa_teams WHERE name LIKE ? OR abbr LIKE ? ORDER BY ai, div DESC, name LIMIT ?", (like, like, limit)).fetchall()
    out = []
    for r in rows:
        t = _team_row(r)
        out.append(team_brief(c, t))
    return out


def team_brief(c, t):
    d = t["data"]
    n = len(d.get("roster", [])) if t["ai"] else len(members(c, t["id"]))
    return {"id": t["id"], "name": t["name"], "abbr": t["abbr"], "ai": t["ai"], "division": div_info(t["div"]), "rp": t["rp"], "record": d.get("record", [0, 0]),
            "series": d.get("series", [0, 0]), "size": n, "open": d.get("open", True) if not t["ai"] else False, "primary": d.get("primary"),
            "secondary": d.get("secondary"), "logo": d.get("logo"), "court": d.get("court"), "league": d.get("league"),
            "jersey": d.get("jersey"), "custom": d.get("custom")}


def team_new_season(c, t, season, now=None):
    """A team in a new season: Bronze 1 at 0 RP (AI teams spread out again), its old season kept, a series still on
    voided."""
    if t["season"] >= season:
        return False
    d = t["data"]
    d.setdefault("history", []).append({"season": t["season"], "div": t["div"], "label": div_info(t["div"])["label"], "record": d.get("record", [0, 0]), "series": d.get("series", [0, 0])})
    d["history"] = d["history"][-12:]
    d["record"], d["series"] = [0, 0], [0, 0]
    t["season"], t["rp"] = season, 0
    t["div"] = ai_start_div(t["data"].get("slot", 0)) if t["ai"] else 0
    c.execute("UPDATE pa_series SET status='void', updated_at=? WHERE team_id=? AND status='running'", ((time.time() if now is None else now), t["id"]))
    save_team(c, t, now)
    return True


# ---------------- AI teams (§4) ----------------
# the AI world's skill tiers (cup.TIER_IDS: casual, regular, hooper, elite, legend) a division's players come from
def tiers_for_div(i):
    t = tier_of(i)
    return {0: (0, 1), 1: (1, 2), 2: (2, 3), 3: (3, 4)}.get(t, (4,))


def ai_start_div(slot):
    """AI teams start a season spread over Bronze 1 .. Platinum 7."""
    return int(round(slot * PLAYABLE_TOP / max(1, AI_TEAMS - 1)))


def ai_pool(seed, tiers, exclude=(), salt="pa"):
    """AI world ids of those skill tiers, in a stable order of their own (salt), none of exclude."""
    ex = set(exclude)
    ids = [f"ai-{i}" for i in range(cup.POOL) if cup.tier_of(seed, f"ai-{i}") in tiers and f"ai-{i}" not in ex]
    return sorted(ids, key=lambda a: cup.fnv(f"{salt}|{a}"))


def ai_fives(c, skip=None):
    """Every AI team's five (nobody drafts them)."""
    out = set()
    for r in c.execute("SELECT id, data FROM pa_teams WHERE ai=1"):
        if r[0] != skip:
            out.update(json.loads(r[1]).get("roster", [])[:5])
    return out


def ensure_ai_teams(c, seed, season, now=None):
    """At least AI_TEAMS AI teams, with league identities, rostered from the shared world (made once; a new world, after
    a season reset, rosters them again)."""
    now = (time.time() if now is None else now)
    have = {r[0]: json.loads(r[1]) for r in c.execute("SELECT id, data FROM pa_teams WHERE ai=1")}
    taken = set()
    for d in have.values():
        if d.get("seed") == seed:
            taken.update(d.get("roster", []))
    made = 0
    for slot, (lid, name, abbr, c1, c2, logo) in enumerate(LEAGUE[:AI_TEAMS]):
        tid = "ai_" + lid
        d = have.get(tid)
        if d and d.get("seed") == seed:
            continue
        div = ai_start_div(slot)
        roster = ai_pool(seed, tiers_for_div(div), taken, salt=f"pa|{tid}")[:7]
        taken.update(roster)
        data = {"primary": c1, "secondary": c2, "logo": logo if logo in LOGOS else "bolt", "jersey": "classic", "court": PARKS[cup.fnv(tid) % len(PARKS)],
                "open": False, "record": [0, 0], "series": [0, 0], "history": [], "roster": roster, "league": lid, "seed": seed, "slot": slot}
        if d:
            c.execute("UPDATE pa_teams SET data=?, updated_at=? WHERE id=?", (json.dumps({**d, **{k: data[k] for k in ("roster", "seed", "slot")}}), now, tid))
        else:
            c.execute("INSERT INTO pa_teams(id,name,abbr,ai,founder,season,div,rp,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                      (tid, name, abbr, 1, None, season, div, 0, json.dumps(data), now, now))
        made += 1
    return made


AI_SIM_EVERY = 6 * 3600  # (between AI teams: a round of series every 6 hours)


def ai_simulate(c, season, now=None):
    """Rounds of AI-vs-AI series since the last one (at most 8 at a time): paired by a shuffle of the round, the better
    division more likely to win; the winner goes up a division, the loser to 0 RP (or down one, at 0 already).
    Deterministic: the same rounds come out the same."""
    now = (time.time() if now is None else now)
    row = c.execute("SELECT v FROM pa_state WHERE k='ai_sim'").fetchone()
    last = int(row[0]) if row else int(now // AI_SIM_EVERY)
    upto = int(now // AI_SIM_EVERY)
    done = 0
    for slot in range(max(last + 1, upto - 7), upto + 1):
        teams = [_team_row(r) for r in c.execute("SELECT * FROM pa_teams WHERE ai=1 AND season=? ORDER BY id", (season,))]
        teams.sort(key=lambda t: cup.fnv(f"{slot}|{t['id']}"))
        for a, b in zip(teams[0::2], teams[1::2]):
            p = 1 / (1 + 10 ** ((b["div"] - a["div"]) / 6))
            awin = (cup.fnv(f"{slot}|{a['id']}|{b['id']}|w") % 1000) / 1000 < p
            w, l = (a, b) if awin else (b, a)
            w["div"] = min(PLAYABLE_TOP, promote(w["div"]))
            if l["rp"] == 0:
                l["div"] = demote(l["div"])
            l["rp"] = 0
            w["data"]["series"][0] += 1
            l["data"]["series"][1] += 1
            save_team(c, w, now); save_team(c, l, now)
        done += 1
    c.execute("INSERT INTO pa_state(k,v) VALUES('ai_sim',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (str(upto),))
    return done


# ---------------- the draft (§5) ----------------
DRAFT_SIZE = 5
DRAFT_POOL = 15
DRAFT_REFRESHES = 3


def draft_pool(seed, s, taken):
    """The AI players this series' draft (at its refresh) can offer: near the team's division, none in an AI team's
    five. The captain's game picks the 5 shown from these (a spread of positions; it knows them) and the server checks."""
    return ai_pool(seed, tiers_for_div(s["div"]), taken, salt=f"draft|{s['id']}|{s['refreshes']}")[:DRAFT_POOL]


def draft_state(seed, s, taken):
    pool = draft_pool(seed, s, taken)
    d = s.get("draft") or {}
    if d.get("refresh") != s["refreshes"] or not set(d.get("list") or []) <= set(pool):
        d = {"refresh": s["refreshes"], "list": pool[:DRAFT_SIZE]}
        s["draft"] = d
    return {"pool": pool, "list": d["list"], "refreshes_left": DRAFT_REFRESHES - s["refreshes"], "picks": s.get("picks", {})}


def draft_set_list(seed, s, taken, ids):
    pool = draft_pool(seed, s, taken)
    if not isinstance(ids, list) or len(ids) != DRAFT_SIZE or len(set(ids)) != DRAFT_SIZE or not all(i in pool for i in ids):
        raise Invalid("The draft list is 5 of the players on offer.")
    s["draft"] = {"refresh": s["refreshes"], "list": list(ids)}


def draft_refresh(s):
    if s["refreshes"] >= DRAFT_REFRESHES:
        raise Invalid(f"No refreshes left this series ({DRAFT_REFRESHES} a series).")
    s["refreshes"] += 1
    s["draft"] = None


def draft_pick(seed, s, taken, ai_id, open_spots):
    st = draft_state(seed, s, taken)
    if ai_id not in st["list"]:
        raise Invalid("Pick one of the players on the clipboard.")
    picks = s.setdefault("picks", {})
    if ai_id in picks.values():
        raise Invalid("He's on the sheet already.")
    if len(picks) >= open_spots:
        raise Invalid("Every open spot is filled.")
    picks[str(len(picks) + 1)] = ai_id


def lineup(seed, s, taken, humans):
    """At the ready check: the people ready, then the drafted players, then the open spots from the clipboard in order.
    -> the AI ids who play with them (5 on the floor in all)."""
    need = max(0, 5 - min(5, humans))
    st = draft_state(seed, s, taken)
    out = [i for i in st["picks"].values()][:need]
    for i in st["list"]:
        if len(out) >= need:
            break
        if i not in out:
            out.append(i)
    return out[:need]


# ---------------- matchmaking (§3) ----------------
class Matchmaker:
    """The queue (in memory: a queued team that restarts the server queues again). A team in it is paired with the first
    real team queued within MATCH_SPAN divisions; one that's waited QUEUE_WAIT with nobody gets the nearest AI team
    (match_ai, by the caller). {team_id: {"div", "since"}} and the matches made for teams that haven't asked yet."""

    def __init__(self):
        self.queue = {}
        self.made = {}

    def join(self, team_id, div, now=None):
        now = time.time() if now is None else now
        if team_id in self.made:
            return self.made.pop(team_id)
        for other, q in sorted(self.queue.items(), key=lambda kv: kv[1]["since"]):
            if other != team_id and abs(q["div"] - div) <= MATCH_SPAN:
                del self.queue[other]
                self.queue.pop(team_id, None)
                m = {"kind": "team", "a": team_id, "b": other, "at": now}
                self.made[other] = {**m, "opponent": team_id}
                return {**m, "opponent": other}
        self.queue.setdefault(team_id, {"div": div, "since": now})
        return None

    def poll(self, team_id, now=None):
        """The match made for him, or {"kind": "ai"} once he's waited QUEUE_WAIT, or None (still waiting)."""
        now = time.time() if now is None else now
        if team_id in self.made:
            return self.made.pop(team_id)
        q = self.queue.get(team_id)
        if not q:
            return None
        if now - q["since"] >= QUEUE_WAIT:
            del self.queue[team_id]
            return {"kind": "ai", "a": team_id, "at": now}
        return {"kind": "waiting", "waited": now - q["since"], "left": QUEUE_WAIT - (now - q["since"])}

    def leave(self, team_id):
        self.queue.pop(team_id, None)
        self.made.pop(team_id, None)


def nearest_ai(c, div, season, avoid=None, salt=""):
    rows = [_team_row(r) for r in c.execute("SELECT * FROM pa_teams WHERE ai=1 AND season=?", (season,))]
    rows = [t for t in rows if t["id"] != avoid] or rows
    if not rows:
        return None
    return min(rows, key=lambda t: (abs(t["div"] - div), cup.fnv(f"{salt}|{t['id']}")))


# ---------------- the service's side (app.py routes and hooks) ----------------
# ---------------- v0.4.8.9 qp6: Pro-Am teams online ----------------
# A Pro-Am team is kept by the service its members meet on. Offline that's your own; online (your own copy playing
# through a friend's hosted game or the online server) it's that one, the hub: every member's game asks it over the
# online socket (online.py "pa", ProAm.online_call), with that service's account ids, so everyone online finds the same
# teams, joins them, meets in their HUB (its place key is the team's id there) and queues and plays as one team. What
# stays in each player's own save: his builds, their Pro-Am rank and RP, VC, items. So:
#   * his game sends a card for the build he plays (online_status: clean_card, kept in pa_cards) for the roster;
#   * a series game's ticket on his own service carries the hub's game (online_ticket_meta: the RP is worked out there
#     as for any series game) and its result goes back to the hub (the ticket's "report": online_report: the series,
#     the team's record and division);
#   * a series that ended comes back to his game in the hub's status ("settle") and his own service moves his build
#     up or down and pays the bonus, once (settle_online).
CARD_KEYS = ("character_id", "name", "position", "overall", "div", "rp", "record", "series")


def clean_card(card, season_n):
    """A member's build as his game sends it: {character_id, name, position, overall, div, rp, record, series}."""
    if not isinstance(card, dict):
        return None
    num = lambda v, lo, hi: max(lo, min(hi, int(v))) if isinstance(v, (int, float)) and not isinstance(v, bool) else lo
    pair = lambda v: [num(v[0], 0, 10 ** 6), num(v[1], 0, 10 ** 6)] if isinstance(v, list) and len(v) == 2 else [0, 0]
    pos = card.get("position") if card.get("position") in builds.POSITIONS else None
    pa = {"season": season_n, "div": num(card.get("div"), 0, TOP), "rp": num(card.get("rp"), 0, RP_MAX)}
    rec, ser = pair(card.get("record")), pair(card.get("series"))
    pa.update({"high": pa["div"], "gw": rec[0], "gl": rec[1], "sw": ser[0], "sl": ser[1]})
    return {"character_id": str(card.get("character_id") or "")[:64] or None, "name": " ".join(str(card.get("name") or "").split())[:40] or None,
            "position": pos, "overall": num(card.get("overall"), 0, 99) or None, "state": public_state(pa)}


def save_card(c, aid, card, now=None):
    c.execute("INSERT INTO pa_cards(account_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
              (aid, json.dumps(card), (time.time() if now is None else now)))


def load_card(c, aid):
    r = c.execute("SELECT data FROM pa_cards WHERE account_id=?", (aid,)).fetchone()
    return json.loads(r[0]) if r else None


def online_ticket_meta(pg):
    """A series game of an online team, on the player's own service: {"series", "n", "online": {"team", "div",
    "opp_div", "opp", "venue", "home"}} as the hub made it (the client brings it from the hub's queue)."""
    on = pg["online"]
    if not isinstance(on, dict):
        raise Invalid("pa_game.online is the hub's game.")
    num = lambda v, name: builds.integer(v, 0, TOP, name)
    opp = on.get("opp") if isinstance(on.get("opp"), dict) else {}
    opp = {"kind": "team" if opp.get("kind") == "team" else "ai", "id": str(opp.get("id") or "")[:64], "name": " ".join(str(opp.get("name") or "").split())[:40],
           "abbr": str(opp.get("abbr") or "")[:4], "div": num(opp.get("div", on.get("opp_div")), "opp div")}
    if not 1 <= pg["n"] <= 7 or len(pg["series"]) > 64:
        raise Invalid("That series game isn't on.")
    return {"series": pg["series"], "n": pg["n"], "team": str(on.get("team") or "")[:64], "opp_div": num(on.get("opp_div", opp["div"]), "opp_div"), "opp": opp,
            "venue": str(on.get("venue") or "")[:40], "home": on.get("home") is True, "div": num(on.get("div"), "div"), "online": True}


ONLINE_ACTIONS = ("create", "update", "join", "leave", "answer", "kick", "handon", "draft", "queue", "lineup")


class ProAm:
    """The Pro-Am meta layer on a Service: its routes (status, search, teams, the draft, the queue) and the hooks the
    match flow calls (a ticket's series game, a result, a forfeit, a profile load)."""

    def __init__(self, service, catalog):
        self.s = service
        self.sides = {}  # (v0.4.8.8: real-vs-real games' sides: side())
        self.catalog = catalog  # (app.CATALOG: the season items are added to it as their seasons come)
        self.mm = Matchmaker()

    # -- the season, the AI teams and the season items, brought up to now --
    def boot(self, now=None):
        seed = self.s.shared_world(now)["seed"]
        with self.s.db.transaction() as c:
            season = current_season(c, now)
            ensure_ai_teams(c, seed, season["n"], now)
            ai_simulate(c, season["n"], now)
        self.sync_catalog(season["n"])
        return season

    def sync_catalog(self, n):
        for it in season_catalog(n):
            self.catalog.setdefault(it["id"], it)

    def world_seed(self):
        return self.s.shared_world()["seed"]

    def give(self, c, aid, ids):
        got = []
        for i in ids:
            if i in self.catalog and c.execute("INSERT OR IGNORE INTO inventory VALUES(?,?,?)", (aid, i, time.time())).rowcount:
                got.append(i)
        return got

    def settle_char(self, c, aid, char, season):
        """A build in the season on now: its old season's reward given, its tier items given. -> (state, items given)"""
        pa, closed = player_state(char, season)
        got = []
        for rec in closed:
            got += self.give(c, aid, season_items(rec["season"], tier_of(rec["high"])))
        got += self.give(c, aid, rank_items_for(pa["high"]))
        return pa, got

    def on_profile(self, c, aid, chars, season_n):
        """Every build of the account in the season on now (profile load): returns the items given."""
        got = []
        for ch in chars:
            before = json.dumps(ch.get("progression", {}).get("pa"))
            _, g = self.settle_char(c, aid, ch, season_n)
            got += g
            if json.dumps(ch.get("progression", {}).get("pa")) != before or g:
                c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(ch), ch["id"]))
        return got

    # -- teams --
    def my_team(self, c, aid, season_n):
        tid = team_of(c, aid)
        t = load_team(c, tid) if tid else None
        if t:
            team_new_season(c, t, season_n)
        return t

    def home_court_check(self, c, aid, venue, now=None):
        """v0.4.8.8 §8: a home-court 3s game (POST /api/matches pa_home) is for a member of a Gold or higher team, on its own
        home court. -> None when it is, else why not."""
        t = self.my_team(c, aid, current_season(c, now)["n"])
        if not t or t["ai"]:
            return "Home-court games are for a Pro-Am team's players."
        if tier_of(t["div"]) < GOLD:
            return "Home-court games open when your team reaches Gold."
        court = t["data"].get("court")
        if not court or venue != "proam_" + court:
            return "That isn't your team's home court."
        return None

    def running_series(self, c, team_id, season_n):
        r = c.execute("SELECT data FROM pa_series WHERE team_id=? AND status='running' AND season=? ORDER BY created_at DESC LIMIT 1", (team_id, season_n)).fetchone()
        return json.loads(r[0]) if r else None

    def save_series(self, c, sr, now=None):
        now = (time.time() if now is None else now)
        c.execute("INSERT INTO pa_series(id,team_id,season,div,status,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) "
                  "ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data, updated_at=excluded.updated_at",
                  (sr["id"], sr["team_id"], sr["season"], sr["div"], sr["status"], json.dumps(sr), sr.get("created_at", now), now))

    def member_view(self, c, aid, season_n, founder):
        u = c.execute("SELECT username FROM accounts WHERE id=?", (aid,)).fetchone()
        best = None
        for r in c.execute("SELECT data FROM characters WHERE account_id=?", (aid,)):
            ch = json.loads(r[0])
            pa = (ch.get("progression") or {}).get("pa") or {}
            st = public_state(pa if pa.get("season") == season_n else blank_state(season_n))
            if not best or st["index"] > best["state"]["index"]:
                best = {"character_id": ch.get("id"), "name": ch.get("name"), "position": ch.get("position"), "overall": ch.get("overall"), "state": st}
        if best is None:  # (qp6: a member playing from his own copy: the card his game sent, online_status)
            best = load_card(c, aid)
        return {"account_id": aid, "username": u[0] if u else "?", "founder": aid == founder, "build": best}

    def team_view(self, c, t, viewer, season_n, seed=None):
        out = team_brief(c, t)
        out["season"] = t["season"]
        out["history"] = t["data"].get("history", [])
        if t["ai"]:
            out["roster"] = t["data"].get("roster", [])
        else:
            out["members"] = [self.member_view(c, a, season_n, t["founder"]) for a in members(c, t["id"])]
            out["founder"] = t["founder"]
            out["mine"] = viewer in [m["account_id"] for m in out["members"]]
            if viewer == t["founder"]:
                out["requests"] = [{"account_id": r[0], "username": (c.execute("SELECT username FROM accounts WHERE id=?", (r[0],)).fetchone() or ["?"])[0], "at": r[1]}
                                   for r in c.execute("SELECT account_id, created_at FROM pa_requests WHERE team_id=? ORDER BY created_at", (t["id"],))]
            sr = self.running_series(c, t["id"], season_n)
            if sr and seed is not None:
                sr = {**sr, "draft_state": draft_state(seed, sr, ai_fives(c))}
            out["current"] = series_public(sr)  # (the series on now; "series" is the season's series won and lost)
        return out

    def status(self, aid, now=None):
        season = self.boot(now)
        seed = self.world_seed()
        with self.s.db.transaction() as c:
            n = season["n"]
            chars = [json.loads(r[0]) for r in c.execute("SELECT data FROM characters WHERE account_id=?", (aid,))]
            given = self.on_profile(c, aid, chars, n)
            t = self.my_team(c, aid, n)
            out = {"me": aid, "season": season_public(season, now), "team": self.team_view(c, t, aid, n, seed) if t else None, "given": given,
                   "builds": [{"id": ch.get("id"), "name": ch.get("name"), "pa": public_state(ch["progression"]["pa"]), "history": ch["progression"].get("pa_history"),
                               "seasons": ch["progression"].get("pa_seasons", [])} for ch in chars],
                   "requested": [r[0] for r in c.execute("SELECT team_id FROM pa_requests WHERE account_id=?", (aid,))],
                   "rules": {"max_members": MAX_MEMBERS, "logos": LOGOS, "parks": PARKS, "refreshes": DRAFT_REFRESHES, "queue_wait": QUEUE_WAIT,
                             "series_bonus": SERIES_BONUS, "boost": BOOST, "custom": {"floors": CUSTOM_FLOORS, "walls": CUSTOM_WALLS}, "tiers": [{"id": a, "name": b, "divs": n_} for a, b, n_ in TIERS]}}
        return out

    def search(self, q):
        self.boot()
        with self.s.db.transaction() as c:
            return {"teams": search(c, q)}

    def team(self, aid, team_id):
        season = self.boot()
        seed = self.world_seed()
        with self.s.db.transaction() as c:
            t = load_team(c, team_id)
            if not t:
                raise Invalid("Team not found.")
            team_new_season(c, t, season["n"])
            return {"team": self.team_view(c, t, aid, season["n"], seed)}

    def action(self, aid, kind, data):
        """POST /api/proam/<kind>: create, update, join, leave, answer, kick, handon, draft, queue, lineup."""
        season = self.boot()
        seed = self.world_seed()
        n = season["n"]
        with self.s.db.transaction() as c:
            if kind == "create":
                t = create_team(c, aid, data.get("team"), n)
                return {"team": self.team_view(c, t, aid, n, seed)}
            if kind == "join":
                return {"result": join_team(c, aid, str(data.get("team_id") or ""))}
            if kind == "leave":
                return leave_team(c, aid)
            if kind == "settle":  # (qp6: an online team's series that ended, on this save's builds: settle_online)
                return {"settled": self.settle_online(c, aid, data.get("items"), n)}
            t = self.my_team(c, aid, n)
            if not t:
                raise Invalid("You're not on a Pro-Am team.")
            if kind == "update":
                return {"team": self.team_view(c, update_team(c, aid, t["id"], data.get("team")), aid, n, seed)}
            if kind == "answer":
                return {"result": answer_request(c, aid, t["id"], str(data.get("account_id") or ""), bool(data.get("accept")))}
            if kind == "kick":
                kick(c, aid, t["id"], str(data.get("account_id") or ""))
                return {"ok": True}
            if kind == "handon":
                hand_on(c, aid, t["id"], str(data.get("account_id") or ""))
                return {"ok": True}
            sr = self.running_series(c, t["id"], n)
            if kind == "draft":
                if not sr:
                    sr = new_series(t, n, time.time())
                taken = ai_fives(c)
                act = data.get("action")
                if act == "refresh":
                    draft_refresh(sr)
                elif act == "list":
                    draft_set_list(seed, sr, taken, data.get("ids"))
                elif act == "pick":
                    open_spots = max(0, 5 - min(5, int(data.get("humans") or 1)))
                    draft_pick(seed, sr, taken, data.get("ai_id"), open_spots)
                elif act == "unpick":
                    sr["picks"] = {str(i + 1): v for i, v in enumerate(v for v in sr.get("picks", {}).values() if v != data.get("ai_id"))}
                elif act != "view":
                    raise Invalid("action: view, refresh, list, pick or unpick.")
                st = draft_state(seed, sr, taken)
                self.save_series(c, sr)
                return {"draft": st, "series": series_public(sr)}
            if kind == "lineup":
                if not sr:
                    raise Invalid("No series on.")
                ids = lineup(seed, sr, ai_fives(c), int(data.get("humans") or 1))
                self.save_series(c, sr)
                return {"ai": ids}
            if kind == "queue":
                return self.queue(c, t, sr, n, data.get("action"), data=data)
        raise Invalid("Unknown Pro-Am action.")

    # -- the queue and the games (§3) --
    def pending_game(self, sr):
        g = sr["games"][-1] if sr and sr["games"] else None
        return g if g and g["result"] is None else None

    def queue(self, c, t, sr, n, act, now=None, data=None):
        now = (time.time() if now is None else now)
        if act == "leave":
            self.mm.leave(t["id"])
            return {"state": "left"}
        if act == "side":
            return self.side(t, sr, data or {}, now)
        if not sr:
            sr = new_series(t, n, now)
            self.save_series(c, sr, now)
        g = self.pending_game(sr)
        if g:  # (a game made already and not played yet: that one)
            self.mm.leave(t["id"])
            return {"state": "matched", "game": g, "series": series_public(sr)}
        m = self.mm.join(t["id"], sr["div"], now) if act == "join" else self.mm.poll(t["id"], now)
        if m is None:
            m = self.mm.poll(t["id"], now)
        if not m or m["kind"] == "waiting":
            return {"state": "waiting", **({"left": m["left"]} if m else {})}
        if m["kind"] == "team":
            other = load_team(c, m["opponent"])
            if not other:
                return {"state": "waiting"}
            g = add_game(sr, t, other, "team", now)
            osr = self.running_series(c, other["id"], n) or new_series(other, n, now)
            og = self.pending_game(osr)
            if not og:
                # (the same game for the other team: away when this one's at home, at the same court)
                og = add_game(osr, other, t, "team", now)
                og["home"], og["venue"] = not g["home"], g["venue"]
                og["match"] = uuid.uuid4().hex
                self.save_series(c, osr, now)
            # (both teams' games are one game: the match id they meet at, side(), to play it as one online game)
            g["match"] = og.get("match") or uuid.uuid4().hex
        else:
            last = sr["games"][-1]["opponent"]["id"] if sr["games"] else None
            ai = nearest_ai(c, sr["div"], n, avoid=last, salt=f"{sr['id']}|{len(sr['games'])}")
            if not ai:
                return {"state": "waiting"}
            g = add_game(sr, t, ai, "ai", now)
        self.save_series(c, sr, now)
        return {"state": "matched", "game": g, "series": series_public(sr)}

    # v0.4.8.8: a real team against a real team plays one online game (the home team's Captain starts it). Each team's
    # Captain says who's playing (side): his account id, the teammates in it and his draft's lineup, and whether he's online;
    # each sees the other's once it's there. In memory, for SIDE_TTL.
    SIDE_TTL = 600

    def side(self, t, sr, data, now):
        g = self.pending_game(sr)
        if not g or g["opponent"]["kind"] != "team" or not g.get("match") or data.get("match") != g["match"]:
            raise Invalid("No game against a real team is on.")
        for k in [k for k, v in self.sides.items() if now - v["at"] > self.SIDE_TTL]:
            del self.sides[k]
        rec = self.sides.setdefault(g["match"], {"at": now, "teams": {}})
        s = data.get("side")
        if s is not None:
            if not isinstance(s, dict):
                raise Invalid("side is {online, humans, lineup}.")
            humans = [{"id": str(h.get("id"))[:64], "username": str(h.get("username") or "")[:24]} for h in (s.get("humans") or [])[:5] if isinstance(h, dict) and h.get("id")]
            lineup = [i for i in (s.get("lineup") or [])[:5] if isinstance(i, str) and len(i) <= 64]
            rec["teams"][t["id"]] = {"online": s.get("online") is True, "humans": humans, "lineup": lineup, "home": g["home"], "series": sr["id"], "n": g["n"],
                                     "team": {"id": t["id"], "name": t["name"], "abbr": t["abbr"], "div": sr["div"]}, "at": now}
        other = rec["teams"].get(g["opponent"]["id"])
        return {"state": "side", "match": g["match"], "home": g["home"], "mine": rec["teams"].get(t["id"]), "other": other}

    def ticket_meta(self, c, aid, data):
        """A Pro-Am ticket for a series game: {"series", "n"} -> what goes in the ticket's meta (or Invalid)."""
        pg = data.get("pa_game")
        if pg is None:
            return None
        if not isinstance(pg, dict) or not isinstance(pg.get("series"), str) or not isinstance(pg.get("n"), int):
            raise Invalid("pa_game is {series, n}.")
        if pg.get("online") is not None:  # (qp6: an online team's game: its series is the hub's)
            return online_ticket_meta(pg)
        r = c.execute("SELECT team_id, data FROM pa_series WHERE id=?", (pg["series"],)).fetchone()
        if not r or team_of(c, aid) != r[0]:
            raise Invalid("That series isn't your team's.")
        sr = json.loads(r[1])
        if sr["status"] != "running" or not 1 <= pg["n"] <= len(sr["games"]):
            raise Invalid("That series game isn't on.")
        g = sr["games"][pg["n"] - 1]
        return {"series": sr["id"], "n": g["n"], "team": r[0], "opp_div": g["opponent"]["div"], "opp": g["opponent"], "venue": g["venue"], "home": g["home"], "div": sr["div"]}

    def complete(self, c, aid, char, summary, ticket, rw):
        """A Pro-Am result (complete): the build's RP, and for a series game the series (once, from the first report)."""
        n = current_season(c)["n"]
        pa, got = self.settle_char(c, aid, char, n)
        meta = ticket["meta"]
        pg = meta.get("pa_game")
        if not pg:
            return None  # (a pickup Pro-Am game, outside a team's series: no season RP)
        opp_div = pg["opp_div"]
        won = rw["won"]
        if summary["forfeit"]:
            ch = {"total": -FORFEIT_RP, "forfeit": -FORFEIT_RP}
        else:
            ch = game_rp(pa["div"], pa["rp"], opp_div, won, summary["stats"], meta.get("quarter_len", 180) * meta.get("quarters", 4))
        res = apply_game(pa, ch["total"], won)
        got += self.give(c, aid, rank_items_for(pa["high"]))
        out = {**res, "parts": {k: v for k, v in ch.items() if k != "total"}, "state": public_state(pa), "items": got}
        if pg.get("online"):  # (qp6: the hub keeps the series: the game reports it there, online_report)
            out["report"] = {"series": pg["series"], "n": pg["n"], "won": bool(won), "score": summary.get("score"), "delta": res["delta"],
                             "character_id": char.get("id"), "forfeit": bool(summary["forfeit"])}
        elif pg:
            out["series"] = self.series_result(c, aid, char, pg, won, summary, res["delta"])
            out["state"] = public_state(pa)
        return out

    def series_result(self, c, aid, char, pg, won, summary, delta, now=None):
        now = (time.time() if now is None else now)
        r = c.execute("SELECT data FROM pa_series WHERE id=?", (pg["series"],)).fetchone()
        if not r:
            return None
        sr = json.loads(r[0])
        sr.setdefault("players", {})[aid] = char.get("id")
        g = sr["games"][pg["n"] - 1]
        if g["result"] is None and sr["status"] == "running":
            g["result"] = "W" if won else "L"
            g["score"] = summary["score"]
            g["at"] = now
            sr["wins" if won else "losses"] += 1
            t = load_team(c, sr["team_id"])
            if t:
                t["data"].setdefault("record", [0, 0])[0 if won else 1] += 1
                t["rp"] = max(0, min(RP_MAX, t["rp"] + int(delta)))
                save_team(c, t, now)
                if g["opponent"]["kind"] == "ai":
                    self.ai_result(c, g["opponent"]["id"], not won, now)
            outcome = series_outcome(sr)
            if outcome:
                self.finish_series(c, sr, t, outcome, aid, char, now)
        self.save_series(c, sr, now)
        return series_public(sr)

    def ai_result(self, c, ai_id, won, now):
        a = load_team(c, ai_id)
        if not a:
            return
        a["data"].setdefault("record", [0, 0])[0 if won else 1] += 1
        if won:
            a["rp"] += 15
            if a["rp"] >= RP_MAX:
                a["div"], a["rp"] = min(PLAYABLE_TOP, promote(a["div"])), a["rp"] - RP_MAX
        else:
            if a["rp"] == 0:
                a["div"] = demote(a["div"])
            a["rp"] = max(0, a["rp"] - 15)
        save_team(c, a, now)

    def finish_series(self, c, sr, t, outcome, reporter, reporter_char, now):
        """A series over: the team and everyone who played in it (§2), the bonus for a win, and the draft's refreshes
        reset (the next series starts its own)."""
        n = sr["season"]
        sr["status"] = outcome
        sr["ended_at"] = now
        bonus = series_bonus(sr["div"]) if outcome == "won" else 0
        sr["bonus"] = bonus
        if t:
            if outcome == "won":
                t["div"] = max(t["div"], promote(sr["div"]))
            else:
                if t["rp"] == 0:
                    t["div"] = demote(t["div"])
                t["rp"] = 0
            t["data"].setdefault("series", [0, 0])[0 if outcome == "won" else 1] += 1
            save_team(c, t, now)
        moved = {}
        for acct, cid in sr.get("players", {}).items():
            if acct == reporter and reporter_char.get("id") == cid:
                if reporter_char.get("remote"):  # (qp6: his build is in his own save: his game settles it, settle_online)
                    continue
                ch = reporter_char
            else:
                row = c.execute("SELECT data FROM characters WHERE id=? AND account_id=?", (cid, acct)).fetchone()
                if not row:
                    continue
                ch = json.loads(row[0])
            pa, _ = player_state(ch, n)
            moved[acct] = series_won_player(pa, sr["div"]) if outcome == "won" else series_lost_player(pa)
            self.give(c, acct, rank_items_for(pa["high"]))
            if bonus:
                self.s.db.change_wallet(c, acct, bonus, "proam_series", f"pa_series:{sr['id']}")
            if ch is not reporter_char:
                c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(ch), cid))
        sr["moved"] = moved

    def forfeit(self, c, aid, char_id, meta):
        """A series game forfeited or abandoned: -20 RP this season, and it counts as a loss in the series."""
        pg = (meta or {}).get("pa_game")
        row = c.execute("SELECT data FROM characters WHERE id=?", (char_id,)).fetchone()
        if not row or not pg:
            return None
        ch = json.loads(row[0])
        n = current_season(c)["n"]
        pa, _ = self.settle_char(c, aid, ch, n)
        res = apply_game(pa, -FORFEIT_RP, False)
        if pg.get("online"):  # (qp6: for the hub's series, from the game: online_report)
            res["report"] = {"series": pg["series"], "n": pg["n"], "won": False, "score": [0, 0], "delta": -FORFEIT_RP, "character_id": char_id, "forfeit": True}
        elif pg:
            res["series"] = self.series_result(c, aid, ch, pg, False, {"score": [0, 0]}, -FORFEIT_RP)
        c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(ch), char_id))
        return res

    # -- v0.4.8.9 qp6: the team's service for members playing from their own copies (online.py "pa") --
    def online_call(self, aid, msg):
        """{"op", "args"} from a member's game over the online socket, as his account here. -> the answer (Invalid when
        it's refused, with the reason the HTTP routes give)."""
        op, args = msg.get("op"), msg.get("args") if msg.get("args") is not None else {}
        if not isinstance(args, dict):
            raise Invalid("args is an object.")
        if op == "status":
            return self.online_status(aid, args.get("card"))
        if op == "search":
            return self.search(args.get("q"))
        if op == "team":
            return self.team(aid, str(args.get("id") or ""))
        if op == "report":
            return self.online_report(aid, args)
        if op in ONLINE_ACTIONS:
            return self.action(aid, op, args)
        raise Invalid("Unknown Pro-Am action.")

    def online_status(self, aid, card=None, now=None):
        """His team as this service keeps it, the season, his requests, the rules, and the series of his team that ended
        with him in them (settle: his own service moves his build). His card (the build he plays) is kept first."""
        season = self.boot(now)
        seed = self.world_seed()
        n = season["n"]
        with self.s.db.transaction() as c:
            cc = clean_card(card, n)
            if cc:
                save_card(c, aid, cc)
            t = self.my_team(c, aid, n)
            settle = []
            if t:
                for r in c.execute("SELECT data FROM pa_series WHERE team_id=? AND status IN ('won','lost') ORDER BY updated_at DESC LIMIT 10", (t["id"],)):
                    sr = json.loads(r[0])
                    if aid in (sr.get("players") or {}):
                        settle.append({"series": sr["id"], "outcome": sr["status"], "div": sr["div"], "season": sr["season"], "character_id": sr["players"][aid]})
            return {"me": aid, "online": True, "season": season_public(season, now), "team": self.team_view(c, t, aid, n, seed) if t else None,
                    "requested": [r[0] for r in c.execute("SELECT team_id FROM pa_requests WHERE account_id=?", (aid,))], "settle": settle,
                    "rules": {"max_members": MAX_MEMBERS, "logos": LOGOS, "parks": PARKS, "refreshes": DRAFT_REFRESHES, "queue_wait": QUEUE_WAIT,
                              "series_bonus": SERIES_BONUS, "boost": BOOST, "custom": {"floors": CUSTOM_FLOORS, "walls": CUSTOM_WALLS}, "tiers": [{"id": a, "name": b, "divs": n_} for a, b, n_ in TIERS]}}

    def online_report(self, aid, data, now=None):
        """A series game played by a member from his own copy: {series, n, won, score, delta, character_id, forfeit,
        alone}, from his own service's ticket ("report"). The first report of a game counts, as on one service. A
        forfeit counts when he was the team's only player in it (the others' result counts otherwise)."""
        sid, gn = data.get("series"), data.get("n")
        if not isinstance(sid, str) or not isinstance(gn, int) or isinstance(gn, bool) or not isinstance(data.get("won"), bool):
            raise Invalid("A report is {series, n, won, score, delta}.")
        with self.s.db.transaction() as c:
            r = c.execute("SELECT team_id, data FROM pa_series WHERE id=?", (sid,)).fetchone()
            if not r or team_of(c, aid) != r[0]:
                raise Invalid("That series isn't your team's.")
            sr = json.loads(r[1])
            if not 1 <= gn <= len(sr["games"]):
                raise Invalid("That series game isn't on.")
            if data.get("forfeit") and data.get("alone") is not True:
                return {"series": series_public(sr), "counted": False}
            sc = data.get("score")
            score = [int(sc[0]), int(sc[1])] if isinstance(sc, list) and len(sc) == 2 and all(isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 999 for v in sc) else [0, 0]
            delta = max(-FORFEIT_RP, min(RP_MAX, int(data["delta"]))) if isinstance(data.get("delta"), int) and not isinstance(data.get("delta"), bool) else 0
            was = sr["games"][gn - 1]["result"]
            char = {"id": str(data.get("character_id") or "")[:64] or None, "remote": True}
            out = self.series_result(c, aid, char, {"series": sid, "n": gn}, data["won"], {"score": score}, delta, now)
            return {"series": out, "counted": was is None}

    def settle_online(self, c, aid, items, season_n):
        """On a player's own service: his online team's series that ended (the hub's status "settle"), each once, on
        the build that played in it: a win moves it up from the series' division and pays the bonus, a loss puts it at
        0 RP (down a division from 0). -> [{series, outcome, ...the move}]"""
        out = []
        for it in (items if isinstance(items, list) else [])[:10]:
            if not isinstance(it, dict) or it.get("outcome") not in ("won", "lost") or not isinstance(it.get("series"), str) or not isinstance(it.get("character_id"), str):
                continue
            sid, div = it["series"][:64], builds.integer(it.get("div", 0), 0, TOP, "div")
            row = c.execute("SELECT data FROM characters WHERE id=? AND account_id=?", (it["character_id"], aid)).fetchone()
            if not row:
                continue
            ch = json.loads(row[0])
            done = ch.setdefault("progression", {}).setdefault("pa_online", [])
            if sid in done:
                continue
            pa, _ = player_state(ch, season_n)
            move = series_won_player(pa, div) if it["outcome"] == "won" else series_lost_player(pa)
            items_got = self.give(c, aid, rank_items_for(pa["high"]))
            bonus = series_bonus(div) if it["outcome"] == "won" else 0
            if bonus:
                self.s.db.change_wallet(c, aid, bonus, "proam_series", f"pa_series:{sid}")
            done.append(sid)
            del done[:-50]
            c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(ch), ch["id"]))
            out.append({"series": sid, "outcome": it["outcome"], "bonus": bonus, "items": items_got, **move})
        return out


def series_public(sr):
    if not sr:
        return None
    out = {k: sr.get(k) for k in ("id", "team_id", "season", "div", "status", "length", "need", "wins", "losses", "games", "refreshes", "picks", "bonus", "moved")}
    out["division"] = div_info(sr["div"])
    out["refreshes_left"] = DRAFT_REFRESHES - sr.get("refreshes", 0)
    if "draft_state" in sr:
        out["draft"] = sr["draft_state"]
    return out
