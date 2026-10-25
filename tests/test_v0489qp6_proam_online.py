"""v0.4.8.9 qp6: Pro-Am teams online (server/proam.py ProAm.online_call, server/online.py pa_call). Players who play
from their own copies have their builds in their own saves, so the team is kept by the service they meet on (the
host's, or the online server): their games ask it over the online socket, as their accounts there.

* Found and joined: a player finds another's team in the search and joins it (open, or by a request the founder
  accepts), both see each other on the roster (each member's build from the card his game sends), and it stays that
  way across a reconnect and a restart of the service (the same save).
* One team in the queue: the Captain's ready check reaches the teammate, the lineup fills only the open spots, and the
  series game's result comes back from a member's own service (report): the first report counts; the series ends, the
  team moves up, and each member's own service settles his build (settle_online: once, with the bonus).
* On a player's own service: a ticket for an online team's series game (pa_game.online) works out its RP as any
  series game and hands the result back for the team's service (report); a forfeit too.

Run from the project root:  python3 -m unittest tests.test_v0489qp6_proam_online -v
"""
import json
import tempfile
import threading
import time
import unittest
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app, proam

try:
    from tests.test_online import Client
except ImportError:
    from test_online import Client

S = {"pts": 12, "fgm": 5, "fga": 10, "tpm": 1, "tpa": 3, "ftm": 1, "fta": 2, "reb": 4, "ast": 5, "stl": 1, "blk": 0, "tov": 2}


def serve(db, hosting=True):
    svc = server_app.Service(db, dev_accounts=True)
    svc.hosting, svc.join_code = hosting, "hoops42" if hosting else None
    svc.rate_limit = lambda ip, category: None
    handler = type("QuietHandler", (server_app.Handler,), {"log_message": lambda *a: None})
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    srv.daemon_threads = True
    srv.service = svc
    threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
    return svc, srv, f"http://127.0.0.1:{srv.server_address[1]}"


def stop(svc, srv):
    srv.shutdown()
    srv.server_close()
    svc.close()


OPEN = []  # (every member's socket, closed after each test)


class Member:
    """A player on the team's service: his online account there (no builds there) and his socket."""

    def __init__(self, base, name):
        OPEN.append(self)
        self.c = Client(base)
        st, out = self.c.call("/api/register", {"username": name, "password": "password123", "join_code": "hoops42"})
        assert st == 200, out
        self.id, self.name, self.seq = out["account"]["id"], name, 0
        self.connect()

    def connect(self):
        assert self.c.connect() == 101
        self.c.until("hello")

    def pa(self, op, args=None, ok=True):
        self.seq += 1
        req = f"r{self.seq}"
        self.c.send({"t": "pa", "req": req, "op": op, "args": args or {}})
        m = self.c.until("pa", lambda m: m.get("req") == req, limit=200)
        assert m["ok"] is ok, m
        return m["data"] if ok else m["error"]

    def card(self, name, div=0, rp=0):
        return {"character_id": f"local-{self.name}", "name": name, "position": "PG", "overall": 78, "div": div, "rp": rp, "record": [0, 0], "series": [0, 0]}


TEAM = {"name": "Night Shift", "abbr": "NS", "primary": "#c8322f", "secondary": "#111111", "logo": "bolt", "jersey": "classic", "court": "rooftop", "open": True}


