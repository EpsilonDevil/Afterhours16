"""v0.4.8.9 The Gauntlet, the server's side (server/gauntlet.py, docs/GAUNTLET.md §11, §12): runs issued and paid once
(VC from the counts, capped per run and by the real time it took; implausible runs refused), the achievements and the
nemesis world kept per account, the sacrifices (every gate, the refusals, the build gone and its slot free, the park card
rolled from its Icon's stat list), park cards on every build of the account, and the event parks' cut streak VC.

Run from the project root:  python3 -m unittest tests.test_v0489_gauntlet -v
"""
import http.cookiejar
import json
import os
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app, gauntlet as G, progression, builds, cup

try:
    from tests.test_icon_slots import make_icon
except ImportError:
    from test_icon_slots import make_icon


def counts(**kw):
    """A runOver(run)-shaped summary: a failed run in Phase 1 by default."""
    out = {"completed": False, "phaseReached": 1, "nodesCleared": 4, "matchesWon": 3, "rivals": 0, "bosses": 0, "durationTurns": 12,
           "summary": {"final": False, "cardsPlayed": 30, "nonMatchNodes": 1}}
    inner = kw.pop("summary", {})
    out.update(kw)
    out["summary"].update(inner)
    return out


COMPLETE = dict(completed=True, phaseReached=4, nodesCleared=40, matchesWon=19, rivals=3, bosses=3, durationTurns=140,
                summary={"final": True, "cardsPlayed": 600, "nonMatchNodes": 20})


class VCRules(unittest.TestCase):
    def check(self, s, elapsed=3600, seed=7, pid="starter-7-0"):
        return G.check_summary(s, {"seed": seed, "player": {"id": pid}}, elapsed)

    def test_vc_per_win_kind_and_the_caps(self):
        c = self.check(counts())
        self.assertEqual(G.run_vc(c)["raw"], 3 * 140)
        full = self.check(counts(**COMPLETE))
        v = G.run_vc(full)
        # (19 wins: 12 matches, 3 Rivals, 3 bosses and the Final)
        self.assertEqual((v["matches"], v["rivals"], v["bosses"], v["final"]), (12 * 140, 900, 2700, 2000))
        self.assertEqual(v["raw"], 1680 + 900 + 2700 + 2000)
        self.assertTrue(6000 <= min(v["raw"], G.RUN_CAP) <= 8000, "a completed run: 6-8k (§11)")
        # the time cap: 180 a real minute, the run cap 8,000 from ~45 minutes
        self.assertEqual(G.time_cap(10 * 60), 1800)
        self.assertEqual(G.time_cap(45 * 60), 8000)
        self.assertEqual(G.time_cap(10 * 3600), 8000)
        self.assertEqual(G.time_cap(-5), 0)

    def test_implausible_runs_are_refused(self):
        bad = [
            counts(completed=True),                                    # completed without the Final
            counts(phaseReached=2),                                    # Phase 2 without beating the boss
            counts(bosses=1),                                          # a boss beaten, still in Phase 1
            counts(rivals=4),                                          # more Rivals than wins
            counts(matchesWon=30, nodesCleared=10),                    # more won than played
            counts(matchesWon=5, durationTurns=2),                     # a match in less than a turn
            counts(matchesWon=99),                                     # past the bracket's size
            counts(summary={"seed": 8}),                               # another run's summary
            counts(summary={"player": {"id": "starter-7-2"}}),         # another player's
            counts(completed="yes"),
            "not a summary",
        ]
        for s in bad:
            with self.assertRaises(builds.Invalid, msg=str(s)[:90]):
                self.check(s)
        with self.assertRaises(builds.Invalid):  # (19 wins in 5 minutes: faster than a run can be played)
            self.check(counts(**COMPLETE), elapsed=300)
        self.check(counts(**COMPLETE), elapsed=19 * G.MIN_MATCH_SECS + 20 * G.MIN_NODE_SECS)

    def test_world_shape_and_size(self):
        w = {"v": 1, "aiSeed": 5, "runs": 2, "ticks": 1, "feed": ["Tre Moss is now a Rival."], "chars": {
            "ai-12": {"name": "Tre Moss", "rank": 9, "traits": ["handle_read", "BAD TRAIT!"], "memories": [{"k": "beat", "text": "x" * 500}] * 8,
                      "record": {"w": 3, "l": -1}, "rel": {"ai-7": "rival", "ai-8": "enemy"}, "turned": "yes", "extra": 1}}}
        out = G.clean_world(w)
        c = out["chars"]["ai-12"]
        self.assertEqual((c["rank"], c["traits"], len(c["memories"]), len(c["memories"][0]["text"]), c["record"], c["rel"], c["turned"]),
                         (4, ["handle_read"], 5, 120, {"w": 3, "l": 0}, {"ai-7": "rival"}, False))
        self.assertNotIn("extra", c)
        for bad in ([], {"chars": []}, {"chars": {"bob": {}}}, {"chars": {"ai-1": "x"}}, {"chars": {f"ai-{i}": {} for i in range(G.MAX_CHARS + 1)}},
                    {"chars": {"ai-1": {"name": "x" * (G.MAX_WORLD_BYTES + 10)}}}):
            with self.assertRaises(builds.Invalid):
                G.clean_world(bad)

    def test_park_card_rolls_from_the_icons_stat_list(self):
        for icon, stats in G.ICON_CARD_STATS.items():
            seen = {G.roll_card("acct", f"c{i}", 0, icon)["attr"] for i in range(80)}
            self.assertTrue(seen <= set(stats), icon)
            self.assertEqual(len(seen), len(stats) if len(stats) <= 4 else len(seen))
        self.assertEqual(set(G.ICON_CARD_STATS["the_general"]), set(builds.ATTRIBUTES), "The General: any attribute")
        self.assertEqual(G.ICON_CARD_STATS["sharp_eye"], ("three_point", "mid_range"))
        self.assertEqual(G.roll_card("a", "b", 1, "oprah"), G.roll_card("a", "b", 1, "oprah"), "seeded: the same every time")
        self.assertEqual([G.roll_card("a", "b", n, "oprah")["pct"] for n in range(3)], [0.01, 0.03, 0.05])
        self.assertEqual([G.roll_card("a", "b", n, "oprah")["tier"] for n in range(3)], ["common", "rare", "legendary"])


