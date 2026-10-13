"""A load test for the online hub (server/online.py): one park game of P players with W people watching from the
same park, every player sending his input 60 times a second, as the game does. It reports the service's CPU, how
long an input takes to reach the others (median / 99th percentile / worst) and the bytes everyone receives.

    python tests/load_hub.py [--players 10] [--watchers 10] [--seconds 10] [--slow 0]

It starts its own service (a temporary database) in a separate process, so the CPU it reports is the service's alone.
--slow N makes N of the watchers stop reading their socket (a phone on bad Wi-Fi): the others must not notice.
"""
import argparse
import base64
import json
import os
import socket
import statistics
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import http.cookiejar
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVE = r"""
import sys, threading
from pathlib import Path
from http.server import ThreadingHTTPServer
sys.path.insert(0, sys.argv[3])
from server import app as server_app
sys.setswitchinterval(0.001)  # (as a hosted service runs: server/app.py main)
s = server_app.Service(Path(sys.argv[1]), dev_accounts=False)
s.hosting, s.join_code = True, "load"
s.rate_limit = lambda ip, category: None
h = type("Q", (server_app.Handler,), {"log_message": lambda *a: None})
srv = ThreadingHTTPServer(("127.0.0.1", int(sys.argv[2])), h)
srv.daemon_threads = True
srv.service = s
print("ready", flush=True)
srv.serve_forever(poll_interval=0.05)
"""


