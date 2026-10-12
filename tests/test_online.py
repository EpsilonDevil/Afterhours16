"""v0.4.7.5 qp3: playing online with friends (server/online.py): friends between real accounts, the join code, and the
WebSocket hub (presence, invites, rooms, the lockstep input relay).

Run from the project root:  python -m unittest discover -s tests -v
"""
import base64
import http.cookiejar
import json
import os
import socket
import struct
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app, online


class Client:
    """One player: an HTTP session (cookie jar) and, once connected, a raw WebSocket."""

    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.sock = None
        self.buf = b""

    def call(self, path, body=None):
        req = urllib.request.Request(self.base + path, method="GET" if body is None else "POST",
                                     data=None if body is None else json.dumps(body).encode(),
                                     headers={} if body is None else {"Content-Type": "application/json"})
        try:
            with self.opener.open(req, timeout=10) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"null")

    def connect(self, origin=True):
        host, port = self.base.split("//")[1].split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=5)
        cookie = "; ".join(f"{c.name}={c.value}" for c in self.jar)
        key = base64.b64encode(os.urandom(16)).decode()
        lines = [f"GET /api/ws HTTP/1.1", f"Host: {host}:{port}", "Upgrade: websocket", "Connection: Upgrade",
                 f"Sec-WebSocket-Key: {key}", "Sec-WebSocket-Version: 13", f"Cookie: {cookie}"]
        if isinstance(origin, str):
            lines.append(f"Origin: {origin}")
        elif origin:
            lines.append(f"Origin: http://{host}:{port}")
        self.sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                break
            head += chunk
        head, _, self.buf = head.partition(b"\r\n\r\n")
        status = int(head.split(b" ")[1])
        if status == 101:
            assert online.accept_key(key).encode() in head
        return status

    def send(self, obj):
        data = json.dumps(obj).encode()
        mask = os.urandom(4)
        n = len(data)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack("!H", n))
        self.sock.sendall(head + mask + bytes(b ^ mask[i & 3] for i, b in enumerate(data)))

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise EOFError
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv(self):
        b0, b1 = self._read(2)
        n = b1 & 0x7F
        if n == 126:
            n = struct.unpack("!H", self._read(2))[0]
        elif n == 127:
            n = struct.unpack("!Q", self._read(8))[0]
        data = self._read(n)
        if b0 & 0x0F == 0x8:
            raise EOFError
        return json.loads(data)

    def until(self, t, pred=lambda m: True, limit=60):
        for _ in range(limit):
            m = self.recv()
            if m.get("t") == t and pred(m):
                return m
        raise AssertionError(f"no {t} message")

    def close(self):
        if self.sock:
            self.sock.close()
            self.sock = None


class OnlineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "online.sqlite3", dev_accounts=False)
        cls.service.hosting, cls.service.join_code = True, "hoops42"
        cls.service.rate_limit = lambda ip, category: None  # (these tests make more accounts than one IP may in 10 minutes)
        handler = type("QuietHandler", (server_app.Handler,), {"log_message": lambda *a: None})
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server.daemon_threads = True
        cls.server.service = cls.service
        threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.service.close()
        cls.tmp.cleanup()

    def player(self, name):
        c = Client(self.base)
        st, body = c.call("/api/register", {"username": name, "password": "password123", "join_code": "hoops42"})
        self.assertEqual(st, 200, body)
        return c

    def test_join_code_and_config(self):
        c = Client(self.base)
        st, cfg = c.call("/api/config")
        self.assertEqual(cfg["online"], {"hosting": True, "join_code": True})
        st, body = c.call("/api/register", {"username": "nocode", "password": "password123"})
        self.assertEqual(st, 403)
        st, body = c.call("/api/register", {"username": "nocode", "password": "password123", "join_code": "wrong"})
        self.assertEqual(st, 403)
        st, body = c.call("/api/register", {"username": "withcode", "password": "password123", "join_code": " hoops42 "})
        self.assertEqual(st, 200, body)
        # signing in needs no code
        c2 = Client(self.base)
        self.assertEqual(c2.call("/api/login", {"username": "withcode", "password": "password123"})[0], 200)
        # the socket answers on the same origin only, and only signed in
        anon = Client(self.base)
        self.assertEqual(anon.connect(), 401)
        anon.close()
        self.assertEqual(c2.connect(origin=False), 403)
        c2.close()

    def test_friends_requests(self):
        a, b = self.player("fr_ann"), self.player("fr_ben")
        st, out = a.call("/api/online/friend", {"username": "FR_BEN", "action": "add"})
        self.assertEqual(st, 200, out)
        self.assertEqual([(f["username"], f["status"]) for f in out["friends"]], [("fr_ben", "requested")])
        st, mine = b.call("/api/online")
        self.assertEqual([(f["username"], f["status"]) for f in mine["friends"]], [("fr_ann", "incoming")])
        self.assertEqual(b.call("/api/online/friend", {"username": "fr_ann", "action": "accept"})[0], 200)
        st, mine = a.call("/api/online")
        self.assertEqual(mine["friends"][0]["status"], "friends")
        self.assertEqual(mine["friends"][0]["presence"], {"online": False})
        self.assertEqual(a.call("/api/online/friend", {"username": "nobody_here", "action": "add"})[0], 400)
        self.assertEqual(a.call("/api/online/friend", {"username": "fr_ann", "action": "add"})[0], 400)
        self.assertEqual(a.call("/api/online/friend", {"username": "fr_ben", "action": "remove"})[0], 200)
        self.assertEqual(b.call("/api/online")[1]["friends"], [])

    def friends(self, *names):
        """Accounts that are all friends with each other, connected, with hello read: [(client, id)]."""
        cs = [self.player(n) for n in names]
        for i, a in enumerate(cs):
            for j in range(i + 1, len(cs)):
                a.call("/api/online/friend", {"username": names[j], "action": "add"})
                cs[j].call("/api/online/friend", {"username": names[i], "action": "accept"})
        out = []
        for c in cs:
            self.assertEqual(c.connect(), 101)
            out.append((c, c.until("hello")["you"]["id"]))
        return out

    def test_park_presence_squads_claims_games_and_kings(self):
        (a, ida), (b, idb), (w, idw) = self.friends("pk_lead", "pk_mate", "pk_watch")
        for c, n in ((a, "Lead"), (b, "Mate"), (w, "Watcher")):
            c.send({"t": "entry", "entry": {"name": n, "build": {"overall": 70}}})
        # everyone at the same park sees the others (with their player) and where they walk
        a.send({"t": "where", "name": "Lead", "park": "harbor", "status": "park"})
        here = a.until("here")
        self.assertEqual((here["place"], here["players"], here["courts"]), ("harbor", [], {}))
        b.send({"t": "where", "name": "Mate", "park": "harbor", "status": "park"})
        self.assertEqual(b.until("here")["players"][0]["entry"]["name"], "Lead")
        self.assertEqual(a.until("pentry")["id"], idb)
        a.send({"t": "pos", "x": 1.5, "z": -2.25, "f": 0.5, "m": 3})
        self.assertEqual({k: v for k, v in b.until("pos").items() if k != "t"}, {"from": ida, "x": 1.5, "z": -2.25, "f": 0.5, "m": 3})
        # a squad: invite, accept; the member can't call next, the leader can, for both of them
        a.send({"t": "sq-invite", "to": idb})
        inv = b.until("sqinvite")
        self.assertEqual((inv["from"], inv["park"]), (ida, "harbor"))
        b.send({"t": "sq-accept", "from": ida})
        sq = a.until("squad", lambda m: m["squad"] and len(m["squad"]["members"]) == 2)["squad"]
        self.assertEqual((sq["leader"], [m["id"] for m in sq["members"]]), (ida, [ida, idb]))
        self.assertEqual(b.until("squad-entries", lambda m: len(m["entries"]) == 2)["entries"][ida]["name"], "Lead")
        b.send({"t": "claim", "court": 3, "spot": 0})
        self.assertFalse(b.until("claimed")["ok"])
        a.send({"t": "claim", "court": 3, "spot": 0})
        self.assertTrue(a.until("claimed")["ok"])
        cts = b.until("courts", lambda m: m["courts"].get("3", {}).get("lines", [None])[0])["courts"]
        self.assertEqual(cts["3"]["lines"][0]["members"], [ida, idb])
        # the watcher arrives: he sees the claim
        w.send({"t": "where", "name": "Watcher", "park": "harbor", "status": "park"})
        hw = w.until("here")
        self.assertEqual(hw["courts"]["3"]["lines"][0]["leader"], ida)
        self.assertEqual(sorted(p["id"] for p in hw["players"]), sorted([ida, idb]))
        # the leader starts the game on that court: the players get it, the watcher gets it to watch; the claim's used
        a.send({"t": "start", "setup": {"seed": 5, "kind": "park", "where": "harbor", "court": 3, "slots": {ida: 0, idb: 1}}})
        g = a.until("start")["setup"]["game"]
        self.assertEqual(b.until("start")["setup"]["game"], g)
        busy = w.until("courts", lambda m: m["courts"]["3"]["busy"])["courts"]["3"]  # (the court's in use, then the game)
        self.assertEqual((busy["busy"]["kind"], busy["lines"]), ("game", [None, None]))
        self.assertEqual(w.until("watch")["setup"]["game"], g)
        # inputs go to the other player and the watcher, in order; scores to the watcher
        for k in (4, 5, 5, 6):
            a.send({"t": "in", "k": k, "g": g, "i": {"mx": k}})
        self.assertEqual([m["k"] for m in (b.until("in"), b.until("in"), b.until("in"))], [4, 5, 6])
        self.assertEqual([m["k"] for m in (w.until("in"), w.until("in"), w.until("in"))], [4, 5, 6])
        b.send({"t": "score", "score": [3, 1]})
        self.assertEqual(w.until("courtscore")["score"], [3, 1])
        # nobody in a game starts another
        b.send({"t": "start", "setup": {"slots": {idb: 0}}})
        self.assertIn("can't play", b.until("error")["text"])
        # the end: the winners hold the court (the squad leader leads them); the watcher hears it's over
        b.send({"t": "end", "g": g, "winners": [ida, idb]})
        kings = a.until("courts", lambda m: m["courts"]["3"]["kings"])["courts"]["3"]["kings"]
        self.assertEqual((kings["leader"], kings["members"], kings["streak"]), (ida, [ida, idb], 1))
        self.assertEqual(w.until("watchend")["g"], g)
        # a solo player's local game on another court: the court shows busy with its score, then he holds it
        w.send({"t": "court", "court": 1, "busy": True, "score": [0, 0]})
        self.assertEqual(a.until("courts", lambda m: (m["courts"].get("1") or {}).get("busy"))["courts"]["1"]["busy"]["kind"], "local")
        w.send({"t": "court", "court": 1, "busy": False, "kings": True})
        k1 = a.until("courts", lambda m: (m["courts"].get("1") or {}).get("kings"))["courts"]["1"]
        self.assertEqual((k1["busy"], k1["kings"]["leader"]), (None, idw))
        # a player who drops out mid-game: the others get the tick he's handed to the AI after
        a.send({"t": "start", "setup": {"kind": "park", "where": "harbor", "court": 3, "slots": {ida: 0, idb: 1}}})
        g2 = a.until("start")["setup"]["game"]
        b.until("start")
        b.send({"t": "in", "k": 9, "g": g2, "i": {}})
        a.until("in")
        b.close()
        left = a.until("left")
        self.assertEqual((left["slot"], left["last"], left["g"]), (1, 9, g2))
        sq = a.until("squad")["squad"]  # (the squad broke up: he was the only other one)
        self.assertIsNone(sq)
        # the last player walks out of the game: the court's free and nobody holds it
        a.send({"t": "quit"})
        c3 = w.until("courts", lambda m: (m["courts"].get("3") or {}).get("busy") is None and not m["courts"]["3"]["kings"])["courts"]["3"]
        self.assertEqual(c3["lines"], [None, None])
        # leaving the park takes your claims and your court with you
        w.send({"t": "claim", "court": 2, "spot": 1})
        a.until("courts", lambda m: (m["courts"].get("2") or {}).get("lines", [None, None])[1])
        w.send({"t": "where", "park": None, "status": "menu"})
        self.assertEqual(a.until("gone", lambda m: m["id"] == idw)["place"], "harbor")
        cts = a.until("courts", lambda m: not (m["courts"].get("2") or {}).get("lines", [0, 0])[1])["courts"]
        self.assertIsNone(cts["1"]["kings"], "his court too")
        a.close(); w.close()

    def test_pro_am_challenges(self):
        (a, ida), (b, idb) = self.friends("ch_one", "ch_two")
        b.send({"t": "entry", "entry": {"name": "Two", "build": {"overall": 71}}})
        a.send({"t": "challenge", "to": idb})
        ch = b.until("challenge")
        self.assertEqual((ch["from"], ch["size"]), (ida, 1))
        b.send({"t": "challenge-reply", "from": ida, "ok": True})
        go = a.until("challenge-go")["opp"]
        self.assertEqual((go["leader"], go["members"], go["entries"][idb]["name"]), (idb, [idb], "Two"))
        a.send({"t": "challenge", "to": idb})
        b.until("challenge")
        b.send({"t": "challenge-reply", "from": ida, "ok": False})
        self.assertIn("passed", a.until("note", lambda m: "passed" in m["text"])["text"])
        a.close(); b.close()

    def test_online_crews(self):
        (f, idf), (m, idm), (x, idx) = self.friends("cr_found", "cr_mem", "cr_other")
        # the founder brings his crew (from his save) online, and adds a friend
        f.send({"t": "crew-sync", "crew": {"name": "Night Shift", "tag": "NS", "color": "#2457c5", "level": 3, "xp": 9000}})
        cr = f.until("crew")["crew"]
        self.assertEqual((cr["id"], cr["name"], cr["level"], [p["id"] for p in cr["members"]]), (idf, "Night Shift", 3, [idf]))
        m.send({"t": "crew-invite", "to": idx})
        self.assertIn("founder", m.until("error")["text"])
        f.send({"t": "crew-invite", "to": idm})
        inv = m.until("crewinvite")
        self.assertEqual(inv["crew"]["tag"], "NS")
        m.send({"t": "crew-accept", "crew": inv["crew"]["id"]})
        cr = m.until("crew", lambda q: q["crew"] and len(q["crew"]["members"]) == 2)["crew"]
        self.assertEqual([p["id"] for p in cr["members"]], [idf, idm])
        # a member can't bring a crew of his own online while he's in this one
        m.send({"t": "crew-sync", "crew": {"name": "Other", "tag": "OT", "color": "#111111"}})
        self.assertIn("leave it", m.until("crew-error")["text"])
        # his games' crew XP waits for the founder's game to collect it
        m.send({"t": "crewxp", "xp": 120})
        m.send({"t": "crewxp", "xp": 99999})  # (out of range: ignored)
        self.assertEqual(f.until("crew-pending")["xp"], 120)
        f.send({"t": "crew-ack", "xp": 120})
        m.send({"t": "crewxp", "xp": 30})
        self.assertEqual(f.until("crew-pending")["xp"], 30)
        # he leaves; the founder takes the crew offline
        m.send({"t": "crew-leave"})
        self.assertIsNone(m.until("crew", lambda q: q["crew"] is None)["crew"])
        f.send({"t": "crew-leave"})
        self.assertIsNone(f.until("crew", lambda q: q["crew"] is None)["crew"])
        f.close(); m.close(); x.close()

    def test_your_own_copy_signs_in_on_the_socket_with_the_same_build(self):
        build = self.service.build
        # a game on a friend's own PC: its page is http://127.0.0.1:<his port>, no cookie of ours
        f = Client(self.base)
        self.assertEqual(f.connect(origin="http://127.0.0.1:9999"), 101)
        f.send({"t": "register", "username": "own_copy", "password": "password123", "join_code": "nope", "build": build})
        self.assertIn("join code", f.until("autherror")["text"])
        f.send({"t": "register", "username": "own_copy", "password": "password123", "join_code": "hoops42", "build": build})
        authed = f.until("authed")
        token, me = authed["token"], authed["you"]
        self.assertEqual(me["username"], "own_copy")
        self.assertEqual(f.until("hello")["you"]["id"], me["id"])
        # friend requests go over the socket (no cookie for the HTTP API from another origin)
        h = self.player("own_host")
        f.send({"t": "friend", "username": "own_host", "action": "add"})
        self.assertIn("request sent", f.until("note")["text"])
        self.assertEqual(h.call("/api/online")[1]["friends"][0]["status"], "incoming")
        f.send({"t": "friend", "username": "nobody_at_all", "action": "add"})
        self.assertIn("No player", f.until("error")["text"])
        f.close()
        # back later with the token
        g = Client(self.base)
        self.assertEqual(g.connect(origin="http://localhost:8765"), 101)
        g.send({"t": "auth", "token": token, "build": build})
        self.assertEqual(g.until("authed")["you"]["id"], me["id"])
        g.until("hello")
        g.close()
        # a wrong password can be tried again on the same socket; a different build can't come in at all
        w = Client(self.base)
        self.assertEqual(w.connect(origin="http://127.0.0.1:8765"), 101)
        w.send({"t": "login", "username": "own_copy", "password": "wrongpass1", "build": build})
        self.assertEqual(w.until("autherror")["code"], "auth")
        w.send({"t": "auth", "token": "not-a-token", "build": build})
        self.assertEqual(w.until("autherror")["code"], "token")
        w.send({"t": "login", "username": "own_copy", "password": "password123", "build": "0123456789ab"})
        err = w.until("autherror")
        self.assertEqual(err["code"], "version")
        self.assertIn(build, err["text"])
        with self.assertRaises((EOFError, OSError)):
            for _ in range(5):
                w.recv()
        w.close()
        # the version check comes as soon as the socket opens, before any sign-in
        v = Client(self.base)
        self.assertEqual(v.connect(origin="http://127.0.0.1:8765"), 101)
        v.send({"t": "hi", "build": build})
        self.assertEqual(v.until("hubinfo")["t"], "hubinfo")
        v.close()
        v = Client(self.base)
        self.assertEqual(v.connect(origin="http://127.0.0.1:8765"), 101)
        v.send({"t": "hi", "build": "ffffffffffff"})
        self.assertEqual(v.until("autherror")["code"], "version")
        v.close()
        # any other website is turned away
        x = Client(self.base)
        self.assertEqual(x.connect(origin="http://evil.example"), 403)
        x.close()

    def test_linking_your_game_to_a_hosted_one(self):
        self.assertEqual(server_app.normalize_hub("203.0.113.7"), "203.0.113.7:8765")
        self.assertEqual(server_app.normalize_hub(" http://Friend-PC.example:9000/ "), "Friend-PC.example:9000")
        self.assertEqual(server_app.normalize_hub("[2001:db8::1]"), "[2001:db8::1]:8765")
        for bad in ("", "a b", "x:99999", "javascript:alert(1)", "host:1;", "a..b"):
            self.assertIsNone(server_app.normalize_hub(bad), bad)
        c = self.player("linker")
        self.assertEqual(c.call("/api/online-link")[1]["link"], None)
        self.assertEqual(c.call("/api/online-link", {"hub": "bad host!"})[0], 400)
        st, out = c.call("/api/online-link", {"hub": "203.0.113.7", "username": "linker", "token": "tok"})
        self.assertEqual(st, 200, out)
        self.assertEqual(out["link"], {"hub": "203.0.113.7:8765", "username": "linker", "token": "tok"})
        self.assertEqual(c.call("/api/online-link")[1]["link"]["hub"], "203.0.113.7:8765")
        # the page may open a socket to it (the CSP lists it)
        with urllib.request.urlopen(self.base + "/", timeout=10) as r:
            self.assertIn("ws://203.0.113.7:8765", r.headers["Content-Security-Policy"])
        self.assertEqual(c.call("/api/online-link", {"clear": True})[1]["link"], None)

    def test_the_build_fingerprint(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "client/js/sim").mkdir(parents=True)
            (root / "server").mkdir()
            (root / "client/js/sim/game.js").write_bytes(b"export const A = 1;\nexport const B = 2;\n")
            (root / "server/catalog.json").write_bytes(b"[]\n")
            a = server_app.compute_build(root)
            self.assertRegex(a, r"^[0-9a-f]{12}$")
            (root / "client/js/sim/game.js").write_bytes(b"export const A = 1;\r\nexport const B = 2;\r\n")
            self.assertEqual(server_app.compute_build(root), a, "a Windows checkout hashes the same")
            (root / "client/js/_viewer.js").write_bytes(b"// a test harness")
            self.assertEqual(server_app.compute_build(root), a, "harness files don't count")
            (root / "client/js/sim/game.js").write_bytes(b"export const A = 2;\nexport const B = 2;\n")
            self.assertNotEqual(server_app.compute_build(root), a)
        self.assertEqual(self.call_config()["build"], self.service.build)

    def call_config(self):
        return Client(self.base).call("/api/config")[1]

    def test_frames(self):
        # a long message uses the 16-bit length; the server answers pings
        a = self.player("fx_one")
        self.assertEqual(a.connect(), 101)
        a.until("hello")
        a.send({"t": "ping", "c": "x" * 300})
        self.assertEqual(len(a.until("pong")["c"]), 300)
        a.close()


if __name__ == "__main__":
    unittest.main()
