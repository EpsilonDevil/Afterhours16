"""RIMRIFT — dependency-free local service: accounts, characters, VC economy, store,
progression (Rep, badges), Pro-Am teams, match tickets/results, and the static game client."""
import argparse
import collections
import gzip
import hashlib
import hmac
import http.cookies
import json
import os
import random
import re
import secrets
import socket
import sqlite3
import sys
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from . import builds, progression, cup, crew, bugs, online, upnp, proam, gauntlet
from . import reset as season
from .database import Database, encode

ROOT = Path(__file__).resolve().parent.parent
CLIENT = ROOT / "client"


# v0.4.8.6 RIMRIFT: the service's settings from the environment are RIMRIFT_* (RIMRIFT_JOIN_CODE, RIMRIFT_PUBLIC_URL,
# RIMRIFT_ONLINE_FILE, RIMRIFT_TIME_SLACK); the names from before the rename still work, so a server's env file or a
# script from before keeps going. The new name wins when both are set
def env(name, default=None):
    return os.environ.get("RIMRIFT_" + name) or os.environ.get("AFTERHOURS16_" + name) or default



CATALOG = {item["id"]: item for item in json.loads((ROOT / "server/catalog.json").read_text())}
# v0.4.8.5 qp5: Icon items a build that already held the badge gets put on once, each with its own flag on the
# character (so one never stands in for another): Sexy Red's Post Move Package, The General's Salute
ICON_EQUIP_ONCE = {"post_sexy_red": "icon_pkg_v0485qp5_sr", "cel_general_salute": "icon_pkg_v0485qp5_gen",
                   "block_big_brother": "icon_pkg_v0485qp5_bb",  # (and Big Brother's own Block Package)
                   "steal_the_clamp": "icon_pkg_v0485qp6_clamp",  # (qp6: and The Clamp's Steal Package, into the new "steal" slot)
                   "pass_oprah": "icon_pkg_v0487qp7_oprah"}  # (v0.4.8.7 qp7: and Oprah's Pass Package, into the new "pass" slot)
VENUES = json.loads((ROOT / "server/venues.json").read_text())
SCHEMA_VERSION = 12
PRORUN_MAX = 2_000_000  # bytes of JSON for one saved Pro Run career
PRORUN_PHASES = ("college", "draft", "season", "playoffs", "offseason")
VERSION = "0.4.8.9"  # (v0.4.8.6: the RIMRIFT identity patch; its quick patch: the ICON Squad, the season reset; v0.4.8.7; v0.4.8.8 The Pro-Am Overhaul; v0.4.8.9 The Gauntlet)
# Reported game clock may run ahead of wall clock by at most this many seconds.
# (Tests raise it to fast-forward simulated games; leave it alone for real play.)
TIME_SLACK = float(env("TIME_SLACK", "30"))
# v0.4.8.5 qp8: a game started this long ago can still be finished (a result reports up to 4 hours of play), so its build
# can't be deleted until it's done or left. An older one still marked running was left for good (the page closed)
GAME_OPEN_SECS = 4 * 3600
# v0.4.8.7 hosted games' results: a game played through this service's online server (online.py) pays only when what the
# player says happened matches what the other real players' games said (hosted_verdict). The service waits this long at
# most for their ends to come in (on the hub's condition: no other request waits with it, and no database lock is held)
HOSTED_WAIT = float(env("HOSTED_WAIT", "12"))
DISPUTE_WINDOW = 24 * 3600  # (an account in disputes with this many different people in a day is named in the log)
DISPUTE_WARN = 3


def results_log(line):
    """v0.4.8.7: the results check's log lines, on the service's console (and kept for the tests)."""
    results_log.lines.append(line)
    del results_log.lines[:-200]
    print("[results] " + line, file=sys.stderr, flush=True)


results_log.lines = []


def judge_hosted(aid, rec, summary, now=None):
    """v0.4.8.7: does a player's reported result for a hosted game hold up against the game's record on the online
    server (online.py Hub.results: each real player's own end, the scores and state hashes they relayed)?
      agreed      every other real player's game ended the same way (the score, and whether he won)
      single      nobody else's end came in (they left, or lost the connection): his own end matches, the score is at
                  least what the others last relayed, the state hashes they share agree, and the game took long enough
      unverified  there's no record (the online server restarted, or it's long gone): paid, and logged
      disputed    anything else: void (no rewards, the ante back), and logged
    -> {"state", "why", "others": the real players whose ends disagree (for the dispute count)}"""
    if not rec:
        return {"state": "unverified", "why": "no record of the game on the online server", "others": []}
    now = now or time.time()
    claim_score, claim_won = list(summary["score"]), summary["winner"] == summary["team"] and not summary["forfeit"]

    def same(r):
        return (r.get("score") is None or r["score"] == claim_score) and ((aid in r.get("winners", [])) == claim_won)
    reports = rec.get("reports", {})
    mine = reports.get(aid)
    if mine and not same(mine):
        return {"state": "disputed", "why": "the result sent here isn't the one this player's own game ended with", "others": []}
    others = {a: r for a, r in reports.items() if a != aid}
    wrong = sorted(a for a, r in others.items() if not same(r))
    if wrong:
        return {"state": "disputed", "why": "the other players' games ended differently", "others": wrong}
    if others:
        return {"state": "agreed", "why": f"{len(others) + 1} players' games agree", "others": []}
    # nobody else's end: what the online server saw of the game has to fit
    if not mine and aid in rec.get("left", []):
        return {"state": "disputed", "why": "this player left the game before its end", "others": []}
    end = (mine or {}).get("t") or rec.get("ended") or now
    if summary["duration"] > end - rec["started"] + TIME_SLACK:
        return {"state": "disputed", "why": "the game took longer than it was on the online server", "others": []}
    for a, sc in rec.get("scores", {}).items():
        if a != aid and (sc[0] > claim_score[0] or sc[1] > claim_score[1]):
            return {"state": "disputed", "why": f"the score is below what another player's game last relayed ({sc[0]}-{sc[1]})", "others": [a]}
    my_h = rec.get("hashes", {}).get(aid, {})
    for a, hs in rec.get("hashes", {}).items():
        if a != aid and any(str(k) in my_h and my_h[str(k)] != h for k, h in hs.items()):
            return {"state": "disputed", "why": "this player's game wasn't the same game as another player's", "others": [a]}
    return {"state": "single", "why": "the only end that came in; it fits what the online server saw", "others": []}
# Explicit types: Windows registry MIME entries are often wrong (e.g. .js as text/plain), which breaks ES modules.
STATIC_EXT = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg",
              ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon", ".txt": "text/plain", ".woff2": "font/woff2",
              ".mp3": "audio/mpeg", ".webm": "video/webm", ".mp4": "video/mp4"}  # (v0.4.8.6 qp: the opening cinematic)
STATIC_MEDIA = (".mp3", ".webm", ".mp4")  # (streamed with byte ranges: static_media)
# v0.4.7.5 qp3 perf: the game's files come from memory (read and hashed once, again only when one changes), and the
# text ones gzipped for browsers that take it: a friend loading the game from a home PC's upload gets a quarter of it
STATIC_CACHE = {}
STATIC_GZIP = (".html", ".js", ".css", ".svg", ".json", ".txt")


def static_entry(file):
    """(etag, content, gzipped content or None) for a client file, from memory while it's unchanged."""
    st = file.stat()
    key = str(file)
    hit = STATIC_CACHE.get(key)
    if hit and hit[0] == (st.st_mtime_ns, st.st_size):
        return hit[1]
    content = file.read_bytes()
    etag = '"' + hashlib.sha1(content).hexdigest()[:16] + '"'
    gz = gzip.compress(content, 6, mtime=0) if file.suffix.lower() in STATIC_GZIP and len(content) > 1024 else None
    entry = (etag, content, gz if gz and len(gz) < len(content) * 0.9 else None)
    STATIC_CACHE[key] = ((st.st_mtime_ns, st.st_size), entry)
    return entry


# v0.4.7.5 qp3: online play from your own copy. Every screen in an online game runs the same simulation, so everyone
# needs the same game: this fingerprint covers the client code (the simulation and everything around it), the catalog,
# the venues and the event schedule, line endings ignored (a Windows checkout and a Linux one hash the same). The host's
# service refuses an online sign-in from a game whose fingerprint differs ("update your copy").
BUILD_FILES = ("server/catalog.json", "server/venues.json", "server/events.json")


def compute_build(root=ROOT):
    h = hashlib.sha256(VERSION.encode())
    files = sorted(p for p in (Path(root) / "client/js").rglob("*.js") if not p.name.startswith("_"))
    files += [Path(root) / f for f in BUILD_FILES if (Path(root) / f).is_file()]
    for p in files:
        h.update(p.relative_to(root).as_posix().encode() + b"\0")
        h.update(p.read_bytes().replace(b"\r\n", b"\n") + b"\0")
    return h.hexdigest()[:12]


# v0.4.7.5 qp3 (Oct 12): the online server every copy of the game plays on by itself. online.json, at the top of the game
# folder, holds its address and join code; a copy that isn't hosting connects there when it starts, and its players only
# sign in (or make their online account: the join code goes with it). Nobody types an address any more.
ONLINE_FILE = Path(env("ONLINE_FILE") or ROOT / "online.json")  # (the variable: tests)


