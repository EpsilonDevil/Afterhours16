"""v0.4.8.5 quick patch 7: the AI world wears what it unlocks. The AI field keeps grinding the park events, and every closed
window's top 25 get that rank's prizes, the same ones you would (cup.ai_prizes, GET /api/ai-world/unlocks; the client
dresses them: sim/world.js setUnlocks, bots.js wearUnlocked). The standings are the server's (cup.standings): the fast
path here must give exactly what they give, field by field, and the account's own entry for a window moves the AI it
beat down a rank, as it does on the board.

Run from the project root:  python3 -m unittest tests.test_ai_unlocks -v
"""
import http.cookiejar
import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app, cup

SEEDS = (4242, 123456, 7, 2 ** 31 - 1, 1)


def slow_prizes(seed, born_s, mine, now):
    """The reference: standings() for every closed window since the world was born, ranks 1-25 taking prize_for's items."""
    out = {}
    for w in range(max(0, cup.window_at(born_s)), cup.window_at(now)):
        ev = cup.event_for_window(w)
        if not ev:
            continue
        me = mine.get(w)
        rows = cup.standings(seed, w, {**cup.blank_entry(), **me} if me else None)
        for r in rows:
            if r["id"] != "me" and r["rank"] <= 25:
                out.setdefault(r["id"], set()).update(cup.prize_for(r["rank"], len(rows), ev)["items"])
    return {k: sorted(v) for k, v in out.items() if v}


class FastRecordTests(unittest.TestCase):
    def test_fast_records_are_ai_record_field_by_field(self):
        for seed in SEEDS:
            for w in (0, 5, 77, 141, 142, 143):
                self.assertEqual(cup.fast_records(seed, w), [cup.ai_record(seed, i, w) for i in cup.entrants(w)], (seed, w))
        # a window still running, cut off at any hour (and before it has started)
        start, end = cup.window_bounds(150)
        for until in (start - 10, start + 3, start + 7 * 3600 + 5, start + 30 * 3600, end + 999):
            self.assertEqual(cup.fast_records(4242, 150, until), [cup.ai_record(4242, i, 150, until) for i in cup.entrants(150)], until)
        # the tiers are tier_of's
        tiers = cup._tiers(4242)
        self.assertEqual([cup.TIER_IDS[t] for t in tiers[:120]], [cup.TIER_IDS[cup.tier_of(4242, f"ai-{i}")] for i in range(120)])

    def test_final_top_is_the_boards_top(self):
        for seed in SEEDS[:3]:
            for w in (12, 100, 143):
                board = [{k: r[k] for k in ("id", "net", "wins", "games")} for r in cup.standings(seed, w, until=cup.window_bounds(w)[1])]
                self.assertEqual(list(cup.final_top(seed, w)), board[:cup.FINAL_ROWS], (seed, w))
        self.assertIn((SEEDS[0], 12), cup._FINAL)  # (kept)


