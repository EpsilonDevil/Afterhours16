"""v0.4.8.7: hosted games' results, checked on the server. A park or Pro-Am game played through this service's online
server (online.py) is bound to it when its ticket is made (by the server's own word, Hub.game_of), and at the end it
pays only when the player's result matches what the other real players' games ended with (each one's own 'end' on the
game's record, Hub.results). The service waits for their ends on the hub's condition (no other request waits with it,
no database lock is held), at most HOSTED_WAIT seconds.

  agreed      paid as before
  disputed    void: nothing paid, the ante back, 409 with why, logged; an account in disputes with 3+ different people
              in 24 hours is named in the log
  single      the only end that came in (the others left): paid if it fits what the online server saw (the score at
              least what they last relayed, the state hashes they share, the game's time on the server)
  unverified  no record (the online server restarted): paid, logged

Offline and solo games, and games on someone else's online server (a linked copy), are exactly as before.

Run from the project root:  python3 -m unittest tests.test_hosted_results -v
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

from server import app as server_app, online, cup


def summary(score=(11, 5), winner=0, team=0, duration=60, forfeit=False):
    s = {"pts": 0, "fgm": 0, "fga": 0, "tpm": 0, "tpa": 0, "ftm": 0, "fta": 0}
    return {"mode": "park", "score": list(score), "winner": winner, "duration": duration, "quarter": 1, "players": [], "me": {"team": team, "stats": s}, "forfeit": forfeit}


def judged(score=(11, 5), winner=0, team=0, duration=60, forfeit=False):
    s = summary(score, winner, team, duration, forfeit)
    return {"score": s["score"], "winner": winner, "team": team, "duration": duration, "forfeit": forfeit}


class FakeConn:
    """A player on the hub without a socket: what it's sent is kept."""
    def __init__(self, aid, name):
        self.aid, self.username, self.alive, self.game, self.got = aid, name, True, None, []
        self.info = {"name": name, "park": None, "status": "menu", "char": None}
        self.squad, self.entry, self.aisquad, self.ip, self.connected_at = None, None, [], None, time.time()

    def stop(self):
        self.alive = False

    def send(self, msg):
        self.got.append(msg)

    def send_frame(self, fr):
        pass


# ---------------- the verdict itself ----------------
class JudgeTests(unittest.TestCase):
    def rec(self, **kw):
        r = {"game": 1, "run": "r", "slots": {"A": 0, "B": 1}, "started": time.time() - 120, "ended": time.time(),
             "reports": {}, "scores": {}, "hashes": {}, "left": []}
        r.update(kw)
        return r

    def test_agreed_and_disputed(self):
        both = {"A": {"winners": ["A"], "score": [11, 5], "t": time.time()}, "B": {"winners": ["A"], "score": [11, 5], "t": time.time()}}
        self.assertEqual(server_app.judge_hosted("A", self.rec(reports=both), judged())["state"], "agreed")
        self.assertEqual(server_app.judge_hosted("B", self.rec(reports=both), judged(team=1))["state"], "agreed", "the loser's side agrees too")
        # B's game says B won: void, and B is on the other side of it
        v = server_app.judge_hosted("A", self.rec(reports={**both, "B": {"winners": ["B"], "score": [5, 11], "t": 0}}), judged())
        self.assertEqual((v["state"], v["others"]), ("disputed", ["B"]))
        # the same winner but another score (stats padded): void
        self.assertEqual(server_app.judge_hosted("A", self.rec(reports={**both, "B": {"winners": ["A"], "score": [11, 9], "t": 0}}), judged())["state"], "disputed")
        # what he tells the service isn't what his own game told the online server: void
        self.assertEqual(server_app.judge_hosted("A", self.rec(reports=both), judged(score=(11, 2)))["state"], "disputed")
        self.assertEqual(server_app.judge_hosted("B", self.rec(reports=both), judged(team=1, winner=1, score=(5, 11)))["state"], "disputed", "the loser claiming the win")
        # an end without a score (it only says who won) is held to that
        self.assertEqual(server_app.judge_hosted("A", self.rec(reports={"B": {"winners": ["A"], "score": None, "t": 0}}), judged())["state"], "agreed")

    def test_single_report_has_to_fit_what_the_online_server_saw(self):
        mine = {"A": {"winners": ["A"], "score": [11, 5], "t": time.time()}}
        ok = self.rec(reports=mine, left=["B"], scores={"B": [6, 4]}, hashes={"A": {"120": 5, "240": 7}, "B": {"120": 5}})
        self.assertEqual(server_app.judge_hosted("A", ok, judged())["state"], "single")
        # below what B's game last relayed
        self.assertEqual(server_app.judge_hosted("A", self.rec(reports=mine, left=["B"], scores={"B": [6, 6]}), judged())["state"], "disputed")
        # a state hash they share that differs: not the same game
        self.assertEqual(server_app.judge_hosted("A", self.rec(reports=mine, left=["B"], hashes={"A": {"120": 5}, "B": {"120": 9}}), judged())["state"], "disputed")
        # longer than the game was on the online server (with the usual slack)
        short = self.rec(reports={"A": {"winners": ["A"], "score": [11, 5], "t": time.time()}}, started=time.time() - 50, left=["B"])
        self.assertEqual(server_app.judge_hosted("A", short, judged(duration=60))["state"], "single")
        self.assertEqual(server_app.judge_hosted("A", short, judged(duration=50 + server_app.TIME_SLACK + 20))["state"], "disputed")
        # he left the game himself before it ended
        self.assertEqual(server_app.judge_hosted("A", self.rec(left=["A", "B"]), judged())["state"], "disputed")

    def test_no_record_is_accepted_and_said(self):
        self.assertEqual(server_app.judge_hosted("A", None, judged())["state"], "unverified")


