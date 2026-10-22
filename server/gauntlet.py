"""v0.4.8.9 The Gauntlet, the server's side (docs/GAUNTLET.md §1, §8, §11, §12).

* Runs: issued at start (an id and a seed: the server's, or one it checks), paid once at finish. The deck engine
  (client/js/deck/, pure and seeded) plays the run on the player's screen; it's JavaScript, and this service ships
  without a JavaScript runtime (Windows players run the Python service alone), so the server doesn't replay the run.
  It checks what it can without the engine: the summary is the run's (its seed, its player), its counts hang together
  (a phase's boss beaten to reach the next, the Final only after three, nothing past the bracket's size), and it took
  at least the real time its progress needs. Then it pays from the counts itself (never the summary's own VC figure),
  capped per run and by the real time it took.
* VC (§11): ~140 a won match, ~300 a Rival, ~900 a phase boss, ~2,000 the Final; a completed run comes to the cap,
  RUN_CAP. A failed run keeps what it earned (there is no separate completion bonus: the counts of a completed run
  already reach the cap, as the deck agent's balance harness shows: deck/rewards.js VC).

  Calibration against the park (progression.rewards, VC_K 1.35): a park game to 21 pays (160 + 180 + statline) * 1.35
  for a win, about 800 with a typical ~250 statline, and (160 + 40 + statline) * 1.35 for a loss, about 540: about 670 a
  game at an even record, with no streak. A game to 21 takes about 7-9 real minutes with the check-ball and the walk to
  the next one, so the park pays about 4,500-5,700 VC an hour flat, and much more on a streak (x1.3 to x4 on wins; x1.075
  to x1.75 at event parks from v0.4.8.9). A completed Gauntlet run (45-75 minutes, GAUNTLET.md §1) pays the 8,000 cap:
  6,400-10,700 an hour, about a park hour with a short streak, for beating a run that most attempts fail. A failed run
  (~3,000 for the harness's good player, ~30 minutes) is ~6,000 an hour, the park's flat rate. And no run pays faster
  than VC_PER_MIN real minutes allow (180 a minute: 10,800 an hour, a good park streak's hour): a completed run reaches
  its cap only after ~45 real minutes, the short end of §1's 45-75.
* Achievements: completed runs and the distinct players they were completed with, for the sacrifice gates (§12).
* The nemesis world (§8): the engine's (deck/nemesis.js worldAfterRun), sent back after each run, checked for size and
  shape (normWorld's fields, here), kept per account with its "word on the street" feed.
* Sacrifices (§12): an ICON 99 build, at the account's next gate (1 completed run; then 3 completed with 3 different
  players; then 5 completed), at most three ever. The build leaves the park for good, as a deleted build does (its slot
  is free; an ICON's kept slot stays the account's), and its data is kept as a converted Gauntlet player. It brings a
  park card: Common +1%, Rare +3%, Legendary +5% to one attribute drawn (seeded by the account, the build and the
  card's number: the same answer every time) from the build's Icon badge stat list (ICON_CARD_STATS, mirroring
  client/js/sim/badges.js ICON_BADGES: The General's "all" is any attribute; Sharp Eye's, which boosts the green
  window and no attribute, Three Point or Mid-Range, as §12 says).
* Park cards work on every build of the account, in park games only (event parks included), never in Pro-Am, the Pro
  Run or crew runs: the game applies them (client/js/sim/player.js applyParkCards, keyed on a park game at a park).
  They're kept on every build of the account (characters.data park_cards), so every game's entry carries them.
"""
import collections
import json
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

from . import builds, cup

Invalid = builds.Invalid


class Conflict(Exception):
    """A run's payout refused by its replay (the service answers 409 with the message and where it went wrong)."""

    def __init__(self, message, detail=None):
        super().__init__(message)
        self.detail = detail or {}


# ---------------- v0.4.8.9 qp1: the replay check (server/verify/gauntlet_replay.mjs) ----------------
# A run's payout is checked by replaying its choices through the deck engine itself, in an optional Node helper: when
# Node is there (on PATH, or RIMRIFT_NODE), the server pays from what the replay earned, and refuses (409) a log that
# doesn't replay or a summary that claims more than it. Without Node (a player-hosted Windows PC, say), or when the
# helper fails or takes too long, it falls back to the count checks and records the run as not verified. RIMRIFT_REPLAY=0
# turns it off. The helper runs sandboxed: no shell, a minimal environment, the repo as its folder, a wall-clock timeout
# (killed when it runs over), on Linux/macOS CPU-seconds and memory limits, its input and output size-capped, and at most
# REPLAY_PARALLEL at a time, never inside the database lock.
ROOT = Path(__file__).resolve().parent.parent
HELPER = ROOT / "server" / "verify" / "gauntlet_replay.mjs"
REPLAY_TIMEOUT = 5.0          # (a completed run replays in ~250 ms with a cold Node)
REPLAY_MAX_IN = 160 * 1024    # (the finish route's own body cap)
REPLAY_MAX_OUT = 64 * 1024
REPLAY_CPU_SECS = 5
REPLAY_DATA_BYTES = 256 * 1024 * 1024
REPLAY_HEAP_MB = 160
REPLAY_PARALLEL = 2
REPLAY_WAIT = 10.0            # (seconds a finish waits for a free slot, then it falls back)
NODE_MIN_MAJOR = 14           # (the engine is plain ES modules; the newest syntax it uses is ?. and ??: Node 14)
MAX_CHOICES = 20000           # (deck/replay.js MAX_CHOICES)
_slots = threading.BoundedSemaphore(REPLAY_PARALLEL)
_node_versions = {}
REPLAY_LOG = collections.deque(maxlen=200)