class EventStreak(unittest.TestCase):
    def test_event_parks_keep_a_quarter_of_the_streak_bonus(self):
        self.assertEqual(progression.event_streak_mult(4.0), 1.75)
        self.assertEqual(progression.event_streak_mult(1.0), 1.0)
        self.assertEqual(progression.event_streak_mult(1.3), 1.075)
        s = {k: 0 for k in progression.STAT_KEYS}
        s.update(pts=10, fgm=5, fga=9, reb=3, ast=2)
        summ = {"mode": "park", "score": [21, 12], "winner": 0, "team": 0, "forfeit": False, "stats": s, "duration": 400}
        ev = next(iter(cup.EVENT_VENUES))
        raw = (160 + 180 + (10 * 8 + 2 * 10 + 3 * 6)) * progression.VC_K   # (a win's VC before the streak)
        rep = 70 + 10 * 2 + 2 * 3 + 3 * 2
        r = progression.rewards(summ, {"mode": "park", "meta": {"venue": "brick", "streak": 10}}, {})
        self.assertEqual((r["streak_mult"], r["vc"], r["rep"]), (4.0, min(int(raw * 4), int(2200 * progression.VC_K * 4)), int(rep * 4)))
        # the event park on the same streak: VC x1.75, not x4 (the pot too); Rep keeps the full streak
        r = progression.rewards(summ, {"mode": "park", "meta": {"venue": ev, "streak": 10, "ante": 1000}}, {})
        pot = 1000 + int(1000 * 1.75)
        self.assertEqual((r["streak_mult"], r["vc"], r["rep"], r["cup"]["pot"]), (1.75, min(int(raw * 1.75), int(2200 * progression.VC_K * 1.75)) + pot, int(rep * 4), pot))
        # no streak: nothing to cut
        r = progression.rewards(summ, {"mode": "park", "meta": {"venue": ev, "streak": 0, "ante": 1000}}, {})
        self.assertEqual((r["streak_mult"], r["vc"]), (1.0, int(raw) + 2000))


