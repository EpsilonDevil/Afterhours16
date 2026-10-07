"""Build legality for v0.3 (mirrors client/js/sim/builds.js and ratings.js — keep in sync).

Positions + archetypes + body (height/weight/wingspan) set per-attribute caps. Players buy
attribute points with VC up to those caps. v0.2 characters (9 attributes) are upgraded in place.
"""
import math

POSITIONS = {"PG": (67, 79), "SG": (70, 80), "SF": (75, 82), "PF": (77, 84), "C": (80, 87)}
STYLES = ("inside", "balanced", "outside")  # legacy v0.2
ARCHETYPES = ("sharpshooter", "slasher", "playmaker", "lockdown", "two_way", "glass_cleaner", "stretch_big", "post_scorer")
STYLE_TO_ARCH = {"outside": "sharpshooter", "balanced": "two_way", "inside": "slasher"}
ATTRIBUTES = (
    "close_shot", "mid_range", "three_point", "free_throw",
    "layup", "driving_dunk", "standing_dunk", "post_control",
    "ball_handle", "speed_with_ball", "pass_accuracy",
    "perimeter_d", "interior_d", "steal", "block",
    "off_rebound", "def_rebound",
    "speed", "acceleration", "vertical", "strength", "stamina",
)
LEGACY_ATTRIBUTES = ("shooting", "finishing", "dunk", "handle", "passing", "defense", "rebound", "speed", "stamina")
SKIN = ("#efc5a2", "#d9a77c", "#bc865e", "#a56945", "#875332", "#69432e", "#513528", "#3d2b24")
HAIR = ("crop", "curls", "buzz", "bald", "fade", "twists", "high_top", "cornrows", "waves")
HAIR_COLORS = ("#201b19", "#493021", "#85502e", "#c39a58", "#c5c1b6")
FACES = ("oval", "square", "angular", "round")
BEARDS = ("none", "stubble", "goatee", "full")
EYES = ("#3a2418", "#5a3a22", "#2f4a5a", "#3d5a3a", "#1d1a18")
DEFAULT_EQUIPMENT = {"top": "yard_teal", "bottom": "yard_shorts", "shoes": "yard_shoes", "release": "release_classic",
                     "jumpshot": "js_base_standard", "dunk": "dunk_basic", "sizeup": "sizeup_basic"}
EQUIP_SLOTS = ("top", "bottom", "shoes", "socks", "headband", "sleeve", "leg_sleeve", "wristband", "knee_pad", "chain",
               "release", "jumpshot", "dunk", "sizeup", "celebration")
OPTIONAL_SLOTS = tuple(s for s in EQUIP_SLOTS if s not in DEFAULT_EQUIPMENT)

