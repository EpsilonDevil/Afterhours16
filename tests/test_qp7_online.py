"""v0.4.8.7 quick patch 7: what the online service checks and decides for everyone.

* Emotes: a celebration in the park (or the Crew HQ) goes to everyone at the same place, checked against the celebration
  item the sender has on (his entry) and named by the catalog (the animation), or one of the three defaults; at most one
  every EMOTE_GAP seconds; nobody elsewhere gets it.
* The park's host is picked here (whoever has been there longest), told to everyone there ('here', 'host'); only his
  reports (pop) are passed on, and the latest is kept a moment for whoever arrives next.

Run from the project root:  python3 -m unittest tests.test_qp7_online -v
"""
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app, online

try:
    from tests.test_online import Client
except ImportError:
    from test_online import Client


class OnlineChecksTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "qp7.sqlite3", dev_accounts=False)
        cls.service.hosting, cls.service.join_code = True, "hoops42"
        cls.service.rate_limit = lambda ip, category: None
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

    def join(self, name, park, celebration=None):
        c = Client(self.base)
        st, body = c.call("/api/register", {"username": name, "password": "password123", "join_code": "hoops42"})
        self.assertEqual(st, 200, body)
        self.assertEqual(c.connect(), 101)
        c.id = c.until("hello")["you"]["id"]
        c.send({"t": "entry", "entry": {"name": name, "build": {"overall": 70, "equipment": {"celebration": celebration} if celebration else {}}}})
        c.send({"t": "where", "name": name, "park": park, "status": "park"})
        c.here = c.until("here")
        return c

    def quiet(self, c, kind):
        """Nothing of kind came to c (everything up to the answer to a ping)."""
        time.sleep(0.15)
        c.send({"t": "ping", "c": 1})
        seen = []
        for _ in range(40):
            m = c.recv()
            seen.append(m.get("t"))
            if m.get("t") == "pong":
                break
        self.assertIn("pong", seen)
        self.assertNotIn(kind, seen)

    def test_emotes_go_to_everyone_there_checked_and_named(self):
        a = self.join("em_ann", "harbor", "fv_celly_passinho")
        b = self.join("em_ben", "harbor")
        x = self.join("em_xav", "brick")
        a.send({"t": "emote", "item": "fv_celly_passinho", "dur": 1.6})
        m = b.until("emote")
        self.assertEqual((m["from"], m["kind"], m["item"], m["dur"]), (a.id, "passinho", "fv_celly_passinho", 1.6))
        self.quiet(x, "emote")  # (another park: nothing)
        time.sleep(online.Hub.EMOTE_GAP + 0.05)
        a.send({"t": "emote", "item": "celly_flex", "dur": 1.6})  # (an item he doesn't have on)
        self.quiet(b, "emote")
        b.send({"t": "emote", "kind": "flex", "dur": 9})  # (nothing on: a default, its length held to 3 s)
        m = a.until("emote")
        self.assertEqual((m["kind"], m["dur"], m["item"]), ("flex", 3.0, None))
        b.send({"t": "emote", "kind": "flex"})  # (straight after: too soon)
        time.sleep(online.Hub.EMOTE_GAP + 0.05)
        b.send({"t": "emote", "kind": "moonwalk"})  # (no such default)
        self.quiet(a, "emote")
        for c in (a, b, x):
            c.close()

    def test_the_park_host_is_picked_here_and_only_his_reports_go_out(self):
        # (v0.4.8.7: with the park director off: RIMRIFT_PARK_DIRECTOR=0. With it on the server runs the park: no host)
        hub = self.service.hub
        keep, hub.parks = hub.parks, None
        try:
            a = self.join("ho_ann", "foundry")
            self.assertEqual(a.here["host"], a.id)
            b = self.join("ho_ben", "foundry")
            self.assertEqual(b.here["host"], a.id, "the one there longest")
            b.send({"t": "pop", "place": "foundry", "courts": [], "walkers": []})  # (not the host: goes nowhere)
            self.quiet(a, "pop")
            a.send({"t": "pop", "place": "foundry", "courts": [None], "walkers": [["ai-1", 1, 2, 0, 0, 0, None, 0, None, 0]]})
            self.assertEqual(b.until("pop")["from"], a.id)
            c = self.join("ho_cal", "foundry")
            self.assertEqual(c.here["host"], a.id)
            self.assertEqual(c.here["pop"]["walkers"][0][0], "ai-1", "a newcomer gets the park as the host had it")
            # the host goes: the next one there longest takes over, and everyone there hears it
            a.send({"t": "where", "name": "A", "park": "harbor", "status": "park"})
            self.assertEqual(b.until("host")["id"], b.id)
            self.assertEqual(c.until("host")["id"], b.id)
            for x in (a, b, c):
                x.close()
        finally:
            hub.parks = keep

    def test_with_the_park_director_on_there_is_no_host(self):
        # v0.4.8.7: the flag is on by default; the park is the server's (pstate), nobody hosts it and nobody's pop goes out
        self.assertTrue(online.parkdir.enabled())
        for v in ("0", "false", "off", "no", "OFF", " No "):
            self.assertFalse(online.parkdir.enabled(v), v)
        self.assertIsNotNone(self.service.hub.parks)
        a = self.join("pd_ann", "brick")
        b = self.join("pd_ben", "brick")
        self.assertIsNone(a.here["host"])
        self.assertIsNone(b.here["host"])
        st = b.until("pstate", limit=400)
        self.assertEqual((st["place"], st["pd"]), ("brick", 1))
        a.send({"t": "pop", "place": "brick", "courts": [], "walkers": []})
        self.quiet(b, "pop")
        for x in (a, b):
            x.close()


if __name__ == "__main__":
    unittest.main()