def load_online_default(path=None):
    """(the server's address as normalize_hub gives it, its join code) from online.json; (None, None) without one."""
    try:
        data = json.loads(Path(path or ONLINE_FILE).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return None, None
    if not isinstance(data, dict):
        return None, None
    hub = normalize_hub(data["server"]) if isinstance(data.get("server"), str) and data["server"].strip() else None
    code = data.get("joinCode").strip() if isinstance(data.get("joinCode"), str) else ""
    return hub, (code if re.fullmatch(r"[A-Za-z0-9._-]{1,64}", code) else None)


def save_online_default(hub, code, path=None):
    path = Path(path or ONLINE_FILE)
    text = json.dumps({"_": "The online server every copy of RIMRIFT connects to by itself, and its join code (README: Play online). "
                            "Leave server empty to have none.", "server": hub or "", "joinCode": code or ""}, indent=2) + "\n"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


HUB_RE = re.compile(r"(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+(?::\d{1,5})?|\[[0-9A-Fa-f:.]+\](?::\d{1,5})?")


def normalize_hub(text):
    """'203.0.113.7', 'http://friend.example:8765/' -> 'host:port' (port 8765 when none is given), or None.
    An online server with HTTPS (deploy/install.sh): 'https://203-0-113-7.sslip.io/' -> 'https://203-0-113-7.sslip.io'
    (its socket is wss://, on the port given or 443)."""
    t = (text or "").strip()
    secure = bool(re.match(r"^(?:https|wss)://", t, flags=re.I))
    t = re.sub(r"^(?:https?|wss?)://", "", t, flags=re.I).split("/")[0].strip()
    if not t or not HUB_RE.fullmatch(t):
        return None
    if secure:
        port = int(t.rsplit(":", 1)[1]) if re.search(r"(?<!:):\d{1,5}$", t) and not t.endswith("]") else 443
        if not 0 < port < 65536:
            return None
        return "https://" + (t[:-4] if t.endswith(":443") else t).lower()
    if not re.search(r":\d{1,5}$", t) or (t.startswith("[") and t.endswith("]")):
        t += ":8765"
    port = int(t.rsplit(":", 1)[1])
    return t if 0 < port < 65536 else None


def hub_socket_sources(hub):
    """The CSP connect-src entries a page needs to reach this hub's socket."""
    if hub.startswith("https://"):
        h = hub[8:]
        return [f"wss://{h}"] if HUB_RE.fullmatch(h) else []
    return [f"ws://{hub}", f"wss://{hub}"] if HUB_RE.fullmatch(hub) else []


class HTTPError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Service:
    def __init__(self, db_path, dev_accounts=True, secure_cookies=False, welcome_vc=1_000_000, season_reset=None):
        self.db = Database(db_path, welcome_vc)
        self.dev_accounts, self.secure_cookies = dev_accounts, secure_cookies
        self.attempts = collections.defaultdict(collections.deque)
        self.attempt_lock = threading.Lock()
        self.attempts_swept = time.monotonic()
        self.last_ping = None  # set by game windows opened from the launcher (see --exit-when-idle)
        self.quit_allowed = False  # only when started by RIMRIFT.exe (--exit-when-idle)
        self.quit_requested = False
        self.bug_root = ROOT  # v0.4.7.5: bug reports go next to RIMRIFT.exe
        # v0.4.7.5 qp3: playing online with friends (online.py). hosting: started with --online (reachable from other
        # machines); join_code: new accounts need it (--join-code)
        self.hosting, self.join_code = False, None
        # an online server (--server, deploy/install.sh): behind its own HTTPS proxy on the same machine, which forwards
        # each player's address (X-Forwarded-For); public_url is the address players use
        self.behind_proxy, self.public_url = False, None
        self.upnp = None  # upnp.PortMapper while hosting: the router forwards the port to this PC by itself
        self.build = compute_build()  # (qp3: the game's fingerprint, for the online version check)
        self.hub = online.Hub(self.db, self.online_auth, world=self.shared_world_payload, catalog=CATALOG)  # (v0.4.8.7: and its AI world; qp7: the catalog, for emotes)
        self.hub_hosts = {r[0] for r in self.db.query("SELECT DISTINCT hub FROM hub_links") if r[0]}  # (the CSP lets the page reach them)
        # qp3 (Oct 12): the game's own online server (online.json), for a copy that isn't hosting (see online_default)
        self.default_hub, self.default_join = load_online_default()
        if self.default_hub:
            self.hub_hosts.add(self.default_hub)
        self.upgrade_characters()
        # v0.4.8.6 qp: the season reset (server/reset.py): due at start-up, or on the first request after its time. The
        # game's service (main) passes reset.SEASON_RESET; a Service made without one (the tests) never resets
        self.season, self.reset_lock, self.reset_done = season_reset, threading.Lock(), False
        self.maybe_reset()
        # v0.4.8.8 The Pro-Am Overhaul (server/proam.py, docs/PROAM-OVERHAUL.md): Season 1 begins the first time this
        # runs; the AI Pro-Am teams are made, and the season items added to the catalog
        self.proam = proam.ProAm(self, CATALOG)
        self.gauntlet = gauntlet.Gauntlet(self)  # (v0.4.8.9 The Gauntlet: runs, the nemesis world, sacrifices, park cards)
        self.proam.boot()

    def maybe_reset(self, now=None):
        """v0.4.8.6 qp: the season reset, once per save, the first moment the service is asked anything at or after its
        time (every request comes through here first, so nothing is served from the old save after it). None, or the
        reset's summary."""
        if self.reset_done or not self.season:
            return None
        now = time.time() if now is None else now
        if now < self.season["at"]:
            return None
        with self.reset_lock:
            if self.reset_done:
                return None
            out = season.run(self.db, [i for i in CATALOG if CATALOG[i]["price"] == 0 and not CATALOG[i].get("exclusive")], now, self.season)
            season.sweep_ai(self.db, now, self.season)  # (an old AI world a game left open saved back after it: cleared, once)
            self.reset_done = True
            return out

    def online_default(self):
        """The server this copy connects to by itself, and its join code: online.json's, unless this copy hosts."""
        return (None, None) if self.hosting else (self.default_hub, self.default_join)

    def upgrade_characters(self):
        """One-time, idempotent upgrade of saved v0.2 characters to the v0.3 schema."""
        with self.db.transaction() as c:
            for row in c.execute("SELECT id, data FROM characters").fetchall():
                char = json.loads(row[1])
                if char.get("schema") != 3:
                    builds.normalize(char)
                    c.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), row[0]))

    def character(self, account_id, char_id, c=None):
        query = "SELECT data FROM characters WHERE id=? AND account_id=?"
        rows = c.execute(query, (char_id, account_id)).fetchall() if c else self.db.query(query, (char_id, account_id))
        if not rows:
            raise HTTPError(404, "Player not found.")
        char = builds.normalize(json.loads(rows[0][0]))
        progression.proam_state(char)  # v0.4.8.5: Pro-Am RP (seeded once from an older build's record; saved with it)
        return char

    def describe(self, char):
        rp = progression.proam_state(char)["rp"]  # v0.4.8.5: Pro-Am RP and rank
        out = dict(char)
        out.update(builds.describe(char))
        out["rep"] = progression.rep_info(char.get("progression", {}).get("rep", 0))
        out["proam_rank"] = progression.proam_rank(rp)
        # v0.4.8.8 Pro-Am: the build's season rank (division, RP 0..100, record), the boost it brings, and the rank from
        # before Season 1 as history
        prog = char.get("progression", {})
        pa = prog.get("pa") or proam.blank_state(None)
        # ("best": the highest tier this build has ever reached, this season or an old one: what a tier unlocks for good
        # goes by it, like the Platinum record over the head)
        best = max([proam.tier_of(pa.get("high", 0))] + [proam.tier_of(r.get("high", 0)) for r in prog.get("pa_seasons", []) if isinstance(r, dict)])
        out["pa"] = {**proam.public_state(pa), "boost": proam.BOOST[proam.tier_of(pa.get("div", 0))], "best": best}
        out["pa_history"] = prog.get("pa_history")
        out["pa_seasons"] = prog.get("pa_seasons", [])
        return out

    # v0.4.8.5 qp7: ICON build slots (builds.build_slots): the account's slots from its builds as saved. claim=True (a new
    # build is about to take a slot) marks any ICON build not marked yet first, so the slot it's using stays for good
    @staticmethod
    def build_slots(c, account_id, claim=False):
        chars = []
        for cid, data in c.execute("SELECT id, data FROM characters WHERE account_id=?", (account_id,)).fetchall():
            ch = builds.normalize(json.loads(data))
            if claim and builds.mark_icon_slot(ch):
                c.execute("UPDATE characters SET data=? WHERE id=?", (encode(ch), cid))
            chars.append(ch)
        return builds.build_slots(chars, Service.kept_slots(c, account_id))

    # v0.4.8.5 qp8 deleting a build (v0.4.8.9: and sacrificing one into the Gauntlet, the same way): not while it's in a
    # game still running; an ICON's slot stays the account's (icon_slots); its games and Pro Run career go with it.
    # -> {"icon_slot_kept", "removed"}
    @staticmethod
    def remove_build(c, aid, char, what="delete the build"):
        char_id = char["id"]
        if c.execute("SELECT 1 FROM matches WHERE character_id=? AND status='running' AND created_at>?", (char_id, time.time() - GAME_OPEN_SECS)).fetchone():
            raise builds.Invalid(f"{char.get('name') or 'This build'} is in a game that's still running. Finish it or leave it first, then {what}.")
        kept = builds.holds_icon_slot(char)
        if kept:
            c.execute("INSERT OR IGNORE INTO icon_slots(account_id, character_id, name, deleted_at) VALUES(?,?,?,?)", (aid, char_id, char.get("name"), time.time()))
        removed = {"matches": c.execute("DELETE FROM matches WHERE character_id=?", (char_id,)).rowcount,
                   "prorun_careers": c.execute("DELETE FROM prorun_careers WHERE character_id=?", (char_id,)).rowcount}
        c.execute("DELETE FROM characters WHERE id=? AND account_id=?", (char_id, aid))
        return {"icon_slot_kept": kept, "removed": removed}

    # v0.4.8.5 qp8: the ICON slots deleted builds left open for the account (icon_slots: one row each, counted once)
    @staticmethod
    def kept_slots(c, account_id):
        return c.execute("SELECT count(*) FROM icon_slots WHERE account_id=?", (account_id,)).fetchone()[0]

    # Called with a build about to be saved after anything that can make it an ICON (a game's result, an upgrade, cap
    # breakers): marks its slot for good, and returns {"slot", "max", "opened"} when that opened a build slot on the
    # account (so the game can say so right then), else None. (qp8: the slots kept from deleted ICONs count as marked)
    @staticmethod
    def icon_slot_check(c, account_id, char):
        if not builds.mark_icon_slot(char):
            return None
        others = c.execute("SELECT data FROM characters WHERE account_id=? AND id<>?", (account_id, char.get("id"))).fetchall()
        return builds.slot_opened(sum(1 for r in others if json.loads(r[0]).get("icon_slot")) + Service.kept_slots(c, account_id), 1)

    def profile(self, account_id):
        with self.db.lock:
            conn = self.db.conn
            account = conn.execute("SELECT id,username,created_at FROM accounts WHERE id=?", (account_id,)).fetchone()
            rows = conn.execute("SELECT id, data FROM characters WHERE account_id=? ORDER BY created_at", (account_id,)).fetchall()
            chars, badge_updates = [], []
            # (v0.4.8.5 qp7: the builds as saved; ICON slots marked before / now. qp8: the ones deleted ICONs left open count
            # as marked before, so they're never said again)
            kept = self.kept_slots(conn, account_id)
            stored, marked_before, marked_now = [], kept, 0
            pa_season = proam.current_season(conn)["n"]  # (v0.4.8.8)
            self.proam.sync_catalog(pa_season)
            pcards = gauntlet.park_cards(conn, account_id)  # (v0.4.8.9: the account's park cards, on every build: park_cards)
            ecards = gauntlet.entry_cards(pcards)
            for cid, data in rows:
                char = builds.normalize(json.loads(data))
                if (char.get("park_cards") or []) != ecards:
                    char["park_cards"] = ecards
                    if not ecards:
                        char.pop("park_cards")
                    conn.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), cid))
                # v0.4.8.5: badges catch up with the current requirements as the profile loads (a lowered Hall of Fame
                # mark, Handles for Days counting the games already played, Brick Wall's move to screens), not a game later
                had_v0485 = bool(char.get("badges_v0485"))
                sync = progression.sync_badges(char)
                if sync or not had_v0485:
                    conn.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), cid))
                if sync:
                    badge_updates.append({"character_id": cid, "name": char.get("name"), **sync})
                # v0.4.8: a build that already held Sharp Eye gets the Icon's new package (jumpshot base and release)
                # put on once, as a build that unlocks it now does (it can change them back in its Inventory)
                if char.get("icon_badge") and not char.get("icon_pkg_v048"):
                    pkg = [i for i in CATALOG.values() if i.get("icon") == char["icon_badge"] and i.get("v048") and i.get("slot") in builds.EQUIP_SLOTS]
                    char["icon_pkg_v048"] = True
                    for i in pkg:
                        conn.execute("INSERT OR IGNORE INTO inventory VALUES(?,?,?)", (account_id, i["id"], time.time()))
                        char.setdefault("equipment", {})[i["slot"]] = i["id"]
                    conn.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), cid))
                # v0.4.8.5: the same for Open Arms: a build that already held it gets the Icon's new Rebound Package put on
                # once (into the new, empty "rebound" slot; it can take it off in its Inventory and keeps the basic snag)
                if char.get("icon_badge") and not char.get("icon_pkg_v0485"):
                    pkg = [i for i in CATALOG.values() if i.get("icon") == char["icon_badge"] and i.get("v0485") and i.get("slot") in builds.EQUIP_SLOTS]
                    if pkg:
                        char["icon_pkg_v0485"] = True
                        for i in pkg:
                            conn.execute("INSERT OR IGNORE INTO inventory VALUES(?,?,?)", (account_id, i["id"], time.time()))
                            if not char.setdefault("equipment", {}).get(i["slot"]):
                                char["equipment"][i["slot"]] = i["id"]
                        conn.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), cid))
                # v0.4.8.5 qp5: Sexy Red's own Post Move Package and The General's Salute: a build that already held the badge
                # gets its item put on once, over whatever it wore there (the badge used to swap that out in games anyway);
                # each item its own flag (ICON_EQUIP_ONCE). It can change it back in its Inventory
                once = [i for i in CATALOG.values() if char.get("icon_badge") and i.get("icon") == char["icon_badge"] and i["id"] in ICON_EQUIP_ONCE
                        and not char.get(ICON_EQUIP_ONCE[i["id"]]) and i.get("slot") in builds.EQUIP_SLOTS]
                if once:
                    for i in once:
                        conn.execute("INSERT OR IGNORE INTO inventory VALUES(?,?,?)", (account_id, i["id"], time.time()))
                        char.setdefault("equipment", {})[i["slot"]] = i["id"]
                        char[ICON_EQUIP_ONCE[i["id"]]] = True
                    conn.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), cid))
                # v0.4.8.5 qp7: an ICON build keeps the build slot it opened for good, from the first time it's seen as one
                # (here: a build that was an ICON before this patch, or became one just now in the badge catch-up above)
                if char.get("icon_slot"):
                    marked_before += 1
                elif builds.mark_icon_slot(char):
                    marked_now += 1
                    conn.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), cid))
                # v0.4.8.8 Pro-Am: the build in this season (an old season's record kept and its reward given, Bronze 1
                # again), its rank items given
                self.proam.on_profile(conn, account_id, [char], pa_season)
                stored.append(char)
                chars.append(self.describe(char))
            # v0.4.7.5 qp3: every Icon badge a build holds brings its own items (the Hash-Slinging dunk package); builds
            # that earned the Icon before this patch pick theirs up here
            for ch in chars:
                self.grant_icon_items(conn, account_id, ch.get("icon_badge"))
            team = conn.execute("SELECT data FROM proam_teams WHERE account_id=?", (account_id,)).fetchone()
            return {"account": dict(account),
                    "balance": conn.execute("SELECT balance FROM wallets WHERE account_id=?", (account_id,)).fetchone()[0],
                    "inventory": [r[0] for r in conn.execute("SELECT item_id FROM inventory WHERE account_id=?", (account_id,))],
                    "characters": chars,
                    # v0.4.8.5 qp7: 4 base + 1 a build holding an ICON slot, up to 8 (and the slots this load opened, if any)
                    "build_slots": builds.build_slots(stored, kept),
                    "build_slot_unlocked": builds.slot_opened(marked_before, marked_now),
                    "park_cards": pcards, "gauntlet_unlocks": gauntlet.unlocks(conn, account_id),  # (v0.4.8.9: the MyPLAYER row)
                    "proam_team": json.loads(team[0]) if team else None,
                    "badge_updates": badge_updates,
                    "daily_spin": self.spin_status(conn, account_id),
                    "locker_codes": [{"code": r["code"], "used": r["count"], "max": progression.locker_code_info(r["code"]).get("max_per_account", r["count"]),
                                      "label": progression.locker_code_info(r["code"]).get("label", "")}
                                     for r in conn.execute("SELECT code, count FROM locker_redemptions WHERE account_id=? ORDER BY last_at DESC", (account_id,))],
                    "ai_world": self.load_ai_world(conn, account_id),
                    "recent_matches": [{"id": r["id"], "mode": r["mode"], "status": r["status"], "result": json.loads(r["result"] or "null")}
                                       for r in conn.execute("SELECT id,mode,status,result FROM matches WHERE account_id=? ORDER BY created_at DESC LIMIT 12", (account_id,))]}

    @staticmethod
    def load_ai_world(conn, account_id):
        row = conn.execute("SELECT data FROM ai_world WHERE account_id=?", (account_id,)).fetchone()
        return json.loads(row[0]) if row else None

    @staticmethod
    def spin_status(conn, account_id):
        row = conn.execute("SELECT last_spin, spins, last_prize FROM daily_spins WHERE account_id=?", (account_id,)).fetchone()
        if not row:
            return {"next_at": 0, "spins": 0, "last_prize": None}
        return {"next_at": row["last_spin"] + progression.SPIN_COOLDOWN, "spins": row["spins"], "last_prize": json.loads(row["last_prize"] or "null")}

    # ---------- v0.4.5 Crews ----------
    def crew_world(self, conn, account_id):
        w = self.load_ai_world(conn, account_id)
        if not w:
            return None, set()
        return crew.AIWorld(w["seed"], w.get("born") or time.time() * 1000), set(w.get("friends") or [])

    def load_crew(self, conn, account_id, settle=True):
        row = conn.execute("SELECT data FROM crews WHERE account_id=?", (account_id,)).fetchone()
        if not row:
            return None
        data = json.loads(row[0])
        if settle:
            world, friends = self.crew_world(conn, account_id)
            crew.settle(data, world, friends)
        return data

    @staticmethod
    def save_crew(conn, account_id, data):
        conn.execute("INSERT INTO crews(account_id,data,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
                     (account_id, encode(data), time.time(), time.time()))

    def crew_status(self, account_id):
        with self.db.transaction() as c:
            data = self.load_crew(c, account_id)
            if data:
                self.save_crew(c, account_id, data)  # keep the settled totals
            return {"crew": crew.describe(data) if data else None, "levels": crew.levels_table(), "max_members": crew.MAX_MEMBERS,
                    "rules": {"share": crew.CREW_SHARE, "weights": crew.MODE_WEIGHT, "mates_bonus": crew.MATES_BONUS}}

    # ---------- v0.4.5 The King Tut Cup ----------
    # v0.4.8.5 quick patch 3: a game left unfinished (abandoned or quit) ends the build's win streak too
    @staticmethod
    def reset_win_streak(c, char_id):
        crow = c.execute("SELECT data FROM characters WHERE id=?", (char_id,)).fetchone()
        if crow:
            char = builds.normalize(json.loads(crow[0]))
            if char["progression"].get("win_streak"):
                char["progression"]["win_streak"] = 0
                c.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), char_id))

    @staticmethod
    def reset_cup_streak(c, char_id):
        crow = c.execute("SELECT data FROM characters WHERE id=?", (char_id,)).fetchone()
        if crow:
            char = builds.normalize(json.loads(crow[0]))
            char["progression"].setdefault("cup", {"games": 0, "wins": 0})["streak"] = 0
            c.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), char_id))

    # v0.4.8.5: a Pro-Am game forfeited (Forfeit & leave), or left running when the next game starts, costs its build RP
    @staticmethod
    def proam_forfeit(c, char_id, kind="forfeit"):
        crow = c.execute("SELECT data FROM characters WHERE id=?", (char_id,)).fetchone()
        if not crow:
            return None
        char = builds.normalize(json.loads(crow[0]))
        out = progression.proam_forfeit(char, kind)
        c.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), char_id))
        return {**out, "character_id": char_id}

    # ---- v0.4.8.7: hosted games' results (judge_hosted) ----
    def hosted_verdict(self, aid, hg, summary):
        """The verdict on a hosted game's reported result, once the other real players' ends are in (or HOSTED_WAIT has
        passed). Called before the database transaction: the wait holds no lock."""
        rec = self.hub.wait_results(hg.get("game"), hg.get("run"), HOSTED_WAIT) if self.hub else None
        v = judge_hosted(aid, rec, summary)
        if v["state"] != "agreed":
            results_log(f"game {hg.get('game')} ({hg.get('run')}): {self.username_of(aid)} {v['state']}: {v['why']}"
                        + (f" (with {', '.join(self.username_of(a) for a in v['others'])})" if v["others"] else ""))
        return v

    def username_of(self, aid):
        row = self.db.query("SELECT username FROM accounts WHERE id=?", (aid,))
        return row[0][0] if row else str(aid)

    def void_disputed(self, c, aid, row, meta, verdict, match_id):
        """A disputed hosted game: nothing paid, the ante back, the game cancelled with why. -> the response."""
        balance = c.execute("SELECT balance FROM wallets WHERE account_id=?", (aid,)).fetchone()[0]
        if meta.get("ante"):
            balance = self.db.change_wallet(c, aid, meta["ante"], "cup_ante_refund", "ante_refund:" + match_id)
            cw = meta.get("cup_window", cup.window_at())
            entry = self.cup_entry(c, aid, cw)
            entry["staked"] = max(0, entry["staked"] - meta["ante"])
            entry["net"] += meta["ante"]
            entry["games"] = max(0, entry["games"] - 1)
            self.save_cup_entry(c, aid, cw, entry)
        message = ("This game's result didn't match what the other players' games reported, so it wasn't counted"
                   + (f" (your {meta['ante']:,} VC ante is back)" if meta.get("ante") else "") + ". It's been logged.")
        result = {"cancelled": True, "reason": "disputed", "disputed": True, "reward": 0, "message": message, "balance": balance,
                  "verdict": {"why": verdict["why"], "others": verdict["others"], "game": meta.get("hub_game")}}
        c.execute("UPDATE matches SET status='cancelled', result=?, updated_at=? WHERE id=?", (encode(result), time.time(), match_id))
        self.dispute_watch(c, aid)
        return result

    def dispute_watch(self, c, aid):
        """An account in disputes with DISPUTE_WARN or more different people in a day is named in the log (a griefer, or
        a broken game). Counted from the disputed games themselves: the people on either side of each."""
        since = time.time() - DISPUTE_WINDOW
        sides = {}
        for r in c.execute("SELECT account_id, result FROM matches WHERE status='cancelled' AND updated_at>? AND result LIKE '%disputed%'", (since,)):
            res = json.loads(r["result"] or "{}")
            if not res.get("disputed"):
                continue
            party = {r["account_id"], *res.get("verdict", {}).get("others", [])}
            for p in party:
                sides.setdefault(p, set()).update(party - {p})
        for p in {aid, *sides.get(aid, set())}:
            if len(sides.get(p, ())) >= DISPUTE_WARN:
                results_log(f"WARNING: {self.username_of(p)} ({p}) has been in disputed games with {len(sides[p])} different players in 24 hours")

    def cup_seed(self, conn, account_id):
        w = self.load_ai_world(conn, account_id)
        return int(w["seed"]) if w and isinstance(w.get("seed"), int) else 1

    @staticmethod
    def cup_entry(conn, account_id, window):
        row = conn.execute("SELECT data FROM cup_entries WHERE account_id=? AND window=?", (account_id, window)).fetchone()
        return {**cup.blank_entry(), **json.loads(row[0])} if row else cup.blank_entry()

    @staticmethod
    def save_cup_entry(conn, account_id, window, entry):
        conn.execute("INSERT INTO cup_entries(account_id,window,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(account_id,window) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
                     (account_id, window, encode(entry), time.time()))

    def cup_board(self, conn, account_id, window, until=None):
        me = self.cup_entry(conn, account_id, window)
        rows = cup.standings(self.cup_seed(conn, account_id), window, me, until)
        mine = next((r for r in rows if r["id"] == "me"), None)
        return rows, me, mine

    def cup_status(self, account_id):
        conn = self.db.conn
        with self.db.lock:
            now = time.time()
            w = cup.window_at(now)
            start, end = cup.window_bounds(w)
            ev = cup.active_event(now)  # (v0.4.7.5 qp3: which park event is on; None between events)
            rows, me, mine = self.cup_board(conn, account_id, w)
            top = rows[:25]
            around = []
            if mine and mine["rank"] > 25:
                i = mine["rank"] - 1
                around = rows[max(25, i - 2):i + 3]
            # the window that just closed: final standings and prizes (claimed once)
            prev = None
            pw = w - 1
            pentry = self.cup_entry(conn, account_id, pw)
            if pentry["games"] > 0:
                pev = cup.event_for_window(pw)
                prows, _, pmine = self.cup_board(conn, account_id, pw)
                prize = cup.prize_for(pmine["rank"] if pmine else None, len(prows), pev)
                prev = {"window": pw, "rank": pmine["rank"] if pmine else None, "field": len(prows), "net": pentry["net"], "games": pentry["games"],
                        "wins": pentry["wins"], "prize": prize, "claimed": bool(pentry.get("claimed")), "winner": prows[0] if prows else None,
                        "event": cup.public_event(pev, pw)}
            return {"window": w, "start": start, "end": end, "now": now, "antes": list(cup.ANTES), "field": len(rows),
                    "event": cup.public_event(ev, w),
                    "board": top, "around": around, "me": {**me, "rank": mine["rank"] if mine else None},
                    "prizes": cup.prize_table(ev),
                    "previous": prev, "event_schedule": cup.public_schedule()}

    # v0.4.8.7: the one AI world everybody connected to this service plays in (sim/world.js adoptSharedWorld): its seed and
    # its birth, made once and kept (shared_world), a new one after a season reset (a world born before it is the old one,
    # reset.stale_world). Everything else in it is worked out from these and the clock, the same on every screen
    def shared_world(self, now=None):
        now = time.time() if now is None else now
        old = lambda row: bool(self.season and self.reset_done and season.stale_world({"born": row[1]}, self.season))
        rows = self.db.query("SELECT seed, born FROM shared_world WHERE id=1")
        if rows and not old(rows[0]):
            return {"seed": int(rows[0][0]), "born": float(rows[0][1])}
        with self.db.transaction() as c:
            row = c.execute("SELECT seed, born FROM shared_world WHERE id=1").fetchone()
            if row and not old(row):
                return {"seed": int(row[0]), "born": float(row[1])}
            seed, born = secrets.randbelow(2 ** 31 - 2) + 1, float(now * 1000)
            c.execute("INSERT INTO shared_world(id,seed,born,created_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET seed=excluded.seed, born=excluded.born, created_at=excluded.created_at",
                      (seed, born, now))
        return {"seed": seed, "born": born}

    def shared_world_payload(self, now=None):
        """The shared world as the game takes it (GET /api/ai-world/canonical, the hub's hello and world messages): seed and
        born (ms), the service's clock (now, ms) and time zone (tz, minutes east of UTC: the world's days and hours are this
        service's), the prizes the AI field has won (standings with nobody's own entries in them, so no account's games
        change them) and the event schedule."""
        now = time.time() if now is None else now
        w = self.shared_world(now)
        through = cup.window_at(now) - 1
        key = (w["seed"], w["born"], through)
        cached = getattr(self, "_shared_unlocks", None)
        if not cached or cached[0] != key:
            cached = self._shared_unlocks = (key, {"prizes": cup.ai_prizes(w["seed"], w["born"] / 1000, {}, now), "through": through})
        return {**w, "now": now * 1000, "tz": time.localtime(now).tm_gmtoff // 60, "unlocks": cached[1], "schedule": cup.public_schedule()}

    # v0.4.8.5 qp7: the prizes the AI world has won in the closed event windows (cup.ai_prizes), for the client to dress
    # them in (sim/world.js setUnlocks). The rows are read under the lock; the standings are worked out after it (a cold
    # world can take a second; it's kept after that), so nobody else waits on them
    def ai_unlocks(self, account_id):
        with self.db.lock:
            conn = self.db.conn
            world = self.load_ai_world(conn, account_id)
            if not world:
                return {"prizes": {}, "through": None}
            seed = self.cup_seed(conn, account_id)
            mine = {int(r[0]): json.loads(r[1]) for r in conn.execute("SELECT window, data FROM cup_entries WHERE account_id=?", (account_id,))}
        born = world.get("born")
        born = float(born) / 1000 if isinstance(born, (int, float)) and not isinstance(born, bool) and born > 0 else time.time()
        now = time.time()
        return {"prizes": cup.ai_prizes(seed, born, mine, now), "through": cup.window_at(now) - 1}

    def rate_limit(self, ip, category):
        limit, period = (8, 600) if category == "register" else (25, 60)
        with self.attempt_lock:
            now = time.monotonic()
            # (once every 10 minutes, forget the addresses with nothing left inside the longest window: the table no
            # longer grows by one entry for every address that ever tried)
            if now - self.attempts_swept > 600:
                self.attempts_swept = now
                for key in [k for k, q in self.attempts.items() if not q or q[-1] < now - 600]:
                    del self.attempts[key]
            queue = self.attempts[(ip, category)]
            while queue and queue[0] < now - period:
                queue.popleft()
            if len(queue) >= limit:
                raise HTTPError(429, "Too many attempts. Try again shortly.")
            queue.append(now)

    # v0.4.7.5 qp3: the items an Icon badge brings with it (catalog items with "icon": <badge>): into the inventory, and
    # (equip=True, at the moment the badge unlocks) straight into their slot
    def grant_icon_items(self, c, aid, icon, char=None, equip=False):
        if not icon:
            return []
        items = [i for i in CATALOG.values() if i.get("icon") == icon]
        for i in items:
            c.execute("INSERT OR IGNORE INTO inventory VALUES(?,?,?)", (aid, i["id"], time.time()))
            if equip and char is not None and i.get("slot") in builds.EQUIP_SLOTS:
                char.setdefault("equipment", {})[i["slot"]] = i["id"]
                if i["id"] in ICON_EQUIP_ONCE:  # (qp5: put on at the unlock: the profile's one-time catch-up is done)
                    char[ICON_EQUIP_ONCE[i["id"]]] = True
        return [i["id"] for i in items]

    def eligible(self, char, item):
        # v0.4.7.5 qp3: an Icon badge's own package (the Hash-Slinging dunks) fits only the build that holds that badge
        if item.get("icon") and char.get("icon_badge") != item["icon"]:
            # (v0.4.8.5: and says whose it is: "... Icon badge: only a Stretch Big who has unlocked it can equip this.")
            ic = progression.ICON_BADGES.get(item["icon"], {})
            arch = {"two_way": "Two-Way"}.get(ic.get("archetype"), str(ic.get("archetype") or "").replace("_", " ").title())
            name = ic.get("name", item["icon"])  # (qp5: "Requires The General Icon badge", never "the The General")
            return f"Requires {'' if name.startswith('The ') else 'the '}{name} Icon badge" + (f": only a {arch} who has unlocked it can equip this." if arch else ".")
        if builds.overall(char["attributes"], char["position"]) < item.get("min_overall", 0):
            return f"Requires {item['min_overall']} overall."
        rep_lvl = progression.rep_level(char.get("progression", {}).get("rep", 0))
        if rep_lvl < item.get("rep_required", 0):
            return f"Requires Rep {progression.rep_label(item['rep_required'])}."
        for attr, need in self.min_attr_for(char, item).items():
            if char["attributes"].get(attr, 0) < need:
                return f"Requires {need} {attr.replace('_', ' ')}."
        return None

    # v0.4.7.5 qp3: the Block Packages ask a tier less of the tall and a tier more of the small (min_attr_tall /
    # min_attr_short with tall_height / short_height); everything else just has min_attr
    @staticmethod
    def min_attr_for(char, item):
        h = char.get("height") or 78
        if item.get("tall_height") and h >= item["tall_height"] and "min_attr_tall" in item:
            return item["min_attr_tall"] or {}
        if item.get("short_height") and h <= item["short_height"] and "min_attr_short" in item:
            return item["min_attr_short"] or {}
        return item.get("min_attr") or {}

    # qp3: signing in on the online socket from your own copy of the game (no cookie crosses over from another
    # origin): an online account here, by token, password or a new one with the join code. Returns (aid, username, token).
    def online_auth(self, msg, ip):
        t = msg.get("t")
        build = msg.get("build")
        if build != self.build:
            raise online.AuthError("version", f"Your game isn't the same version as the host's (yours {VERSION} \u00b7 {str(build or '?')[:12]}, "
                                              f"the host's {VERSION} \u00b7 {self.build}). Update your copy to the host's, restart it and connect again.")
        if t == "hi":
            return None
        if t == "auth":
            aid = self.db.authenticate(msg.get("token") if isinstance(msg.get("token"), str) else None)
            if not aid:
                raise online.AuthError("token", "Sign in again to go online.")
            return aid, self.db.query("SELECT username FROM accounts WHERE id=?", (aid,))[0][0], msg.get("token")
        if t not in ("login", "register"):
            raise online.AuthError("auth", "Sign in first.")
        try:
            self.rate_limit(ip, t)
        except HTTPError as e:
            raise online.AuthError("rate", e.message)
        username, password = msg.get("username"), msg.get("password")
        if not isinstance(username, str) or not re.fullmatch(r"[a-zA-Z0-9_]{3,24}", username) or username.lower() == "localplayer":
            raise online.AuthError("auth", "Username: 3-24 letters, numbers, or underscores. localplayer is reserved.")
        username = username.lower()
        if not isinstance(password, str) or not 8 <= len(password) <= 128:
            raise online.AuthError("auth", "Password must be 8-128 characters.")
        if t == "register":
            if self.join_code and not hmac.compare_digest(str(msg.get("join_code") or "").strip().encode(), self.join_code.encode()):
                raise online.AuthError("auth", "That join code isn't right: ask whoever hosts the game for it.")
            try:
                aid = self.db.create_account(username, password, [])
            except sqlite3.IntegrityError:
                raise online.AuthError("auth", "That username is taken on this host. Pick another, or sign in.")
        else:
            rows = self.db.query("SELECT * FROM accounts WHERE username=?", (username,))
            row = rows[0] if rows else None
            hashed = hashlib.scrypt(password.encode(), salt=bytes.fromhex(row["password_salt"]) if row else bytes(16), n=16384, r=8, p=1).hex()
            if not row or not hmac.compare_digest(hashed, row["password_hash"]):
                raise online.AuthError("auth", "Username or password is incorrect.")
            aid = row["id"]
        return aid, username, self.db.session(aid)

    def close(self):
        self.db.conn.close()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "RIMRIFT/" + VERSION

    @property
    def service(self):
        return self.server.service

    def log_message(self, fmt, *args):
        if args and isinstance(args[0], str) and (args[0].startswith(("GET /js/", "GET /css/", "GET /api/ping")) or " 304" in str(args[1:2])):
            return
        super().log_message(fmt, *args)

    def client_ip(self):
        """The player's address. On an online server (--server) the requests come through its own proxy on this
        machine, which passes the player's address on in X-Forwarded-For (the last one is the one it saw)."""
        peer = self.client_address[0]
        if self.service.behind_proxy and peer in ("127.0.0.1", "::1") and getattr(self, "headers", None):
            fwd = (self.headers.get("X-Forwarded-For") or "").split(",")[-1].strip()
            if fwd:
                return fwd
        return peer

    def is_local(self):
        return self.client_ip() in ("127.0.0.1", "::1")

    def address_string(self):
        return self.client_ip()  # (the log shows the player's address, not the proxy's)

    def headers_common(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        # (qp3: the online socket, /api/ws, on this same host; a WebSocket isn't covered by 'self' in every browser)
        host = self.headers.get("Host", "") if self.headers else ""
        ws = f" ws://{host} wss://{host}" if re.fullmatch(r"[A-Za-z0-9.\-]+(:\d{1,5})?|\[[0-9A-Fa-f:.]+\](:\d{1,5})?", host) else ""
        ws += "".join(" " + src for h in sorted(self.service.hub_hosts) for src in hub_socket_sources(h))  # (your friends' hosted games)
        self.send_header("Content-Security-Policy", f"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'{ws}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")

    def respond(self, status, payload, cookie=None):
        data = encode(payload).encode()
        self.send_response(status)
        self.headers_common()
        if status >= 400:
            self.close_connection = True
            self.send_header("Connection", "close")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(data)

    def token(self):
        cookie = http.cookies.SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            return cookie["ah_session"].value if "ah_session" in cookie else None
        except http.cookies.CookieError:
            return None

    def account(self):
        account = self.service.db.authenticate(self.token())
        if not account:
            raise HTTPError(401, "Sign in to continue.")
        return account

    def session_cookie(self, token):
        return f"ah_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000" + ("; Secure" if self.service.secure_cookies else "")

    def body(self):
        origin = self.headers.get("Origin")
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme not in ("http", "https") or parsed.netloc != self.headers.get("Host"):
                raise HTTPError(403, "Cross-origin changes are not allowed.")
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            raise HTTPError(415, "Use JSON requests.")
        if self.headers.get("Transfer-Encoding"):
            raise HTTPError(400, "Chunked requests are not supported.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise HTTPError(400, "Invalid request length.")
        # (v0.4.8.9: a Gauntlet run's finish carries the nemesis world, up to gauntlet.MAX_WORLD_BYTES, with its summary)
        limit = PRORUN_MAX + 4096 if urlsplit(self.path).path == "/api/prorun" else 160 * 1024 if urlsplit(self.path).path == "/api/gauntlet/finish" else 65536
        if not 0 < length <= limit:
            raise HTTPError(413, "Request body exceeds limit or is empty.")
        try:
            data = json.loads(self.rfile.read(length), parse_constant=lambda v: (_ for _ in ()).throw(ValueError(v)))
        except (ValueError, UnicodeDecodeError):
            raise HTTPError(400, "Invalid JSON.")
        if not isinstance(data, dict):
            raise HTTPError(400, "Expected a JSON object.")
        return data

    # v0.4.7.5 qp3: the online socket (online.py). Same sign-in cookie as the rest of the API; same-origin only.
    def websocket(self):
        origin = self.headers.get("Origin")
        same = bool(origin) and urlsplit(origin).netloc == self.headers.get("Host")
        # qp3: a game from this service signs in with its cookie; your friends' own copies (a page on their own PC,
        # http://127.0.0.1) sign in on the socket itself, with a token or their online account (see Service.online_auth)
        own_copy = bool(origin) and not same and urlsplit(origin).scheme == "http" and urlsplit(origin).hostname in ("127.0.0.1", "localhost", "::1")
        if not same and not own_copy:
            raise HTTPError(403, "Cross-origin sockets are not allowed.")
        aid = self.account() if same else None
        key = self.headers.get("Sec-WebSocket-Key", "")
        if self.headers.get("Upgrade", "").lower() != "websocket" or "upgrade" not in self.headers.get("Connection", "").lower() or not key:
            raise HTTPError(400, "Expected a WebSocket upgrade.")
        username = self.service.db.query("SELECT username FROM accounts WHERE id=?", (aid,))[0][0] if aid else None
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", online.accept_key(key))
        self.end_headers()
        self.wfile.flush()
        self.close_connection = True
        try:
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)  # (inputs are tiny and time-critical)
        except OSError:
            pass
        conn = online.WSConn(self.rfile, self.wfile, self.connection, aid, username)
        conn.ip = self.client_ip()
        self.service.hub.serve(conn)

    # ---------------- GET ----------------
    def do_GET(self):
        try:
            path = urlsplit(self.path).path
            s = self.service
            s.maybe_reset()  # (v0.4.8.6 qp: the season reset, the moment it's due)
            # ---------- the service: health, the game's config, your profile ----------
            if path == "/api/health":
                return self.respond(200, {"ready": True, "schema_version": SCHEMA_VERSION, "version": VERSION, "app": "rimrift"})  # (v0.4.8.6; RIMRIFT.exe takes this or the old name)
            if path == "/api/ping":
                s.last_ping = time.monotonic()
                return self.respond(200, {"ok": True})
            if path == "/api/config":
                return self.respond(200, {
                    "version": VERSION, "positions": builds.POSITIONS, "archetypes": builds.ARCHETYPES, "attributes": builds.ATTRIBUTES,
                    "skin": builds.SKIN, "hair": builds.HAIR, "hair_colors": builds.HAIR_COLORS, "faces": builds.FACES, "beards": builds.BEARDS, "eyes": builds.EYES,
                    "equip_slots": builds.EQUIP_SLOTS, "default_equipment": builds.DEFAULT_EQUIPMENT,
                    "venues": VENUES, "affiliations": progression.AFFILIATIONS, "catalog": list(CATALOG.values()),
                    "event": cup.public_event(cup.active_event()), "event_venues": sorted(cup.EVENT_VENUES),
                    "event_schedule": cup.public_schedule(), "server_time": time.time(),  # (qp4: the client follows the handovers itself)
                    "badges": progression.BADGES, "rep_thresholds": progression.REP_THRESHOLDS, "rep_tiers": progression.REP_TIERS,
                    "logos": progression.LOGOS, "woods": progression.WOODS,
                    # (qp3: the local account is only offered on the PC running the service)
                    "dev_accounts": s.dev_accounts and self.is_local(),
                    "wheel": {"segments": progression.WHEEL_SEGMENTS, "odds": progression.WHEEL_ODDS, "vc": progression.WHEEL_VC, "cooldown": progression.SPIN_COOLDOWN},
                    "icon_badges": progression.ICON_BADGES, "badge_rules": {"hof_limit": builds.HOF_LIMIT, "cap_breakers_per_hof": builds.CAP_BREAKERS_PER_HOF, "cap_breaker_hof_limit": builds.CAP_BREAKER_HOF_LIMIT, "ovr_cap": builds.OVR_CAP, "base_ovr_cap": builds.BASE_OVR_CAP, "prorun_games_per_ovr": builds.PRORUN_GAMES_PER_OVR, "legend_games_per_ovr": builds.LEGEND_GAMES_PER_OVR, "legend_ovr_cap": builds.LEGEND_OVR_CAP},
                    "boosts": {"categories": {k: {"name": v["name"], "attrs": v["attrs"]} for k, v in progression.BOOSTS.items()}, "amount": progression.BOOST_AMOUNT, "packs": progression.BOOST_PACKS, "max_games": progression.BOOST_MAX_GAMES},
                    "signed_in": bool(s.db.authenticate(self.token())),
                    # (qp3, Oct 12: the server this copy plays on by itself, and its join code, for this PC's own page only)
                    # (v0.4.8.6 qp: the season reset: when it happens, so an open game can warn and reload; done on this save?)
                    "season_reset": {"id": s.season["id"], "at": s.season["at"], "vc": s.season["vc"],
                                     "done": s.reset_done or season.done(s.db, s.season)} if s.season else None,
                    "online": {"hosting": s.hosting, "join_code": bool(s.join_code), "server": s.online_default()[0],
                               "server_code": s.online_default()[1] if self.is_local() else None}, "build": s.build,
                })
            if path == "/api/me":
                return self.respond(200, s.profile(self.account()))
            if path == "/api/wallet":
                aid = self.account()
                rows = s.db.query("SELECT id,delta,balance_after,kind,reference,created_at FROM ledger WHERE account_id=? ORDER BY id DESC LIMIT 200", (aid,))
                return self.respond(200, {"balance": s.db.query("SELECT balance FROM wallets WHERE account_id=?", (aid,))[0][0], "transactions": [dict(r) for r in rows]})
            # ---------- online: the hub's socket, friends, the link to another server, hosting ----------
            if path == "/api/ws":
                return self.websocket()
            if path == "/api/online":
                aid = self.account()
                me = s.db.query("SELECT username FROM accounts WHERE id=?", (aid,))[0][0]
                local = self.is_local()
                return self.respond(200, {"you": {"id": aid, "username": me}, "friends": s.hub.friends_payload(aid), "hosting": s.hosting,
                                          "players_on": sum(1 for c in list(s.hub.conns.values()) if c.alive),
                                          # (the host's own screen: whether the router opened the port, and the address for friends)
                                          **({"port": s.upnp.status()} if local and s.upnp else {})})
            if path == "/api/online-link":
                # qp3: the friend's game this account plays online through (its address, your online account there)
                rows = s.db.query("SELECT hub, username, token, offline FROM hub_links WHERE account_id=?", (self.account(),))
                link = dict(rows[0]) if rows else None
                if link:
                    link["offline"] = bool(link["offline"])
                return self.respond(200, {"link": link, "build": s.build, "server": s.online_default()[0]})
            if path == "/api/hosting.txt":
                # qp3: host.cmd's "your friends open ..." lines (this PC only; waits for the router's answer)
                if not self.is_local():
                    raise HTTPError(403, "Only on the hosting PC.")
                if s.public_url:
                    text = f"SERVER {s.public_url}\n"
                else:
                    text = s.upnp.summary() if s.upnp else ("NO Hosting without opening the port automatically (--no-upnp).\n" if s.hosting else "NO Not hosting.\n")
                text += f"BUILD {VERSION} {s.build}\n"  # (friends playing from their own copy need this same game)
                # (who's on, and the games being played: deploy/update.sh waits for no games before it restarts)
                text += f"ONLINE {sum(1 for c in list(s.hub.conns.values()) if c.alive)}\nGAMES {len(s.hub.games)}\n"
                data = text.encode()
                self.send_response(200)
                self.headers_common()
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            # ---------- the AI world ----------
            if path == "/api/ai-world/canonical":  # (v0.4.8.7: the one AI world everybody on this service plays in)
                return self.respond(200, s.shared_world_payload())
            if path == "/api/ai-world/unlocks":  # (v0.4.8.5 qp7: what the AI world has won)
                return self.respond(200, s.ai_unlocks(self.account()))
            # ---------- games ----------
            if re.fullmatch(r"/api/matches/[a-f0-9-]{36}", path):
                aid = self.account()
                rows = s.db.query("SELECT id,mode,status,seed,meta,result FROM matches WHERE id=? AND account_id=?", (path.split("/")[-1], aid))
                if not rows:
                    raise HTTPError(404, "Game not found.")
                r = rows[0]
                return self.respond(200, {"id": r["id"], "mode": r["mode"], "status": r["status"], "seed": r["seed"], "meta": json.loads(r["meta"] or "{}"), "result": json.loads(r["result"] or "null")})
            if path == "/api/prorun":
                aid = self.account()
                cid = (parse_qs(urlsplit(self.path).query).get("character_id") or [""])[0]
                s.character(aid, cid)
                rows = s.db.query("SELECT data, updated_at FROM prorun_careers WHERE character_id=? AND account_id=?", (cid, aid))
                return self.respond(200, {"career": json.loads(rows[0]["data"]) if rows else None, "updated_at": rows[0]["updated_at"] if rows else None})
            # ---------- crews and the park events (the Cup) ----------
            if path == "/api/crew":
                return self.respond(200, s.crew_status(self.account()))
            if path == "/api/cup":
                return self.respond(200, s.cup_status(self.account()))
            # ---------- Pro-Am ----------
            # v0.4.8.8 The Pro-Am Overhaul (server/proam.py): the season, your team and builds; search; a team
            if path == "/api/proam":
                return self.respond(200, s.proam.status(self.account()))
            if path == "/api/proam/search":
                self.account()
                return self.respond(200, s.proam.search((parse_qs(urlsplit(self.path).query).get("q") or [""])[0]))
            if path == "/api/proam/teams":
                aid = self.account()
                return self.respond(200, s.proam.team(aid, (parse_qs(urlsplit(self.path).query).get("id") or [""])[0]))
            # ---------- the Gauntlet ----------
            # v0.4.8.9 The Gauntlet (server/gauntlet.py): converted players, the nemesis world, unlocks, stats, the feed
            if path == "/api/gauntlet/profile":
                return self.respond(200, s.gauntlet.profile(self.account()))
            if path.startswith("/api/"):
                raise HTTPError(404, "Endpoint not found.")
            return self.static(path)
        except (HTTPError, builds.Invalid) as e:
            self.respond(e.status if isinstance(e, HTTPError) else 400, {"error": e.message if isinstance(e, HTTPError) else str(e)})
        except (BrokenPipeError, ConnectionResetError):
            pass

    def static(self, path):
        relative = "index.html" if path in ("/", "") else path.lstrip("/")
        # (v0.4.8.6 RIMRIFT: a browser that asks the site for its icon without a page that names one, e.g. a tab on
        # /api/health or a bookmark, gets the RIMRIFT mark too, not a 404 and a blank icon)
        relative = "brand/favicon.ico" if relative == "favicon.ico" else relative
        if ".." in relative or relative.startswith("dev/") or "\\" in relative:
            raise HTTPError(404, "File not found.")
        file = (CLIENT / relative).resolve()
        if CLIENT.resolve() not in file.parents or not file.is_file() or file.suffix.lower() not in STATIC_EXT:
            raise HTTPError(404, "File not found.")
        if file.suffix.lower() in STATIC_MEDIA:
            return self.static_media(file)
        etag, content, gz = static_entry(file)
        if gz is not None and "gzip" in (self.headers.get("Accept-Encoding") or "").lower():
            content, etag = gz, etag[:-1] + '-gz"'  # (each form has its own tag)
        else:
            gz = None
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.headers_common()
            self.send_header("ETag", etag)
            self.send_header("Vary", "Accept-Encoding")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(200)
        self.headers_common()
        ctype = STATIC_EXT[file.suffix.lower()]
        if ctype.startswith("text/") or ctype.endswith("javascript") or ctype.endswith("json"):
            ctype += "; charset=utf-8"
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-cache")
        self.send_header("ETag", etag)
        self.send_header("Vary", "Accept-Encoding")
        if gz is not None:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    # v0.4.4 soundtrack files: byte-range support (seeking / streaming) and long caching
    def static_media(self, file):
        size = file.stat().st_size
        start, end = 0, size - 1
        rng = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", "").strip())
        if rng and (rng.group(1) or rng.group(2)):
            if rng.group(1):
                start = int(rng.group(1))
                end = min(size - 1, int(rng.group(2))) if rng.group(2) else size - 1
            else:
                start = max(0, size - int(rng.group(2)))
            if start > end or start >= size:
                self.send_response(416)
                self.headers_common()
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        with open(file, "rb") as f:
            f.seek(start)
            content = f.read(end - start + 1)
        self.send_response(206 if rng else 200)
        self.headers_common()
        self.send_header("Content-Type", STATIC_EXT[file.suffix.lower()])
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "max-age=86400")
        if rng:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    # ---------------- POST ----------------
    def do_POST(self):
        try:
            data = self.body()
            path = urlsplit(self.path).path
            s, db = self.service, self.service.db
            s.maybe_reset()  # (v0.4.8.6 qp: the season reset, the moment it's due)
            # ---------- signed out: quit, register and log in, the local account, bug reports ----------
            if path == "/api/quit":
                builds.strict_keys(data, ())
                if not s.quit_allowed or not self.is_local():
                    raise HTTPError(403, "Quit is only available when the game was started from RIMRIFT.exe.")
                s.quit_requested = True
                threading.Timer(0.4, self.server.shutdown).start()
                print("Quit from the game window; stopping the service.", flush=True)
                return self.respond(200, {"ok": True})
            if path in ("/api/register", "/api/login"):
                builds.strict_keys(data, ("username", "password", "join_code"))
                s.rate_limit(self.client_ip(), "register" if path.endswith("register") else "login")
                username, password = data.get("username"), data.get("password")
                if not isinstance(username, str) or not re.fullmatch(r"[a-zA-Z0-9_]{3,24}", username) or username.lower() == "localplayer":
                    raise builds.Invalid("Username: 3-24 letters, numbers, or underscores. localplayer is reserved.")
                username = username.lower()
                if not isinstance(password, str) or not 8 <= len(password) <= 128:
                    raise builds.Invalid("Password must be 8-128 characters.")
                if path.endswith("register"):
                    # qp3: a hosted service (--join-code) only lets in the friends who have the code
                    if s.join_code and not hmac.compare_digest(str(data.get("join_code") or "").strip().encode(), s.join_code.encode()):
                        raise HTTPError(403, "This server needs its join code to make an account (ask whoever runs it).")
                    try:
                        aid = db.create_account(username, password, self.starter_items())
                    except sqlite3.IntegrityError:
                        raise HTTPError(409, "That username already exists. Sign in instead.")
                else:
                    rows = db.query("SELECT * FROM accounts WHERE username=?", (username,))
                    row = rows[0] if rows else None
                    hashed = hashlib.scrypt(password.encode(), salt=bytes.fromhex(row["password_salt"]) if row else bytes(16), n=16384, r=8, p=1).hex()
                    if not row or not hmac.compare_digest(hashed, row["password_hash"]):
                        raise HTTPError(401, "Username or password is incorrect.")
                    aid = row["id"]
                self.ensure_starters(aid)
                return self.respond(200, s.profile(aid), self.session_cookie(db.session(aid)))
            if path == "/api/dev-account":
                builds.strict_keys(data, ())
                if not s.dev_accounts or not self.is_local():
                    raise HTTPError(403, "Local account flow is disabled.")
                aid = db.create_account("localplayer", secrets.token_urlsafe(32), self.starter_items(), local=True)
                self.ensure_starters(aid)
                return self.respond(200, s.profile(aid), self.session_cookie(db.session(aid)))
            if path == "/api/bug-report":
                # v0.4.7.5: works signed in or not (a bug on the sign-in screen is still a bug)
                builds.strict_keys(data, ("key", "category", "what", "expected", "steps", "context"))
                s.rate_limit(self.client_ip(), "bug")
                try:
                    out = bugs.write_report(s.bug_root, data, VERSION)
                except bugs.BadReport as e:
                    raise builds.Invalid(str(e))
                print(f"Bug report #{out['number']} saved to {out['path']}", flush=True)
                return self.respond(200, out)
            # ---------- everything below needs a signed-in account ----------
            aid = self.account()
            # ---------- your session ----------
            if path == "/api/logout":
                builds.strict_keys(data, ())
                with db.transaction() as c:
                    c.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256((self.token() or "").encode()).hexdigest(),))
                return self.respond(200, {"ok": True}, "ah_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
            # ---------- online: the link to another server, this copy's default server, friends ----------
            if path == "/api/online-link":
                builds.strict_keys(data, ("hub", "username", "token", "clear", "offline"))
                if data.get("clear"):
                    with db.transaction() as c:
                        c.execute("DELETE FROM hub_links WHERE account_id=?", (aid,))
                    return self.respond(200, {"link": None})
                if "offline" in data and "hub" not in data:
                    # qp3 (Oct 12): play offline (the link and its sign-in stay, for connecting again), or connect again
                    off = bool(data["offline"])
                    with db.transaction() as c:
                        row = c.execute("SELECT hub, username, token FROM hub_links WHERE account_id=?", (aid,)).fetchone()
                        if row:
                            c.execute("UPDATE hub_links SET offline=?, updated_at=? WHERE account_id=?", (int(off), time.time(), aid))
                        elif off:
                            c.execute("INSERT INTO hub_links(account_id, hub, username, token, updated_at, offline) VALUES(?,?,?,?,?,1)", (aid, s.online_default()[0] or "", None, None, time.time()))
                        row = c.execute("SELECT hub, username, token, offline FROM hub_links WHERE account_id=?", (aid,)).fetchone()
                    link = dict(row) if row else None
                    if link:
                        link["offline"] = bool(link["offline"])
                    return self.respond(200, {"link": link})
                hub = normalize_hub(data.get("hub") if isinstance(data.get("hub"), str) else "")
                if not hub:
                    raise builds.Invalid("Type the server's address: like https://203-0-113-7.sslip.io, or an IP like 203.0.113.7 (with :port if it isn't 8765).")
                user, tok = data.get("username"), data.get("token")
                if user is not None and (not isinstance(user, str) or not re.fullmatch(r"[a-zA-Z0-9_]{3,24}", user)):
                    raise builds.Invalid("Invalid online username.")
                if tok is not None and (not isinstance(tok, str) or len(tok) > 200):
                    raise builds.Invalid("Invalid token.")
                with db.transaction() as c:
                    c.execute("INSERT INTO hub_links(account_id, hub, username, token, updated_at, offline) VALUES(?,?,?,?,?,0) ON CONFLICT(account_id) DO UPDATE SET hub=excluded.hub, username=excluded.username, "
                              "token=excluded.token, updated_at=excluded.updated_at, offline=0", (aid, hub, user, tok, time.time()))
                s.hub_hosts.add(hub)
                return self.respond(200, {"link": {"hub": hub, "username": user, "token": tok, "offline": False}})
            if path == "/api/online-default":
                # qp3 (Oct 12): this copy's own player writes the server every copy connects to by itself into online.json
                # (with its join code), to push to GitHub. Only from this PC, and not on a hosting or server copy
                builds.strict_keys(data, ("server", "joinCode"))
                if not self.is_local() or s.hosting or s.behind_proxy:
                    raise HTTPError(403, "Only from the game on this PC.")
                hub = normalize_hub(data.get("server") if isinstance(data.get("server"), str) else "")
                code = data.get("joinCode").strip() if isinstance(data.get("joinCode"), str) else ""
                if not hub:
                    raise builds.Invalid("That isn't a server address.")
                if code and not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", code):
                    raise builds.Invalid("A join code is letters, digits, - _ and . only.")
                save_online_default(hub, code or None)
                s.default_hub, s.default_join = hub, code or None
                s.hub_hosts.add(hub)
                return self.respond(200, {"server": hub, "joinCode": code or None})
            if path == "/api/online/friend":
                builds.strict_keys(data, ("username", "action"))
                s.rate_limit(self.client_ip(), "friend")
                if data.get("action") not in ("add", "accept", "decline", "remove") or not isinstance(data.get("username"), str):
                    raise builds.Invalid("Choose add, accept, decline or remove, and a username.")
                try:
                    msg = online.friend_action(db, aid, data["username"], data["action"])
                except ValueError as e:
                    raise builds.Invalid(str(e))
                other = db.query("SELECT id FROM accounts WHERE username=?", (data["username"].lower(),))
                s.hub.push_presence(aid)
                if other:
                    s.hub.push_presence(other[0][0])
                return self.respond(200, {"message": msg, "friends": s.hub.friends_payload(aid)})
            # ---------- builds ----------
            if path == "/api/build-preview":
                build = builds.spec(data)
                attrs = builds.starting_attributes(build)
                char = {**build, "attributes": attrs}
                return self.respond(200, {**build, "attributes": attrs, **builds.describe(char), "equipment": builds.DEFAULT_EQUIPMENT})
            if path == "/api/characters":
                builds.strict_keys(data, ("key", "build"))
                build = builds.spec(data.get("build"))

                def create(c):
                    # v0.4.8.5 qp7: 4 build slots, and one more for every build holding an ICON slot, up to 8 (was a flat 4)
                    slots = s.build_slots(c, aid, claim=True)
                    if slots["used"] >= slots["unlocked"]:
                        raise builds.Invalid(builds.build_slot_rule(slots))
                    char = builds.normalize({**build, "id": str(uuid.uuid4()), "attributes": builds.starting_attributes(build),
                                             "equipment": dict(builds.DEFAULT_EQUIPMENT), "schema": 3, "badges": {}, "affiliation": None,
                                             "progression": {"games": 0, "wins": 0, "xp": 0, "rep": 0, "park": {"games": 0, "wins": 0, "streak": 0, "best_streak": 0}, "proam": {"games": 0, "wins": 0, "rp": 0, "best_rp": 0}, "career": {}}})
                    pc = gauntlet.entry_cards(gauntlet.park_cards(c, aid))  # (v0.4.8.9: a new build carries the account's park cards too)
                    if pc:
                        char["park_cards"] = pc
                    c.execute("INSERT INTO characters VALUES(?,?,?,?)", (char["id"], aid, encode(char), time.time()))
                    return {"character": s.describe(char), "build_slots": {**slots, "used": slots["used"] + 1}}
                return self.respond(200, db.once(aid, data.get("key"), "character_create", build, create))
            char_route = re.fullmatch(r"/api/characters/([a-f0-9-]{36})/(upgrade|appearance|equip|affiliation|capbreakers|cbrespec)", path)
            if char_route:
                return self.character_action(aid, data, *char_route.groups())
            del_route = re.fullmatch(r"/api/characters/([a-f0-9-]{36})/delete", path)  # (v0.4.8.5 qp8: deleting a build)
            if del_route:
                return self.delete_character(aid, data, del_route.group(1))
            # ---------- the store, the Daily Spin, boosts, locker codes ----------
            if path == "/api/store/purchase":
                builds.strict_keys(data, ("key", "item_id", "character_id"))
                item = CATALOG.get(data.get("item_id")) if isinstance(data.get("item_id"), str) else None
                if not item:
                    raise builds.Invalid("Item not found.")
                payload = {"item_id": item["id"], "character_id": data.get("character_id")}

                def purchase(c):
                    char = s.character(aid, data.get("character_id"), c)
                    if c.execute("SELECT 1 FROM inventory WHERE account_id=? AND item_id=?", (aid, item["id"])).fetchone():
                        return {"item_id": item["id"], "cost": 0, "already_owned": True, "balance": c.execute("SELECT balance FROM wallets WHERE account_id=?", (aid,)).fetchone()[0]}
                    if item.get("exclusive") == "cup":
                        raise builds.Invalid("King Tut Cup exclusive. Win it in the Cup.")
                    if item.get("exclusive") == "jungle":
                        raise builds.Invalid("Jungle Ballers exclusive. Win it in the Jungle.")
                    if item.get("exclusive") == "beat":
                        raise builds.Invalid("And The Beat Goes On exclusive. Win it at the Beat Goes On park.")
                    if item.get("exclusive") == "monster":
                        raise builds.Invalid("Monster Mash exclusive. Win it at the Monster Mash.")
                    if item.get("exclusive") == "favela":  # (v0.4.8.7)
                        raise builds.Invalid("The Favelas exclusive. Win it at the Favelas.")
                    if item.get("exclusive") == "icon":
                        raise builds.Invalid("Icon badge exclusive. It comes with the Icon badge; it cannot be bought.")
                    if item.get("exclusive") == "proam":  # (v0.4.8.8: rank and season items)
                        raise builds.Invalid("Pro-Am exclusive. Won, not bought: earn it in Pro-Am.")
                    if item.get("exclusive"):
                        raise builds.Invalid("Daily Spin exclusive. Win it on the wheel in your park.")
                    why = s.eligible(char, item)
                    if why:
                        raise builds.Invalid(why)
                    balance = db.change_wallet(c, aid, -item["price"], "store_purchase", "purchase:" + data["key"])
                    c.execute("INSERT INTO inventory VALUES(?,?,?)", (aid, item["id"], time.time()))
                    return {"item_id": item["id"], "cost": item["price"], "balance": balance}
                return self.respond(200, db.once(aid, data.get("key"), "purchase", payload, purchase))
            if path == "/api/daily-spin":
                return self.daily_spin(aid, data)
            if path == "/api/boosts/purchase":
                return self.buy_boost(aid, data)
            if path == "/api/locker-codes/redeem":
                return self.redeem_code(aid, data)
            # ---------- the AI world ----------
            if path == "/api/ai-world":
                return self.save_ai_world(aid, data)
            # ---------- games: tickets and results, the Pro Run's career ----------
            if path == "/api/matches":
                return self.start_match(aid, data)
            match_route = re.fullmatch(r"/api/matches/([a-f0-9-]{36})/(complete|cancel)", path)
            if match_route:
                match_id, action = match_route.groups()
                return self.finish_match(aid, match_id, action, data)
            if path == "/api/prorun":
                return self.save_prorun(aid, data)
            # ---------- crews and the park events (the Cup) ----------
            if path == "/api/crew":
                return self.crew_action(aid, data)
            if path == "/api/cup/claim":
                return self.claim_cup(aid, data)
            # ---------- Pro-Am (the old single-game team, and server/proam.py) ----------
            if path == "/api/proam/team":
                builds.strict_keys(data, ("key", "team"))
                team = progression.proam_team(data.get("team"))

                def save_team(c):
                    old = c.execute("SELECT data FROM proam_teams WHERE account_id=?", (aid,)).fetchone()
                    record = json.loads(old[0]) if old else {"wins": 0, "losses": 0}
                    merged = {**team, "wins": record.get("wins", 0), "losses": record.get("losses", 0)}
                    if old:
                        c.execute("UPDATE proam_teams SET data=?, updated_at=? WHERE account_id=?", (encode(merged), time.time(), aid))
                    else:
                        c.execute("INSERT INTO proam_teams VALUES(?,?,?,?)", (aid, encode(merged), time.time(), time.time()))
                    return {"team": merged}
                return self.respond(200, db.once(aid, data.get("key"), "proam_team", team, save_team))
            # v0.4.8.8 Pro-Am: create, update, join, leave, answer, kick, handon, draft, queue, lineup (server/proam.py)
            pa_route = re.fullmatch(r"/api/proam/(create|update|join|leave|answer|kick|handon|draft|queue|lineup)", path)
            if pa_route:
                return self.respond(200, s.proam.action(aid, pa_route.group(1), data))
            # ---------- the Gauntlet ----------
            # v0.4.8.9 The Gauntlet: a run's start and finish (paid once), and the sacrifices (server/gauntlet.py)
            if path == "/api/gauntlet/start":
                return self.respond(200, s.gauntlet.start(aid, data))
            if path == "/api/gauntlet/finish":
                try:
                    return self.respond(200, s.gauntlet.finish(aid, data))
                except gauntlet.Conflict as e:  # (v0.4.8.9 qp1: the run's replay refused its payout)
                    return self.respond(409, {"error": str(e), **e.detail})
            if path == "/api/gauntlet/sacrifice":
                return self.respond(200, s.gauntlet.sacrifice(aid, data))
            raise HTTPError(404, "Endpoint not found.")
        except HTTPError as e:
            self.respond(e.status, {"error": e.message})
        except (builds.Invalid, TypeError, KeyError) as e:
            self.respond(400, {"error": str(e) if isinstance(e, builds.Invalid) else "Invalid request fields."})
        except sqlite3.IntegrityError:
            self.respond(409, {"error": "Request conflicts with saved state."})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            import traceback
            traceback.print_exc()
            self.respond(500, {"error": "Service error. Nothing was charged or rewarded."})

    def starter_items(self):
        return [i for i in CATALOG if CATALOG[i]["price"] == 0 and not CATALOG[i].get("exclusive")]

    def ensure_starters(self, aid):
        """Grant newly added free items (e.g. default animations) to existing accounts."""
        with self.service.db.transaction() as c:
            for item_id in self.starter_items():
                c.execute("INSERT OR IGNORE INTO inventory VALUES(?,?,?)", (aid, item_id, time.time()))

    # v0.4.8.5 qp8: deleting a build (MyPlayer → Players, after a 5-second hold). Owner only, and never while it's in a game
    # that can still finish (GAME_OPEN_SECS). One transaction: its games (matches; their foreign key to characters is
    # enforced, and they're only its own history) and its Pro Run career go with it. What every build shares stays: VC
    # and the ledger, the locker, the crew, the Pro-Am team, Cup entries, the AI world. A build holding an ICON slot leaves
    # it open for the account (icon_slots), so 4 builds can have 5 slots; it's counted once and never announced again.
    def delete_character(self, aid, data, char_id):
        s, db = self.service, self.service.db
        builds.strict_keys(data, ("key",))

        def run(c):
            char = s.character(aid, char_id, c)  # (404 for another account's build, or one already gone)
            gone = s.remove_build(c, aid, char)
            rest = [s.describe(builds.normalize(json.loads(r[0]))) for r in c.execute("SELECT data FROM characters WHERE account_id=? ORDER BY created_at", (aid,)).fetchall()]
            return {"deleted": {"id": char_id, "name": char.get("name"), **gone},
                    "build_slots": s.build_slots(c, aid), "characters": rest}
        return self.respond(200, db.once(aid, data.get("key"), "delete:" + char_id, {}, run))

    def character_action(self, aid, data, char_id, action):
        s, db = self.service, self.service.db
        allowed = {"upgrade": ("key", "targets", "max"), "appearance": ("key", "appearance"), "equip": ("key", "item_id", "slot"), "affiliation": ("key", "affiliation"),
                   "capbreakers": ("key", "attribute", "count"), "cbrespec": ("key",)}[action]
        builds.strict_keys(data, allowed)
        payload = {k: v for k, v in data.items() if k != "key"}

        def mutate(c):
            char = s.character(aid, char_id, c)
            result = {}
            if action == "upgrade":
                if ("max" in data and data["max"] is not True) or ("max" in data and "targets" in data):
                    raise builds.Invalid("Use max=true or explicit targets.")
                targets = builds.max_targets(char) if data.get("max") is True else data.get("targets", {})
                cost, upgraded = builds.quote(char, targets)
                if cost == 0:
                    raise builds.Invalid("Player is already at those attributes.")
                balance = db.change_wallet(c, aid, -cost, "attribute_upgrade", "upgrade:" + data["key"])
                char["attributes"] = upgraded
                result = {"cost": cost, "balance": balance}
            elif action == "capbreakers":
                builds.apply_cap_breakers(char, data.get("attribute"), data.get("count", 1))
            elif action == "cbrespec":
                # v0.4.8.7: ICON builds take back their cap breakers to place again (the first free, then 250,000 VC)
                cost = builds.respec_cap_breakers(char)
                balance = db.change_wallet(c, aid, -cost, "capbreaker_respec", "cbrespec:" + data["key"]) if cost else None
                result = {"cost": cost, **({"balance": balance} if balance is not None else {})}
            elif action == "appearance":
                char["appearance"] = builds.appearance(data.get("appearance", {}))
            elif action == "affiliation":
                aff = data.get("affiliation")
                if aff not in progression.AFFILIATIONS:
                    raise builds.Invalid("Choose Harbor Kings, Old Brick Society or Foundry Rivets.")
                if char.get("affiliation"):
                    raise builds.Invalid("Affiliation is chosen once per player.")
                char["affiliation"] = aff
            else:
                slot, item_id = data.get("slot"), data.get("item_id")
                if slot not in builds.EQUIP_SLOTS:
                    raise builds.Invalid("Unsupported equipment slot.")
                if item_id is None:
                    if slot in builds.DEFAULT_EQUIPMENT:
                        char["equipment"][slot] = builds.DEFAULT_EQUIPMENT[slot]
                    else:
                        char["equipment"].pop(slot, None)
                else:
                    item = CATALOG.get(item_id) if isinstance(item_id, str) else None
                    if not item or item["slot"] != slot:
                        raise builds.Invalid("Item does not fit that slot.")
                    # (v0.4.8.5: an Icon badge's own item says so first, owned or not: it's that Icon's holder's alone)
                    if item.get("icon") and char.get("icon_badge") != item["icon"]:
                        raise builds.Invalid(s.eligible(char, item))
                    if not c.execute("SELECT 1 FROM inventory WHERE account_id=? AND item_id=?", (aid, item_id)).fetchone():
                        raise builds.Invalid("You do not own that item.")
                    why = s.eligible(char, item)
                    if why:
                        raise builds.Invalid(why)
                    char["equipment"][slot] = item_id
            # v0.4.8.5 qp7: an upgrade or cap breakers can take a build to 99 and make it an ICON: its build slot opens now
            opened = s.icon_slot_check(c, aid, char)
            c.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), char_id))
            return {**result, "character": s.describe(char), **({"build_slot_unlocked": opened, "build_slots": s.build_slots(c, aid)} if opened else {})}
        return self.respond(200, db.once(aid, data.get("key"), action + ":" + char_id, payload, mutate))

    # ---------------- v0.4.2: daily rewards wheel ----------------
    def crew_action(self, aid, data):
        s, db = self.service, self.service.db
        builds.strict_keys(data, ("key", "action", "name", "tag", "color", "member", "xp"))
        action = data.get("action")
        if action not in ("create", "update", "add", "remove", "online_xp"):
            raise builds.Invalid("Unknown crew action.")

        def run(c):
            cr = s.load_crew(c, aid)
            now = time.time()
            if action == "create":
                if cr:
                    raise builds.Invalid("You already have a crew.")
                try:
                    name, tag, color = crew.validate_identity(data.get("name"), data.get("tag"), data.get("color"))
                except ValueError as e:
                    raise builds.Invalid(str(e))
                cr = crew.new_crew(name, tag, color, now)
            elif not cr:
                raise builds.Invalid("Start a crew first.")
            elif action == "online_xp":
                # qp3: crew XP your crew's real members earned in their own games (collected from the online hub)
                xp = builds.integer(data.get("xp"), 1, 1_000_000, "XP")
                cr["online_xp"] = cr.get("online_xp", 0) + xp
            elif action == "update":
                try:
                    cr["name"], cr["tag"], cr["color"] = crew.validate_identity(data.get("name", cr["name"]), data.get("tag", cr["tag"]), data.get("color", cr["color"]))
                except ValueError as e:
                    raise builds.Invalid(str(e))
            else:
                mid = data.get("member")
                if not isinstance(mid, str) or not progression.AI_ID.match(mid):
                    raise builds.Invalid("Pick a player.")
                ids = [m["id"] for m in cr["members"]]
                if action == "add":
                    _, friends = s.crew_world(c, aid)
                    if mid not in friends:
                        raise builds.Invalid("Only friends can join your crew. Add him as a friend first.")
                    if mid in ids:
                        raise builds.Invalid("Already in your crew.")
                    if len(ids) >= crew.MAX_MEMBERS:
                        raise builds.Invalid(f"Your crew is full ({crew.MAX_MEMBERS} + you).")
                    cr["members"].append({"id": mid, "since": now, "xp": 0, "hours": 0})
                else:
                    if mid not in ids:
                        raise builds.Invalid("He isn't in your crew.")
                    gone = next(m for m in cr["members"] if m["id"] == mid)
                    cr["former_xp"] = cr.get("former_xp", 0) + gone.get("xp", 0)  # what he earned stays with the crew
                    cr["members"] = [m for m in cr["members"] if m["id"] != mid]
            s.save_crew(c, aid, cr)
            return {"crew": crew.describe(cr)}
        payload = {k: v for k, v in data.items() if k != "key"}
        return self.respond(200, db.once(aid, data.get("key"), "crew:" + action, payload, run))

    def claim_cup(self, aid, data):
        s, db = self.service, self.service.db
        builds.strict_keys(data, ("key", "window"))
        w = builds.integer(data.get("window"), 0, 10 ** 6, "Window")
        if w >= cup.window_at():
            raise builds.Invalid("This Cup is still running. Prizes are paid when it ends.")

        def claim(c):
            entry = s.cup_entry(c, aid, w)
            if entry["games"] <= 0:
                raise builds.Invalid("You didn't play in that Cup.")
            if entry.get("claimed"):
                raise builds.Invalid("Prizes for that Cup were already claimed.")
            rows, _, mine = s.cup_board(c, aid, w)
            prize = cup.prize_for(mine["rank"] if mine else None, len(rows), cup.event_for_window(w))
            if not prize:
                raise builds.Invalid("No prize for that Cup.")
            granted = []
            for item_id in prize["items"]:
                if item_id in CATALOG and not c.execute("SELECT 1 FROM inventory WHERE account_id=? AND item_id=?", (aid, item_id)).fetchone():
                    c.execute("INSERT INTO inventory VALUES(?,?,?)", (aid, item_id, time.time()))
                    granted.append(item_id)
            balance = db.change_wallet(c, aid, prize["vc"], "cup_prize", f"cup:{w}") if prize["vc"] else c.execute("SELECT balance FROM wallets WHERE account_id=?", (aid,)).fetchone()[0]
            entry["claimed"] = True
            s.save_cup_entry(c, aid, w, entry)
            return {"window": w, "rank": mine["rank"], "prize": prize, "items": granted, "balance": balance}
        return self.respond(200, db.once(aid, data.get("key"), "cup_claim", {"window": w}, claim))

    def daily_spin(self, aid, data):
        s, db = self.service, self.service.db
        builds.strict_keys(data, ("key",))

        def spin(c):
            now = time.time()
            row = c.execute("SELECT last_spin, spins FROM daily_spins WHERE account_id=?", (aid,)).fetchone()
            if row and now - row["last_spin"] < progression.SPIN_COOLDOWN:
                raise builds.Invalid("Your next spin isn't ready yet.")
            owned = {r[0] for r in c.execute("SELECT item_id FROM inventory WHERE account_id=?", (aid,))}
            prize = progression.spin_wheel(random.SystemRandom(), CATALOG, owned)
            balance = c.execute("SELECT balance FROM wallets WHERE account_id=?", (aid,)).fetchone()[0]
            if prize["vc"]:
                balance = db.change_wallet(c, aid, prize["vc"], "daily_spin", "spin:" + data["key"])
            if prize["item"]:
                c.execute("INSERT OR IGNORE INTO inventory VALUES(?,?,?)", (aid, prize["item"], now))
            c.execute("INSERT INTO daily_spins(account_id,last_spin,spins,last_prize) VALUES(?,?,1,?) ON CONFLICT(account_id) DO UPDATE SET last_spin=excluded.last_spin, spins=spins+1, last_prize=excluded.last_prize",
                      (aid, now, encode(prize)))
            return {**prize, "balance": balance, "next_at": now + progression.SPIN_COOLDOWN}
        return self.respond(200, db.once(aid, data.get("key"), "daily_spin", {}, spin))

    # ---------------- v0.4.4: locker codes ----------------
    def redeem_code(self, aid, data):
        s, db = self.service, self.service.db
        builds.strict_keys(data, ("key", "code"))
        code = progression.normalize_code(data.get("code"))
        reward = progression.LOCKER_CODES.get(code)
        if not reward:
            # (v0.4.8.6 qp: every code so far was retired with the season reset)
            raise builds.Invalid("That locker code has expired." if code in progression.RETIRED_LOCKER_CODES else "That locker code isn't valid.")

        def redeem(c):
            row = c.execute("SELECT count FROM locker_redemptions WHERE account_id=? AND code=?", (aid, code)).fetchone()
            used = row[0] if row else 0
            if used >= reward["max_per_account"]:
                raise builds.Invalid(f"You've already redeemed {code} {reward['max_per_account']} times.")
            balance = db.change_wallet(c, aid, reward["vc"], "locker_code", "locker:" + data["key"])
            c.execute("INSERT INTO locker_redemptions(account_id,code,count,last_at) VALUES(?,?,1,?) ON CONFLICT(account_id,code) DO UPDATE SET count=count+1, last_at=excluded.last_at",
                      (aid, code, time.time()))
            return {"code": code, "vc": reward["vc"], "label": reward["label"], "balance": balance, "used": used + 1, "max": reward["max_per_account"]}
        return self.respond(200, db.once(aid, data.get("key"), "locker_code", {"code": code}, redeem))

    # ---------------- v0.4.4: persistent AI world (friends, squad, AI players' progress) ----------------
    def save_ai_world(self, aid, data):
        s, db = self.service, self.service.db
        builds.strict_keys(data, ("key", "world"))
        # (v0.4.8.6 qp: after the season reset, a game left open from before it can't save its old AI world back)
        if s.season and s.reset_done and season.stale_world(data.get("world"), s.season):
            raise HTTPError(409, "The season reset started a new AI world. Restart the game to play in it.")
        world = progression.ai_world(data.get("world"))

        def save(c):
            c.execute("INSERT INTO ai_world(account_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
                      (aid, encode(world), time.time()))
            return {"world": world}
        return self.respond(200, db.once(aid, data.get("key"), "ai_world", {"n": len(world.get("friends", []))}, save))

    # ---------------- v0.4.2: boosts ----------------
    def buy_boost(self, aid, data):
        s, db = self.service, self.service.db
        builds.strict_keys(data, ("key", "character_id", "category", "games"))
        cat, games = data.get("category"), data.get("games")
        if cat not in progression.BOOSTS:
            raise builds.Invalid("Unknown boost category.")
        if isinstance(games, bool) or games not in progression.BOOST_PACKS:
            raise builds.Invalid("Boosts come in 1, 3 or 5 game packs.")
        payload = {"character_id": data.get("character_id"), "category": cat, "games": games}

        def buy(c):
            char = s.character(aid, data.get("character_id"), c)
            boosts = char.setdefault("boosts", {})
            have = int(boosts.get(cat, 0))
            if have + games > progression.BOOST_MAX_GAMES:
                raise builds.Invalid(f"You can stock up to {progression.BOOST_MAX_GAMES} games of a boost.")
            balance = db.change_wallet(c, aid, -progression.BOOST_PACKS[games], "boost_purchase", "boost:" + data["key"])
            boosts[cat] = have + games
            c.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), char["id"]))
            return {"balance": balance, "character": s.describe(char)}
        return self.respond(200, db.once(aid, data.get("key"), "boost", payload, buy))

    def start_match(self, aid, data):
        s, db = self.service, self.service.db
        builds.strict_keys(data, ("key", "character_id", "mode", "venue", "format", "target", "quarter_len", "difficulty", "ante", "bounty_streak", "opp_rating", "pa_game", "pa_home"))
        if "pa_game" in data and data.get("mode") != "proam":
            raise builds.Invalid("A series game is a Pro-Am game.")
        # v0.4.8.8: a 3s game on a Gold+ Pro-Am team's home court, from its HUB (game/proamhub.js): a quarter of a park
        # game's VC, no Rep, the usual badge progress, and nothing else (no streaks, ante, bounty, cup, crew or rank)
        pa_home = "pa_home" in data
        if pa_home:
            if data.get("pa_home") is not True or data.get("mode", "park") != "park" or "ante" in data or "bounty_streak" in data:
                raise builds.Invalid("A home-court game is a plain park game: pa_home true, no ante or bounty.")
            with db.transaction() as pc:
                why = s.proam.home_court_check(pc, aid, data.get("venue"))
            if why:
                raise builds.Invalid(why)
        mode = data.get("mode", "park")
        if mode not in ("park", "proam", "prorun"):
            raise builds.Invalid("Mode must be park, proam or prorun.")
        if "opp_rating" in data and mode != "proam":
            raise builds.Invalid("An opponent rating is for Pro-Am games.")
        char = s.character(aid, data.get("character_id"))
        venue = data.get("venue", "brick")
        if venue not in {v["id"] for v in VENUES}:
            raise builds.Invalid("Choose a supported venue.")
        fmt = builds.integer(data.get("format", 3), 1, 5, "Format")
        if fmt not in progression.MODES[mode]["formats"]:
            raise builds.Invalid("Unsupported team size for this mode.")
        meta = {"format": fmt, "venue": venue}
        # v0.4.8.5: until Pro 1 a build's park games are in its home park (park events are open to everyone)
        if mode == "park" and venue in progression.AFFILIATIONS and char.get("affiliation") and venue != char["affiliation"] \
                and progression.rep_level(char.get("progression", {}).get("rep", 0)) < progression.TRAVEL_REP_LEVEL:
            raise builds.Invalid("Reach Pro 1 to play at other parks; until then your games are in your home park.")
        if mode == "park":
            target = builds.integer(data.get("target", 21), 11, 21, "Target")
            if target not in (11, 15, 21):
                raise builds.Invalid("Park games go to 11, 15 or 21.")
            meta["target"] = target
            meta["streak"] = 0 if pa_home else char.get("progression", {}).get("park", {}).get("streak", 0)
            if pa_home:
                meta["pa_home"] = True
            # v0.4.7.5: challenging kings on a streak above 6 puts their bounty on the line
            bs = data.get("bounty_streak")
            if bs is not None:
                bs = builds.integer(bs, 0, 99, "Bounty streak")
                if progression.bounty_for(bs):
                    meta["bounty"] = progression.bounty_for(bs)
                    meta["bounty_streak"] = bs
            if venue in cup.EVENT_VENUES:
                # v0.4.5 King Tut Cup / v0.4.7.5 qp3 park events: every game is an ante-up, and the event keeps its own
                # streak. An event that isn't on the schedule is closed: its park takes no games
                ev = cup.active_event()
                if not ev or ev["venue"] != venue:
                    raise builds.Invalid(cup.EVENT_BY_VENUE[venue]["name"] + " isn't running right now.")
                ante = data.get("ante")
                if ante not in cup.ANTES:
                    raise builds.Invalid("Choose an ante: " + ", ".join(f"{a:,}" for a in cup.ANTES) + " VC.")
                meta["ante"] = ante
                meta["cup_window"] = cup.window_at()
                meta["event"] = ev["id"]
                meta["streak"] = char.get("progression", {}).get("cup", {}).get("streak", 0)
        elif venue in cup.EVENT_VENUES:
            raise builds.Invalid(cup.EVENT_BY_VENUE[venue]["name"] + " only runs park games.")
        elif mode == "prorun":
            # v0.4.5 The Pro Run: college and pro games, 3- to 12-minute quarters (v0.4.8.5: from 1 minute)
            if venue != "arena":
                raise builds.Invalid("Pro Run games are played in the arena.")
            meta["quarter_len"] = builds.integer(data.get("quarter_len", 300), 60, 720, "Quarter length")
            meta["quarters"] = 4
        else:
            ql = builds.integer(data.get("quarter_len", 180), 120, 420, "Quarter length")
            meta["quarter_len"] = ql
            meta["quarters"] = 4
            row = db.query("SELECT data FROM proam_teams WHERE account_id=?", (aid,))
            if not row and data.get("pa_game") is None:  # (v0.4.8.8: a series game is the Pro-Am team's)
                raise builds.Invalid("Create your Pro-Am team first.")
            # v0.4.8.5: how strong the other team is (RP-like, 0..3200: the client's AI level or its players' RP), for the
            # competition part of the RP this game pays; without one, a team as strong as you
            opp = data.get("opp_rating")
            meta["opp_rating"] = progression.proam_state(char)["rp"] if opp is None else builds.integer(opp, 0, progression.PROAM_RATING_MAX, "Opponent rating")
            # v0.4.8.8: a game of the team's series (server/proam.py ProAm.ticket_meta: his team's, on, not played yet)
            if data.get("pa_game") is not None:
                with db.transaction() as pc:
                    meta["pa_game"] = s.proam.ticket_meta(pc, aid, data)
        diff = data.get("difficulty", 0.6)
        if not isinstance(diff, (int, float)) or isinstance(diff, bool) or not 0.2 <= diff <= 1.0:
            raise builds.Invalid("Difficulty must be 0.2-1.0.")
        meta["difficulty"] = round(float(diff), 2)
        # v0.4.8.7: a game played through this service's online server is bound to it here, by the server's own word (not
        # a flag the game sends): its result is checked against the other real players' at the end (hosted_verdict)
        hg = s.hub.game_of(aid) if mode in ("park", "proam") and s.hub else None
        if hg:
            meta["hub_game"] = {"game": hg["game"], "run": hg["run"], "started": hg["started"]}

        def create(c):
            # abandoning an unfinished game forfeits it (no reward, resets park streak)
            for old in c.execute("SELECT id, mode, character_id, venue, meta FROM matches WHERE account_id=? AND status='running'", (aid,)).fetchall():
                rank = s.proam_forfeit(c, old["character_id"], "abandoned") if old["mode"] == "proam" else None  # v0.4.8.5: -20 RP
                if old["mode"] == "proam":  # (v0.4.8.8: this season's -20, and a series game lost)
                    s.proam.forfeit(c, aid, old["character_id"], json.loads(old["meta"] or "{}"))
                c.execute("UPDATE matches SET status='cancelled', result=?, updated_at=? WHERE id=?", (encode({"cancelled": True, "reason": "abandoned", "reward": 0, **({"proam_rank": rank} if rank else {})}), time.time(), old["id"]))
                if old["venue"] in cup.EVENT_VENUES:
                    s.reset_cup_streak(c, old["character_id"])
                if old["mode"] in ("park", "proam", "prorun") and not json.loads(old["meta"] or "{}").get("pa_home"):  # (v0.4.8.8: a home-court game touches no streak)
                    s.reset_win_streak(c, old["character_id"])
            # v0.4.5: the Cup stake comes out of the wallet now; it's only paid back on a win
            if meta.get("ante"):
                db.change_wallet(c, aid, -meta["ante"], "cup_ante", "ante:" + data["key"])
                entry = s.cup_entry(c, aid, meta["cup_window"])
                entry["event"] = meta.get("event")
                entry["games"] += 1
                entry["staked"] += meta["ante"]
                entry["net"] -= meta["ante"]
                s.save_cup_entry(c, aid, meta["cup_window"], entry)
            # boosts are used up one game at a time when a park or Pro-Am game starts
            ch = s.character(aid, char["id"], c)
            active = sorted(k for k, v in (ch.get("boosts") or {}).items() if k in progression.BOOSTS and int(v) > 0)
            if active:
                for k in active:
                    ch["boosts"][k] = int(ch["boosts"][k]) - 1
                    if ch["boosts"][k] <= 0:
                        del ch["boosts"][k]
                c.execute("UPDATE characters SET data=? WHERE id=?", (encode(ch), ch["id"]))
            meta["boosts"] = active
            match_id = str(uuid.uuid4())
            seed = secrets.randbits(31)
            c.execute("INSERT INTO matches(id,account_id,character_id,status,seed,state,result,created_at,updated_at,venue,mode,meta) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                      (match_id, aid, char["id"], "running", seed, None, None, time.time(), time.time(), venue, mode, encode(meta)))
            return {"id": match_id, "seed": seed, "mode": mode, "meta": meta}
        return self.respond(200, db.once(aid, data.get("key"), "match_start", {k: v for k, v in data.items() if k != "key"}, create))

    # v0.4.5 The Pro Run: one career per player, saved whole (the season is simulated in the client; the
    # rewards still only come from validated game results)
    def save_prorun(self, aid, data):
        s, db = self.service, self.service.db
        builds.strict_keys(data, ("key", "character_id", "career"))
        s.character(aid, data.get("character_id"))
        career = data.get("career")
        if career is not None:
            if not isinstance(career, dict) or career.get("v") != 1 or career.get("phase") not in PRORUN_PHASES:
                raise builds.Invalid("Invalid Pro Run career.")
            blob = encode(career)
            if len(blob) > PRORUN_MAX:
                raise builds.Invalid("That career save is too large.")

        def save(c):
            if career is None:
                c.execute("DELETE FROM prorun_careers WHERE character_id=? AND account_id=?", (data["character_id"], aid))
                return {"saved": True, "reset": True}
            now = time.time()
            c.execute("INSERT INTO prorun_careers(character_id,account_id,data,created_at,updated_at) VALUES(?,?,?,?,?) "
                      "ON CONFLICT(character_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at WHERE prorun_careers.account_id=excluded.account_id",
                      (data["character_id"], aid, blob, now, now))
            return {"saved": True, "updated_at": now}
        return self.respond(200, db.once(aid, data.get("key"), "prorun_save", hashlib.sha256(encode(data.get("career")).encode()).hexdigest(), save))

    def finish_match(self, aid, match_id, action, data):
        s, db = self.service, self.service.db
        if action == "cancel":
            # v0.4.8.5: forfeit (Forfeit & leave from the pause menu) costs a Pro-Am game's RP; a lost connection doesn't
            builds.strict_keys(data, ("forfeit",))
            if not isinstance(data.get("forfeit", False), bool):
                raise builds.Invalid("forfeit must be true or false.")
            rank, char_out = None, None
            with db.transaction() as c:
                row = c.execute("SELECT status, result, mode, character_id, venue, meta FROM matches WHERE id=? AND account_id=?", (match_id, aid)).fetchone()
                if not row:
                    raise HTTPError(404, "Game not found.")
                if row["status"] != "running":
                    return self.respond(200, {"status": row["status"], "result": json.loads(row["result"] or "null")})
                if json.loads(row["meta"] or "{}").get("pa_home"):  # (v0.4.8.8: a home-court game left: nothing to undo)
                    c.execute("UPDATE matches SET status='cancelled', result=?, updated_at=? WHERE id=?", (encode({"cancelled": True, "reason": "player_left", "reward": 0}), time.time(), match_id))
                    return self.respond(200, {"status": "cancelled", "reward": 0})
                if row["mode"] == "proam" and data.get("forfeit"):
                    rank = s.proam_forfeit(c, row["character_id"])
                    pm = c.execute("SELECT meta FROM matches WHERE id=?", (match_id,)).fetchone()
                    s.proam.forfeit(c, aid, row["character_id"], json.loads(pm[0] or "{}") if pm else {})  # (v0.4.8.8)
                    char_out = s.describe(s.character(aid, row["character_id"], c)) if rank else None
                c.execute("UPDATE matches SET status='cancelled', result=?, updated_at=? WHERE id=?", (encode({"cancelled": True, "reason": "forfeit" if rank else "player_left", "reward": 0, **({"proam_rank": rank} if rank else {})}), time.time(), match_id))
                if row["mode"] == "park" and row["venue"] in cup.EVENT_VENUES:
                    s.reset_cup_streak(c, row["character_id"])  # the stake is already gone
                elif row["mode"] == "park":
                    crow = c.execute("SELECT data FROM characters WHERE id=?", (row["character_id"],)).fetchone()
                    if crow:
                        char = builds.normalize(json.loads(crow[0]))
                        char["progression"].setdefault("park", {})["streak"] = 0
                        c.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), row["character_id"]))
                if row["mode"] in ("park", "proam", "prorun"):
                    s.reset_win_streak(c, row["character_id"])
                    if char_out:
                        char_out = s.describe(s.character(aid, row["character_id"], c))
            return self.respond(200, {"status": "cancelled", "reward": 0, **({"proam_rank": rank, "character": char_out} if rank else {})})
        builds.strict_keys(data, ("key", "summary", "mates", "crew_mates"))
        mates = data.get("mates") or []
        crew_mates = data.get("crew_mates") or 0  # (qp3: real crew members who ran with you in an online game)
        if not isinstance(crew_mates, int) or isinstance(crew_mates, bool) or not 0 <= crew_mates <= 4:
            raise builds.Invalid("Invalid crew teammates.")
        if not isinstance(mates, list) or len(mates) > 4 or not all(isinstance(m, str) and progression.AI_ID.match(m) for m in mates):
            raise builds.Invalid("Invalid teammates.")
        # v0.4.8.7: a hosted game's result is checked first, against what the other real players' games reported. The
        # wait for their ends happens here, before the transaction (and only once: a repeat of the same request is
        # answered from the first)
        verdict = None
        pre = db.query("SELECT status, mode, meta FROM matches WHERE id=? AND account_id=?", (match_id, aid))
        pre_meta = json.loads(pre[0]["meta"] or "{}") if pre else {}
        if pre and pre[0]["status"] == "running" and pre_meta.get("hub_game") and not db.query("SELECT 1 FROM requests WHERE account_id=? AND key=?", (aid, data.get("key"))):
            first = progression.validate_summary(data.get("summary"), {"mode": pre[0]["mode"], "meta": pre_meta})
            if not first["forfeit"]:  # (a forfeit pays nothing: nothing to check)
                verdict = s.hosted_verdict(aid, pre_meta["hub_game"], first)

        def complete(c):
            row = c.execute("SELECT * FROM matches WHERE id=? AND account_id=?", (match_id, aid)).fetchone()
            if not row:
                raise HTTPError(404, "Game not found.")
            if row["status"] == "completed":
                return json.loads(row["result"])
            if row["status"] != "running":
                old = json.loads(row["result"] or "null") or {}
                if old.get("disputed"):
                    return old  # (v0.4.8.7: asked again: the same answer)
                raise builds.Invalid("This game was cancelled.")
            ticket = {"mode": row["mode"], "meta": json.loads(row["meta"] or "{}")}
            elapsed = time.time() - row["created_at"]
            summary = progression.validate_summary(data.get("summary"), ticket)
            if summary["duration"] > elapsed + TIME_SLACK:
                raise builds.Invalid("Reported game time exceeds the time since the game started.")
            if verdict and verdict["state"] == "disputed":
                return s.void_disputed(c, aid, row, ticket["meta"], verdict, match_id)  # (v0.4.8.7: no rewards, the ante back)
            char = s.character(aid, row["character_id"], c)
            s.proam.settle_char(c, aid, char, proam.current_season(c)["n"])  # (v0.4.8.8: his rank boost is this season's)
            rw = progression.rewards(summary, ticket, char)
            home3s = bool(ticket["meta"].get("pa_home"))
            if home3s:  # (v0.4.8.8: a home-court game: a quarter of the park VC, no Rep, the badge progress as usual)
                rw = {**rw, "vc": int(rw["vc"] * progression.PA_HOME_VC), "rep": 0, "streak": 0, "streak_mult": 1.0, "bounty": 0, "pa_home": True}
            # v0.4.8.5: Pro-Am RP (worked out before apply_progress counts this game in the build's record): win or loss,
            # how strong the other team was, and how you played; a forfeited result costs what Forfeit & leave does
            proam_rank = None
            # (v0.4.8.8: a team's series game counts for the season's rank alone; the old RP is the "before Season 1" record)
            if row["mode"] == "proam" and not ticket["meta"].get("pa_game"):
                if summary["forfeit"]:
                    proam_rank = progression.proam_forfeit(char)
                else:
                    pa = progression.proam_state(char)
                    secs = ticket["meta"].get("quarter_len", 180) * ticket["meta"].get("quarters", 4)
                    change = progression.proam_rp_change(pa["rp"], ticket["meta"].get("opp_rating", pa["rp"]), rw["won"], summary["stats"], secs)
                    proam_rank = progression.proam_apply(char, change)
            # v0.4.8.8 Pro-Am: this season's RP and division, and a series game's result for the series (server/proam.py)
            pa_result = s.proam.complete(c, aid, char, summary, ticket, rw) if row["mode"] == "proam" else None
            prog = progression.apply_progress(char, summary, rw)
            icon_items = s.grant_icon_items(c, aid, prog["icon_unlocked"], char, equip=True) if prog["icon_unlocked"] else []
            balance = db.change_wallet(c, aid, rw["vc"], "match_reward", "match:" + match_id) if rw["vc"] > 0 else c.execute("SELECT balance FROM wallets WHERE account_id=?", (aid,)).fetchone()[0]
            # v0.4.8.5 qp7: the game that makes a build an ICON (its last badge maxed, its Legend +1 to 99) opens a build slot
            slot_opened = s.icon_slot_check(c, aid, char)
            c.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), char["id"]))
            team = None
            if row["mode"] == "proam" and not summary["forfeit"]:
                trow = c.execute("SELECT data FROM proam_teams WHERE account_id=?", (aid,)).fetchone()
                if trow:
                    team = json.loads(trow[0])
                    team["wins" if rw["won"] else "losses"] = team.get("wins" if rw["won"] else "losses", 0) + 1
                    c.execute("UPDATE proam_teams SET data=?, updated_at=? WHERE account_id=?", (encode(team), time.time(), aid))
            cup_info = None
            if rw.get("cup") is not None:
                cw = ticket["meta"].get("cup_window", cup.window_at())
                entry = s.cup_entry(c, aid, cw)
                entry["net"] += rw["vc"]
                entry["won_vc"] += rw["vc"]
                if rw["won"]:
                    entry["wins"] += 1
                entry["streak"] = rw["streak"]
                entry["best_streak"] = max(entry["best_streak"], rw["streak"])
                s.save_cup_entry(c, aid, cw, entry)
                rows, _, mine = s.cup_board(c, aid, cw)
                cup_info = {**rw["cup"], "window": cw, "net_change": rw["vc"] - rw["cup"]["ante"], "net": entry["net"], "rank": mine["rank"] if mine else None, "field": len(rows), "streak": rw["streak"]}
            # v0.4.5 crew XP: a share of the Rep this game paid, weighted by mode, doubled with a crew member on your team
            crew_info = None
            cr = s.load_crew(c, aid) if row["mode"] in ("park", "proam") and not home3s else None
            if cr and not summary["forfeit"]:
                ids = {m["id"] for m in cr["members"]}
                with_crew = any(m in ids for m in mates) or crew_mates > 0
                before = crew.level_info(crew.total_xp(cr))
                gain = crew.game_xp(rw["rep"], row["mode"], ticket["meta"].get("venue"), with_crew)
                cr["user_xp"] = cr.get("user_xp", 0) + gain
                cr["games"] = cr.get("games", 0) + 1
                cr["crew_games"] = cr.get("crew_games", 0) + (1 if with_crew else 0)
                s.save_crew(c, aid, cr)
                after = crew.level_info(crew.total_xp(cr))
                crew_info = {"xp": gain, "with_crew": with_crew, "level_before": before["level"], "level_after": after["level"], "total": after["xp"], "next": after["next"], "floor": after["floor"], "name": cr["name"], "tag": cr["tag"]}
            result = {"match_id": match_id, "mode": row["mode"], "won": rw["won"], "score": summary["score"], "vc": rw["vc"], "rep": rw["rep"], "cup": cup_info, "crew": crew_info,
                      "streak": rw["streak"], "bounty": rw.get("bounty", 0), "balance": balance, "rep_before": prog["rep_before"], "rep_after": prog["rep_after"],
                      "badges_upgraded": prog["badges_upgraded"], "badge_progress": rw["badges"], "stats": summary["stats"],
                      "streak_mult": rw.get("streak_mult", 1.0), "rank_boost": rw.get("rank_boost", 0), "cap_breakers_awarded": prog["cap_breakers_awarded"], "icon_unlocked": prog["icon_unlocked"], "icon_items": icon_items, "max_ovr_unlocked": prog["max_ovr_unlocked"],
                      "legend_ovr": prog.get("legend_ovr"), "character": s.describe(char), "proam_team": team, "proam_rank": proam_rank,
                      "build_slot_unlocked": slot_opened, **({"build_slots": s.build_slots(c, aid)} if slot_opened else {}),
                      **({"pa": pa_result} if pa_result else {}), **({"pa_home": True} if home3s else {})}
            c.execute("UPDATE matches SET status='completed', result=?, updated_at=? WHERE id=?", (encode(result), time.time(), match_id))
            return result
        out = db.once(aid, data.get("key"), "match_complete:" + match_id, [data.get("summary"), mates], complete)
        if out.get("disputed"):  # (v0.4.8.7: the game shows "Result not saved: <why>")
            return self.respond(409, {"error": out["message"], "disputed": True, "balance": out.get("balance")})
        if verdict:
            out = {**out, "checked": verdict["state"]}
        return self.respond(200, out)