ARCH_SCALE = 1.12  # v0.4.3 1.4; v0.4.4 strengths/weaknesses 20% smaller
ARCH_BONUS = {
    "sharpshooter": {"three_point": 12, "mid_range": 10, "free_throw": 8, "close_shot": 2, "layup": -6, "driving_dunk": -10, "standing_dunk": -8, "post_control": -6, "interior_d": -8, "block": -8, "off_rebound": -6, "def_rebound": -6, "strength": -4},
    "slasher": {"layup": 10, "driving_dunk": 14, "close_shot": 4, "speed": 4, "acceleration": 4, "vertical": 6, "three_point": -12, "mid_range": -4, "free_throw": -4, "pass_accuracy": -4, "post_control": -2},
    "playmaker": {"ball_handle": 10, "pass_accuracy": 12, "speed_with_ball": 8, "three_point": 2, "driving_dunk": -6, "block": -8, "off_rebound": -6, "def_rebound": -6, "strength": -6, "post_control": -6, "interior_d": -6},
    "lockdown": {"perimeter_d": 12, "steal": 10, "speed": 2, "acceleration": 3, "stamina": 3, "three_point": -6, "mid_range": -4, "ball_handle": -6, "pass_accuracy": -4, "post_control": -4},
    "two_way": {"perimeter_d": 2, "steal": 2, "mid_range": 2, "layup": 2, "ball_handle": -2, "pass_accuracy": -2, "block": -2, "post_control": -2},
    "glass_cleaner": {"off_rebound": 12, "def_rebound": 12, "block": 8, "interior_d": 8, "strength": 6, "three_point": -16, "mid_range": -10, "ball_handle": -10, "speed_with_ball": -8, "free_throw": -8},
    "stretch_big": {"three_point": 12, "mid_range": 8, "free_throw": 6, "post_control": -6, "standing_dunk": -8, "strength": -6, "off_rebound": -8, "block": -4},
    "post_scorer": {"post_control": 14, "close_shot": 10, "standing_dunk": 6, "strength": 6, "three_point": -12, "ball_handle": -8, "speed": -4, "speed_with_ball": -6},
}
OVERALL_WEIGHTS = {
    "PG": {"three_point": 2, "mid_range": 1.5, "ball_handle": 2.4, "pass_accuracy": 2.2, "speed_with_ball": 1.6, "speed": 1.4, "acceleration": 1.3, "perimeter_d": 1.2, "steal": 1.2, "layup": 1.2, "close_shot": 0.6, "free_throw": 0.6},
    "SG": {"three_point": 2.4, "mid_range": 2, "ball_handle": 1.5, "pass_accuracy": 1, "speed_with_ball": 1.1, "speed": 1.3, "acceleration": 1.2, "perimeter_d": 1.4, "steal": 1.1, "layup": 1.4, "driving_dunk": 0.8, "free_throw": 0.6},
    "SF": {"three_point": 1.6, "mid_range": 1.6, "layup": 1.5, "driving_dunk": 1.3, "ball_handle": 1.1, "perimeter_d": 1.6, "interior_d": 0.8, "steal": 1, "block": 0.8, "speed": 1.1, "vertical": 1, "strength": 0.8, "def_rebound": 0.8},
    "PF": {"close_shot": 1.6, "mid_range": 1.2, "layup": 1.2, "standing_dunk": 1.4, "driving_dunk": 1, "post_control": 1.4, "interior_d": 1.8, "block": 1.4, "def_rebound": 1.8, "off_rebound": 1.5, "strength": 1.4, "vertical": 0.8},
    "C": {"close_shot": 1.8, "standing_dunk": 1.8, "post_control": 1.6, "interior_d": 2.2, "block": 2, "def_rebound": 2.2, "off_rebound": 1.8, "strength": 1.6, "layup": 0.8, "vertical": 0.7},
}


class Invalid(ValueError):
    pass


def jround(x):
    """Match JavaScript Math.round (half rounds up)."""
    return int(math.floor(x + 0.5))


def strict_keys(data, allowed):
    if not isinstance(data, dict) or set(data) - set(allowed):
        raise Invalid("Unsupported fields in request.")


def integer(value, low, high, name):
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise Invalid(f"{name} must be an integer from {low} to {high}.")
    return value


def appearance(data):
    strict_keys(data, ("skin", "hair", "number", "hair_color", "face", "beard", "eyes"))
    skin, hair = data.get("skin", SKIN[3]), data.get("hair", "crop")
    if skin not in SKIN or hair not in HAIR:
        raise Invalid("Choose a supported skin tone and hairstyle.")
    hair_color, face, beard, eyes = data.get("hair_color", HAIR_COLORS[0]), data.get("face", "oval"), data.get("beard", "none"), data.get("eyes", EYES[0])
    if hair_color not in HAIR_COLORS or face not in FACES or beard not in BEARDS or eyes not in EYES:
        raise Invalid("Choose a supported hair color, face shape, facial hair and eye color.")
    return {"skin": skin, "hair": hair, "hair_color": hair_color, "face": face, "beard": beard, "eyes": eyes,
            "number": integer(data.get("number", 16), 0, 99, "Jersey number")}