class PrizeTests(unittest.TestCase):
    def test_ai_prizes_are_what_the_standings_pay(self):
        now = cup.window_bounds(144)[0] + 5 * 3600  # (the Monster Mash running: the Beat, the Jungle and the Cup closed)
        for seed in SEEDS[:3]:
            born = cup.window_bounds(137)[0] + 7 * 3600
            got = cup.ai_prizes(seed, born, {}, now)
            self.assertEqual(got, slow_prizes(seed, born, {}, now), seed)
            # 7 windows: 7 winners' costumes (some win twice), 25 a window with something
            self.assertTrue(25 <= len(got) <= 7 * 25)
            events = {cup.event_for_window(w)["id"] for w in range(137, 144)}
            self.assertEqual(events, {"kingtut", "jungle", "beat"})
            for items in got.values():
                self.assertEqual(items, sorted(set(items)))
                self.assertTrue(all(server_app.CATALOG[i]["exclusive"] in ("cup", "jungle", "beat") for i in items), items)

    def test_you_beating_them_moves_their_prizes(self):
        now = cup.window_bounds(144)[0] + 3600
        seed, born = 4242, cup.window_bounds(140)[0]
        top = cup.final_top(seed, 141)
        # you won window 141 by a mile; in 142 you finished between 3rd and 4th; in 143 you played but finished nowhere
        mine = {141: {"games": 30, "wins": 30, "net": top[0]["net"] + 1},
                142: {"games": 9, "wins": 6, "net": (cup.final_top(seed, 142)[2]["net"] + cup.final_top(seed, 142)[3]["net"]) // 2},
                143: {"games": 3, "wins": 0, "net": -15000}, 140: {"games": 0, "net": 10 ** 9}}  # (no games: not on the board)
        got = cup.ai_prizes(seed, born, mine, now)
        self.assertEqual(got, slow_prizes(seed, born, mine, now))
        alone = cup.ai_prizes(seed, born, {}, now)
        self.assertNotEqual(got, alone)
        # 141's winner gets the Top 3 prizes instead of the costume (unless he won it some other window)
        first = top[0]["id"]
        if not any(cup.final_top(seed, w)[0]["id"] == first for w in (140, 142, 143)):
            self.assertIn("cup_mocap_top", alone[first])
            self.assertNotIn("cup_mocap_top", got.get(first, []))
            self.assertIn("cup_shoes_pharaoh", got[first])
        # and a tie on net goes to the AI (standings sorts "ai-..." before "me")
        tie = {141: {"games": 5, "wins": top[0]["wins"], "net": top[0]["net"]}}
        self.assertEqual(cup.ai_prizes(seed, born, tie, now), slow_prizes(seed, born, tie, now))
        self.assertIn("cup_mocap_top", cup.ai_prizes(seed, born, tie, now)[first])

    def test_windows_counted_and_nothing_before_the_cup(self):
        now = cup.window_bounds(144)[0] + 60
        self.assertEqual(cup.ai_prizes(4242, now - 30, {}, now), {})  # (born in the running window: nothing closed yet)
        self.assertEqual(cup.ai_prizes(4242, cup.window_bounds(143)[0] + 1, {}, now), slow_prizes(4242, cup.window_bounds(143)[0] + 1, {}, now))
        # a world "born" years before the first Cup only counts from window 0
        t0 = time.time()
        old = cup.ai_prizes(99, cup.EPOCH - 10 * 365 * 86400, {}, cup.window_bounds(3)[0])
        self.assertEqual(old, slow_prizes(99, cup.EPOCH, {}, cup.window_bounds(3)[0]))
        self.assertLess(time.time() - t0, 5)
        # no event on (a schedule gap): nothing is won that window
        old_sched = cup.SCHEDULE
        cup.SCHEDULE = [{"event": "kingtut", "from": None, "until": cup.window_bounds(142)[0]}]
        try:
            gap = cup.ai_prizes(777, cup.window_bounds(140)[0], {}, now)
            self.assertEqual(gap, slow_prizes(777, cup.window_bounds(140)[0], {}, now))
            self.assertTrue(all(i.startswith("cup_") for l in gap.values() for i in l))
        finally:
            cup.SCHEDULE = old_sched

    def test_fast_cold_and_instant_warm(self):
        now = cup.window_bounds(144)[0] + 60
        born = cup.window_bounds(104)[0]  # 40 closed windows
        seed = 31337 + int(time.time()) % 1000  # (a seed no other test has warmed)
        t0 = time.perf_counter()
        cold = cup.ai_prizes(seed, born, {}, now)
        t1 = time.perf_counter()
        warm = cup.ai_prizes(seed, born, {}, now)
        t2 = time.perf_counter()
        self.assertEqual(cold, warm)
        print(f"\n  ai_prizes, 40 windows: cold {t1 - t0:.2f} s, warm {(t2 - t1) * 1000:.1f} ms")
        self.assertLess(t1 - t0, 2.5)  # (~0.3 s here; the slow way is ~2 s)
        self.assertLess(t2 - t1, 0.05)
        self.assertLessEqual(len(cup._FINAL), cup.FINAL_CACHE_MAX)


class EndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "api.sqlite3")
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

    def setUp(self):
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, path, body=None, expect=200):
        req = urllib.request.Request(self.base + path, method="GET" if body is None else "POST", data=None if body is None else json.dumps(body).encode(),
                                     headers={} if body is None else {"Content-Type": "application/json"})
        try:
            with self.opener.open(req, timeout=30) as r:
                status, payload = r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            status, payload = e.code, json.loads(e.read() or b"null")
        self.assertEqual(status, expect, f"{path}: {payload}")
        return payload

    def test_the_endpoint(self):
        self.call("/api/ai-world/unlocks", expect=401)  # (signed in only)
        self.call("/api/register", {"username": "aiu_" + uuid.uuid4().hex[:6], "password": "longpassword1"})
        self.assertEqual(self.call("/api/ai-world/unlocks"), {"prizes": {}, "through": None})  # (no AI world yet)
        now = time.time()
        born = (now - 12 * 86400) * 1000  # (ms, as the client keeps it)
        self.call("/api/ai-world", {"key": uuid.uuid4().hex, "world": {"seed": 4242, "born": born, "friends": [], "squad": [], "met": {}}})
        r = self.call("/api/ai-world/unlocks")
        self.assertEqual(set(r), {"prizes", "through"})
        self.assertEqual(r["through"], cup.window_at(time.time()) - 1)
        self.assertEqual(r["prizes"], cup.ai_prizes(4242, born / 1000, {}, time.time()))
        self.assertEqual(r["prizes"], slow_prizes(4242, born / 1000, {}, time.time()))
        self.assertTrue(r["prizes"])
        # the account's own entry for a closed window counts: you won window `through`, its winner is pushed to 2nd
        aid = self.service.db.query("SELECT id FROM accounts WHERE username LIKE 'aiu_%'")[0][0]
        w = r["through"]
        win = {**cup.blank_entry(), "games": 40, "wins": 40, "net": cup.final_top(4242, w)[0]["net"] + 5}
        with self.service.db.transaction() as c:
            self.service.save_cup_entry(c, aid, w, win)
        r2 = self.call("/api/ai-world/unlocks")
        self.assertEqual(r2["prizes"], slow_prizes(4242, born / 1000, {w: win}, time.time()))
        self.assertNotEqual(r2["prizes"], r["prizes"])
        # (the standings are worked out outside the database lock: it isn't held while they're computed)
        src = (Path(__file__).resolve().parents[1] / "server/app.py").read_text()
        body = src[src.index("    def ai_unlocks(self, account_id):"):src.index("    def rate_limit(")]
        self.assertLess(body.index("with self.db.lock:"), body.index("mine = {"))
        self.assertGreater(body.index("cup.ai_prizes("), body.index("born = world.get"))
        self.assertNotIn("    with", body[body.index("born = world.get"):])


if __name__ == "__main__":
    unittest.main()