# ---------------- the record on the online server ----------------
class HubRecordTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.service = server_app.Service(Path(self.tmp.name) / "h.sqlite3", dev_accounts=False)
        self.hub = self.service.hub
        self.a, self.b = FakeConn("A", "ann"), FakeConn("B", "ben")
        self.hub.conns.update({"A": self.a, "B": self.b})

    def tearDown(self):
        self.service.close()
        self.tmp.cleanup()

    def start(self):
        self.hub.handle(self.a, {"t": "start", "setup": {"slots": {"A": 0, "B": 1}}})
        return self.hub.game_of("A")

    def test_every_end_goes_on_the_record_and_stays_a_while(self):
        g = self.start()
        self.assertEqual((g["players"], g["run"]), (["A", "B"], self.hub.run_id))
        self.hub.handle(self.a, {"t": "hash", "k": 120, "h": 77})
        self.hub.handle(self.a, {"t": "score", "score": [4, 2]})
        self.hub.handle(self.a, {"t": "end", "g": g["game"], "winners": ["A", "nobody"], "score": [11, 5]})
        self.assertIsNone(self.hub.game_of("A"), "the first end ends the game")
        self.hub.handle(self.b, {"t": "end", "g": g["game"], "winners": ["A"], "score": [11, 5]})  # (after it: still kept)
        rec = self.hub.result_record(g["game"], g["run"])
        self.assertEqual(rec["reports"]["A"]["winners"], ["A"])
        self.assertEqual(rec["reports"]["B"]["score"], [11, 5])
        self.assertEqual((rec["scores"]["A"], rec["hashes"]["A"]), ([4, 2], {"120": 77}))
        self.assertIsNotNone(rec["ended"])
        self.assertIsNone(self.hub.result_record(g["game"], "another run"), "a record of another run of the online server isn't this one")
        # a second end from the same player doesn't overwrite his first; nonsense isn't kept
        self.hub.handle(self.a, {"t": "end", "g": g["game"], "winners": [], "score": [0, 0]})
        self.assertEqual(self.hub.result_record(g["game"], g["run"])["reports"]["A"]["score"], [11, 5])
        self.assertIsNone(online.score_pair([1, True])); self.assertIsNone(online.score_pair([1])); self.assertIsNone(online.score_pair(["1", 2]))

    def test_bounded(self):
        g = self.start()
        for k in range(0, 2400, 120):
            self.hub.handle(self.a, {"t": "hash", "k": k, "h": k})
        self.assertEqual(len(self.hub.result_record(g["game"], g["run"])["hashes"]["A"]), online.RESULT_HASHES)
        self.hub.handle(self.a, {"t": "end", "g": g["game"], "winners": ["A"], "score": [11, 5]})
        # old finished records go after RESULT_TTL, and there are never more than RESULT_MAX
        with self.hub.lock:
            self.hub.results_prune(time.time() + online.RESULT_TTL + 1)
        self.assertIsNone(self.hub.result_record(g["game"], g["run"]))
        with self.hub.lock:
            now = time.time()
            for i in range(online.RESULT_MAX + 50):
                t = now - 600 + i * 0.01  # (all within the TTL: the cap alone trims them)
                self.hub.results[10_000 + i] = {"game": 10_000 + i, "run": self.hub.run_id, "slots": {}, "started": t, "ended": t, "reports": {}, "scores": {}, "hashes": {}, "left": []}
            self.hub.results_prune()
            self.assertEqual(len(self.hub.results), online.RESULT_MAX)
            self.assertNotIn(10_000, self.hub.results, "the oldest go first")

    def test_waiting_wakes_on_the_last_end_and_frees_the_lock(self):
        g = self.start()
        self.hub.handle(self.a, {"t": "end", "g": g["game"], "winners": ["A"], "score": [11, 5]})
        got, t0 = {}, time.monotonic()
        th = threading.Thread(target=lambda: got.update(rec=self.hub.wait_results(g["game"], g["run"], 5)))
        th.start()
        time.sleep(0.2)
        with self.hub.lock:  # (the waiting thread doesn't hold it)
            pass
        self.hub.handle(self.b, {"t": "end", "g": g["game"], "winners": ["A"], "score": [11, 5]})
        th.join(3)
        self.assertLess(time.monotonic() - t0, 2, "woken by the end, not the timeout")
        self.assertEqual(sorted(got["rec"]["reports"]), ["A", "B"])
        # somebody who leaves isn't waited for
        g2 = self.start()
        self.hub.handle(self.b, {"t": "quit"})
        self.hub.handle(self.a, {"t": "end", "g": g2["game"], "winners": ["A"], "score": [11, 5]})
        t0 = time.monotonic()
        rec = self.hub.wait_results(g2["game"], g2["run"], 5)
        self.assertLess(time.monotonic() - t0, 1)
        self.assertEqual(rec["left"], ["B"])


