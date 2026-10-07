"""Server-owned progression: result validation, VC rewards, Rep tiers, badge progress, Pro-Am teams.

The match itself is simulated in the client at 60 Hz (for responsiveness). The server issues a seeded
ticket, then checks the submitted summary for internal consistency and plausibility before paying
anything. Rewards, Rep and badges are computed here, never trusted from the client.
"""
import re
import time
from .builds import Invalid, strict_keys, integer

MODES = {"park": {"formats": (1, 2, 3), "min_seconds": 40}, "proam": {"formats": (5,), "min_seconds": 120}, "practice": {"formats": (1,), "min_seconds": 0}}
AFFILIATIONS = ("harbor", "brick", "foundry")
PARK_VENUES = AFFILIATIONS
STAT_KEYS = ("pts", "reb", "oreb", "ast", "stl", "blk", "tov", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "pf",
             "dunks", "greens", "ankles", "contested_makes", "posters", "putbacks", "chasedowns", "alleyoops")
STAT_CAPS = {"pts": 150, "reb": 60, "oreb": 40, "ast": 50, "stl": 30, "blk": 30, "tov": 40, "fgm": 60, "fga": 120, "tpm": 40, "tpa": 80,
             "ftm": 40, "fta": 50, "pf": 10, "dunks": 40, "greens": 80, "ankles": 20, "contested_makes": 60, "posters": 20, "putbacks": 30,
             "chasedowns": 20, "alleyoops": 30}

REP_TIERS = ("Rookie", "Pro", "All-Star", "Superstar", "Legend")
# cumulative rep needed for level i (0 = Rookie 1 … 20 = Legend)
REP_THRESHOLDS = [int(round(160 * (i ** 1.55))) for i in range(21)]

BADGES = {
    "deadeye": {"name": "Deadeye", "group": "Shooting", "stat": "contested_makes", "tiers": (12, 40, 100, 220), "desc": "Contested jumpers are less affected by the defender."},
    "catch_shoot": {"name": "Catch & Shoot", "group": "Shooting", "stat": "tpm", "tiers": (15, 50, 120, 260), "desc": "Boost on jumpers taken right off the catch."},
    "corner_specialist": {"name": "Corner Specialist", "group": "Shooting", "stat": "tpm", "tiers": (25, 70, 160, 320), "desc": "Boost on corner threes."},
    "limitless": {"name": "Limitless Range", "group": "Shooting", "stat": "tpm", "tiers": (30, 90, 200, 400), "desc": "Extends range on deep threes."},
    "green_machine": {"name": "Green Machine", "group": "Shooting", "stat": "greens", "tiers": (20, 70, 180, 400), "desc": "Wider Excellent release window."},
    "clutch": {"name": "Clutch Shooter", "group": "Shooting", "stat": "fgm", "tiers": (40, 120, 280, 550), "desc": "Boost on shots late in close games."},
    "posterizer": {"name": "Posterizer", "group": "Finishing", "stat": "dunks", "tiers": (8, 30, 80, 180), "desc": "Better odds to dunk on contesting defenders."},
    "contact_finisher": {"name": "Contact Finisher", "group": "Finishing", "stat": "fgm", "tiers": (30, 100, 250, 500), "desc": "Contested layups are less affected."},
    "acrobat": {"name": "Acrobat", "group": "Finishing", "stat": "fgm", "tiers": (45, 130, 300, 600), "desc": "Boost on heavily contested layups."},
    "ankle_breaker": {"name": "Ankle Breaker", "group": "Playmaking", "stat": "ankles", "tiers": (3, 12, 30, 70), "desc": "Dribble moves drop defenders more often."},
    "dimer": {"name": "Dimer", "group": "Playmaking", "stat": "ast", "tiers": (25, 80, 200, 420), "desc": "Teammates shoot better off your passes."},
    "handles_for_days": {"name": "Handles for Days", "group": "Playmaking", "stat": "games", "tiers": (10, 30, 80, 160), "desc": "Dribble moves cost less stamina."},
    "pick_pocket": {"name": "Pick Pocket", "group": "Defense", "stat": "stl", "tiers": (15, 50, 120, 250), "desc": "Better steal odds and faster reach recovery."},
    "interceptor": {"name": "Interceptor", "group": "Defense", "stat": "stl", "tiers": (20, 60, 150, 300), "desc": "Deflect and pick off more passes."},
    "rim_protector": {"name": "Rim Protector", "group": "Defense", "stat": "blk", "tiers": (10, 35, 90, 200), "desc": "More blocks at the rim."},
    "chasedown": {"name": "Chase-Down Artist", "group": "Defense", "stat": "blk", "tiers": (15, 50, 120, 250), "desc": "Blocks from behind on breakaways."},
    "brick_wall": {"name": "Brick Wall", "group": "Defense", "stat": "games", "tiers": (10, 35, 90, 180), "desc": "Screens and bumps hit harder."},
    "rebound_chaser": {"name": "Rebound Chaser", "group": "Rebounding", "stat": "reb", "tiers": (40, 140, 350, 700), "desc": "Track down more boards."},
}


