"""v0.4.8.6 RIMRIFT: the game's new name everywhere, without losing anything from before it.

The save moves to data/rimrift.sqlite3 by itself (in one piece, or not at all while something else has it open), the
service's settings are RIMRIFT_* with the old AFTERHOURS16_* names still read, the bug reports go to
RIMRIFT_Bug_Reports.txt, and the service says RIMRIFT (its health check, its Server header, its banner).
Run: python3 -m unittest discover -s tests -p 'test_*.py'
"""
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import app as server_app  # noqa: E402
from server import bugs  # noqa: E402

# a save that was written to and never closed (the game killed, the PC switched off): its last rows are in the WAL only
CRASHED_SAVE = r"""
import os, sqlite3, sys
conn = sqlite3.connect(sys.argv[1], isolation_level=None)
conn.execute("PRAGMA journal_mode=WAL"); conn.execute("PRAGMA wal_autocheckpoint=0")
conn.execute("CREATE TABLE IF NOT EXISTS players (name TEXT)")
for i in range(int(sys.argv[2])): conn.execute("INSERT INTO players VALUES (?)", ("p%d" % i,))
os._exit(0)
"""
# something else with the save open (a game left running from before the update, a database viewer), until told to stop
HOLDER = r"""
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1], isolation_level=None)
print(conn.execute("SELECT count(*) FROM players").fetchone()[0], flush=True)
sys.stdin.readline()
conn.execute("INSERT INTO players VALUES ('after')")
print(conn.execute("SELECT count(*) FROM players").fetchone()[0], flush=True)
conn.close()
"""


def rows(path):
    conn = sqlite3.connect(str(path))
    try:
        return [r[0] for r in conn.execute("SELECT name FROM players ORDER BY rowid")]
    finally:
        conn.close()


class SaveRenameTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name) / "data"
        self.data.mkdir()
        self.old, self.new = self.data / "afterhours.sqlite3", self.data / "rimrift.sqlite3"

    def tearDown(self):
        self.tmp.cleanup()

    def crashed_save(self, n):
        subprocess.run([sys.executable, "-c", CRASHED_SAVE, str(self.old), str(n)], check=True, timeout=30)
        wal = self.data / "afterhours.sqlite3-wal"
        self.assertTrue(wal.exists() and wal.stat().st_size > 0, "the rows are in the WAL")

    def test_a_new_game_folder(self):
        self.assertEqual(server_app.default_db(self.data), self.new)
        self.assertEqual(sorted(os.listdir(self.data)), [], "nothing made until the service opens it")
        self.assertEqual(server_app.DB_NAME, "rimrift.sqlite3")

    def test_the_old_save_moves_over_whole_with_what_its_wal_held(self):
        self.crashed_save(500)
        self.assertEqual(server_app.default_db(self.data), self.new)
        self.assertEqual(sorted(os.listdir(self.data)), ["rimrift.sqlite3"], "the old name, its -wal and -shm all gone")
        self.assertEqual(rows(self.new), ["p%d" % i for i in range(500)])
        # and the service runs on it as before (its own migrations, WAL mode again)
        svc = server_app.Service(self.new, dev_accounts=False)
        try:
            self.assertEqual(svc.db.query("PRAGMA journal_mode")[0][0], "wal")
            self.assertEqual(svc.db.query("SELECT count(*) FROM players")[0][0], 500)
        finally:
            svc.close()
        # the next start finds it under the new name
        self.assertEqual(server_app.default_db(self.data), self.new)

    def test_held_open_the_old_save_is_used_where_it_is(self):
        self.crashed_save(40)
        holder = subprocess.Popen([sys.executable, "-c", HOLDER, str(self.old)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(holder.stdout.readline().strip(), "40")
            self.assertEqual(server_app.default_db(self.data), self.old)
            self.assertFalse(self.new.exists(), "never two saves")
            self.assertEqual(rows(self.old), ["p%d" % i for i in range(40)])
            # the one holding it carries on, none the wiser
            holder.stdin.write("\n"); holder.stdin.flush()
            self.assertEqual(holder.stdout.readline().strip(), "41")
        finally:
            holder.communicate(timeout=10)
        # (it moves over on a later start, once it's free)
        self.assertEqual(server_app.default_db(self.data), self.new)
        self.assertEqual(len(rows(self.new)), 41)
        self.assertFalse(self.old.exists())

    def test_held_mid_read_the_old_save_is_used_where_it_is(self):
        self.crashed_save(10)
        reader = sqlite3.connect(str(self.old), isolation_level=None)
        try:
            reader.execute("BEGIN")
            reader.execute("SELECT count(*) FROM players").fetchone()
            self.assertEqual(server_app.default_db(self.data), self.old)
            self.assertFalse(self.new.exists())
        finally:
            reader.close()
        self.assertEqual(rows(self.old), ["p%d" % i for i in range(10)])

    def test_a_save_under_the_new_name_wins_and_the_old_one_is_left_alone(self):
        self.crashed_save(3)
        sqlite3.connect(str(self.new)).close()
        before = {p.name: p.read_bytes() for p in self.data.iterdir()}
        self.assertEqual(server_app.default_db(self.data), self.new)
        self.assertEqual({p.name: p.read_bytes() for p in self.data.iterdir()}, before)

    def test_a_save_that_cannot_move_is_left_as_it_was(self):
        self.crashed_save(5)
        with mock.patch.object(server_app.os, "rename", side_effect=PermissionError("in use")):
            self.assertEqual(server_app.default_db(self.data), self.old)
        self.assertFalse(self.new.exists())
        self.assertEqual(rows(self.old), ["p%d" % i for i in range(5)])
        self.old.write_bytes(b"not a database at all")
        self.assertEqual(server_app.default_db(self.data), self.old)
        self.assertEqual(self.old.read_bytes(), b"not a database at all")
        self.assertFalse(self.new.exists())

    def test_an_explicit_db_is_never_renamed(self):
        self.crashed_save(7)
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        p = subprocess.Popen([sys.executable, "-m", "server.app", "--port", str(port), "--db", str(self.old), "--no-dev-account"],
                             cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        health = {}
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as r:
                        health = json.loads(r.read())
                    break
                except OSError:
                    time.sleep(0.1)
            self.assertEqual(health["app"], "rimrift")
            self.assertTrue(self.old.exists())
            self.assertFalse(self.new.exists())
        finally:
            p.terminate()
            out = p.communicate(timeout=10)[0]
        self.assertIn(f"RIMRIFT v{server_app.VERSION}\n", out)
        self.assertEqual(rows(self.old), ["p%d" % i for i in range(7)])
        self.assertIn("db_path = args.db or default_db()", (ROOT / "server/app.py").read_text())


class SettingsFromTheEnvironmentTest(unittest.TestCase):
    def test_the_new_names_and_the_old_ones(self):
        clean = {k: v for k, v in os.environ.items() if not k.startswith(("RIMRIFT_", "AFTERHOURS16_"))}
        with mock.patch.dict(os.environ, clean, clear=True):
            self.assertIsNone(server_app.env("JOIN_CODE"))
            self.assertEqual(server_app.env("TIME_SLACK", "30"), "30")
            os.environ["AFTERHOURS16_JOIN_CODE"] = "oldcode"
            self.assertEqual(server_app.env("JOIN_CODE"), "oldcode")  # (a server's settings file from before the rename)
            os.environ["RIMRIFT_JOIN_CODE"] = "newcode"
            self.assertEqual(server_app.env("JOIN_CODE"), "newcode")  # (the new name wins)

    def test_the_scripts_set_the_new_names(self):
        host = (ROOT / "host.cmd").read_text()
        self.assertIn('set "RIMRIFT_JOIN_CODE=%CODE%"', host)
        self.assertNotIn("set \"AFTERHOURS16_", host)
        self.assertIn('PORT="${RIMRIFT_PORT:-${AFTERHOURS16_PORT:-8765}}"', (ROOT / "start.sh").read_text())


class NameTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "t.sqlite3", dev_accounts=False)
        cls.service.bug_root = Path(cls.tmp.name)
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

    def test_health_and_server_header(self):
        with urllib.request.urlopen(self.base + "/api/health", timeout=5) as r:
            self.assertEqual(json.loads(r.read())["app"], "rimrift")
            self.assertTrue(r.headers["Server"].startswith("RIMRIFT/" + server_app.VERSION), r.headers["Server"])
        self.assertNotIn("afterhours", r.headers["Server"].lower())
        # (the site's icon where a browser looks for it by itself is the RIMRIFT mark)
        with urllib.request.urlopen(self.base + "/favicon.ico", timeout=5) as r:
            self.assertEqual(r.read(), (ROOT / "client/brand/favicon.ico").read_bytes())

    def test_bug_reports_file(self):
        root = Path(self.tmp.name)
        old = root / "Afterhours16_Bug_Reports.txt"
        old.write_text("BUG REPORT #1 · from before the rename\n")
        self.assertEqual(bugs.BUG_FILE, "RIMRIFT_Bug_Reports.txt")
        out = bugs.write_report(root, {"category": "ui", "what": "The top bar overlaps the phone."}, server_app.VERSION)
        self.assertEqual(out["number"], 1)
        text = (root / "RIMRIFT_Bug_Reports.txt").read_text(encoding="utf-8")
        self.assertTrue(text.startswith("RIMRIFT bug reports."), text[:80])
        self.assertIn("BUG REPORT #1 · ", text)
        self.assertIn(f" · RIMRIFT v{server_app.VERSION} · Menus / HUD", text)
        self.assertNotIn("Afterhours", text)
        self.assertEqual(old.read_text(), "BUG REPORT #1 · from before the rename\n", "the old file stays as it was")
        self.assertEqual(bugs.write_report(root, {"what": "And again."}, server_app.VERSION)["number"], 2)

    def test_names_in_the_data_files(self):
        venues = json.loads((ROOT / "server/venues.json").read_text())
        self.assertIn("RIMRIFT Arena", json.dumps(venues))
        self.assertNotIn("Afterhours", json.dumps(venues))
        self.assertIn("RIMRIFT", json.loads((ROOT / "online.json").read_text())["_"])
        self.assertEqual(json.loads((ROOT / "package.json").read_text())["name"], "rimrift")
        for f in ("server/app.py", "server/__init__.py", "server/bugs.py", "server/upnp.py"):
            src = (ROOT / f).read_text()
            for line in src.splitlines():
                if "afterhours" in line.lower():
                    # (only where the names from before the rename are still read)
                    self.assertTrue("AFTERHOURS16_" in line or "OLD_DB_NAME" in line, f"{f}: {line.strip()}")


if __name__ == "__main__":
    unittest.main()