# ---------------- through the service ----------------
class HostedResultsApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.service = server_app.Service(Path(cls.tmp.name) / "api.sqlite3", dev_accounts=False)
        cls.service.rate_limit = lambda ip, category: None
        cls.slack, cls.wait = server_app.TIME_SLACK, server_app.HOSTED_WAIT
        server_app.TIME_SLACK, server_app.HOSTED_WAIT = 10_000, 1.5
        handler = type("QuietHandler", (server_app.Handler,), {"log_message": lambda *a: None})
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server.daemon_threads = True
        cls.server.service = cls.service
        threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        server_app.TIME_SLACK, server_app.HOSTED_WAIT = cls.slack, cls.wait
        cls.server.shutdown()
        cls.server.server_close()
        cls.service.close()
        cls.tmp.cleanup()

    def player(self, name):
        p = type("P", (), {})()
        p.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        p.name = name + "_" + uuid.uuid4().hex[:5]
        p.id = self.call(p, "/api/register", {"username": p.name, "password": "longpassword1"})["account"]["id"]
        build = {"name": name.title(), "position": "SG", "archetype": "sharpshooter", "height": 76, "weight": 195, "wingspan": 79}
        p.cid = self.call(p, "/api/characters", {"key": uuid.uuid4().hex, "build": build})["character"]["id"]
        p.conn = FakeConn(p.id, p.name)
        self.service.hub.conns[p.id] = p.conn
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

    def ticket(self, p):
        return self.call(p, "/api/matches", {"key": uuid.uuid4().hex, "character_id": p.cid, "mode": "park", "venue": "brick", "format": 1, "target": 11})

    def complete(self, p, t, summ, expect=200):
        return self.call(p, f"/api/matches/{t['id']}/complete", {"key": uuid.uuid4().hex, "summary": summ}, expect=expect)

    def game(self):
        a, b = self.player("ann"), self.player("ben")
        self.service.hub.handle(a.conn, {"t": "start", "setup": {"slots": {a.id: 0, b.id: 1}}})
        ta, tb = self.ticket(a), self.ticket(b)
        self.assertEqual(ta["meta"]["hub_game"]["game"], tb["meta"]["hub_game"]["game"], "both bound to the game, by the online server")
        return a, b, ta, tb, ta["meta"]["hub_game"]["game"]

    def end(self, p, gid, winners, score):
        self.service.hub.handle(p.conn, {"t": "end", "g": gid, "winners": winners, "score": score})

    def balance(self, p):
        return self.call(p, "/api/me")["balance"]

    def test_both_agree_both_paid(self):
        a, b, ta, tb, gid = self.game()
        self.end(a, gid, [a.id], [11, 5]); self.end(b, gid, [a.id], [11, 5])
        ra = self.complete(a, ta, summary())
        rb = self.complete(b, tb, summary(team=1))
        self.assertEqual((ra["checked"], ra["won"], rb["checked"], rb["won"]), ("agreed", True, "agreed", False))
        self.assertGreater(ra["vc"], 0)

    def test_they_disagree_void_logged_and_said(self):
        a, b, ta, tb, gid = self.game()
        before = self.balance(a)
        self.end(a, gid, [a.id], [11, 5]); self.end(b, gid, [b.id], [5, 11])
        err = self.complete(a, ta, summary(), expect=409)
        self.assertTrue(err["disputed"])
        self.assertIn("didn't match what the other players' games reported", err["error"])
        self.assertEqual(self.balance(a), before, "nothing paid")
        m = self.call(a, f"/api/matches/{ta['id']}")
        self.assertEqual(m["status"], "cancelled")
        self.assertTrue(any(f"{a.name} disputed" in l and b.name in l for l in server_app.results_log.lines))
        # asked again (a new request): the same answer, never a payout
        self.assertTrue(self.complete(a, ta, summary(), expect=409)["disputed"])

    def test_waits_for_the_others_end_without_holding_up_the_service(self):
        a, b, ta, tb, gid = self.game()
        server_app.HOSTED_WAIT = 8
        try:
            self.end(a, gid, [a.id], [11, 5])
            out, t0 = {}, time.monotonic()
            th = threading.Thread(target=lambda: out.update(r=self.complete(a, ta, summary())))
            th.start()
            time.sleep(0.4)
            t1 = time.monotonic()
            self.call(b, "/api/health")  # (another request while that one waits: answered at once)
            self.call(b, "/api/me")
            self.assertLess(time.monotonic() - t1, 1.5)
            self.end(b, gid, [a.id], [11, 5])
            th.join(10)
            self.assertLess(time.monotonic() - t0, 4, "woken by the other end, not the timeout")
            self.assertEqual(out["r"]["checked"], "agreed")
        finally:
            server_app.HOSTED_WAIT = 1.5

    def test_the_only_end_when_the_other_left(self):
        a, b, ta, tb, gid = self.game()
        self.service.hub.handle(a.conn, {"t": "score", "score": [6, 4]})
        self.service.hub.handle(b.conn, {"t": "quit"})
        self.end(a, gid, [a.id], [11, 5])
        r = self.complete(a, ta, summary())
        self.assertEqual((r["checked"], r["won"]), ("single", True), "a legit win is never lost")
        self.assertTrue(any(f"{a.name} single" in l for l in server_app.results_log.lines))
        # below the score the online server already saw: refused
        a, b, ta, tb, gid = self.game()
        self.service.hub.handle(b.conn, {"t": "score", "score": [6, 7]})
        self.service.hub.handle(b.conn, {"t": "quit"})
        self.end(a, gid, [a.id], [11, 5])
        self.assertTrue(self.complete(a, ta, summary(), expect=409)["disputed"])

    def test_no_record_after_a_restart_is_paid_and_logged(self):
        a, b, ta, tb, gid = self.game()
        with self.service.hub.lock:  # (the online server restarted: a new run, its old records gone)
            self.service.hub.results.clear()
            self.service.hub.run_id = "restarted"
        r = self.complete(a, ta, summary())
        self.assertEqual(r["checked"], "unverified")
        self.assertTrue(any(f"{a.name} unverified" in l for l in server_app.results_log.lines))

    def test_offline_and_solo_games_are_as_before(self):
        p = self.player("solo")
        del self.service.hub.conns[p.id]  # (not in an online game: offline, solo, or on another copy's online server)
        t = self.ticket(p)
        self.assertNotIn("hub_game", t["meta"])
        server_app.HOSTED_WAIT = 30
        try:
            t0 = time.monotonic()
            r = self.complete(p, t, summary())
            self.assertLess(time.monotonic() - t0, 3, "no wait")
        finally:
            server_app.HOSTED_WAIT = 1.5
        self.assertNotIn("checked", r)
        self.assertTrue(r["won"]); self.assertGreater(r["vc"], 0)
        # a player who's online but not in a game (walking the park) is solo too
        q = self.player("walker")
        self.assertNotIn("hub_game", self.ticket(q)["meta"])

    def test_a_disputed_ante_comes_back(self):
        p = self.player("ante")
        with self.service.db.transaction() as c:
            bal = c.execute("SELECT balance FROM wallets WHERE account_id=?", (p.id,)).fetchone()[0]
            cw = cup.window_at()
            mid = str(uuid.uuid4())
            meta = {"ante": 5000, "cup_window": cw, "hub_game": {"game": 1, "run": "x"}}
            c.execute("INSERT INTO matches(id,account_id,character_id,status,seed,state,result,created_at,updated_at,venue,mode,meta) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                      (mid, p.id, p.cid, "running", 1, None, None, time.time(), time.time(), "brick", "park", json.dumps(meta)))
            server_app.Database.change_wallet(c, p.id, -5000, "cup_ante", "ante:t" + mid)
            entry = self.service.cup_entry(c, p.id, cw); entry.update(games=1, staked=5000, net=-5000); self.service.save_cup_entry(c, p.id, cw, entry)
            row = c.execute("SELECT * FROM matches WHERE id=?", (mid,)).fetchone()
            out = self.service.void_disputed(c, p.id, row, meta, {"why": "test", "others": []}, mid)
            self.assertEqual(out["balance"], bal)
            self.assertIn("5,000 VC ante is back", out["message"])
            entry = self.service.cup_entry(c, p.id, cw)
            self.assertEqual((entry["games"], entry["staked"], entry["net"]), (0, 0, 0))
            # the same refund never twice
            self.service.void_disputed(c, p.id, row, meta, {"why": "test", "others": []}, mid)
            self.assertEqual(c.execute("SELECT balance FROM wallets WHERE account_id=?", (p.id,)).fetchone()[0], bal)

    def test_an_account_in_disputes_with_three_different_people_is_named(self):
        g = self.player("griefer")
        server_app.results_log.lines.clear()
        with self.service.db.transaction() as c:
            for i, other in enumerate(["v1", "v2", "v3"]):
                res = {"cancelled": True, "disputed": True, "reason": "disputed", "verdict": {"others": [other], "why": "x"}}
                c.execute("INSERT INTO matches(id,account_id,character_id,status,seed,state,result,created_at,updated_at,venue,mode,meta) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                          (str(uuid.uuid4()), g.id, g.cid, "cancelled", 1, None, json.dumps(res), time.time(), time.time(), "brick", "park", "{}"))
                self.service.dispute_watch(c, g.id)
                warned = [l for l in server_app.results_log.lines if "WARNING" in l and g.name in l]
                self.assertEqual(bool(warned), i == 2, f"after {i + 1}")
        self.assertIn("3 different players in 24 hours", warned[0])


if __name__ == "__main__":
    unittest.main()
