"""v0.4.7.5 qp3: the online server (deploy/, README "Host on a server").

The game service in server mode (--server) sits behind Caddy on the same machine: it listens on 127.0.0.1 only, takes
each player's address from X-Forwarded-For (so the local-only things stay local), has no local session, and tells the
server's own scripts what it's doing (/api/hosting.txt). Own copies link to it by its https:// address (wss).
Run: python3 -m unittest discover -s tests
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import app as server_app  # noqa: E402


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.read().decode(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), dict(e.headers)


class ServerModeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "srv.sqlite3", dev_accounts=False, secure_cookies=True)
        cls.service.hosting, cls.service.join_code = True, "hoops42"
        cls.service.behind_proxy, cls.service.public_url = True, "https://203-0-113-7.sslip.io"
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

    def test_players_come_through_the_proxy_with_their_own_address(self):
        far = {"X-Forwarded-For": "198.51.100.23"}
        # the server's own scripts (no proxy in between) see what it's doing
        st, body, _ = get(self.base + "/api/hosting.txt")
        self.assertEqual(st, 200)
        self.assertIn("SERVER https://203-0-113-7.sslip.io\n", body)
        self.assertRegex(body, r"BUILD \S+ [0-9a-f]{12}\n")
        self.assertIn("ONLINE 0\nGAMES 0\n", body)
        # a player through the proxy is a player from outside
        st, _, _ = get(self.base + "/api/hosting.txt", far)
        self.assertEqual(st, 403)
        st, body, _ = get(self.base + "/api/config", far)
        self.assertEqual(st, 200)
        self.assertFalse(json.loads(body)["dev_accounts"])
        # (a forged header from outside the machine counts for nothing: only the proxy on this machine is believed)
        h = server_app.Handler.__new__(server_app.Handler)
        h.server = self.server
        h.client_address = ("198.51.100.23", 5555)
        h.headers = {"X-Forwarded-For": "127.0.0.1"}
        self.assertEqual(h.client_ip(), "198.51.100.23")
        h.client_address = ("127.0.0.1", 5555)
        self.assertEqual(h.client_ip(), "127.0.0.1")
        h.headers = {"X-Forwarded-For": "10.0.0.9, 198.51.100.23"}
        self.assertEqual(h.client_ip(), "198.51.100.23")

    def test_secure_session_cookie(self):
        req = urllib.request.Request(self.base + "/api/register", data=b'{"username":"cookiecheck","password":"password123","join_code":"hoops42"}',
                                     headers={"Content-Type": "application/json", "X-Forwarded-For": "198.51.100.24"}, method="POST")
        with urllib.request.urlopen(req, timeout=5) as r:
            self.assertIn("Secure", r.headers.get("Set-Cookie", ""))


class HubAddressTest(unittest.TestCase):
    def test_https_servers(self):
        n = server_app.normalize_hub
        self.assertEqual(n("https://203-0-113-7.sslip.io/"), "https://203-0-113-7.sslip.io")
        self.assertEqual(n(" HTTPS://Game.Example.com:8443/x "), "https://game.example.com:8443")
        self.assertEqual(n("https://game.example.com:443"), "https://game.example.com")
        self.assertEqual(n("wss://game.example.com"), "https://game.example.com")
        self.assertEqual(n("203.0.113.7"), "203.0.113.7:8765")  # (a friend's PC, as before)
        self.assertIsNone(n("https://"))
        self.assertIsNone(n("https://bad host"))
        self.assertEqual(server_app.hub_socket_sources("https://203-0-113-7.sslip.io"), ["wss://203-0-113-7.sslip.io"])
        self.assertEqual(server_app.hub_socket_sources("203.0.113.7:8765"), ["ws://203.0.113.7:8765", "wss://203.0.113.7:8765"])


class ServerFilesTest(unittest.TestCase):
    def test_the_command_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            port = 18000 + os.getpid() % 1000
            env = {**os.environ, "AFTERHOURS16_JOIN_CODE": "abcd", "AFTERHOURS16_PUBLIC_URL": "https://x.example"}
            p = subprocess.Popen([sys.executable, "-m", "server.app", "--server", "--port", str(port), "--db", str(Path(tmp) / "a.sqlite3")],
                                 cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            try:
                st, body = 0, ""
                for _ in range(50):
                    try:
                        st, body, _ = get(f"http://127.0.0.1:{port}/api/hosting.txt")
                    except OSError:
                        pass
                    if st == 200:
                        break
                    threading.Event().wait(0.1)
                self.assertIn("SERVER https://x.example", body)
                st, body, _ = get(f"http://127.0.0.1:{port}/api/config")
                self.assertFalse(json.loads(body)["dev_accounts"])
            finally:
                p.terminate()
                out = p.communicate(timeout=5)[0]
            self.assertIn("Online server for https://x.example", out)
            self.assertIn("Join code for new accounts: abcd", out)
            self.assertNotIn("UPnP", out)

    def test_deploy_scripts(self):
        d = ROOT / "deploy"
        for f in ("install.sh", "afterhours16.sh", "digitalocean-startup.sh"):
            r = subprocess.run(["bash", "-n", str(d / f)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, f + r.stderr)
            self.assertNotIn("\r", (d / f).read_text(), f + " has Windows line endings")
        start = (d / "digitalocean-startup.sh").read_text()
        self.assertRegex(start, r'(?m)^JOIN_CODE="change-me"')
        self.assertIn('REPO="https://github.com/EpsilonDevil/Afterhours16"', start)
        self.assertIn("deploy/install.sh", start)
        unit = (d / "systemd/afterhours16.service").read_text()
        self.assertIn("ExecStart=/usr/bin/python3 -m server.app --server --host 127.0.0.1 --port 8765", unit)
        self.assertIn("User=afterhours", unit)
        inst = (d / "install.sh").read_text()
        for u in ("afterhours16.service", "afterhours16-update.timer", "afterhours16-backup.timer"):
            self.assertTrue((d / "systemd" / u).exists(), u)
            self.assertIn(u, inst)
        self.assertIn("reverse_proxy 127.0.0.1:%s", inst)
        self.assertIn(".sslip.io", inst)
        cli = (d / "afterhours16.sh").read_text()
        for cmd in ("status)", "update)", "joincode)", "autoupdate)", "logs)", "restart)", "backup)"):
            self.assertIn(cmd, cli)
        self.assertIn('$1=="GAMES"', cli)  # (the update waits for the games being played to end)
        # join.cmd opens an online server's https address as it is
        join = (ROOT / "join.cmd").read_text()
        self.assertIn('if /i "%HOST:~0,8%"=="https://" goto :secure', join)
        self.assertTrue(re.search(r"Host on a server", (ROOT / "README.md").read_text()))


if __name__ == "__main__":
    unittest.main()