class ReplayUnavailable(Exception):
    """No replay this time (no Node, too old, off, busy, failed, timed out): the payout falls back to the count checks."""


def log(msg):
    REPLAY_LOG.append(msg)
    print(f"[gauntlet] {msg}", flush=True)


def node_path():
    if str(os.environ.get("RIMRIFT_REPLAY", "1")).strip().lower() in ("0", "off", "false", "no"):
        return None
    p = os.environ.get("RIMRIFT_NODE") or shutil.which("node")
    return p if p and os.path.isfile(p) and os.access(p, os.X_OK) else None


def _env():
    env = {"PATH": os.environ.get("PATH", ""), "NODE_OPTIONS": "", "NODE_NO_WARNINGS": "1"}
    for k in ("SYSTEMROOT", "SystemRoot", "TEMP", "TMP"):  # (what node.exe needs to start on Windows)
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


def _limits():  # (in the child, before node starts: Linux and macOS)
    import resource
    for lim, val in ((resource.RLIMIT_CPU, REPLAY_CPU_SECS), (resource.RLIMIT_DATA, REPLAY_DATA_BYTES), (resource.RLIMIT_CORE, 0), (resource.RLIMIT_FSIZE, 1 << 20)):
        try:
            resource.setrlimit(lim, (val, val))
        except (ValueError, OSError):
            pass


def _spawn(args, payload, timeout):
    kw = {"input": payload, "capture_output": True, "timeout": timeout, "cwd": str(ROOT), "env": _env(), "shell": False}
    if os.name == "posix":
        kw["preexec_fn"] = _limits
    elif hasattr(subprocess, "CREATE_NO_WINDOW"):
        kw["creationflags"] = subprocess.CREATE_NO_WINDOW
    return subprocess.run(args, **kw)  # (on a timeout it kills the helper, then raises TimeoutExpired)


def replay_status():
    """{"on", "node", "version", "why"}: whether replay checks run here (cached per Node path)."""
    p = node_path()
    if not p:
        return {"on": False, "node": None, "version": None, "why": "turned off (RIMRIFT_REPLAY=0)" if str(os.environ.get("RIMRIFT_REPLAY", "1")).strip().lower() in ("0", "off", "false", "no") else "Node.js not found"}
    if p not in _node_versions:
        try:
            v = _spawn([p, "--version"], b"", 5).stdout.decode("ascii", "replace").strip()
        except (OSError, subprocess.SubprocessError):
            v = ""
        _node_versions[p] = v
    v = _node_versions[p]
    m = re.match(r"v(\d+)\.", v)
    if not m:
        return {"on": False, "node": p, "version": v or None, "why": "Node.js didn't start"}
    if int(m.group(1)) < NODE_MIN_MAJOR:
        return {"on": False, "node": p, "version": v, "why": f"Node.js {v} is too old (v{NODE_MIN_MAJOR}+ needed)"}
    return {"on": True, "node": p, "version": v, "why": None}


def replay_banner():
    st = replay_status()
    return f"on (Node.js {st['version']})" if st["on"] else f"off: {st['why']} (runs are checked by their counts)"


_COUNT_KEYS = {"matchesWon": int, "rivals": int, "bosses": int, "final": bool, "turns": int, "cardsPlayed": int, "nonMatchNodes": int, "phase": int, "completed": bool, "over": bool}