class Client:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.sock, self.buf, self.lock = None, b"", threading.Lock()
        self.got = 0
        self.lat = []
        self.msgs = 0

    def call(self, path, body):
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        with self.opener.open(req, timeout=10) as r:
            return json.loads(r.read())

    def connect(self):
        host, port = self.base.split("//")[1].split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=10)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        cookie = "; ".join(f"{c.name}={c.value}" for c in self.jar)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(("\r\n".join([f"GET /api/ws HTTP/1.1", f"Host: {host}:{port}", "Upgrade: websocket", "Connection: Upgrade",
                                        f"Sec-WebSocket-Key: {key}", "Sec-WebSocket-Version: 13", f"Cookie: {cookie}", f"Origin: http://{host}:{port}"]) + "\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            head += self.sock.recv(4096)
        _, _, self.buf = head.partition(b"\r\n\r\n")

    def send(self, obj):
        data = json.dumps(obj, separators=(",", ":")).encode()
        mask = os.urandom(4)
        n = len(data)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack("!H", n) if n < 65536 else bytes([0x80 | 127]) + struct.pack("!Q", n))
        m = int.from_bytes((mask * (n // 4 + 1))[:n], "little")
        body = (int.from_bytes(data, "little") ^ m).to_bytes(n, "little") if n else b""
        with self.lock:
            self.sock.sendall(head + mask + body)

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(262144)
            if not chunk:
                raise EOFError
            self.got += len(chunk)
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
        self.msgs += 1
        return json.loads(data)

    def until(self, t, limit=400):
        for _ in range(limit):
            m = self.recv()
            if m.get("t") == t:
                return m
        raise AssertionError(f"no {t}")


def times(m):
    """The send times carried by an input message (old: one intent; new: a batch, or a watchers' bundle)."""
    if m.get("t") == "in":
        if "b" in m:
            return [d["ts"] for d in m["b"] if isinstance(d, dict) and "ts" in d]
        return [m["i"]["ts"]] if isinstance(m.get("i"), dict) and "ts" in m["i"] else []
    if m.get("t") == "inw":
        return [d["ts"] for _, _, b in m.get("m", []) for d in b if isinstance(d, dict) and "ts" in d]
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--players", type=int, default=10)
    ap.add_argument("--watchers", type=int, default=10)
    ap.add_argument("--seconds", type=float, default=10)
    ap.add_argument("--slow", type=int, default=0)
    ap.add_argument("--port", type=int, default=8791)
    ap.add_argument("--old", action="store_true", help="the old wire format (a full intent per message)")
    a = ap.parse_args()
    tmp = tempfile.TemporaryDirectory()
    proc = subprocess.Popen([sys.executable, "-c", SERVE, str(Path(tmp.name) / "load.sqlite3"), str(a.port), str(ROOT)], stdout=subprocess.PIPE)
    try:
        assert proc.stdout.readline().strip() == b"ready"
        base = f"http://127.0.0.1:{a.port}"
        people = []
        for i in range(a.players + a.watchers):
            c = Client(base)
            c.call("/api/register", {"username": f"load{i}_{os.getpid() % 1000}", "password": "password123", "join_code": "load"})
            c.connect()
            c.id = c.until("hello")["you"]["id"]
            people.append(c)
        players, watchers = people[:a.players], people[a.players:]
        for c in people:
            c.send({"t": "where", "name": c.id[:6], "park": "harbor", "status": "park"})
            c.until("here")
        players[0].send({"t": "start", "setup": {"seed": 1, "kind": "park", "where": "harbor", "court": 2, "slots": {c.id: i for i, c in enumerate(players)}}})
        gid = None
        for c in players:
            gid = c.until("start")["setup"]["game"]
        for c in watchers:
            c.until("watch")
        stop = threading.Event()
        slow = set(watchers[:a.slow])

        def reader(c):
            try:
                while not stop.is_set():
                    m = c.recv()
                    now = time.perf_counter()
                    for ts in times(m):
                        c.lat.append(now - ts)
            except (EOFError, OSError, ValueError):
                pass

        for c in people:
            if c not in slow:
                c.sock.settimeout(None)
                threading.Thread(target=reader, args=(c,), daemon=True).start()
        intent = {"mx": 0.7071067811865476, "mz": -0.7071067811865476, "sprint": True, "defense": False, "handsUp": False, "face": None, "stickFace": True,
                  "shoot": None, "shootHeld": False, "pass": None, "move": None, "steal": False, "jump": False, "call": False, "screen": False}
        cpu0 = sum(int(x) for x in open(f"/proc/{proc.pid}/stat").read().split(")")[1].split()[11:13])
        t0 = time.perf_counter()
        k = 0
        sent = 0
        while time.perf_counter() - t0 < a.seconds:
            k += 1
            for c in players:
                ts = time.perf_counter()
                if a.old:
                    c.send({"t": "in", "k": k, "g": gid, "i": {**intent, "ts": ts}})
                elif k == 1:
                    c.send({"t": "in", "k": k, "g": gid, "b": [{"mx": 0.707, "mz": -0.707, "sprint": True, "stickFace": True, "ts": ts}]})
                else:
                    c.send({"t": "in", "k": k, "g": gid, "b": [{"ts": ts} if k % 6 == 0 else 0]})
                sent += 1
            nxt = t0 + k / 60
            d = nxt - time.perf_counter()
            if d > 0:
                time.sleep(d)
        el = time.perf_counter() - t0
        time.sleep(0.5)
        cpu1 = sum(int(x) for x in open(f"/proc/{proc.pid}/stat").read().split(")")[1].split()[11:13])
        stop.set()
        hz = os.sysconf("SC_CLK_TCK")
        lp = sorted(x for c in players for x in c.lat)
        lw = sorted(x for c in watchers if c not in slow for x in c.lat)
        q = lambda v, p: v[min(len(v) - 1, int(len(v) * p))] * 1000 if v else float("nan")
        print(f"{'old' if a.old else 'new'} format · {a.players} players, {a.watchers} watchers ({a.slow} not reading), {el:.1f} s, {sent} inputs sent ({k} ticks)")
        print(f"  service CPU: {(cpu1 - cpu0) / hz / el * 100:.1f}% of one core")
        print(f"  to players : {len(lp)} timed inputs · median {q(lp, .5):.2f} ms · p99 {q(lp, .99):.2f} ms · worst {q(lp, 1):.2f} ms")
        print(f"  to watchers: {len(lw)} timed inputs · median {q(lw, .5):.2f} ms · p99 {q(lw, .99):.2f} ms · worst {q(lw, 1):.2f} ms")
        print(f"  received per player {statistics.mean(c.got for c in players) / el / 1024:.1f} KB/s ({statistics.mean(c.msgs for c in players) / el:.0f} msgs/s), "
              f"per watcher {statistics.mean([c.got for c in watchers if c not in slow] or [0]) / el / 1024:.1f} KB/s ({statistics.mean([c.msgs for c in watchers if c not in slow] or [0]) / el:.0f} msgs/s)")
        print(f"  service sends out {(sum(c.got for c in people if c not in slow)) / el / 1024:.0f} KB/s in all")
    finally:
        proc.kill()
        tmp.cleanup()


if __name__ == "__main__":
    main()