class GauntletApi(unittest.TestCase):
    # (v0.4.8.9 qp1: these runs are fabricated summaries with no choices to replay: the count checks, the payout's
    # fallback when there's no replay, are what's tested here; RIMRIFT_REPLAY=0 turns the replay off.
    # tests/test_v0489qp1_replay.py has the replayed runs)
    @classmethod
    def setUpClass(cls):
        cls._replay = os.environ.get("RIMRIFT_REPLAY")
        os.environ["RIMRIFT_REPLAY"] = "0"
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "g.sqlite3", dev_accounts=False)
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
        if cls._replay is None:
            os.environ.pop("RIMRIFT_REPLAY", None)
        else:
            os.environ["RIMRIFT_REPLAY"] = cls._replay

    def player(self, name="gp", builds_=1, arch="playmaker"):
        p = type("P", (), {})()
        p.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        p.name = name + "_" + uuid.uuid4().hex[:5]
        p.id = self.call(p, "/api/register", {"username": p.name, "password": "longpassword1"})["account"]["id"]
        p.cids = []
        for i in range(builds_):
            b = {"name": f"{name.title()} {i}", "position": "PG", "archetype": arch, "height": 75, "weight": 190, "wingspan": 78}
            p.cids.append(self.call(p, "/api/characters", {"key": uuid.uuid4().hex, "build": b})["character"]["id"])
        return p

    def call(self, p, path, body=None, expect=200):
        req = urllib.request.Request(self.base + path, method="GET" if body is None else "POST", data=None if body is None else json.dumps(body).encode(),
                                     headers={} if body is None else {"Content-Type": "application/json"})
        try:
            with p.opener.open(req, timeout=30) as r:
                status, out = r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            status, out = e.code, json.loads(e.read() or b"null")
        self.assertEqual(status, expect, f"{path}: {out}")
        return out

    def iconize(self, cid):
        with self.service.db.transaction() as c:
            ch = json.loads(c.execute("SELECT data FROM characters WHERE id=?", (cid,)).fetchone()[0])
            make_icon(ch)
            ch["icon_badge"] = builds.ICON_FOR_ARCH.get(ch.get("archetype"), "the_general")
            c.execute("UPDATE characters SET data=? WHERE id=?", (json.dumps(ch), cid))

    def age(self, rid, secs):
        with self.service.db.transaction() as c:
            c.execute("UPDATE gauntlet_runs SET started_at=started_at-? WHERE id=?", (secs, rid))

    SEEDS = iter(range(1000, 10 ** 6))

    def complete_runs(self, p, n, distinct=True):
        for i in range(n):
            seed = next(self.SEEDS) if distinct else 999
            r = self.call(p, "/api/gauntlet/start", {"key": uuid.uuid4().hex, "seed": seed, "player": {"id": f"starter-{seed}-0", "name": "S"}})
            self.age(r["run_id"], 3600)
            self.call(p, "/api/gauntlet/finish", {"run_id": r["run_id"], "summary": counts(**COMPLETE)})

    def test_start_seeds_players_and_the_profile(self):
        a = self.player("st")
        r = self.call(a, "/api/gauntlet/start", {"key": uuid.uuid4().hex, "seed": 77, "player": {"id": "starter-77-2", "name": "Pip"}})
        self.assertEqual((r["seed"], r["player"]["id"], len(r["run_id"])), (77, "starter-77-2", 32))
        self.call(a, "/api/gauntlet/start", {"key": uuid.uuid4().hex, "seed": 77, "player": {"id": "starter-78-0"}}, expect=400)  # (not this seed's)
        self.call(a, "/api/gauntlet/start", {"key": uuid.uuid4().hex, "seed": 0, "player": {"id": "starter-0-0"}}, expect=400)
        self.call(a, "/api/gauntlet/start", {"key": uuid.uuid4().hex, "player": {"id": "cv-nope", "converted": True}}, expect=400)  # (not his)
        auto = self.call(a, "/api/gauntlet/start", {"key": uuid.uuid4().hex, "player": {"id": "x"}}, expect=400)
        self.assertIn("starter", auto["error"])
        prof = self.call(a, "/api/gauntlet/profile")
        self.assertTrue({"converted", "world", "unlocks", "stats", "feed"} <= set(prof))
        self.assertEqual(prof["unlocks"]["next"]["needs"], {"completed": 1, "distinct": 0})
        self.assertEqual(prof["stats"]["started"], 1)

    def test_finish_pays_once_capped_by_time_and_keeps_the_world(self):
        a = self.player("fi")
        bal0 = self.call(a, "/api/me")["balance"]
        r = self.call(a, "/api/gauntlet/start", {"key": uuid.uuid4().hex, "seed": 5, "player": {"id": "starter-5-0", "name": "S"}})
        self.age(r["run_id"], 600)  # (10 real minutes: 1,800 at the most)
        world = {"v": 1, "aiSeed": 3, "runs": 1, "ticks": 0, "chars": {"ai-4": {"name": "Big Dre", "rank": 1, "record": {"w": 1, "l": 0}}}, "feed": []}
        body = {"run_id": r["run_id"], "summary": counts(phaseReached=2, bosses=1, matchesWon=9, rivals=1, nodesCleared=14, durationTurns=40), "world": world, "feed": ["Big Dre sent you home."], "choices": []}
        out = self.call(a, "/api/gauntlet/finish", body)
        self.assertEqual(out["vc_parts"]["raw"], 7 * 140 + 300 + 900)
        self.assertEqual(out["vc"], 1800, "capped by the time it took")
        self.assertEqual(out["balance"], bal0 + 1800)
        self.assertEqual(out["world"]["chars"]["ai-4"]["name"], "Big Dre")
        self.assertEqual(out["feed"], ["Big Dre sent you home."])
        again = self.call(a, "/api/gauntlet/finish", body)
        self.assertEqual((again["vc"], again["balance"], again["repeat"]), (1800, bal0 + 1800, True), "paid once")
        self.assertEqual(self.call(a, "/api/me")["balance"], bal0 + 1800)
        prof = self.call(a, "/api/gauntlet/profile")
        self.assertEqual(prof["world"]["chars"]["ai-4"]["rank"], 1)
        self.assertEqual((prof["stats"]["finished"], prof["stats"]["completed"], prof["unlocks"]["completed"]), (1, 0, 0), "a failed run isn't completed")
        # another account can't finish it; too fast is refused; an expired run is gone
        b = self.player("fx")
        self.call(b, "/api/gauntlet/finish", {"run_id": r["run_id"], "summary": counts()}, expect=400)
        r2 = self.call(a, "/api/gauntlet/start", {"key": uuid.uuid4().hex, "seed": 6, "player": {"id": "starter-6-0", "name": "S"}})
        self.call(a, "/api/gauntlet/finish", {"run_id": r2["run_id"], "summary": counts(**COMPLETE)}, expect=400)
        self.age(r2["run_id"], G.MAX_RUN_AGE + 10)
        self.call(a, "/api/gauntlet/finish", {"run_id": r2["run_id"], "summary": counts(**COMPLETE)}, expect=400)
        # a completed run: the cap
        r3 = self.call(a, "/api/gauntlet/start", {"key": uuid.uuid4().hex, "seed": 9, "player": {"id": "starter-9-1", "name": "S"}})
        self.age(r3["run_id"], 3600)
        out3 = self.call(a, "/api/gauntlet/finish", {"run_id": r3["run_id"], "summary": counts(**COMPLETE)})
        self.assertEqual((out3["vc"], out3["completed"], out3["unlocks"]["completed"], out3["unlocks"]["distinctCompleted"]), (7280, True, 1, 1))
        self.call(a, "/api/gauntlet/finish", {"run_id": r3["run_id"], "summary": counts(**COMPLETE), "world": {"chars": "bad"}})  # (finished: the same answer)
        r4 = self.call(a, "/api/gauntlet/start", {"key": uuid.uuid4().hex, "seed": 10, "player": {"id": "starter-10-1", "name": "S"}})
        self.age(r4["run_id"], 3600)
        self.call(a, "/api/gauntlet/finish", {"run_id": r4["run_id"], "summary": counts(), "world": {"chars": "bad"}}, expect=400)

    def test_every_sacrifice_gate_and_refusal(self):
        a = self.player("sa", builds_=4, arch="playmaker")
        for cid in a.cids[:3]:
            self.iconize(cid)
        sac = lambda cid, expect=200, key=None: self.call(a, "/api/gauntlet/sacrifice", {"key": key or uuid.uuid4().hex, "character_id": cid}, expect)
        # not an ICON
        self.assertIn("ICON 99", sac(a.cids[3], 400)["error"])
        # gate 1: a completed run
        self.assertIn("1 completed Gauntlet run", sac(a.cids[0], 400)["error"])
        self.complete_runs(a, 1)
        me = self.call(a, "/api/me")
        slots0 = me["build_slots"]
        k = uuid.uuid4().hex
        out = sac(a.cids[0], key=k)
        self.assertEqual((out["card"]["tier"], out["card"]["pct"], out["card"]["n"]), ("common", 0.01, 1))
        self.assertIn(out["card"]["attr"], G.ICON_CARD_STATS["oprah"])
        self.assertEqual(sac(a.cids[0], key=k)["card"], out["card"], "idempotent")
        # the build left the park, its slot free (an ICON's slot stays the account's), its data the converted player's
        me = self.call(a, "/api/me")
        self.assertNotIn(a.cids[0], [c["id"] for c in me["characters"]])
        self.assertEqual(me["build_slots"]["used"], slots0["used"] - 1)
        self.assertEqual(me["build_slots"]["unlocked"], slots0["unlocked"])
        self.call(a, "/api/gauntlet/sacrifice", {"key": uuid.uuid4().hex, "character_id": a.cids[0]}, expect=404)
        prof = self.call(a, "/api/gauntlet/profile")
        cv = prof["converted"][0]
        self.assertEqual((cv["id"], cv["character_id"], cv["icon"], cv["converted"]), ("cv-" + a.cids[0], a.cids[0], "oprah", True))
        self.assertTrue(all(isinstance(cv["stats"][k], int) for k in ("stamina", "shooting", "defense", "health")))
        self.assertEqual(cv["build"]["attributes"]["three_point"], 99)
        # every build of the account carries the card now (park games read it from the entry), a new one too
        self.assertTrue(all(c["park_cards"] == [{"attr": out["card"]["attr"], "pct": 0.01}] for c in me["characters"]))
        self.assertEqual(me["park_cards"][0]["tier"], "common")
        # a converted player can start a run; another account's can't
        r = self.call(a, "/api/gauntlet/start", {"key": uuid.uuid4().hex, "player": {"id": cv["id"], "converted": True}})
        self.assertTrue(r["player"]["converted"])
        self.call(self.player("ot"), "/api/gauntlet/start", {"key": uuid.uuid4().hex, "player": {"id": cv["id"], "converted": True}}, expect=400)
        # gate 2: 3 completed runs with 3 different players
        self.complete_runs(a, 1)
        self.assertIn("3 completed", sac(a.cids[1], 400)["error"])
        self.complete_runs(a, 1, distinct=False)  # (a starter's id is its seed's: 3 runs, 3 different players)
        u = self.call(a, "/api/gauntlet/profile")["unlocks"]
        self.assertEqual(u["completed"], 3)
        out2 = sac(a.cids[1])
        self.assertEqual((out2["card"]["tier"], out2["card"]["pct"]), ("rare", 0.03))
        # gate 3: 5 completed
        self.assertIn("5 completed", sac(a.cids[2], 400)["error"])
        self.complete_runs(a, 2)
        out3 = sac(a.cids[2])
        self.assertEqual((out3["card"]["tier"], out3["card"]["pct"], out3["unlocks"]["next"]), ("legendary", 0.05, None))
        # no fourth
        self.iconize(a.cids[3])
        self.assertIn("All three", sac(a.cids[3], 400)["error"])
        cards = self.call(a, "/api/me")["characters"][0]["park_cards"]
        self.assertEqual([c["pct"] for c in cards], [0.01, 0.03, 0.05])

    def test_the_distinct_players_gate_counts_players(self):
        a = self.player("dp", builds_=1)
        self.iconize(a.cids[0])
        with self.service.db.transaction() as c:
            c.execute("INSERT INTO park_cards VALUES(?,?,?,?,?,?,?,?,?)", (a.id, 1, "common", "steal", 0.01, "x", "Old", "the_clamp", time.time()))
        # three completed runs, all with the same converted player: 3 runs, 1 player
        with self.service.db.transaction() as c:
            for i in range(3):
                c.execute("INSERT INTO gauntlet_runs(id, account_id, seed, player, status, started_at) VALUES(?,?,?,?,?,?)",
                          (uuid.uuid4().hex, a.id, 5, json.dumps({"id": "cv-same", "converted": True}), "completed", time.time()))
        r = self.call(a, "/api/gauntlet/sacrifice", {"key": uuid.uuid4().hex, "character_id": a.cids[0]}, expect=400)
        self.assertIn("3 different players", r["error"])

    def test_a_build_in_a_running_game_cant_go(self):
        a = self.player("rg", builds_=1)
        self.iconize(a.cids[0])
        self.complete_runs(a, 1)
        self.call(a, "/api/matches", {"key": uuid.uuid4().hex, "character_id": a.cids[0], "mode": "park", "venue": "brick", "format": 3, "target": 21})
        r = self.call(a, "/api/gauntlet/sacrifice", {"key": uuid.uuid4().hex, "character_id": a.cids[0]}, expect=400)
        self.assertIn("still running", r["error"])
        self.assertEqual(self.call(a, "/api/gauntlet/profile")["unlocks"]["sacrificesDone"], 0, "nothing kept from the refused one")


if __name__ == "__main__":
    unittest.main()
