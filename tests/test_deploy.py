"""v0.4.7.5 qp3: the online server (deploy/, README "Host on a server").

The game service in server mode (--server) sits behind Caddy on the same machine: it listens on 127.0.0.1 only, takes
each player's address from X-Forwarded-For (so the local-only things stay local), has no local session, and tells the
server's own scripts what it's doing (/api/hosting.txt). Own copies link to it by its https:// address (wss).
Run: python3 -m unittest discover -s tests
"""
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
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
            # (v0.4.8.6: the RIMRIFT_* names; the ones from before the rename are tested in test_v0486_rename.py)
            env = {**os.environ, "RIMRIFT_JOIN_CODE": "abcd", "RIMRIFT_PUBLIC_URL": "https://x.example"}
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
            self.assertIn("RIMRIFT v" + server_app.VERSION, out)
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
        # v0.4.8.6 RIMRIFT: what the server shows says RIMRIFT; the box's own names stay (they're on servers already)
        for f in ("afterhours16.sh", "install.sh", "digitalocean-startup.sh", "sysctl-afterhours16.conf", *(f"systemd/{u}" for u in os.listdir(d / "systemd"))):
            self.assertNotIn("Afterhours 16", (d / f).read_text(), f)
        self.assertIn('echo "RIMRIFT online server"', cli)
        self.assertIn("RIMRIFT_JOIN_CODE=$JOIN_CODE", inst)
        self.assertIn("Description=RIMRIFT online server", unit)


@unittest.skipUnless(sys.platform.startswith("linux") and shutil.which("bash"), "the server's command runs on Linux")
class ServerCommandTest(unittest.TestCase):
    """v0.4.8.6 RIMRIFT: the  afterhours16  command on a server set up before the rename and after it (its settings file
    with the old names or the new ones; the save under either name). Run with stand-ins for root, systemctl and curl."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name)
        self.app, self.backups, self.envf, bin_ = t / "app", t / "backups", t / "afterhours16.env", t / "bin"
        (self.app / "data").mkdir(parents=True)
        bin_.mkdir()
        for name, body in (("id", '[ "$1" = -u ] && { echo 0; exit 0; }; exit 1'), ("systemctl", "exit 0"), ("curl", "exit 1")):
            (bin_ / name).write_text("#!/bin/sh\n" + body + "\n")
            (bin_ / name).chmod(0o755)
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(("RIMRIFT_", "AFTERHOURS16_"))},
                    "PATH": f"{bin_}:{os.environ.get('PATH', '/usr/bin:/bin')}",
                    "RIMRIFT_APP": str(self.app), "RIMRIFT_ENV": str(self.envf), "RIMRIFT_BACKUPS": str(self.backups)}

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, *args):
        r = subprocess.run(["bash", str(ROOT / "deploy/afterhours16.sh"), *args], env=self.env, capture_output=True, text=True, timeout=30)
        return r.stdout + r.stderr

    def save(self, name, who):
        conn = sqlite3.connect(str(self.app / "data" / name))
        conn.execute("CREATE TABLE t (who TEXT)")
        conn.execute("INSERT INTO t VALUES (?)", (who,))
        conn.commit()
        conn.close()

    def copies(self):
        return sorted(p.name for p in self.backups.iterdir())

    def who(self, copy):
        conn = sqlite3.connect(str(self.backups / copy))
        try:
            return conn.execute("SELECT who FROM t").fetchone()[0]
        finally:
            conn.close()

    def test_status_and_join_code_with_the_old_settings_file(self):
        self.envf.write_text("AFTERHOURS16_JOIN_CODE=oldcode\nAFTERHOURS16_PUBLIC_URL=https://203-0-113-7.sslip.io\n")
        out = self.run_cli("status")
        self.assertIn("RIMRIFT online server", out)
        self.assertNotIn("Afterhours", out)
        self.assertRegex(out, r"Join code:\s+oldcode ")
        self.assertRegex(out, r"Address:\s+https://203-0-113-7\.sslip\.io ")
        self.assertIn("Join code is now: newcode1", self.run_cli("joincode", "newcode1"))
        self.assertEqual(self.envf.read_text(), "AFTERHOURS16_JOIN_CODE=newcode1\nAFTERHOURS16_PUBLIC_URL=https://203-0-113-7.sslip.io\n")
        self.assertRegex(self.run_cli("status"), r"Join code:\s+newcode1 ")

    def test_join_code_with_the_new_settings_file(self):
        self.envf.write_text("# RIMRIFT online server settings\nRIMRIFT_JOIN_CODE=abcd\nRIMRIFT_PUBLIC_URL=https://x.example\n")
        self.run_cli("joincode", "efgh")
        self.assertIn("\nRIMRIFT_JOIN_CODE=efgh\n", self.envf.read_text())
        self.assertRegex(self.run_cli("status"), r"Join code:\s+efgh ")
        self.envf.write_text("RIMRIFT_PUBLIC_URL=https://x.example\n")  # (none at all: the new name is added)
        self.run_cli("joincode", "ijkl")
        self.assertEqual(self.envf.read_text(), "RIMRIFT_PUBLIC_URL=https://x.example\nRIMRIFT_JOIN_CODE=ijkl\n")

    def test_backup_finds_the_save_under_either_name(self):
        self.envf.write_text("")
        self.assertIn("No database yet.", self.run_cli("backup"))
        # a server that hasn't restarted since the update still has the old name
        self.save("afterhours.sqlite3", "old")
        self.assertIn("Backed up to", self.run_cli("backup"))
        [copy] = self.copies()
        self.assertRegex(copy, r"^rimrift-\d{8}-\d{4}\.sqlite3$")
        self.assertEqual(self.who(copy), "old")
        # once the service has moved it over (both there: the new name is the save, as the service sees it)
        (self.backups / copy).unlink()
        self.save("rimrift.sqlite3", "new")
        self.run_cli("backup")
        [copy] = self.copies()
        self.assertEqual(self.who(copy), "new")

    def test_backup_keeps_the_last_14_counting_both_names(self):
        self.envf.write_text("")
        self.save("rimrift.sqlite3", "new")
        self.backups.mkdir()
        old = time.time() - 30 * 86400
        for i in range(10):
            for name in (f"afterhours-202601{i + 10:02d}-0430.sqlite3", f"rimrift-202602{i + 10:02d}-0430.sqlite3"):
                (self.backups / name).write_bytes(b"")
                os.utime(self.backups / name, (old + i * 86400 + (3600 if name[0] == "r" else 0),) * 2)
        (self.backups / "notes.txt").write_text("left alone")
        self.run_cli("backup")
        left = self.copies()
        self.assertEqual(len(left), 15, left)  # (14 copies, and the one file that isn't a copy)
        self.assertIn("notes.txt", left)
        # today's and the newest 13 before it, by time whatever their name (the 7 oldest went: afterhours-0110..0113 and
        # rimrift-0210..0212, interleaved)
        for gone in ("afterhours-20260110-0430.sqlite3", "afterhours-20260113-0430.sqlite3", "rimrift-20260212-0430.sqlite3"):
            self.assertNotIn(gone, left)
        for kept in ("afterhours-20260114-0430.sqlite3", "rimrift-20260213-0430.sqlite3", "rimrift-20260219-0430.sqlite3"):
            self.assertIn(kept, left)
        self.assertEqual(sum(n.startswith("rimrift-") for n in left), 8)


if __name__ == "__main__":
    unittest.main()
