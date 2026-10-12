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

    def test_rooms_invites_and_the_input_relay(self):
        a, b, c = self.player("rm_host"), self.player("rm_mate"), self.player("rm_stranger")
        a.call("/api/online/friend", {"username": "rm_mate", "action": "add"})
        b.call("/api/online/friend", {"username": "rm_host", "action": "accept"})
        self.assertEqual(a.connect(), 101)
        hello = a.until("hello")
        self.assertEqual(hello["you"]["username"], "rm_host")
        self.assertEqual(b.connect(), 101)
        mate_id = b.until("hello")["you"]["id"]
        # presence: the host sees his friend come online, at a park
        b.send({"t": "where", "name": "Mate Guy", "park": "harbor", "status": "park"})
        f = a.until("friends", lambda m: m["friends"] and m["friends"][0].get("presence", {}).get("park") == "harbor")
        self.assertTrue(f["friends"][0]["presence"]["online"])
        a.send({"t": "where", "name": "Host Guy", "park": "harbor", "status": "park"})
        # a stranger can't be invited or join
        self.assertEqual(c.connect(), 101)
        c.until("hello")
        a.send({"t": "create"})
        room = a.until("room", lambda m: m["room"])["room"]
        a.send({"t": "invite", "to": "nobody"})
        self.assertIn("friends", a.until("error")["text"])
        c.send({"t": "join", "room": room["id"]})
        self.assertIn("invite", c.until("error")["text"])
        # invite, join, entries go to the host
        a.send({"t": "invite", "to": mate_id})
        inv = b.until("invite")
        self.assertEqual((inv["room"], inv["username"], inv["park"]), (room["id"], "rm_host", "harbor"))
        b.send({"t": "join", "room": inv["room"]})
        r = a.until("room", lambda m: m["room"] and len(m["room"]["members"]) == 2)["room"]
        self.assertEqual([m["username"] for m in r["members"]], ["rm_host", "rm_mate"])
        self.assertEqual(r["members"][1]["park"], "harbor")
        b.send({"t": "entry", "entry": {"name": "Mate Guy", "build": {"overall": 70}}})
        ents = a.until("entries", lambda m: m["entries"])
        self.assertEqual(ents["entries"][mate_id]["name"], "Mate Guy")
        # only the host starts; the start goes to everyone with the game number
        b.send({"t": "start", "setup": {"slots": {}}})
        self.assertIn("host", b.until("error")["text"])
        host_id = hello["you"]["id"]
        a.send({"t": "start", "setup": {"seed": 7, "slots": {host_id: 0, mate_id: 1}}})
        sa, sb = a.until("start"), b.until("start")
        self.assertEqual(sa["setup"]["game"], 1)
        self.assertEqual(sb["setup"]["seed"], 7)
        # the relay: in order, stamped with the sender's slot; stale ticks and other games are dropped
        for k in (5, 6, 6, 4, 7):
            a.send({"t": "in", "k": k, "g": 1, "i": {"mx": k}})
        a.send({"t": "in", "k": 9, "g": 2, "i": {}})
        got = [b.until("in") for _ in range(3)]
        self.assertEqual([(m["s"], m["k"], m["i"]["mx"], m["g"]) for m in got], [(0, 5, 5, 1), (0, 6, 6, 1), (0, 7, 7, 1)])
        b.send({"t": "in", "k": 5, "g": 1, "i": {"mx": 1}})
        self.assertEqual(a.until("in")["s"], 1)
        # the host drops out mid-game: everyone gets the tick he's handed to the AI after, and the room is the mate's
        a.close()
        left = b.until("left")
        self.assertEqual((left["slot"], left["last"], left["id"]), (0, 7, host_id))
        r = b.until("room", lambda m: m["room"] and len(m["room"]["members"]) == 1)["room"]
        self.assertEqual(r["host"], mate_id)
        b.send({"t": "end", "g": 1})
        self.assertEqual(b.until("room", lambda m: m["room"] and m["room"]["status"] == "lobby")["room"]["game"], 1)
        b.close()
        c.close()

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