def rep_level(points):
    lvl = 0
    for i, need in enumerate(REP_THRESHOLDS):
        if points >= need:
            lvl = i
    return lvl


def rep_label(level):
    if level >= 20:
        return "Legend"
    return f"{REP_TIERS[level // 5]} {level % 5 + 1}"


def rep_info(points):
    lvl = rep_level(points)
    nxt = REP_THRESHOLDS[lvl + 1] if lvl + 1 < len(REP_THRESHOLDS) else None
    return {"points": points, "level": lvl, "label": rep_label(lvl), "floor": REP_THRESHOLDS[lvl], "next": nxt}


def badge_tiers(char):
    return {k: v.get("tier", 0) for k, v in char.get("badges", {}).items() if v.get("tier", 0) > 0}


def validate_summary(data, ticket):
    """Return a sanitized summary or raise Invalid."""
    strict_keys(data, ("mode", "score", "winner", "duration", "quarter", "players", "me", "forfeit"))
    mode = ticket["mode"]
    if data.get("mode") != mode:
        raise Invalid("Result does not match the game that was started.")
    score = data.get("score")
    if not (isinstance(score, list) and len(score) == 2 and all(isinstance(s, int) and 0 <= s <= 250 for s in score)):
        raise Invalid("Invalid score.")
    duration = integer(data.get("duration", 0), 0, 4 * 3600, "Duration")
    me = data.get("me")
    if not isinstance(me, dict):
        raise Invalid("Missing your stat line.")
    strict_keys(me, ("team", "stats"))
    team = me.get("team")
    if team not in (0, 1):
        raise Invalid("Invalid team.")
    stats = me.get("stats")
    if not isinstance(stats, dict):
        raise Invalid("Invalid stats.")
    clean = {}
    for k in STAT_KEYS:
        v = stats.get(k, 0)
        clean[k] = integer(v, 0, STAT_CAPS[k], k)
    if clean["fgm"] > clean["fga"] or clean["tpm"] > clean["tpa"] or clean["tpa"] > clean["fga"] or clean["ftm"] > clean["fta"] or clean["oreb"] > clean["reb"]:
        raise Invalid("Inconsistent shooting or rebounding numbers.")
    if clean["pts"] != 2 * clean["fgm"] + clean["tpm"] + clean["ftm"]:
        raise Invalid("Points do not add up.")
    if clean["pts"] > score[team]:
        raise Invalid("Player scored more than the team.")
    winner = data.get("winner")
    forfeit = bool(data.get("forfeit", False))
    if mode == "park":
        target = ticket["meta"].get("target", 21)
        if not forfeit:
            if max(score) < target or winner not in (0, 1) or score[winner] < score[1 - winner]:
                raise Invalid("A park game ends when a team reaches the target score.")
            min_secs = max(MODES["park"]["min_seconds"], (max(score) // 3) * 4)
            if duration < min_secs:
                raise Invalid("That game finished faster than a real game can.")
    elif mode == "proam":
        if not forfeit:
            if winner not in (0, 1) or score[0] == score[1] or score[winner] < score[1 - winner]:
                raise Invalid("Pro-Am games need a winner.")
            q = ticket["meta"].get("quarter_len", 180) * ticket["meta"].get("quarters", 4)
            if duration < min(q * 0.75, q - 30):
                raise Invalid("That game finished faster than the game clock allows.")
    if forfeit:
        winner = 1 - team
    return {"mode": mode, "score": score, "winner": winner, "duration": duration, "team": team, "stats": clean, "forfeit": forfeit}


def rewards(summary, ticket, char):
    """Compute VC, Rep and badge progress for a validated summary."""
    s = summary["stats"]
    won = summary["winner"] == summary["team"] and not summary["forfeit"]
    mode = summary["mode"]
    if summary["forfeit"]:
        return {"vc": 0, "rep": 0, "won": False, "streak": 0, "badges": {}}
    statline = s["pts"] * 8 + s["ast"] * 10 + s["reb"] * 6 + s["stl"] * 12 + s["blk"] * 12 + s["dunks"] * 5 + s["ankles"] * 15 - s["tov"] * 4
    if mode == "park":
        streak = ticket["meta"].get("streak", 0) + 1 if won else 0
        mult = streak_multiplier(streak) if won else 1.0
        vc = 160 + (180 if won else 40) + max(0, statline)
        vc = min(int(vc * mult), int(2200 * mult))
        rep = (70 if won else 25) + s["pts"] * 2 + s["ast"] * 3 + s["reb"] * 2 + s["stl"] * 3 + s["blk"] * 3 + s["ankles"] * 6 + s["posters"] * 8
        rep = int(rep * mult)
    elif mode == "proam":
        streak = 0
        vc = min(3600, 300 + (300 if won else 80) + max(0, statline))
        rep = int(((50 if won else 20) + s["pts"] + s["ast"] * 2 + s["reb"] + s["stl"] * 2 + s["blk"] * 2) * 0.6)
    else:
        streak, vc, rep = 0, 0, 0
    # badge progress
    gains = {}
    stat_for = dict(s)
    stat_for["games"] = 1
    for bid, b in BADGES.items():
        inc = min(stat_for.get(b["stat"], 0), 40)
        if inc > 0:
            gains[bid] = inc
    out = {"vc": int(vc), "rep": int(max(0, rep)), "won": won, "streak": streak, "badges": gains}
    if mode == "park":
        out["streak_mult"] = streak_multiplier(streak) if won else 1.0
    return out


def apply_progress(char, summary, rw):
    prog = char.setdefault("progression", {})
    prog["games"] = prog.get("games", 0) + 1
    prog["wins"] = prog.get("wins", 0) + (1 if rw["won"] else 0)
    prog["xp"] = prog.get("xp", 0) + 100 + summary["stats"]["pts"] * 5 + summary["stats"]["ast"] * 5
    before = rep_info(prog.get("rep", 0))
    prog["rep"] = prog.get("rep", 0) + rw["rep"]
    after = rep_info(prog["rep"])
    mode = summary["mode"]
    if mode in ("park", "proam"):
        m = prog.setdefault(mode, {"games": 0, "wins": 0})
        m["games"] = m.get("games", 0) + 1
        m["wins"] = m.get("wins", 0) + (1 if rw["won"] else 0)
        if mode == "park":
            m["streak"] = rw["streak"]
            m["best_streak"] = max(m.get("best_streak", 0), rw["streak"])
    career = prog.setdefault("career", {})
    for k, v in summary["stats"].items():
        career[k] = career.get(k, 0) + v
    # v0.4.4: lifetime splits per mode (games played, seconds, wins and the full stat line) for the Stats screen
    # and for the auto-play profile
    if mode in ("park", "proam"):
        split = prog.setdefault("career_modes", {}).setdefault(mode, {"gp": 0, "secs": 0, "wins": 0})
        split["gp"] = split.get("gp", 0) + 1
        split["secs"] = split.get("secs", 0) + int(summary["duration"])
        split["wins"] = split.get("wins", 0) + (1 if rw["won"] else 0)
        for k, v in summary["stats"].items():
            split[k] = split.get(k, 0) + v
    upgraded = []
    badges = char.setdefault("badges", {})
    for bid, inc in rw["badges"].items():
        b = badges.setdefault(bid, {"progress": 0, "tier": 0})
        b["progress"] += inc
        tiers = BADGES[bid]["tiers"]
        new_tier = sum(1 for t in tiers if b["progress"] >= t)
        if new_tier > b["tier"]:
            upgraded.append({"id": bid, "name": BADGES[bid]["name"], "tier": new_tier})
            b["tier"] = new_tier
    return {"rep_before": before, "rep_after": after, "badges_upgraded": upgraded}


HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
LOGOS = ("circle", "shield", "diamond", "hex", "star", "crown", "bolt")

# ---------------- v0.4.2: park win-streak multiplier ----------------
def streak_multiplier(streak):
    """VC and Rep multiplier for a park win: 1.0 for the first win, +0.15 per extra straight win, up to 2.5x."""
    return round(1 + 0.15 * min(10, max(0, streak - 1)), 2)


# ---------------- v0.4.2: daily rewards wheel ----------------
# 12 slices on the wheel; five VC tiers plus exclusive gear and animations (wheel-only catalog items).
WHEEL_SEGMENTS = ("vc500", "gear", "vc2500", "vc10000", "anim", "vc500", "vc50000", "gear", "vc2500", "anim", "vc10000", "vc250000")
WHEEL_ODDS = {"vc500": 34.0, "vc2500": 26.0, "vc10000": 14.0, "vc50000": 4.0, "vc250000": 0.2, "gear": 12.0, "anim": 9.8}
WHEEL_VC = {"vc500": 500, "vc2500": 2500, "vc10000": 10000, "vc50000": 50000, "vc250000": 250000}
SPIN_COOLDOWN = 24 * 3600


def spin_wheel(rng, catalog, owned):
    """Server-side roll. rng: random.Random-like. Returns {segment, kind, vc, item}."""
    kinds = list(WHEEL_ODDS)
    kind = rng.choices(kinds, weights=[WHEEL_ODDS[k] for k in kinds])[0]
    item = None
    if kind in ("gear", "anim"):
        want_anim = kind == "anim"
        pool = sorted(i for i, it in catalog.items() if it.get("exclusive") == "wheel" and (it["category"] == "animation") == want_anim and i not in owned)
        if not pool:  # already own every exclusive of that kind: pay out VC instead
            kind = "vc10000"
        else:
            item = rng.choice(pool)
    segment = rng.choice([i for i, k in enumerate(WHEEL_SEGMENTS) if k == kind])
    return {"segment": segment, "kind": kind, "vc": WHEEL_VC.get(kind, 0), "item": item}


# ---------------- v0.4.2: boosts (2K17-style, per attribute category) ----------------
BOOSTS = {
    "shooting": {"name": "Shooting", "attrs": ("close_shot", "mid_range", "three_point", "free_throw")},
    "finishing": {"name": "Finishing", "attrs": ("layup", "driving_dunk", "standing_dunk", "post_control")},
    "playmaking": {"name": "Playmaking", "attrs": ("ball_handle", "speed_with_ball", "pass_accuracy")},
    "defense": {"name": "Defense", "attrs": ("perimeter_d", "interior_d", "steal", "block")},
    "rebounding": {"name": "Rebounding", "attrs": ("off_rebound", "def_rebound")},
    "athleticism": {"name": "Athleticism", "attrs": ("speed", "acceleration", "vertical", "strength", "stamina")},
}
BOOST_AMOUNT = 5
BOOST_PACKS = {1: 600, 3: 1500, 5: 2250}  # games -> VC
BOOST_MAX_GAMES = 10
WOODS = ("natural", "blonde", "dark")


def proam_team(data):
    strict_keys(data, ("name", "abbr", "primary", "secondary", "logo", "wood", "roster_seed"))
    name = data.get("name", "")
    abbr = data.get("abbr", "")
    if not isinstance(name, str) or not 2 <= len(name.strip()) <= 22 or any(ord(c) < 32 for c in name):
        raise Invalid("Team name must be 2-22 printable characters.")
    if not isinstance(abbr, str) or not re.fullmatch(r"[A-Za-z0-9]{2,4}", abbr):
        raise Invalid("Abbreviation must be 2-4 letters or numbers.")
    primary, secondary = data.get("primary", "#2457c5"), data.get("secondary", "#f2c14e")
    if not (isinstance(primary, str) and HEX.match(primary) and isinstance(secondary, str) and HEX.match(secondary)):
        raise Invalid("Team colors must be #RRGGBB.")
    logo, wood = data.get("logo", "circle"), data.get("wood", "natural")
    if logo not in LOGOS or wood not in WOODS:
        raise Invalid("Choose a supported logo and floor.")
    seed = integer(data.get("roster_seed", 1), 1, 2 ** 31 - 1, "Roster seed")
    return {"name": name.strip(), "abbr": abbr.upper(), "primary": primary.lower(), "secondary": secondary.lower(), "logo": logo, "wood": wood, "roster_seed": seed}


# ---------------- v0.4.4: locker codes ----------------
# code -> reward. Codes are matched case-insensitively with spaces removed. Each has a per-account limit.
LOCKER_CODES = {
    "HELP-I-NEED-VC": {"vc": 250000, "max_per_account": 3, "label": "250,000 VC"},
}


def normalize_code(code):
    if not isinstance(code, str):
        return ""
    return re.sub(r"\s+", "", code).upper()[:40]


# ---------------- v0.4.4: persistent AI world ----------------
AI_ID = re.compile(r"^ai-[0-9]{1,4}$")


def ai_world(world):
    """Sanitize the client's AI-world state: the seed of this account's AI population, friends, the current
    squad, and who you've played with (games together, last seen)."""
    if not isinstance(world, dict):
        raise Invalid("Invalid social data.")
    seed = world.get("seed")
    if isinstance(seed, bool) or not isinstance(seed, int) or not (1 <= seed < 2 ** 31):
        raise Invalid("Invalid social data.")
    ids = lambda v, n: [x for x in (v if isinstance(v, list) else []) if isinstance(x, str) and AI_ID.match(x)][:n]
    friends = list(dict.fromkeys(ids(world.get("friends"), 200)))
    squad = [x for x in dict.fromkeys(ids(world.get("squad"), 4)) if x in friends]
    met = {}
    raw = world.get("met") if isinstance(world.get("met"), dict) else {}
    count = lambda v: int(v) if isinstance(v, int) and not isinstance(v, bool) and 0 <= v < 100000 else 0
    # keep the most recent 400 players you've shared a court with
    items = [(k, v) for k, v in raw.items() if AI_ID.match(str(k)) and isinstance(v, dict)]
    stamp = lambda v: float(v.get("last")) if isinstance(v.get("last"), (int, float)) and not isinstance(v.get("last"), bool) and 0 <= v.get("last") < 1e13 else 0.0
    items.sort(key=lambda kv: stamp(kv[1]), reverse=True)
    for k, v in items[:400]:
        met[k] = {"games": count(v.get("games")), "with": count(v.get("with")), "vs": count(v.get("vs")),
                  "wins": count(v.get("wins")), "last": stamp(v)}
    born = world.get("born")
    born = float(born) if isinstance(born, (int, float)) and not isinstance(born, bool) and 0 < born < 1e13 else time.time() * 1000
    return {"seed": seed, "born": born, "friends": friends, "squad": squad, "met": met}
