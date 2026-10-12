"""Afterhours 16 v0.3 — dependency-free local service: accounts, characters, VC economy, store,
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
from . import builds, progression, cup, crew, bugs, online, upnp
from .database import Database, encode

ROOT = Path(__file__).resolve().parent.parent
CLIENT = ROOT / "client"
CATALOG = {item["id"]: item for item in json.loads((ROOT / "server/catalog.json").read_text())}
VENUES = json.loads((ROOT / "server/venues.json").read_text())
SCHEMA_VERSION = 11
PRORUN_MAX = 2_000_000  # bytes of JSON for one saved Pro Run career
PRORUN_PHASES = ("college", "draft", "season", "playoffs", "offseason")
VERSION = "0.4.7.5"
# Reported game clock may run ahead of wall clock by at most this many seconds.
# (Tests raise it to fast-forward simulated games; leave it alone for real play.)
TIME_SLACK = float(os.environ.get("AFTERHOURS16_TIME_SLACK", "30"))
# Explicit types: Windows registry MIME entries are often wrong (e.g. .js as text/plain), which breaks ES modules.
STATIC_EXT = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg",
              ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon", ".txt": "text/plain", ".woff2": "font/woff2",
              ".mp3": "audio/mpeg"}
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
    def __init__(self, db_path, dev_accounts=True, secure_cookies=False, welcome_vc=1_000_000):
        self.db = Database(db_path, welcome_vc)
        self.dev_accounts, self.secure_cookies = dev_accounts, secure_cookies
        self.attempts = collections.defaultdict(collections.deque)
        self.attempt_lock = threading.Lock()
        self.last_ping = None  # set by game windows opened from the launcher (see --exit-when-idle)
        self.quit_allowed = False  # only when started by Afterhours16.exe (--exit-when-idle)
        self.quit_requested = False
        self.bug_root = ROOT  # v0.4.7.5: bug reports go next to Afterhours16.exe
        # v0.4.7.5 qp3: playing online with friends (online.py). hosting: started with --online (reachable from other
        # machines); join_code: new accounts need it (--join-code)
        self.hosting, self.join_code = False, None
        # an online server (--server, deploy/install.sh): behind its own HTTPS proxy on the same machine, which forwards
        # each player's address (X-Forwarded-For); public_url is the address players use
        self.behind_proxy, self.public_url = False, None
        self.upnp = None  # upnp.PortMapper while hosting: the router forwards the port to this PC by itself
        self.build = compute_build()  # (qp3: the game's fingerprint, for the online version check)
        self.hub = online.Hub(self.db, self.online_auth)
        self.hub_hosts = {r[0] for r in self.db.query("SELECT DISTINCT hub FROM hub_links")}  # (the CSP lets the page reach them)
        self.upgrade_characters()

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
        return builds.normalize(json.loads(rows[0][0]))

    def describe(self, char):
        out = dict(char)
        out.update(builds.describe(char))
        out["rep"] = progression.rep_info(char.get("progression", {}).get("rep", 0))
        return out

    def profile(self, account_id):
        with self.db.lock:
            conn = self.db.conn
            account = conn.execute("SELECT id,username,created_at FROM accounts WHERE id=?", (account_id,)).fetchone()
            chars = [self.describe(builds.normalize(json.loads(r[0]))) for r in conn.execute("SELECT data FROM characters WHERE account_id=? ORDER BY created_at", (account_id,))]
            # v0.4.7.5 qp3: every Icon badge a build holds brings its own items (the Hash-Slinging dunk package); builds
            # that earned the Icon before this patch pick theirs up here
            for ch in chars:
                self.grant_icon_items(conn, account_id, ch.get("icon_badge"))
            team = conn.execute("SELECT data FROM proam_teams WHERE account_id=?", (account_id,)).fetchone()
            return {"account": dict(account),
                    "balance": conn.execute("SELECT balance FROM wallets WHERE account_id=?", (account_id,)).fetchone()[0],
                    "inventory": [r[0] for r in conn.execute("SELECT item_id FROM inventory WHERE account_id=?", (account_id,))],
                    "characters": chars,
                    "proam_team": json.loads(team[0]) if team else None,
                    "daily_spin": self.spin_status(conn, account_id),
                    "locker_codes": [{"code": r["code"], "used": r["count"], "max": progression.LOCKER_CODES.get(r["code"], {}).get("max_per_account", r["count"]),
                                      "label": progression.LOCKER_CODES.get(r["code"], {}).get("label", "")}
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
    @staticmethod
    def reset_cup_streak(c, char_id):
        crow = c.execute("SELECT data FROM characters WHERE id=?", (char_id,)).fetchone()
        if crow:
            char = builds.normalize(json.loads(crow[0]))
            char["progression"].setdefault("cup", {"games": 0, "wins": 0})["streak"] = 0
            c.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), char_id))

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
                    "previous": prev}

    def rate_limit(self, ip, category):
        limit, period = (8, 600) if category == "register" else (25, 60)
        with self.attempt_lock:
            queue = self.attempts[(ip, category)]
            now = time.monotonic()
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
        return [i["id"] for i in items]

    def eligible(self, char, item):
        # v0.4.7.5 qp3: an Icon badge's own package (the Hash-Slinging dunks) fits only the build that holds that badge
        if item.get("icon") and char.get("icon_badge") != item["icon"]:
            return f"Requires the {progression.ICON_BADGES.get(item['icon'], {}).get('name', item['icon'])} Icon badge."
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
    server_version = "Afterhours16/" + VERSION

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
        limit = PRORUN_MAX + 4096 if urlsplit(self.path).path == "/api/prorun" else 65536
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
            if path == "/api/health":
                return self.respond(200, {"ready": True, "schema_version": SCHEMA_VERSION, "version": VERSION, "app": "afterhours16"})
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
                    "badges": progression.BADGES, "rep_thresholds": progression.REP_THRESHOLDS, "rep_tiers": progression.REP_TIERS,
                    "logos": progression.LOGOS, "woods": progression.WOODS,
                    # (qp3: the local account is only offered on the PC running the service)
                    "dev_accounts": s.dev_accounts and self.is_local(),
                    "wheel": {"segments": progression.WHEEL_SEGMENTS, "odds": progression.WHEEL_ODDS, "vc": progression.WHEEL_VC, "cooldown": progression.SPIN_COOLDOWN},
                    "icon_badges": progression.ICON_BADGES, "badge_rules": {"hof_limit": builds.HOF_LIMIT, "cap_breakers_per_hof": builds.CAP_BREAKERS_PER_HOF, "cap_breaker_hof_limit": builds.CAP_BREAKER_HOF_LIMIT, "ovr_cap": builds.OVR_CAP, "base_ovr_cap": builds.BASE_OVR_CAP, "prorun_games_per_ovr": builds.PRORUN_GAMES_PER_OVR, "legend_games_per_ovr": builds.LEGEND_GAMES_PER_OVR, "legend_ovr_cap": builds.LEGEND_OVR_CAP},
                    "boosts": {"categories": {k: {"name": v["name"], "attrs": v["attrs"]} for k, v in progression.BOOSTS.items()}, "amount": progression.BOOST_AMOUNT, "packs": progression.BOOST_PACKS, "max_games": progression.BOOST_MAX_GAMES},
                    "signed_in": bool(s.db.authenticate(self.token())),
                    "online": {"hosting": s.hosting, "join_code": bool(s.join_code)}, "build": s.build,
                })
            if path == "/api/me":
                return self.respond(200, s.profile(self.account()))
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
                rows = s.db.query("SELECT hub, username, token FROM hub_links WHERE account_id=?", (self.account(),))
                return self.respond(200, {"link": dict(rows[0]) if rows else None, "build": s.build})
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
            if path == "/api/wallet":
                aid = self.account()
                rows = s.db.query("SELECT id,delta,balance_after,kind,reference,created_at FROM ledger WHERE account_id=? ORDER BY id DESC LIMIT 200", (aid,))
                return self.respond(200, {"balance": s.db.query("SELECT balance FROM wallets WHERE account_id=?", (aid,))[0][0], "transactions": [dict(r) for r in rows]})
            if path == "/api/crew":
                return self.respond(200, s.crew_status(self.account()))
            if path == "/api/prorun":
                aid = self.account()
                cid = (parse_qs(urlsplit(self.path).query).get("character_id") or [""])[0]
                s.character(aid, cid)
                rows = s.db.query("SELECT data, updated_at FROM prorun_careers WHERE character_id=? AND account_id=?", (cid, aid))
                return self.respond(200, {"career": json.loads(rows[0]["data"]) if rows else None, "updated_at": rows[0]["updated_at"] if rows else None})
            if path == "/api/cup":
                return self.respond(200, s.cup_status(self.account()))
            if re.fullmatch(r"/api/matches/[a-f0-9-]{36}", path):
                aid = self.account()
                rows = s.db.query("SELECT id,mode,status,seed,meta,result FROM matches WHERE id=? AND account_id=?", (path.split("/")[-1], aid))
                if not rows:
                    raise HTTPError(404, "Game not found.")
                r = rows[0]
                return self.respond(200, {"id": r["id"], "mode": r["mode"], "status": r["status"], "seed": r["seed"], "meta": json.loads(r["meta"] or "{}"), "result": json.loads(r["result"] or "null")})
            if path.startswith("/api/"):
                raise HTTPError(404, "Endpoint not found.")
            return self.static(path)
        except (HTTPError, builds.Invalid) as e:
            self.respond(e.status if isinstance(e, HTTPError) else 400, {"error": e.message if isinstance(e, HTTPError) else str(e)})
        except (BrokenPipeError, ConnectionResetError):
            pass

    def static(self, path):
        relative = "index.html" if path in ("/", "") else path.lstrip("/")
        if ".." in relative or relative.startswith("dev/") or "\\" in relative:
            raise HTTPError(404, "File not found.")
        file = (CLIENT / relative).resolve()
        if CLIENT.resolve() not in file.parents or not file.is_file() or file.suffix.lower() not in STATIC_EXT:
            raise HTTPError(404, "File not found.")
        if file.suffix.lower() == ".mp3":
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
        self.send_header("Content-Type", "audio/mpeg")
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
            if path == "/api/quit":
                builds.strict_keys(data, ())
                if not s.quit_allowed or not self.is_local():
                    raise HTTPError(403, "Quit is only available when the game was started from Afterhours16.exe.")
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
            aid = self.account()
            if path == "/api/logout":
                builds.strict_keys(data, ())
                with db.transaction() as c:
                    c.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256((self.token() or "").encode()).hexdigest(),))
                return self.respond(200, {"ok": True}, "ah_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
            if path == "/api/online-link":
                builds.strict_keys(data, ("hub", "username", "token", "clear"))
                if data.get("clear"):
                    with db.transaction() as c:
                        c.execute("DELETE FROM hub_links WHERE account_id=?", (aid,))
                    return self.respond(200, {"link": None})
                hub = normalize_hub(data.get("hub") if isinstance(data.get("hub"), str) else "")
                if not hub:
                    raise builds.Invalid("Type the server's address: like https://203-0-113-7.sslip.io, or an IP like 203.0.113.7 (with :port if it isn't 8765).")
                user, tok = data.get("username"), data.get("token")
                if user is not None and (not isinstance(user, str) or not re.fullmatch(r"[a-zA-Z0-9_]{3,24}", user)):
                    raise builds.Invalid("Invalid online username.")
                if tok is not None and (not isinstance(tok, str) or len(tok) > 200):
                    raise builds.Invalid("Invalid token.")
                with db.transaction() as c:
                    c.execute("INSERT INTO hub_links VALUES(?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET hub=excluded.hub, username=excluded.username, "
                              "token=excluded.token, updated_at=excluded.updated_at", (aid, hub, user, tok, time.time()))
                s.hub_hosts.add(hub)
                return self.respond(200, {"link": {"hub": hub, "username": user, "token": tok}})
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
            if path == "/api/build-preview":
                build = builds.spec(data)
                attrs = builds.starting_attributes(build)
                char = {**build, "attributes": attrs}
                return self.respond(200, {**build, "attributes": attrs, **builds.describe(char), "equipment": builds.DEFAULT_EQUIPMENT})
            if path == "/api/characters":
                builds.strict_keys(data, ("key", "build"))
                build = builds.spec(data.get("build"))

                def create(c):
                    if c.execute("SELECT count(*) FROM characters WHERE account_id=?", (aid,)).fetchone()[0] >= 4:
                        raise builds.Invalid("Up to four players per account.")
                    char = builds.normalize({**build, "id": str(uuid.uuid4()), "attributes": builds.starting_attributes(build),
                                             "equipment": dict(builds.DEFAULT_EQUIPMENT), "schema": 3, "badges": {}, "affiliation": None,
                                             "progression": {"games": 0, "wins": 0, "xp": 0, "rep": 0, "park": {"games": 0, "wins": 0, "streak": 0, "best_streak": 0}, "proam": {"games": 0, "wins": 0}, "career": {}}})
                    c.execute("INSERT INTO characters VALUES(?,?,?,?)", (char["id"], aid, encode(char), time.time()))
                    return {"character": s.describe(char)}
                return self.respond(200, db.once(aid, data.get("key"), "character_create", build, create))
            char_route = re.fullmatch(r"/api/characters/([a-f0-9-]{36})/(upgrade|appearance|equip|affiliation|capbreakers)", path)
            if char_route:
                return self.character_action(aid, data, *char_route.groups())
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
                    if item.get("exclusive") == "icon":
                        raise builds.Invalid("Icon badge exclusive. It comes with the Icon badge; it cannot be bought.")
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
            if path == "/api/ai-world":
                return self.save_ai_world(aid, data)
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
            if path == "/api/crew":
                return self.crew_action(aid, data)
            if path == "/api/prorun":
                return self.save_prorun(aid, data)
            if path == "/api/cup/claim":
                return self.claim_cup(aid, data)
            if path == "/api/matches":
                return self.start_match(aid, data)
            match_route = re.fullmatch(r"/api/matches/([a-f0-9-]{36})/(complete|cancel)", path)
            if match_route:
                match_id, action = match_route.groups()
                return self.finish_match(aid, match_id, action, data)
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

    def character_action(self, aid, data, char_id, action):
        s, db = self.service, self.service.db
        allowed = {"upgrade": ("key", "targets", "max"), "appearance": ("key", "appearance"), "equip": ("key", "item_id", "slot"), "affiliation": ("key", "affiliation"),
                   "capbreakers": ("key", "attribute", "count")}[action]
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
                    if not c.execute("SELECT 1 FROM inventory WHERE account_id=? AND item_id=?", (aid, item_id)).fetchone():
                        raise builds.Invalid("You do not own that item.")
                    why = s.eligible(char, item)
                    if why:
                        raise builds.Invalid(why)
                    char["equipment"][slot] = item_id
            c.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), char_id))
            return {**result, "character": s.describe(char)}
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
            raise builds.Invalid("That locker code isn't valid.")

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
        builds.strict_keys(data, ("key", "character_id", "mode", "venue", "format", "target", "quarter_len", "difficulty", "ante", "bounty_streak"))
        mode = data.get("mode", "park")
        if mode not in ("park", "proam", "prorun"):
            raise builds.Invalid("Mode must be park, proam or prorun.")
        char = s.character(aid, data.get("character_id"))
        venue = data.get("venue", "brick")
        if venue not in {v["id"] for v in VENUES}:
            raise builds.Invalid("Choose a supported venue.")
        fmt = builds.integer(data.get("format", 3), 1, 5, "Format")
        if fmt not in progression.MODES[mode]["formats"]:
            raise builds.Invalid("Unsupported team size for this mode.")
        meta = {"format": fmt, "venue": venue}
        if mode == "park":
            target = builds.integer(data.get("target", 21), 11, 21, "Target")
            if target not in (11, 15, 21):
                raise builds.Invalid("Park games go to 11, 15 or 21.")
            meta["target"] = target
            meta["streak"] = char.get("progression", {}).get("park", {}).get("streak", 0)
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
            # v0.4.5 The Pro Run: college and pro games, 3- to 12-minute quarters
            if venue != "arena":
                raise builds.Invalid("Pro Run games are played in the arena.")
            meta["quarter_len"] = builds.integer(data.get("quarter_len", 300), 120, 720, "Quarter length")
            meta["quarters"] = 4
        else:
            ql = builds.integer(data.get("quarter_len", 180), 120, 420, "Quarter length")
            meta["quarter_len"] = ql
            meta["quarters"] = 4
            row = db.query("SELECT data FROM proam_teams WHERE account_id=?", (aid,))
            if not row:
                raise builds.Invalid("Create your Pro-Am team first.")
        diff = data.get("difficulty", 0.6)
        if not isinstance(diff, (int, float)) or isinstance(diff, bool) or not 0.2 <= diff <= 1.0:
            raise builds.Invalid("Difficulty must be 0.2-1.0.")
        meta["difficulty"] = round(float(diff), 2)

        def create(c):
            # abandoning an unfinished game forfeits it (no reward, resets park streak)
            for old in c.execute("SELECT id, mode, character_id, venue FROM matches WHERE account_id=? AND status='running'", (aid,)).fetchall():
                c.execute("UPDATE matches SET status='cancelled', result=?, updated_at=? WHERE id=?", (encode({"cancelled": True, "reason": "abandoned", "reward": 0}), time.time(), old["id"]))
                if old["venue"] in cup.EVENT_VENUES:
                    s.reset_cup_streak(c, old["character_id"])
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
            builds.strict_keys(data, ())
            with db.transaction() as c:
                row = c.execute("SELECT status, result, mode, character_id, venue FROM matches WHERE id=? AND account_id=?", (match_id, aid)).fetchone()
                if not row:
                    raise HTTPError(404, "Game not found.")
                if row["status"] != "running":
                    return self.respond(200, {"status": row["status"], "result": json.loads(row["result"] or "null")})
                c.execute("UPDATE matches SET status='cancelled', result=?, updated_at=? WHERE id=?", (encode({"cancelled": True, "reason": "player_left", "reward": 0}), time.time(), match_id))
                if row["mode"] == "park" and row["venue"] in cup.EVENT_VENUES:
                    s.reset_cup_streak(c, row["character_id"])  # the stake is already gone
                elif row["mode"] == "park":
                    crow = c.execute("SELECT data FROM characters WHERE id=?", (row["character_id"],)).fetchone()
                    if crow:
                        char = builds.normalize(json.loads(crow[0]))
                        char["progression"].setdefault("park", {})["streak"] = 0
                        c.execute("UPDATE characters SET data=? WHERE id=?", (encode(char), row["character_id"]))
            return self.respond(200, {"status": "cancelled", "reward": 0})
        builds.strict_keys(data, ("key", "summary", "mates", "crew_mates"))
        mates = data.get("mates") or []
        crew_mates = data.get("crew_mates") or 0  # (qp3: real crew members who ran with you in an online game)
        if not isinstance(crew_mates, int) or isinstance(crew_mates, bool) or not 0 <= crew_mates <= 4:
            raise builds.Invalid("Invalid crew teammates.")
        if not isinstance(mates, list) or len(mates) > 4 or not all(isinstance(m, str) and progression.AI_ID.match(m) for m in mates):
            raise builds.Invalid("Invalid teammates.")

        def complete(c):
            row = c.execute("SELECT * FROM matches WHERE id=? AND account_id=?", (match_id, aid)).fetchone()
            if not row:
                raise HTTPError(404, "Game not found.")
            if row["status"] == "completed":
                return json.loads(row["result"])
            if row["status"] != "running":
                raise builds.Invalid("This game was cancelled.")
            ticket = {"mode": row["mode"], "meta": json.loads(row["meta"] or "{}")}
            elapsed = time.time() - row["created_at"]
            summary = progression.validate_summary(data.get("summary"), ticket)
            if summary["duration"] > elapsed + TIME_SLACK:
                raise builds.Invalid("Reported game time exceeds the time since the game started.")
            char = s.character(aid, row["character_id"], c)
            rw = progression.rewards(summary, ticket, char)
            prog = progression.apply_progress(char, summary, rw)
            icon_items = s.grant_icon_items(c, aid, prog["icon_unlocked"], char, equip=True) if prog["icon_unlocked"] else []
            balance = db.change_wallet(c, aid, rw["vc"], "match_reward", "match:" + match_id) if rw["vc"] > 0 else c.execute("SELECT balance FROM wallets WHERE account_id=?", (aid,)).fetchone()[0]
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
            cr = s.load_crew(c, aid) if row["mode"] in ("park", "proam") else None
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
                      "streak_mult": rw.get("streak_mult", 1.0), "cap_breakers_awarded": prog["cap_breakers_awarded"], "icon_unlocked": prog["icon_unlocked"], "icon_items": icon_items, "max_ovr_unlocked": prog["max_ovr_unlocked"],
                      "legend_ovr": prog.get("legend_ovr"), "character": s.describe(char), "proam_team": team}
            c.execute("UPDATE matches SET status='completed', result=?, updated_at=? WHERE id=?", (encode(result), time.time(), match_id))
            return result
        return self.respond(200, db.once(aid, data.get("key"), "match_complete:" + match_id, [data.get("summary"), mates], complete))


def main():
    p = argparse.ArgumentParser(description="Afterhours 16 local service")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--db", default=str(ROOT / "data/afterhours.sqlite3"))
    p.add_argument("--no-dev-account", action="store_true")
    p.add_argument("--secure-cookies", action="store_true")
    p.add_argument("--open", action="store_true", help="Open the game in the default browser")
    p.add_argument("--welcome-vc", type=int, default=1_000_000, help="One-time fictional VC granted to each NEW account (0 to grind from scratch)")
    p.add_argument("--exit-when-idle", type=float, default=0, metavar="SECONDS",
                   help="Used by Afterhours16.exe: stop once the game window has stopped checking in for this long")
    p.add_argument("--online", action="store_true", help="Host for friends: listen on every network interface (unless --host is given)")
    p.add_argument("--join-code", default=os.environ.get("AFTERHOURS16_JOIN_CODE") or None, metavar="CODE",
                   help="New accounts need this code (share it with your friends)")
    p.add_argument("--no-upnp", action="store_true", help="With --online: don't ask the router to forward the port (UPnP)")
    p.add_argument("--server", action="store_true",
                   help="An online server (deploy/install.sh): hosts for everyone from behind its own HTTPS proxy on this machine "
                        "(Caddy, which passes each player's address on); no local session, no UPnP, secure cookies")
    p.add_argument("--public-url", default=os.environ.get("AFTERHOURS16_PUBLIC_URL") or None, metavar="URL",
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
            print(f"Something is already running on port {args.port} (Afterhours 16 itself?). " + (
                "Quit the game (Quit to desktop) and run host.cmd again: the hosted service is the one your game and your friends' games share."
                if args.online else "The game window can use that one; close it first to start a new service."), flush=True)
            sys.exit(2)
    except OSError:
        pass
    service = Service(args.db, not args.no_dev_account, args.secure_cookies, max(0, args.welcome_vc))
    service.hosting = bool(args.online)
    service.join_code = (args.join_code or "").strip() or None
    service.behind_proxy = bool(args.server)
    service.public_url = (args.public_url or "").strip().rstrip("/") or None if args.server else None
    server = ThreadingHTTPServer((host, args.port), Handler)
    server.daemon_threads = True
    server.service = service
    url = f"http://{'127.0.0.1' if host in ('0.0.0.0', '::') else host}:{server.server_address[1]}/"
    print(f"Afterhours 16 v{VERSION}\nOpen {url}\nPress Ctrl+C to stop.", flush=True)
    if args.online and not args.no_upnp:
        # qp3: the router forwards the port to this PC by itself (UPnP), for as long as the service runs
        service.upnp = upnp.PortMapper(server.server_address[1], "Afterhours 16")

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
        sys.exit(3)  # tells Afterhours16.exe the player quit from the menu, so it closes the game window too


if __name__ == "__main__":
    main()