# v0.4.8.6 RIMRIFT: the save is data/rimrift.sqlite3. A game folder from before the rename has the old one: the first start
# with the default path moves it over, in one piece (what its WAL still holds written into it first, and its -wal and -shm
# gone with it). If that can't be done safely, because something else still has it open (a game left running from before
# the update, a database viewer), the old file is used where it is, untouched, and it moves over on a later start. Never
# two saves, never half of one. An explicit --db is used as given and never renamed.
DB_NAME, OLD_DB_NAME = "rimrift.sqlite3", "afterhours.sqlite3"


def default_db(data_dir=None):
    data_dir = Path(data_dir or ROOT / "data")
    new, old = data_dir / DB_NAME, data_dir / OLD_DB_NAME
    if new.exists() or not old.exists():
        return new
    return new if migrate_db(old, new) else old


def migrate_db(old, new):
    """Move a save to its new name. True when it moved; False when it couldn't, and then nothing has changed."""
    try:
        conn = sqlite3.connect(str(old), timeout=0.2, isolation_level=None)
        try:
            busy = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            if busy and busy[0]:
                return False  # (someone else is reading or writing it right now)
            # leaving WAL mode needs the file to itself: with anyone else holding it open (even idle) this is refused
            if str(conn.execute("PRAGMA journal_mode=DELETE").fetchone()[0]).lower() != "delete":
                return False
        finally:
            conn.close()
        for side in ("-wal", "-shm"):  # (SQLite removes them leaving WAL mode; a leftover is empty, else stop)
            f = old.with_name(old.name + side)
            if f.exists():
                if side == "-wal" and f.stat().st_size:
                    return False
                f.unlink()
        if new.exists():
            return False
        os.rename(old, new)  # (the same folder: one atomic step)
        return True
    except (OSError, sqlite3.Error):
        return False