def replay_check(start, choices):
    """The run replayed by the helper: {"ok", "counts", "hash", "error", "at"}. Invalid when the input is too big (refused
    before anything starts); ReplayUnavailable when there's no replay to be had (the caller falls back)."""
    payload = json.dumps({"start": start, "choices": choices}, separators=(",", ":")).encode()
    if len(payload) > REPLAY_MAX_IN:
        raise Invalid("That run's log is too big to check.")
    st = replay_status()
    if not st["on"]:
        raise ReplayUnavailable(st["why"])
    if not _slots.acquire(timeout=REPLAY_WAIT):
        raise ReplayUnavailable("every replay slot busy")
    try:
        r = _spawn([st["node"], f"--max-old-space-size={REPLAY_HEAP_MB}", "--disallow-code-generation-from-strings", str(HELPER)], payload, REPLAY_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise ReplayUnavailable(f"timed out after {REPLAY_TIMEOUT:g} s (killed)")
    except (OSError, subprocess.SubprocessError) as e:
        raise ReplayUnavailable(f"couldn't run: {e}")
    finally:
        _slots.release()
    if r.returncode != 0:
        raise ReplayUnavailable(f"exited {r.returncode}: {r.stderr[-300:].decode('utf8', 'replace').strip()}")
    if len(r.stdout) > REPLAY_MAX_OUT:
        raise ReplayUnavailable("answered too much")
    try:
        out = json.loads(r.stdout.decode("utf8").strip().splitlines()[-1])
    except (ValueError, IndexError, UnicodeDecodeError):
        raise ReplayUnavailable("answered something that isn't JSON")
    if not isinstance(out, dict) or not isinstance(out.get("ok"), bool):
        raise ReplayUnavailable("answered the wrong shape")
    c = out.get("counts")
    if out["ok"] and not (isinstance(c, dict) and all(isinstance(c.get(k), t) and not (t is int and isinstance(c.get(k), bool)) for k, t in _COUNT_KEYS.items())):
        raise ReplayUnavailable("answered counts of the wrong shape")
    return {"ok": out["ok"], "counts": c if isinstance(c, dict) else None, "hash": str(out["hash"])[:64] if out.get("hash") is not None else None,
            "error": str(out["error"])[:200] if out.get("error") is not None else None, "at": out["at"] if isinstance(out.get("at"), int) and not isinstance(out.get("at"), bool) else None}

# ---------------- VC (§11) ----------------
VC = {"match": 140, "rival": 300, "boss": 900, "final": 2000}
COMPLETION_BONUS = 0
RUN_CAP = 8000
VC_PER_MIN = 180
# the time a run's progress needs at the least: a won match is several turns of cards (30 s even for a fast player
# with a strong deck), any other node a few seconds
MIN_MATCH_SECS = 30
MIN_NODE_SECS = 3
MAX_RUN_AGE = 7 * 86400  # (a run saved on the screen can be finished days later; a week, then it's gone)
ELAPSED_CAP = 3 * 3600   # (the time cap counts up to three hours of a run)
PHASES = 3
MAX_NODES = PHASES * 14 + 1  # (about 13 rounds a phase plus its boss, and the Final)
SEED_MAX = 2 ** 31 - 1

# ---------------- the nemesis world (§8; deck/nemesis.js normWorld) ----------------
MAX_WORLD_BYTES = 64 * 1024
MAX_CHARS = 120  # (the engine keeps 80)
MAX_FEED = 12
MAX_MEM = 5
REL_KINDS = ("rival", "friend", "mentor", "protege")
CHAR_ID = re.compile(r"^ai-\d{1,9}$")
TRAIT_ID = re.compile(r"^[a-z_]{1,24}$")

# ---------------- sacrifices and park cards (§12) ----------------
GATES = ({"completed": 1, "distinct": 0}, {"completed": 3, "distinct": 3}, {"completed": 5, "distinct": 0})
TIERS = (("common", 0.01), ("rare", 0.03), ("legendary", 0.05))
MAX_SACRIFICES = len(GATES)
ICON_CARD_STATS = {
    "sharp_eye": ("three_point", "mid_range"),
    "hash_slinging": ("driving_dunk", "standing_dunk"),
    "oprah": ("ball_handle", "speed_with_ball", "pass_accuracy"),
    "the_clamp": ("perimeter_d", "steal"),
    "the_general": tuple(builds.ATTRIBUTES),
    "big_brother": ("off_rebound", "def_rebound", "block", "interior_d"),
    "open_arms": ("close_shot", "mid_range", "three_point", "free_throw", "perimeter_d", "interior_d", "steal", "block"),
    "sexy_red": ("layup", "post_control", "close_shot"),
}


def _int(v, lo, hi, name):
    if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
        raise Invalid(f"{name} must be a whole number from {lo} to {hi}.")
    return v


def run_vc(counts):
    """The VC a run's counts pay before the caps: {"matches", "rivals", "bosses", "final", "completion", "raw"}."""
    normal = max(0, counts["matchesWon"] - counts["rivals"] - counts["bosses"] - (1 if counts["final"] else 0))
    parts = {"matches": normal * VC["match"], "rivals": counts["rivals"] * VC["rival"], "bosses": counts["bosses"] * VC["boss"],
             "final": VC["final"] if counts["final"] else 0, "completion": COMPLETION_BONUS if counts["completed"] else 0}
    parts["raw"] = sum(parts.values())
    return parts


def time_cap(elapsed):
    return min(RUN_CAP, int(max(0.0, min(elapsed, ELAPSED_CAP)) / 60 * VC_PER_MIN))


def check_summary(data, run, elapsed):
    """A finished run's summary (deck/run.js runOver: the counts, and .summary with the seed and player), checked against
    the run issued and the time it took -> the counts, or Invalid."""
    if not isinstance(data, dict):
        raise Invalid("The run's summary is missing.")
    inner = data.get("summary") if isinstance(data.get("summary"), dict) else {}
    if "seed" in inner and inner["seed"] != run["seed"]:
        raise Invalid("That summary is from another run.")
    pl = inner.get("player")
    if isinstance(pl, dict) and str(pl.get("id")) != run["player"]["id"]:
        raise Invalid("That summary is another player's.")
    completed = data.get("completed")
    if not isinstance(completed, bool):
        raise Invalid("completed is true or false.")
    final = inner.get("final", completed)
    if not isinstance(final, bool):
        raise Invalid("final is true or false.")
    counts = {"completed": completed, "final": final,
              "phaseReached": _int(data.get("phaseReached"), 1, PHASES + 1, "phaseReached"),
              "nodesCleared": _int(data.get("nodesCleared"), 0, MAX_NODES, "nodesCleared"),
              "matchesWon": _int(data.get("matchesWon"), 0, MAX_NODES, "matchesWon"),
              "rivals": _int(data.get("rivals"), 0, MAX_NODES, "rivals"),
              "bosses": _int(data.get("bosses"), 0, PHASES, "bosses"),
              "durationTurns": _int(data.get("durationTurns", 0), 0, 100000, "durationTurns"),
              "nonMatch": _int(inner.get("nonMatchNodes", 0), 0, MAX_NODES, "nonMatchNodes"),
              "cardsPlayed": _int(inner.get("cardsPlayed", 0), 0, 100000, "cardsPlayed")}
    c = counts
    # (the run's shape: each phase's boss beaten to reach the next one, the Final after the third, and beating it is
    # what completes a run)
    if c["completed"] != c["final"] or (c["completed"] and c["phaseReached"] != PHASES + 1):
        raise Invalid("A run is completed by beating the Final.")
    if c["bosses"] != min(PHASES, c["phaseReached"] - 1):
        raise Invalid("A phase is left by beating its boss.")
    if c["final"] and c["bosses"] != PHASES:
        raise Invalid("The Final comes after the three phase bosses.")
    if c["rivals"] + c["bosses"] + (1 if c["final"] else 0) > c["matchesWon"]:
        raise Invalid("Rivals, bosses and the Final are matches won.")
    if c["matchesWon"] + c["nonMatch"] > c["nodesCleared"] + 1 or c["matchesWon"] > c["nodesCleared"]:
        raise Invalid("More won than was played.")
    if c["matchesWon"] and (c["durationTurns"] < c["matchesWon"] or c["cardsPlayed"] < c["matchesWon"]):
        raise Invalid("A match won takes a turn and a card at the least.")
    need = c["matchesWon"] * MIN_MATCH_SECS + c["nonMatch"] * MIN_NODE_SECS
    if elapsed < need:
        raise Invalid("That run finished faster than it can be played.")
    return counts


# ---------------- the nemesis world ----------------
def _s(v, n):
    return str(v)[:n] if isinstance(v, (str, int, float)) and not isinstance(v, bool) else ""


def _n(v, lo, hi):
    return max(lo, min(hi, int(v))) if isinstance(v, (int, float)) and not isinstance(v, bool) else lo


def clean_world(w):
    """The engine's world as the player's screen sent it (deck/nemesis.js worldAfterRun), checked for size and shape and
    kept to normWorld's fields. -> a clean copy, or Invalid."""
    if not isinstance(w, dict):
        raise Invalid("The Gauntlet world must be an object.")
    if len(json.dumps(w)) > MAX_WORLD_BYTES:
        raise Invalid("The Gauntlet world is too big.")
    chars = w.get("chars", {})
    if not isinstance(chars, dict) or len(chars) > MAX_CHARS:
        raise Invalid("The Gauntlet world's characters must be an object of at most %d." % MAX_CHARS)
    out = {"v": 1, "aiSeed": _n(w.get("aiSeed", 1), 1, 2 ** 32 - 1), "runs": _n(w.get("runs", 0), 0, 10 ** 6), "ticks": _n(w.get("ticks", 0), 0, 10 ** 6),
           "chars": {}, "feed": [x[:200] for x in (w.get("feed") or []) if isinstance(x, str)][-MAX_FEED:] if isinstance(w.get("feed"), list) else []}
    for cid, ch in chars.items():
        if not CHAR_ID.match(str(cid)) or not isinstance(ch, dict):
            raise Invalid("A Gauntlet world character must be an AI player (ai-<n>).")
        rec = ch.get("record") if isinstance(ch.get("record"), dict) else {}
        mems = ch.get("memories") if isinstance(ch.get("memories"), list) else []
        rel = ch.get("rel") if isinstance(ch.get("rel"), dict) else {}
        c = {"id": cid, "name": _s(ch.get("name") or cid, 40), "rank": _n(ch.get("rank", 0), 0, 4),
             "traits": [t for t in (ch.get("traits") or []) if isinstance(t, str) and TRAIT_ID.match(t)][:4] if isinstance(ch.get("traits"), list) else [],
             "memories": [{"k": _s(m.get("k", ""), 24), "text": m["text"][:120], "run": _n(m.get("run", 0), 0, 10 ** 6), "phase": _n(m.get("phase", 0), 0, 4)}
                          for m in mems if isinstance(m, dict) and isinstance(m.get("text"), str)][-MAX_MEM:],
             "record": {"w": _n(rec.get("w", 0), 0, 10 ** 6), "l": _n(rec.get("l", 0), 0, 10 ** 6)},
             "met": _n(ch.get("met", 0), 0, 10 ** 6), "last": _n(ch.get("last", 0), 0, 10 ** 6), "idle": _n(ch.get("idle", 0), 0, 10 ** 6),
             "streak": _n(ch.get("streak", 0), 0, 10 ** 6), "owes": _n(ch.get("owes", 0), 0, 3), "grudge": _n(ch.get("grudge", 0), 0, 3),
             "turned": ch.get("turned") is True,
             "rel": {k: v for k, v in list(rel.items())[:4] if CHAR_ID.match(str(k)) and v in REL_KINDS}}
        if isinstance(ch.get("style"), str) and TRAIT_ID.match(ch["style"]):
            c["style"] = ch["style"]
        out["chars"][cid] = c
    return out


def clean_feed(feed):
    if feed is None:
        return []
    if not isinstance(feed, list) or len(feed) > 40:
        raise Invalid("The word on the street is a list of at most 40 lines.")
    return [x[:200] for x in feed if isinstance(x, str)][:MAX_FEED]


def load_world(c, aid):
    r = c.execute("SELECT data, feed FROM gauntlet_worlds WHERE account_id=?", (aid,)).fetchone()
    return (json.loads(r[0]), json.loads(r[1])) if r else (None, [])


def save_world(c, aid, world, feed, now):
    c.execute("INSERT INTO gauntlet_worlds(account_id, data, feed, updated_at) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET data=excluded.data, feed=excluded.feed, updated_at=excluded.updated_at",
              (aid, json.dumps(world, separators=(",", ":")), json.dumps(feed), now))


# ---------------- achievements, gates, park cards ----------------
def achievements(c, aid):
    done = [json.loads(r[0]) for r in c.execute("SELECT player FROM gauntlet_runs WHERE account_id=? AND status='completed'", (aid,))]
    return {"completed": len(done), "distinctCompleted": len({p["id"] for p in done})}


def park_cards(c, aid):
    return [{"n": r[0], "tier": r[1], "attr": r[2], "pct": r[3], "character_id": r[4], "name": r[5], "icon": r[6], "at": r[7]}
            for r in c.execute("SELECT n, tier, attr, pct, character_id, name, icon, created_at FROM park_cards WHERE account_id=? ORDER BY n", (aid,))]


def entry_cards(cards):
    """What the game applies (sim/player.js applyParkCards): [{attr, pct}]."""
    return [{"attr": k["attr"], "pct": k["pct"]} for k in cards]


def unlocks(c, aid):
    a = achievements(c, aid)
    n = c.execute("SELECT count(*) FROM park_cards WHERE account_id=?", (aid,)).fetchone()[0]
    nxt = None
    if n < MAX_SACRIFICES:
        g, (tier, pct) = GATES[n], TIERS[n]
        nxt = {"n": n + 1, "tier": tier, "pct": pct, "needs": dict(g), "have": {"completed": a["completed"], "distinct": a["distinctCompleted"]},
               "ready": a["completed"] >= g["completed"] and a["distinctCompleted"] >= g["distinct"]}
    return {**a, "sacrificesDone": n, "next": nxt}


def roll_card(aid, char_id, n, icon):
    """The park card a sacrifice brings: its tier by the account's sacrifice number n (0-2), its attribute drawn from the
    Icon badge's stat list, seeded (the same answer every time)."""
    stats = ICON_CARD_STATS.get(icon) or ICON_CARD_STATS["the_general"]
    tier, pct = TIERS[n]
    return {"tier": tier, "pct": pct, "attr": stats[cup.fnv(f"parkcard|{aid}|{char_id}|{n}") % len(stats)]}


def sync_cards(c, aid, cards=None):
    """Every build of the account carries the account's park cards (characters.data park_cards), so each game's entry
    has them. Writes only the builds whose copy is out of date."""
    cards = entry_cards(park_cards(c, aid)) if cards is None else cards
    for cid, data in c.execute("SELECT id, data FROM characters WHERE account_id=?", (aid,)).fetchall():
        ch = json.loads(data)
        if (ch.get("park_cards") or []) != cards:
            if cards:
                ch["park_cards"] = cards
            else:
                ch.pop("park_cards", None)
            c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(ch), cid))
    return cards