class OnlineTeams(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "hub.sqlite3"
        self.svc, self.srv, self.base = serve(self.db)
        self.wait = proam.QUEUE_WAIT

    def tearDown(self):
        proam.QUEUE_WAIT = self.wait
        while OPEN:
            OPEN.pop().c.close()
        stop(self.svc, self.srv)
        self.tmp.cleanup()

    def test_found_joined_and_kept_across_a_reconnect_and_a_restart(self):
        a, b = Member(self.base, "qa_ann"), Member(self.base, "qa_ben")
        made = a.pa("create", {"team": TEAM})["team"]
        found = b.pa("search", {"q": "night"})["teams"]
        self.assertIn(made["id"], [t["id"] for t in found], "every team on the service, for everyone on it")
        self.assertEqual(b.pa("join", {"team_id": made["id"]}), {"result": "joined"})
        for m, nm in ((a, "Ann Founder"), (b, "Ben Center")):
            st = m.pa("status", {"card": m.card(nm, div=1, rp=40)})
            self.assertEqual((st["me"], st["team"]["id"], st["online"]), (m.id, made["id"], True))
        st = b.pa("status")
        roster = {x["username"]: x for x in st["team"]["members"]}
        self.assertEqual(set(roster), {"qa_ann", "qa_ben"})
        self.assertTrue(roster["qa_ann"]["founder"])
        self.assertEqual((roster["qa_ben"]["build"]["name"], roster["qa_ben"]["build"]["state"]["label"], roster["qa_ben"]["build"]["state"]["rp"]), ("Ben Center", "Bronze 2", 40),
                         "his build, from the card his game sent")
        # a reconnect (a reload): still on it
        b.c.close()
        b.connect()
        self.assertEqual(b.pa("status")["team"]["id"], made["id"])
        # a restart of the service, the same save
        a.c.close(), b.c.close()
        stop(self.svc, self.srv)
        self.svc, self.srv, self.base = serve(self.db)
        b2 = Client(self.base)
        self.assertEqual(b2.call("/api/login", {"username": "qa_ben", "password": "password123"})[0], 200)
        b.c = b2
        b.connect()
        st = b.pa("status")
        self.assertEqual(st["team"]["id"], made["id"])
        self.assertEqual(sorted(x["username"] for x in st["team"]["members"]), ["qa_ann", "qa_ben"])
        self.assertEqual({x["username"]: x["build"]["name"] for x in st["team"]["members"]}["qa_ann"], "Ann Founder", "the cards are kept too")
        # separate teams stay possible: a third player makes his own
        c = Member(self.base, "qa_cal")
        own = c.pa("create", {"team": {**TEAM, "name": "Solo Act", "abbr": "SA"}})["team"]
        self.assertNotEqual(own["id"], made["id"])
        self.assertEqual(c.pa("join", {"team_id": made["id"]}, ok=False), "You're on a Pro-Am team already: leave it first.")

    def test_invite_only_a_request_the_founder_accepts(self):
        a, b, c = Member(self.base, "qi_ann"), Member(self.base, "qi_ben"), Member(self.base, "qi_cal")
        t = a.pa("create", {"team": {**TEAM, "name": "Closed Doors", "abbr": "CD", "open": False}})["team"]
        self.assertEqual(b.pa("join", {"team_id": t["id"]}), {"result": "requested"})
        self.assertEqual(c.pa("join", {"team_id": t["id"]}), {"result": "requested"})
        self.assertEqual(b.pa("status")["requested"], [t["id"]])
        reqs = a.pa("status")["team"]["requests"]
        self.assertEqual(sorted(r["username"] for r in reqs), ["qi_ben", "qi_cal"])
        self.assertEqual(b.pa("answer", {"account_id": c.id, "accept": True}, ok=False), "You're not on a Pro-Am team.", "only the founder answers")
        self.assertEqual(a.pa("answer", {"account_id": b.id, "accept": True}), {"result": "joined"})
        self.assertEqual(a.pa("answer", {"account_id": c.id, "accept": False}), {"result": "declined"})
        self.assertEqual(b.pa("status")["team"]["id"], t["id"])
        self.assertIsNone(c.pa("status")["team"])
        self.assertEqual(sorted(m["username"] for m in a.pa("status")["team"]["members"]), ["qi_ann", "qi_ben"])

    def test_two_members_queue_and_play_as_one_team(self):
        a, b = Member(self.base, "qq_ann"), Member(self.base, "qq_ben")
        t = a.pa("create", {"team": {**TEAM, "name": "Two Of Us", "abbr": "TWO"}})["team"]
        b.pa("join", {"team_id": t["id"]})
        # the Captain's ready check reaches his teammate on the service
        a.c.send({"t": "pa-ready", "op": "ask", "secs": 10})
        m = b.c.until("pa-ready", limit=100)
        self.assertEqual((m["op"], m["team"], m["from"]), ("ask", t["id"], a.id))
        b.c.send({"t": "pa-ready", "op": "yes"})
        self.assertEqual(a.c.until("pa-ready", limit=100)["op"], "yes")
        # the matchmaker: no real team within reach, the nearest AI team
        proam.QUEUE_WAIT = 0
        q = a.pa("queue", {"action": "join"})
        if q["state"] != "matched":
            q = a.pa("queue", {"action": "poll"})
        self.assertEqual(q["state"], "matched")
        g, sr = q["game"], q["series"]
        self.assertEqual((g["n"], g["opponent"]["kind"], sr["need"]), (1, "ai", 2))
        # two of them on the floor: three spots filled from the draft
        self.assertEqual(len(a.pa("lineup", {"humans": 2})["ai"]), 3)
        # both played it from their own copies: the first report counts, the second doesn't count again
        r1 = b.pa("report", {"series": sr["id"], "n": 1, "won": True, "score": [70, 61], "delta": 18, "character_id": "local-ben"})
        self.assertTrue(r1["counted"])
        self.assertEqual((r1["series"]["wins"], r1["series"]["games"][0]["result"]), (1, "W"))
        r2 = a.pa("report", {"series": sr["id"], "n": 1, "won": True, "score": [70, 61], "delta": 15, "character_id": "local-ann"})
        self.assertFalse(r2["counted"])
        self.assertEqual(r2["series"]["wins"], 1)
        st = a.pa("status")
        self.assertEqual((st["team"]["record"], st["team"]["current"]["wins"]), ([1, 0], 1))
        # a forfeit with teammates still on the floor doesn't decide the game; alone it's a loss
        q = a.pa("queue", {"action": "join"})
        if q["state"] != "matched":
            q = a.pa("queue", {"action": "poll"})
        self.assertEqual(q["game"]["n"], 2)
        self.assertFalse(b.pa("report", {"series": sr["id"], "n": 2, "won": False, "delta": -20, "forfeit": True, "alone": False})["counted"])
        # the second win: Bronze's series is first to 2, won; the team goes up a division
        out = a.pa("report", {"series": sr["id"], "n": 2, "won": True, "score": [66, 60], "delta": 14, "character_id": "local-ann"})
        self.assertEqual(out["series"]["status"], "won")
        st = b.pa("status")
        self.assertEqual(st["team"]["division"]["label"], "Bronze 2")
        self.assertIsNone(st["team"]["current"], "the next series starts when they queue")
        # each one's own service settles his build: both played in the series
        for m, cid in ((a, "local-ann"), (b, "local-ben")):
            s = m.pa("status")["settle"]
            self.assertEqual([(x["series"], x["outcome"], x["div"], x["character_id"]) for x in s], [(sr["id"], "won", 0, cid)])
        # not someone else's series
        c = Member(self.base, "qq_cal")
        c.pa("create", {"team": {**TEAM, "name": "Others", "abbr": "OTH"}})
        self.assertEqual(c.pa("report", {"series": sr["id"], "n": 1, "won": True}, ok=False), "That series isn't your team's.")
        self.assertEqual(c.pa("nope", ok=False), "Unknown Pro-Am action.")


class OwnService(unittest.TestCase):
    """A player's own service: his builds, and the online team's games on them."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.svc, cls.srv, cls.base = serve(Path(cls.tmp.name) / "own.sqlite3", hosting=False)
        server_app.TIME_SLACK, cls.slack = 10 ** 6, server_app.TIME_SLACK
        cls.me = Client(cls.base)
        assert cls.me.call("/api/dev-account", {})[0] == 200
        st, out = cls.me.call("/api/characters", {"key": uuid.uuid4().hex, "build": {"name": "Own Build", "position": "PG", "archetype": "playmaker", "height": 75, "weight": 190, "wingspan": 78}})
        assert st == 200, out
        cls.cid = out["character"]["id"]

    @classmethod
    def tearDownClass(cls):
        server_app.TIME_SLACK = cls.slack
        stop(cls.svc, cls.srv)
        cls.tmp.cleanup()

    def pa_state(self):
        st, out = self.me.call("/api/proam")
        self.assertEqual(st, 200, out)
        return next(b for b in out["builds"] if b["id"] == self.cid)["pa"]

    def ticket(self, n):
        online = {"team": "hub-team", "div": 0, "opp_div": 1, "opp": {"kind": "ai", "id": "ai_hbv", "name": "Harborview Gulls", "abbr": "HBV", "div": 1}, "venue": "proam_rooftop", "home": True}
        st, t = self.me.call("/api/matches", {"key": uuid.uuid4().hex, "character_id": self.cid, "mode": "proam", "venue": "arena", "format": 5, "quarter_len": 180,
                                              "difficulty": 0.6, "opp_rating": 112, "pa_game": {"series": "hub-series-1", "n": n, "online": online}})
        self.assertEqual(st, 200, t)
        return t

    def test_an_online_series_game_counts_here_and_reports_there(self):
        before = self.pa_state()
        t = self.ticket(1)
        self.assertEqual((t["meta"]["pa_game"]["online"], t["meta"]["pa_game"]["series"], t["meta"]["pa_game"]["opp_div"]), (True, "hub-series-1", 1))
        st, r = self.me.call(f"/api/matches/{t['id']}/complete", {"key": uuid.uuid4().hex, "summary": {"mode": "proam", "score": [70, 60], "winner": 0, "duration": 1200, "players": [], "me": {"team": 0, "stats": S}, "forfeit": False}})
        self.assertEqual(st, 200, r)
        rep = r["pa"]["report"]
        self.assertEqual((rep["series"], rep["n"], rep["won"], rep["score"], rep["character_id"], rep["forfeit"]), ("hub-series-1", 1, True, [70, 60], self.cid, False))
        self.assertGreater(rep["delta"], 0)
        self.assertNotIn("series", r["pa"], "the series is the team's service's")
        self.assertEqual(self.pa_state()["rp"], before["rp"] + rep["delta"], "his RP, in his own save")
        # a forfeit: -20 here, and a loss for the team's service to count
        t2 = self.ticket(2)
        st, out = self.me.call(f"/api/matches/{t2['id']}/cancel", {"forfeit": True})
        self.assertEqual(st, 200, out)
        self.assertEqual((out["pa_report"]["won"], out["pa_report"]["forfeit"], out["pa_report"]["delta"]), (False, True, -20))

    def test_a_series_that_ended_is_settled_once(self):
        st, me = self.me.call("/api/me")
        bal = me["balance"]
        div0 = self.pa_state()["index"]
        items = [{"series": "hub-series-won", "outcome": "won", "div": div0, "character_id": self.cid}]
        st, out = self.me.call("/api/proam/settle", {"key": uuid.uuid4().hex, "items": items})
        self.assertEqual(st, 200, out)
        self.assertEqual([(x["series"], x["outcome"], x["bonus"], x["promoted"]) for x in out["settled"]], [("hub-series-won", "won", 1500, True)])
        self.assertEqual(self.pa_state()["index"], div0 + 1)
        self.assertEqual(self.me.call("/api/me")[1]["balance"], bal + 1500)
        st, again = self.me.call("/api/proam/settle", {"key": uuid.uuid4().hex, "items": items})
        self.assertEqual(again["settled"], [], "once")
        self.assertEqual(self.me.call("/api/me")[1]["balance"], bal + 1500)
        # someone else's build, or nonsense: nothing
        st, out = self.me.call("/api/proam/settle", {"key": uuid.uuid4().hex, "items": [{"series": "x", "outcome": "won", "div": 0, "character_id": "not-mine"}, {"series": 5}, "junk"]})
        self.assertEqual((st, out["settled"]), (200, []))


if __name__ == "__main__":
    unittest.main()