def main():
    p = argparse.ArgumentParser(description="RIMRIFT local service")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--db", default=None, help="The save (default: data/rimrift.sqlite3; one from before the rename moves over by itself)")
    p.add_argument("--no-dev-account", action="store_true")
    p.add_argument("--secure-cookies", action="store_true")
    p.add_argument("--open", action="store_true", help="Open the game in the default browser")
    # (v0.4.8.6 qp: 250,000 from the season reset on, what every reset account starts with; was 1,000,000)
    p.add_argument("--welcome-vc", type=int, default=250_000, help="One-time fictional VC granted to each NEW account (0 to grind from scratch)")
    p.add_argument("--exit-when-idle", type=float, default=0, metavar="SECONDS",
                   help="Used by RIMRIFT.exe: stop once the game window has stopped checking in for this long")
    p.add_argument("--online", action="store_true", help="Host for friends: listen on every network interface (unless --host is given)")
    p.add_argument("--join-code", default=env("JOIN_CODE"), metavar="CODE",
                   help="New accounts need this code (share it with your friends)")
    p.add_argument("--no-upnp", action="store_true", help="With --online: don't ask the router to forward the port (UPnP)")
    p.add_argument("--server", action="store_true",
                   help="An online server (deploy/install.sh): hosts for everyone from behind its own HTTPS proxy on this machine "
                        "(Caddy, which passes each player's address on); no local session, no UPnP, secure cookies")
    p.add_argument("--public-url", default=env("PUBLIC_URL"), metavar="URL",
                   help="With --server: the address players use, e.g. https://203-0-113-7.sslip.io")
    args = p.parse_args()
    if args.server:
        args.online, args.no_upnp, args.no_dev_account = True, True, True
        args.secure_cookies = args.secure_cookies or (args.public_url or "").startswith("https://")
    host = args.host
    if args.online and "--host" not in sys.argv and not args.server:
        host = "0.0.0.0"  # (an online server listens on this machine only: its proxy is the one players reach)
    # qp3: one service per port. (Windows can let a second one bind the same port: hosting while the game's own local
    # service is still up, your game would talk to one and your friends to the other, and you'd never see each other)
    try:
        with socket.create_connection(("127.0.0.1", args.port), timeout=0.6):
            print(f"Something is already running on port {args.port} (RIMRIFT itself?). " + (
                "Quit the game (Quit to desktop) and run host.cmd again: the hosted service is the one your game and your friends' games share."
                if args.online else "The game window can use that one; close it first to start a new service."), flush=True)
            sys.exit(2)
    except OSError:
        pass
    if args.online:
        # v0.4.8: a hosted service hands the interpreter between its sockets' threads every 1 ms instead of 5, so an input
        # that comes in while another thread is busy waits less to be passed on (the slowest 1% of relays: ~40% quicker
        # in tests/load_hub.py at 20 players and 40 watchers, for the same CPU)
        sys.setswitchinterval(0.001)
    db_path = args.db or default_db()  # (v0.4.8.6: the save under its RIMRIFT name, moved over from the old one if need be)
    service = Service(db_path, not args.no_dev_account, args.secure_cookies, max(0, args.welcome_vc), season.SEASON_RESET)
    service.hosting = bool(args.online)
    service.join_code = (args.join_code or "").strip() or None
    service.behind_proxy = bool(args.server)
    service.public_url = (args.public_url or "").strip().rstrip("/") or None if args.server else None
    server = ThreadingHTTPServer((host, args.port), Handler)
    server.daemon_threads = True
    server.service = service
    url = f"http://{'127.0.0.1' if host in ('0.0.0.0', '::') else host}:{server.server_address[1]}/"
    print(f"RIMRIFT v{VERSION}\nOpen {url}\nPress Ctrl+C to stop.", flush=True)
    print(f"Gauntlet replay checks: {gauntlet.replay_banner()}", flush=True)  # (v0.4.8.9 qp1: Node.js found or not)
    if args.online and not args.no_upnp:
        # qp3: the router forwards the port to this PC by itself (UPnP), for as long as the service runs
        service.upnp = upnp.PortMapper(server.server_address[1], "RIMRIFT")  # (v0.4.8.6: the router's port-mapping list says RIMRIFT)

        def open_port():
            service.upnp.open()
            print(service.upnp.message, flush=True)
        threading.Thread(target=open_port, daemon=True).start()
        if os.name == "nt":
            # (closing the service window ends the process without a KeyboardInterrupt: take the forwarding down first)
            try:
                import ctypes
                handler_type = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_uint)

                def on_console(event):
                    if event in (2, 5, 6):  # CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT
                        service.upnp.close()
                    return 0
                service.console_handler = handler_type(on_console)
                ctypes.windll.kernel32.SetConsoleCtrlHandler(service.console_handler, True)
            except Exception:  # noqa: BLE001  (best effort: the lease runs out on its own within the hour)
                pass
    if args.server:
        print(f"Online server for {service.public_url or '(no --public-url given)'}, behind its proxy (this machine, port {server.server_address[1]})"
              + (f"\nJoin code for new accounts: {service.join_code}" if service.join_code else "\nNo join code set: anyone can make an account (set one with --join-code)."), flush=True)
    elif args.online:
        print(f"Hosting online on port {server.server_address[1]} (every network interface). Friends open http://<your public IP>:{server.server_address[1]}/"
              + (f"\nJoin code for new accounts: {service.join_code}" if service.join_code else "\nNo join code set: anyone who can reach this port can make an account (use --join-code)."), flush=True)
    if args.open:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    if args.exit_when_idle > 0:
        service.quit_allowed = True
        started = time.monotonic()

        def watchdog():
            prev = time.monotonic()
            while True:
                time.sleep(2)
                now = time.monotonic()
                if now - prev > 20 and service.last_ping is not None:
                    service.last_ping = now  # the PC slept: give the window time to check in again
                prev = now
                last = service.last_ping
                idle = time.monotonic() - (last if last is not None else started)
                # before the first check-in allow time for the browser to start
                if idle > (args.exit_when_idle if last is not None else max(120, args.exit_when_idle)):
                    print("Game window closed; stopping the service.", flush=True)
                    server.shutdown()
                    return
        threading.Thread(target=watchdog, daemon=True).start()
    try:
        server.serve_forever(poll_interval=.1)
    except KeyboardInterrupt:
        pass
    finally:
        if service.upnp:
            service.upnp.close()
        server.server_close()
        service.close()
    if service.quit_requested:
        sys.exit(3)  # tells RIMRIFT.exe the player quit from the menu, so it closes the game window too


if __name__ == "__main__":
    main()