# ---------------- converted players (§1) ----------------
def _avg(a, keys):
    vals = [a.get(k) for k in keys if isinstance(a.get(k), (int, float))]
    return round(sum(vals) / len(vals)) if vals else 60


def converted_stats(char):
    """A sacrificed build's four Gauntlet stats from its ratings (0-99; the engine maps them onto 6-10: deck/run.js
    convertedBase): Stamina its Stamina; Shooting the best of its shooting (close, mid, three); Defense its defense
    (perimeter, interior, steal, block); Health how much of a beating it takes (strength and stamina) with its overall."""
    a = char.get("attributes") or {}
    ovr = builds.overall(a, char.get("position", "SF")) if a else 60
    return {"stamina": int(a.get("stamina", 60)), "shooting": max(int(a.get(k, 0)) for k in ("close_shot", "mid_range", "three_point")) if a else 60,
            "defense": _avg(a, ("perimeter_d", "interior_d", "steal", "block")), "health": round((_avg(a, ("strength", "stamina")) + ovr) / 2)}


def converted_public(row_id, data):
    ch = data["build"]
    return {"id": row_id, "character_id": ch.get("id"), "name": ch.get("name"), "converted": True, "stats": data["stats"], "icon": ch.get("icon_badge"),
            "overall": data.get("overall"), "position": ch.get("position"), "archetype": ch.get("archetype"), "card": data.get("card"),
            "build": {k: ch.get(k) for k in ("name", "position", "archetype", "height", "weight", "wingspan", "hand", "appearance", "equipment", "attributes", "icon_badge")},
            "at": data.get("at")}


