"""v0.4.5 Crews. One crew per account: a name, a tag, a color and up to 39 members picked from your friends
(the AI hoopers of your AI world), so 40 with you. Crews level from 1 to 40 on crew XP.

Crew XP comes from two places:
  * Your games: about 30% of the Rep a game pays, weighted by mode (park 1.1x, Pro-Am 1.3x, park events
    such as the King Tut Cup 1.5x), and doubled when a crew member ran with you.
  * Your AI members: they play at their normal times (the same schedules the client uses for who is online,
    ported here from client/js/sim/world.js), whether you're on or not. Each online hour pays crew XP at
    the rate of the games they'd play in it, so better players and higher Rep contribute more.

The server settles AI contributions up to "now" whenever the crew is read, and keeps the running totals, so
the numbers only ever grow and can't be edited from the client.
"""
import datetime
import math
import re
import time

from .cup import Mulberry, fnv

LEVELS = 40
MAX_MEMBERS = 39
CREW_SHARE = 0.30
MODE_WEIGHT = {"park": 1.1, "proam": 1.3, "event": 1.5}
MATES_BONUS = 2.0
AI_GAMES_PER_HOUR = 2.2
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 '\-.&]{1,22}[A-Za-z0-9.]$")
TAG_RE = re.compile(r"^[A-Z0-9]{2,4}$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def level_floor(n):
    """Total crew XP needed to reach level n (level 1 is free)."""
    return 0 if n <= 1 else int(round(2500 * (n - 1) ** 1.75))


def level_info(xp):
    lvl = 1
    while lvl < LEVELS and xp >= level_floor(lvl + 1):
        lvl += 1
    nxt = level_floor(lvl + 1) if lvl < LEVELS else None
    return {"level": lvl, "xp": int(xp), "floor": level_floor(lvl), "next": nxt}


def game_xp(rep, mode, venue=None, with_crew=False):
    weight = MODE_WEIGHT["event"] if venue == "kingtut" else MODE_WEIGHT.get(mode, 0)
    return int(round(max(0, rep) * CREW_SHARE * weight * (MATES_BONUS if with_crew else 1)))


# ---------- the client's AI world, ported (client/js/sim/world.js) ----------
SKILL_TIERS = (  # share, level lo/hi, iq lo/hi, rep lo/hi
    (0.2, 0.04, 0.3, 0.1, 0.38, 0, 4), (0.33, 0.3, 0.55, 0.3, 0.58, 2, 8), (0.26, 0.55, 0.75, 0.48, 0.76, 6, 12),
    (0.16, 0.75, 0.9, 0.66, 0.9, 10, 17), (0.05, 0.9, 1.0, 0.84, 1.0, 16, 20))
HABITS = (  # id, share, start lo/hi, len lo/hi, days, weekdays, weekends
    ("morning", 0.08, 6, 8.5, 2, 3.5, 0.72, False, False), ("lunch", 0.08, 11, 13, 1.2, 2.5, 0.7, True, False),
    ("after_school", 0.17, 14.5, 16.5, 3, 5, 0.8, False, False), ("evening", 0.25, 17.5, 20, 3, 5.5, 0.8, False, False),
    ("night_owl", 0.2, 20.5, 23.5, 4, 7, 0.78, False, False), ("weekend", 0.1, 10, 14, 5, 9, 0.92, False, True),
    ("grinder", 0.12, 9, 15, 8, 13, 0.88, False, False))
PARKS = ("harbor", "brick", "foundry")
DAY_MS = 86400000


class _R(Mulberry):
    def range(self, a, b):
        return a + (b - a) * self.next()

    def int(self, a, b):
        return math.floor(self.range(a, b + 1))


class AIWorld:
    def __init__(self, seed, born_ms):
        self.seed, self.born = int(seed), float(born_ms)
        self.cache = {}

    def rng(self, ai_id, salt):
        return _R(fnv(f"{ai_id}|{salt}") ^ self.seed)

    def account(self, ai_id, now_ms=None):
        a = self.cache.get(ai_id)
        if a:
            return a
        now_ms = time.time() * 1000 if now_ms is None else now_ms
        r = self.rng(ai_id, "acct")
        x = r.next()
        tier, acc = SKILL_TIERS[-1], 0.0
        for t in SKILL_TIERS:
            acc += t[0]
            if x < acc:
                tier = t
                break
        x = r.next()
        habit, acc = HABITS[-1], 0.0
        for h in HABITS:
            acc += h[1]
            if x < acc:
                habit = h
                break
        r.int(0, 4)                                    # position
        level = r.range(tier[1], tier[2])
        r.range(tier[3], tier[4])                      # iq
        home = None if r.next() < 0.14 else PARKS[r.int(0, len(PARKS) - 1)]
        days = max(0.0, (now_ms - self.born) / DAY_MS)
        activity = 1.6 if habit[0] == "grinder" else 0.6 if habit[0] in ("weekend", "lunch") else 1.0
        base_rep = r.int(tier[5], tier[6])
        rep = min(20, base_rep + min(4, math.floor(days * activity / r.range(9, 16))))
        start = r.range(habit[2], habit[3])
        length = r.range(habit[4], habit[5])
        days_p = habit[6] * r.range(0.85, 1.05)
        extra = r.range(0.08, 0.3)
        a = {"level": level, "rep": rep, "home": home, "habit": habit, "start": start, "len": length, "daysP": days_p, "extra": extra}
        self.cache[ai_id] = a
        return a

    @staticmethod
    def day_index(t_ms):
        lt = time.localtime(t_ms / 1000)
        return (datetime.date(lt.tm_year, lt.tm_mon, lt.tm_mday) - datetime.date(1970, 1, 1)).days

    def sessions(self, ai_id, day):
        """The [start, end) windows (ms) this account plays on local day `day` — the same as AIWorld.makeSessions."""
        a = self.account(ai_id)
        r = self.rng(ai_id, f"day{day}")
        d = datetime.date(1970, 1, 1) + datetime.timedelta(days=day)
        weekend = d.weekday() >= 5
        p = a["daysP"]
        if a["habit"][7] and weekend:
            p *= 0.25
        if a["habit"][8] and not weekend:
            p *= 0.18
        local_mid = time.mktime((d.year, d.month, d.day, 0, 0, 0, 0, 0, -1)) * 1000

        def park_for():
            if a["home"] and r.next() < 0.8:
                return a["home"]
            return PARKS[r.int(0, len(PARKS) - 1)]
        out = []
        if r.next() < p:
            s = a["start"] + r.range(-0.9, 0.9)
            ln = a["len"] * r.range(0.65, 1.25)
            out.append((local_mid + s * 3600000, local_mid + (s + ln) * 3600000, park_for()))
        else:
            r.next()
        if r.next() < a["extra"]:
            s = r.range(7, 23.5)
            ln = r.range(0.75, 2.5)
            out.append((local_mid + s * 3600000, local_mid + (s + ln) * 3600000, park_for()))
        return out

    def online_ms(self, ai_id, t0_ms, t1_ms):
        """Milliseconds this account was online between t0 and t1 (overlapping sessions merged)."""
        if t1_ms <= t0_ms:
            return 0.0
        spans = []
        for day in range(self.day_index(t0_ms) - 1, self.day_index(t1_ms) + 1):
            for s, e, _ in self.sessions(ai_id, day):
                s, e = max(s, t0_ms), min(e, t1_ms)
                if e > s:
                    spans.append((s, e))
        spans.sort()
        total, cur_s, cur_e = 0.0, None, None
        for s, e in spans:
            if cur_e is None or s > cur_e:
                if cur_e is not None:
                    total += cur_e - cur_s
                cur_s, cur_e = s, e
            else:
                cur_e = max(cur_e, e)
        if cur_e is not None:
            total += cur_e - cur_s
        return total


def ai_rate(level, rep):
    """Crew XP an AI member earns per online hour: the games he'd play, at the crew share of their Rep."""
    rep_per_game = 100 + 150 * level
    return AI_GAMES_PER_HOUR * CREW_SHARE * MODE_WEIGHT["park"] * rep_per_game * (1 + rep / 40)


# ---------- the crew record ----------
def new_crew(name, tag, color, now):
    return {"name": name, "tag": tag, "color": color.lower(), "created_at": now, "settled": now,
            "user_xp": 0, "former_xp": 0, "members": [], "games": 0, "crew_games": 0}


def validate_identity(name, tag, color):
    if not isinstance(name, str) or not NAME_RE.match(name.strip()):
        raise ValueError("Crew names are 3-24 letters, numbers and spaces.")
    if not isinstance(tag, str) or not TAG_RE.match(tag.strip().upper()):
        raise ValueError("Crew tags are 2-4 letters or numbers.")
    if not isinstance(color, str) or not COLOR_RE.match(color):
        raise ValueError("Pick a crew color.")
    return name.strip(), tag.strip().upper(), color.lower()


def total_xp(crew):
    return int(crew.get("user_xp", 0) + crew.get("former_xp", 0) + sum(m.get("xp", 0) for m in crew.get("members", [])))


def settle(crew, world, friends, now=None):
    """Pay AI members for their online time since the last settle; members who are no longer your friends
    leave the crew (their XP stays with the crew)."""
    now = time.time() if now is None else now
    keep = []
    for m in crew.get("members", []):
        if m["id"] not in friends:
            crew["former_xp"] = crew.get("former_xp", 0) + m.get("xp", 0)
            continue
        keep.append(m)
    crew["members"] = keep
    t1 = now * 1000
    for m in keep:
        t0 = max(m.get("since", now), crew.get("settled", now)) * 1000
        if world and t1 > t0:
            a = world.account(m["id"], t1)
            hours = world.online_ms(m["id"], t0, t1) / 3600000
            m["xp"] = round(m.get("xp", 0) + hours * ai_rate(a["level"], a["rep"]), 2)
            m["hours"] = round(m.get("hours", 0) + hours, 3)
    crew["settled"] = now
    return crew


def describe(crew, world=None):
    out = {k: v for k, v in crew.items() if k != "settled"}
    out["members"] = [{"id": m["id"], "since": m["since"], "xp": int(m.get("xp", 0)), "hours": round(m.get("hours", 0), 1)} for m in crew.get("members", [])]
    xp = total_xp(crew)
    out["xp"] = xp
    out["level"] = level_info(xp)
    return out


def levels_table():
    return [{"level": n, "xp": level_floor(n), "reward": "Coming soon"} for n in range(1, LEVELS + 1)]
