"""v0.4.8.5 quick patch 3: ICON status, the endgame (server side). A build is an ICON once every cap breaker it can earn is
unlocked, every badge is as high as it can go on that build (its cap; the Hall of Fame slots full, the rest at Gold) and
its overall is 99. The build's own win streak (every mode together) feeds the ICON aura: +1 a win, back to 0 on a loss,
a forfeit or a game left unfinished.

Run from the project root:  python3 -m unittest tests.test_icon_status -v
"""
import http.cookiejar
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app, builds

ROOT = Path(__file__).resolve().parents[1]


def icon_build(**over):
    """A Stretch Big that has done it all."""
    c = {"archetype": "stretch_big", "position": "PF", "height": 83, "weight": 235, "wingspan": 87,
         "attributes": {a: 99 for a in builds.ATTRIBUTES}, "progression": {"prorun_completed": 30},
         "cap_breakers": {"earned": 25, "available": 0, "applied": {}}, "badges": {}}
    caps = builds.badge_caps(c)
    hof = 0
    for k in builds.BADGE_IDS:
        t = caps[k]  # (v0.4.8.7: an ICON has every badge at its cap, every Hall of Fame his build can reach, not just 7)
        c["badges"][k] = {"tier": t, "progress": 0}
    c.update(over)
    return c


class IconStatusRules(unittest.TestCase):
    def test_all_three_or_nothing(self):
        c = icon_build()
        info = builds.icon_status_info(c)
        self.assertTrue(info["active"])
        self.assertEqual((info["cap_breakers_max"], info["badges_left"], info["ovr"]), (25, 0, 99))
        self.assertTrue(builds.icon_status(c))
        # 98 overall (every attribute at 89)
        low = icon_build(attributes={a: 89 for a in builds.ATTRIBUTES})
        self.assertEqual(builds.overall(low["attributes"], "PF"), 98)
        self.assertFalse(builds.icon_status(low))
        # a cap breaker short, or cap breakers not open yet (max OVR 89)
        self.assertFalse(builds.icon_status(icon_build(cap_breakers={"earned": 20, "available": 0, "applied": {}})))
        self.assertFalse(builds.icon_status(icon_build(progression={"prorun_completed": 27})))
        # a badge below what it can reach on this build
        c = icon_build()
        gold = next(k for k, b in c["badges"].items() if b["tier"] == 3)
        c["badges"][gold]["tier"] = 2
        self.assertEqual(builds.icon_status_info(c)["badges_left"], 1)
        self.assertFalse(builds.icon_status(c))
        # a Hall of Fame slot left empty (a cap-4 badge left at Gold)
        c = icon_build()
        hof = next(k for k, b in c["badges"].items() if b["tier"] == 4)
        c["badges"][hof]["tier"] = 3
        self.assertFalse(builds.icon_status(c))
        # a badge above its cap counts at the cap, never more
        c = icon_build()
        capped = next(k for k, v in builds.badge_caps(c).items() if v < 4)
        c["badges"][capped]["tier"] = 4
        self.assertTrue(builds.icon_status(c))

    def test_describe_carries_it(self):
        c = builds.normalize(icon_build())
        d = builds.describe(c)
        self.assertIs(d["icon_status"], True)
        self.assertTrue(d["icon_status_info"]["active"])
        self.assertEqual(d["win_streak"], 0)
        c["progression"]["win_streak"] = 7
        self.assertEqual(builds.describe(c)["win_streak"], 7)

    def test_the_client_mirror_matches(self):
        src = (ROOT / "client/js/sim/builds.js").read_text()
        self.assertIn("export const ICON_STATUS_OVR = 99, CAP_BREAKERS_PER_HOF = 5, CAP_BREAKER_HOF_LIMIT = 5;", src)
        self.assertEqual((builds.ICON_STATUS_OVR, builds.CAP_BREAKERS_PER_HOF, builds.CAP_BREAKER_HOF_LIMIT), (99, 5, 5))


class WinStreakApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "icon.sqlite3")
        handler = type("QuietHandler", (server_app.Handler,), {"log_message": lambda *a: None})
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server.daemon_threads = True
        cls.server.service = cls.service
        cls.thread = threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.service.close()
        cls.tmp.cleanup()

    def call(self, path, body=None, expect=200):
        req = urllib.request.Request(self.base + path, method="GET" if body is None else "POST",
                                     data=None if body is None else json.dumps(body).encode(),
                                     headers={} if body is None else {"Content-Type": "application/json"})
        try:
            with self.opener.open(req, timeout=20) as r:
                status, payload = r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            status, payload = e.code, json.loads(e.read() or b"null")
        if expect is not None and status != expect:
            raise AssertionError(f"{path}: {status} {payload}")
        return payload

    @staticmethod
    def key():
        return uuid.uuid4().hex

    def summary(self, won=True):
        s = {"pts": 11, "fgm": 4, "fga": 9, "tpm": 3, "tpa": 5, "ftm": 0, "fta": 0, "ast": 2, "reb": 3}
        return {"mode": "park", "score": [21, 15] if won else [15, 21], "winner": 0 if won else 1, "duration": 420, "quarter": 1, "players": [], "me": {"team": 0, "stats": s}, "forfeit": False}

    def streak(self, cid):
        return next(c for c in self.call("/api/me")["characters"] if c["id"] == cid)["win_streak"]

    def test_the_streak_counts_wins_and_ends_on_a_loss_or_a_game_left(self):
        self.call("/api/register", {"username": "ic_" + uuid.uuid4().hex[:6], "password": "longpassword1"})
        self.call("/api/ai-world", {"key": self.key(), "world": {"seed": 4747, "friends": [], "squad": [], "met": {}}})
        build = {"name": "Streak Guy", "position": "PF", "archetype": "stretch_big", "height": 82, "weight": 230, "wingspan": 86}
        cid = self.call("/api/characters", {"key": self.key(), "build": build})["character"]["id"]
        self.call(f"/api/characters/{cid}/affiliation", {"key": self.key(), "affiliation": "brick"})
        self.assertEqual(self.streak(cid), 0)
        game = {"character_id": cid, "mode": "park", "venue": "brick", "format": 3, "target": 21}
        old_slack = server_app.TIME_SLACK
        server_app.TIME_SLACK = 10_000
        try:
            for n in (1, 2, 3):
                t = self.call("/api/matches", {"key": self.key(), **game})
                res = self.call(f"/api/matches/{t['id']}/complete", {"key": self.key(), "summary": self.summary(True)})
                self.assertTrue(res["won"])
                self.assertEqual(self.streak(cid), n)
            # a loss ends it
            t = self.call("/api/matches", {"key": self.key(), **game})
            self.call(f"/api/matches/{t['id']}/complete", {"key": self.key(), "summary": self.summary(False)})
            self.assertEqual(self.streak(cid), 0)
            # two wins, then a game left running when the next one starts (abandoned) ends it too
            for n in (1, 2):
                t = self.call("/api/matches", {"key": self.key(), **game})
                self.call(f"/api/matches/{t['id']}/complete", {"key": self.key(), "summary": self.summary(True)})
            self.assertEqual(self.streak(cid), 2)
            self.call("/api/matches", {"key": self.key(), **game})
            t = self.call("/api/matches", {"key": self.key(), **game})  # (the first one is abandoned)
            self.assertEqual(self.streak(cid), 0)
            # and so does leaving one (quit)
            self.call(f"/api/matches/{t['id']}/complete", {"key": self.key(), "summary": self.summary(True)})
            self.assertEqual(self.streak(cid), 1)
            t = self.call("/api/matches", {"key": self.key(), **game})
            self.call(f"/api/matches/{t['id']}/cancel", {})
            self.assertEqual(self.streak(cid), 0)
        finally:
            server_app.TIME_SLACK = old_slack


if __name__ == "__main__":
    unittest.main()