def spec(data):
    strict_keys(data, ("name", "position", "style", "archetype", "height", "weight", "wingspan", "hand", "appearance"))
    name = data.get("name", "Rookie")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 24 or any(ord(c) < 32 for c in name):
        raise Invalid("Player name must be 1-24 printable characters.")
    position = data.get("position", "PG")
    if position not in POSITIONS:
        raise Invalid("Choose a legal position.")
    archetype = data.get("archetype") or STYLE_TO_ARCH.get(data.get("style", "balanced"), "two_way")
    if archetype not in ARCHETYPES:
        raise Invalid("Choose a supported archetype.")
    lo, hi = POSITIONS[position]
    height = integer(data.get("height", max(lo, 75)), lo, hi, "Height")
    weight = integer(data.get("weight", 190), 150, 300, "Weight")
    wingspan = integer(data.get("wingspan", height + 3), height - 1, height + 8, "Wingspan")
    hand = data.get("hand", "R")
    if hand not in ("R", "L"):
        raise Invalid("Shooting hand must be R or L.")
    style = {"sharpshooter": "outside", "stretch_big": "outside", "slasher": "inside", "glass_cleaner": "inside", "post_scorer": "inside"}.get(archetype, "balanced")
    return {"name": name.strip(), "position": position, "archetype": archetype, "style": style, "height": height,
            "weight": weight, "wingspan": wingspan, "hand": hand, "appearance": appearance(data.get("appearance", {}))}


def caps(b):
    big = (b["height"] - 67) / 20
    heavy = (b["weight"] - 200) / 100
    wing = max(-0.8, min(1, (b["wingspan"] - b["height"] - 3) / 5))
    c = {
        "close_shot": 80 + big * 8, "mid_range": 84 - big * 8, "three_point": 84 - big * 14 - wing * 3, "free_throw": 84 - big * 6,
        "layup": 86 - big * 4 - heavy * 4, "driving_dunk": 74 + big * 10 - heavy * 6 + wing * 2, "standing_dunk": 55 + big * 35 + heavy * 4, "post_control": 60 + big * 25 + heavy * 6,
        "ball_handle": 90 - big * 24, "speed_with_ball": 90 - big * 22 - heavy * 8, "pass_accuracy": 88 - big * 14,
        "perimeter_d": 84 - big * 12 + wing * 4, "interior_d": 62 + big * 30 + heavy * 4 + wing * 3, "steal": 82 - big * 10 + wing * 3, "block": 55 + big * 35 + wing * 5,
        "off_rebound": 55 + big * 35 + heavy * 3, "def_rebound": 58 + big * 35 + heavy * 3,
        "speed": 92 - big * 20 - heavy * 10, "acceleration": 92 - big * 20 - heavy * 8, "vertical": 85 - big * 10 - heavy * 10, "strength": 50 + big * 25 + heavy * 25, "stamina": 92 - heavy * 5,
    }
    arch = b.get("archetype") or STYLE_TO_ARCH.get(b.get("style"), "two_way")
    bonus = ARCH_BONUS.get(arch, {})
    # archetype strengths and weaknesses are scaled by ARCH_SCALE (same on the client)
    return {k: max(40, min(99, jround(c[k] + bonus.get(k, 0) * ARCH_SCALE))) for k in ATTRIBUTES}


def starting_attributes(b):
    return {k: max(35, jround(v * 0.72)) for k, v in caps(b).items()}


def overall(attributes, position="SF"):
    w = OVERALL_WEIGHTS.get(position, OVERALL_WEIGHTS["SF"])
    s = t = 0.0
    for k in ATTRIBUTES:
        wk = w.get(k, 0.45)
        s += attributes.get(k, 50) * wk
        t += wk
    raw = s / t
    return jround(max(40, min(99, 40 + (raw - 40) * 1.18)))