def converted(c, aid):
    return [converted_public(r[0], json.loads(r[1])) for r in c.execute("SELECT id, data FROM gauntlet_players WHERE account_id=? ORDER BY created_at", (aid,))]


class Gauntlet:
    """The routes' side on a Service (app.py): profile, start, finish, sacrifice."""

    def __init__(self, service):
        self.s = service

    def profile(self, aid):
        with self.s.db.transaction() as c:
            world, feed = load_world(c, aid)
            runs = c.execute("SELECT status, result FROM gauntlet_runs WHERE account_id=?", (aid,)).fetchall()
            res = [json.loads(r[1]) for r in runs if r[1]]
            stats = {"started": len(runs), "finished": len(res), "completed": sum(1 for r in runs if r[0] == "completed"),
                     "bestPhase": max([r.get("phaseReached", 0) for r in res] or [0]), "matchesWon": sum(r.get("matchesWon", 0) for r in res),
                     "vc": sum(r.get("vc", 0) for r in res)}
            return {"converted": converted(c, aid), "world": world, "unlocks": unlocks(c, aid), "stats": stats, "feed": feed,
                    "parkCards": park_cards(c, aid), "rules": {"vc": VC, "cap": RUN_CAP, "vcPerMin": VC_PER_MIN, "gates": GATES, "tiers": TIERS}}

    def start(self, aid, data, now=None):
        now = time.time() if now is None else now
        builds.strict_keys(data, ("key", "seed", "player"))
        seed = data.get("seed")
        seed = secrets.randbelow(SEED_MAX) + 1 if seed is None else _int(seed, 1, SEED_MAX, "seed")
        p = data.get("player")
        if not isinstance(p, dict) or not isinstance(p.get("id"), str) or not 1 <= len(p["id"]) <= 80:
            raise Invalid("Choose a player for the run.")
        ai_seed = int(self.s.shared_world(now)["seed"])  # (the account's AI world: the one this service shares; before the lock)

        def run(c):
            if p.get("converted"):
                r = c.execute("SELECT data FROM gauntlet_players WHERE id=? AND account_id=?", (p["id"], aid)).fetchone()
                if not r:
                    raise Invalid("That converted player isn't yours.")
                cp = converted_public(p["id"], json.loads(r[0]))
                player = {"id": p["id"], "name": cp["name"], "converted": True}
                # (the replay rolls him from his profile entry as it is now: deck/replay.js canonicalPlayer)
                rplayer = {"id": p["id"], "name": cp["name"], "converted": True, "stats": cp["stats"], "icon": cp["icon"], "build": cp["build"]}
            else:
                # (a starter: one of the three the run's seed offers: deck/run.js rollStarters ids)
                if not re.fullmatch(r"starter-%d-[0-2]" % seed, p["id"]):
                    raise Invalid("A starter is one of the three this run's seed offers.")
                player = {"id": p["id"], "name": _s(p.get("name") or "Starter", 40), "converted": False}
                rplayer = {"id": p["id"], "converted": False}
            # v0.4.8.9 qp1: what the replay needs, as it is now: the client starts its run (newRun) from exactly this
            # world and unlocks, so both sides start the same. The world: the stored one, or an empty one; its aiSeed the
            # account's AI world seed. Unlocks: the engine's run unlocks (none are kept server-side yet: null)
            world, _ = load_world(c, aid)
            world = {**world, "aiSeed": ai_seed} if world else {"v": 1, "aiSeed": ai_seed, "runs": 0, "ticks": 0, "chars": {}, "feed": []}
            start = {"seed": seed, "player": rplayer, "world": world, "unlocks": None}
            rid = uuid.uuid4().hex
            c.execute("INSERT INTO gauntlet_runs(id, account_id, seed, player, status, started_at, start) VALUES(?,?,?,?,?,?,?)",
                      (rid, aid, seed, json.dumps(player), "running", now, json.dumps(start, separators=(",", ":"))))
            return {"run_id": rid, "seed": seed, "player": player, "started_at": now, "world": world, "unlocks": None, "replay": replay_status()["on"]}
        return self.s.db.once(aid, data.get("key"), "gauntlet_start", {k: v for k, v in data.items() if k != "key"}, run)

    def finish(self, aid, data, now=None):
        now = time.time() if now is None else now
        builds.strict_keys(data, ("key", "run_id", "summary", "choices", "world", "feed"))
        rid = data.get("run_id")
        if not isinstance(rid, str) or not re.fullmatch(r"[0-9a-f]{32}", rid):
            raise Invalid("run_id is missing.")
        repeat = lambda c, r: {**json.loads(r["result"]), "balance": c.execute("SELECT balance FROM wallets WHERE account_id=?", (aid,)).fetchone()[0], "repeat": True}
        with self.s.db.transaction() as c:
            r = c.execute("SELECT * FROM gauntlet_runs WHERE id=? AND account_id=?", (rid, aid)).fetchone()
            if not r:
                raise Invalid("That run isn't yours.")
            if r["status"] != "running":  # (finished already: the same answer, once paid)
                return repeat(c, r)
            run = {"seed": r["seed"], "player": json.loads(r["player"])}
            start = json.loads(r["start"]) if r["start"] else None
            elapsed = now - r["started_at"]
        if elapsed > MAX_RUN_AGE:
            raise Invalid("That run has expired.")
        counts = check_summary(data.get("summary"), run, elapsed)
        world = clean_world(data["world"]) if data.get("world") is not None else None
        feed = clean_feed(data.get("feed"))
        choices = data.get("choices")
        if choices is not None and (not isinstance(choices, list) or len(choices) > MAX_CHOICES):
            raise Invalid(f"choices is the run's log: a list of at most {MAX_CHOICES}.")
        # v0.4.8.9 qp1: the replay check, outside the database lock (pays from what the replay earned)
        verified, rhash = False, None
        try:
            if start is None:
                raise ReplayUnavailable("a run started before replay checks")
            if choices is None:
                if replay_status()["on"]:
                    raise Invalid("The run's choices are needed to check it.")
                raise ReplayUnavailable("no choices sent")
            res = replay_check(start, choices)
            if not res["ok"]:
                log(f"run {rid} refused: its log doesn't replay ({res['error']}, at choice {res['at']})")
                raise Conflict(f"That run's log doesn't replay: {res['error']} (choice {res['at']}).", {"replay": {"error": res["error"], "at": res["at"]}})
            rc = res["counts"]
            got = {"completed": rc["completed"], "final": rc["final"], "phaseReached": (PHASES + 1) if rc["completed"] else rc["phase"],
                   "matchesWon": rc["matchesWon"], "rivals": rc["rivals"], "bosses": rc["bosses"]}
            if not rc["over"]:
                log(f"run {rid} refused: the replayed run isn't over")
                raise Conflict("That run's log stops before the run is over.", {"replay": {"error": "not over", "at": len(choices)}})
            diff = {k: (counts[k], v) for k, v in got.items() if counts[k] != v}
            if diff:
                log(f"run {rid} refused: the summary doesn't match its replay ({', '.join(f'{k} {a} vs {b}' for k, (a, b) in diff.items())})")
                raise Conflict("That run's summary doesn't match its replay.", {"replay": {"error": "summary mismatch", "diff": {k: {"summary": a, "replay": b} for k, (a, b) in diff.items()}}})
            counts = {**got, "nodesCleared": counts["nodesCleared"], "durationTurns": rc["turns"], "nonMatch": rc["nonMatchNodes"], "cardsPlayed": rc["cardsPlayed"]}
            if elapsed < counts["matchesWon"] * MIN_MATCH_SECS + counts["nonMatch"] * MIN_NODE_SECS:
                raise Invalid("That run finished faster than it can be played.")
            verified, rhash = True, res["hash"]
        except ReplayUnavailable as e:
            log(f"run {rid}: not replayed ({e}); paid by its counts")
        # (the world after the run: the client's worldAfterRun, shape-checked. A later step could work it out here from the
        # replayed run instead)
        with self.s.db.transaction() as c:
            r = c.execute("SELECT * FROM gauntlet_runs WHERE id=? AND account_id=?", (rid, aid)).fetchone()
            if r["status"] != "running":  # (another finish of it got here first)
                return repeat(c, r)
            parts = run_vc(counts)
            cap = time_cap(elapsed)
            vc = min(parts["raw"], cap)
            balance = self.s.db.change_wallet(c, aid, vc, "gauntlet_run", "gauntlet:" + rid) if vc > 0 else c.execute("SELECT balance FROM wallets WHERE account_id=?", (aid,)).fetchone()[0]
            if world is not None:
                save_world(c, aid, world, feed, now)
            else:
                world, feed = load_world(c, aid)
            status = "completed" if counts["completed"] else "failed"
            result = {"run_id": rid, "vc": vc, "vc_parts": parts, "cap": cap, "elapsed": round(elapsed), "completed": counts["completed"],
                      "phaseReached": counts["phaseReached"], "matchesWon": counts["matchesWon"], "player": run["player"], "verified": verified}
            c.execute("UPDATE gauntlet_runs SET status=?, finished_at=?, result=?, verified=?, replay_hash=? WHERE id=?", (status, now, json.dumps(result), 1 if verified else 0, rhash, rid))
            return {**result, "balance": balance, "world": world, "feed": feed, "unlocks": unlocks(c, aid)}

    def sacrifice(self, aid, data, now=None):
        now = time.time() if now is None else now
        builds.strict_keys(data, ("key", "character_id"))
        cid = data.get("character_id")
        if not isinstance(cid, str):
            raise Invalid("Choose the build to sacrifice.")
        s = self.s

        def run(c):
            char = s.character(aid, cid, c)
            if not builds.icon_status(char):
                raise Invalid(f"Only an ICON 99 build can be sacrificed. {char.get('name') or 'This build'} isn't one.")
            if not char.get("icon_badge") or char["icon_badge"] not in ICON_CARD_STATS:
                raise Invalid("Only an ICON with its Icon badge can be sacrificed.")
            u = unlocks(c, aid)
            if u["next"] is None:
                raise Invalid("All three sacrifices are done: there are no more park cards to earn.")
            if not u["next"]["ready"]:
                g = u["next"]["needs"]
                raise Invalid(f"The next sacrifice needs {g['completed']} completed Gauntlet run{'s' if g['completed'] != 1 else ''}"
                              + (f" with {g['distinct']} different players" if g["distinct"] else "") + f" (you have {u['completed']}"
                              + (f", with {u['distinctCompleted']} different players" if g["distinct"] else "") + ").")
            n = u["sacrificesDone"]
            card = roll_card(aid, cid, n, char["icon_badge"])
            # (the converted player keeps the build itself: its name, look, ratings and Icon)
            pid = "cv-" + cid
            keep = {"build": char, "stats": converted_stats(char), "overall": builds.describe(char).get("overall"), "card": card, "at": now}
            c.execute("INSERT INTO gauntlet_players(id, account_id, character_id, data, created_at) VALUES(?,?,?,?,?)", (pid, aid, cid, json.dumps(keep), now))
            c.execute("INSERT INTO park_cards(account_id, n, tier, attr, pct, character_id, name, icon, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                      (aid, n + 1, card["tier"], card["attr"], card["pct"], cid, char.get("name"), char["icon_badge"], now))
            # (the build leaves the park as a deleted one does: its slot free, an ICON's kept slot the account's)
            gone = s.remove_build(c, aid, char, "sacrifice it")
            cards = sync_cards(c, aid)
            rest = [s.describe(builds.normalize(json.loads(r[0]))) for r in c.execute("SELECT data FROM characters WHERE account_id=? ORDER BY created_at", (aid,)).fetchall()]
            return {"sacrificed": {"id": cid, "name": char.get("name"), **gone}, "card": {"n": n + 1, **card, "name": char.get("name"), "icon": char["icon_badge"]},
                    "player": converted_public(pid, keep), "parkCards": cards, "unlocks": unlocks(c, aid),
                    "build_slots": s.build_slots(c, aid), "characters": rest}
        return s.db.once(aid, data.get("key"), "sacrifice:" + cid, {}, run)