def upgrade_cost(current, target):
    return sum(150 + (level - 40) * 16 for level in range(current, target))


def quote(character, targets):
    strict_keys(targets, ATTRIBUTES)
    limit = caps(character)
    total = 0
    out = dict(character["attributes"])
    for key, value in targets.items():
        integer(value, out[key], limit[key], key)
        total += upgrade_cost(out[key], value)
        out[key] = value
    return total, out


def max_targets(character):
    """Targets that raise every attribute to its cap (only attributes below cap)."""
    limit = caps(character)
    return {k: v for k, v in limit.items() if character["attributes"].get(k, 0) < v}


def normalize(char):
    """Upgrade a v0.2 character (9 attributes) to the v0.3 schema in place. Idempotent."""
    if char.get("schema") == 3:
        char.setdefault("badges", {})
        char.setdefault("affiliation", None)
        return char
    old = char.get("attributes", {})
    if "archetype" not in char:
        char["archetype"] = STYLE_TO_ARCH.get(char.get("style", "balanced"), "two_way")
    char.setdefault("hand", "R")
    ap = char.setdefault("appearance", {})
    ap.setdefault("hair_color", HAIR_COLORS[0]); ap.setdefault("face", "oval"); ap.setdefault("beard", "none"); ap.setdefault("eyes", EYES[0])
    if ap.get("hair") not in HAIR:
        ap["hair"] = "crop"
    if any(k in old for k in LEGACY_ATTRIBUTES) and not all(k in old for k in ATTRIBUTES):
        g = lambda k, d=50: old.get(k, d)
        mapped = {
            "close_shot": (g("shooting") + g("finishing")) // 2, "mid_range": g("shooting"), "three_point": g("shooting"), "free_throw": g("shooting"),
            "layup": g("finishing"), "driving_dunk": g("dunk"), "standing_dunk": g("dunk") - 4, "post_control": (g("finishing") + g("rebound")) // 2,
            "ball_handle": g("handle"), "speed_with_ball": (g("handle") + g("speed")) // 2, "pass_accuracy": g("passing"),
            "perimeter_d": g("defense"), "interior_d": (g("defense") + g("rebound")) // 2, "steal": g("defense") - 2, "block": (g("defense") + g("rebound")) // 2 - 2,
            "off_rebound": g("rebound") - 2, "def_rebound": g("rebound"),
            "speed": g("speed"), "acceleration": g("speed"), "vertical": (g("dunk") + g("speed")) // 2, "strength": (g("rebound") + 55) // 2, "stamina": g("stamina"),
        }
        start = starting_attributes(char)
        cap = caps(char)
        char["attributes"] = {k: max(start[k], min(cap[k], mapped[k])) for k in ATTRIBUTES}
    elif not all(k in old for k in ATTRIBUTES):
        start = starting_attributes(char)
        char["attributes"] = {k: old.get(k, start[k]) for k in ATTRIBUTES}
    eq = char.setdefault("equipment", {})
    for slot, default in DEFAULT_EQUIPMENT.items():
        eq.setdefault(slot, default)
    prog = char.setdefault("progression", {})
    prog.setdefault("games", 0); prog.setdefault("wins", 0); prog.setdefault("xp", 0); prog.setdefault("rep", 0)
    prog.setdefault("park", {"games": 0, "wins": 0, "streak": 0, "best_streak": 0})
    prog.setdefault("proam", {"games": 0, "wins": 0})
    prog.setdefault("career", {})
    prog.setdefault("career_modes", {})
    char.setdefault("badges", {})
    char.setdefault("affiliation", None)
    char["schema"] = 3
    return char


def describe(char):
    """Derived (non-persisted) fields for clients."""
    cap = caps(char)
    return {"caps": cap, "overall": overall(char["attributes"], char["position"]),
            "max_overall": overall(cap, char["position"]),
            "max_upgrade_cost": quote(char, max_targets(char))[0]}
