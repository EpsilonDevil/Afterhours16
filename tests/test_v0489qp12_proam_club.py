"""v0.4.8.9 qp12: the Pro-Am club (the team) with AI members and invites (server/proam.py, docs/PROAM-OVERHAUL.md §11).

* AI members: an AI friend joins at once (offline: only one of your AI friends; online: the shared world's), on one
  team at most; the roster lists him (kind 'ai'); the founder removes him. 10 members in all, real and AI.
* Invites: any member invites a real player, who accepts or declines from his Pro-Am menu (and is told at once online);
  the founder or the inviter takes one back.
* The lineup: the real players, then the AI members here, then AI squad mates, then the draft.
* Spare-time games: AI members who are on play the club's own series games on the server, at most one series' worth a
  window and only with 3 or more of them on, never while the real members are in the middle of a game; ±15 team RP
  each, the series counter, and a series they finish moves the team by the shared rules; nothing for the real players.

Run from the project root:  python3 -m unittest tests.test_v0489qp12_proam_club -v
"""
import json
import tempfile
import threading
import time
import unittest
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path

from server import app as server_app, crew, proam

try:
    from tests.test_online import Client
    from tests.test_v0489qp6_proam_online import Member, OPEN, serve, stop, TEAM
except ImportError:
    from test_online import Client
    from test_v0489qp6_proam_online import Member, OPEN, serve, stop, TEAM


def ai(i, name=None, ovr=70):
    return {"kind": "ai", "ai_id": f"ai-{i}", "name": name or f"Hooper {i}", "build": {"position": "SF", "overall": ovr}, "look": {"skin": 3}}


class Local(unittest.TestCase):
    """One service, players on it (offline, or join.cmd players on a host)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.svc, self.srv, self.base = serve(Path(self.tmp.name) / "club.sqlite3", hosting=False)
        self.svc.join_code = None

    def tearDown(self):
        while OPEN:
            OPEN.pop().c.close()
        stop(self.svc, self.srv)
        self.tmp.cleanup()

    def player(self, name, friends=()):
        c = Client(self.base)
        st, out = c.call("/api/register", {"username": name, "password": "password123"})
        self.assertEqual(st, 200, out)
        c.id = out["account"]["id"]
        if friends is not None:
            st, out = c.call("/api/ai-world", {"key": uuid.uuid4().hex, "world": {"seed": 4242, "born": 1.7e12, "friends": [f"ai-{i}" for i in friends]}})
            self.assertEqual(st, 200, out)
        return c

    def call(self, c, path, body=None, expect=200):
        st, out = c.call(path, body)
        self.assertEqual(st, expect, f"{path}: {out}")
        return out

    def team(self, c):
        return self.call(c, "/api/proam")["team"]

    def test_ai_friends_join_the_roster_and_the_founder_removes_them(self):
        a = self.player("cl_ann", friends=range(10, 20))
        self.call(a, "/api/proam/create", {"team": TEAM})
        self.assertEqual(self.call(a, "/api/proam/invite", {"to": ai(10, "Dre Banks", 81)}), {"result": "joined", "ai_id": "ai-10"})
        self.assertIn("AI friends", self.call(a, "/api/proam/invite", {"to": ai(99)}, expect=400)["error"], "only his AI friends")
        self.assertIn("in your club already", self.call(a, "/api/proam/invite", {"to": ai(10)}, expect=400)["error"])
        t = self.team(a)
        aim = [m for m in t["members"] if m["kind"] == "ai"]
        self.assertEqual([(m["ai_id"], m["name"], m["build"]["overall"], m["look"]) for m in aim], [("ai-10", "Dre Banks", 81, {"skin": 3})])
        self.assertIn(aim[0]["online"], (True, False))
        self.assertEqual(t["size"], 2)
        self.assertEqual(t["members"][0]["kind"], "player")
        # on one team at most: another club can't have him
        b = self.player("cl_ben", friends=range(10, 20))
        self.call(b, "/api/proam/create", {"team": {**TEAM, "name": "Rivals", "abbr": "RIV"}})
        self.assertIn("another Pro-Am club", self.call(b, "/api/proam/invite", {"to": ai(10)}, expect=400)["error"])
        # any member invites; only the founder removes
        c = self.player("cl_cal", friends=range(10, 20))
        self.call(c, "/api/proam/join", {"team_id": t["id"]})
        self.assertEqual(self.call(c, "/api/proam/invite", {"to": ai(11)})["result"], "joined")
        self.assertIn("founder", self.call(c, "/api/proam/remove", {"ai_id": "ai-11"}, expect=400)["error"])
        self.assertEqual(self.call(a, "/api/proam/remove", {"ai_id": "ai-11"}), {"ok": True})
        self.assertEqual([m["ai_id"] for m in self.team(a)["members"] if m["kind"] == "ai"], ["ai-10"])
        # the last real player out ends the club: its AI members are free again
        self.call(c, "/api/proam/leave", {})
        self.call(a, "/api/proam/leave", {})
        self.assertEqual(self.call(b, "/api/proam/invite", {"to": ai(10)})["result"], "joined")

    def test_ten_members_real_and_ai(self):
        a = self.player("cap_ann", friends=range(30, 60))
        t = self.call(a, "/api/proam/create", {"team": TEAM})["team"]
        b = self.player("cap_ben", friends=None)
        self.call(b, "/api/proam/join", {"team_id": t["id"]})
        for i in range(8):
            self.call(a, "/api/proam/invite", {"to": ai(30 + i)})
        self.assertEqual(self.team(a)["size"], 10)
        self.assertIn("full", self.call(a, "/api/proam/invite", {"to": ai(50)}, expect=400)["error"])
        self.assertIn("full", self.call(a, "/api/proam/invite", {"to": {"kind": "player", "username": "nobody"}}, expect=400)["error"])
        c = self.player("cap_cal", friends=None)
        self.assertIn("full", self.call(c, "/api/proam/join", {"team_id": t["id"]}, expect=400)["error"])
        self.call(a, "/api/proam/remove", {"ai_id": "ai-30"})
        self.assertEqual(self.call(c, "/api/proam/join", {"team_id": t["id"]}), {"result": "joined"})

    def test_a_player_invite_accepted_or_declined(self):
        a, b, c, d = (self.player(n, friends=None) for n in ("in_ann", "in_ben", "in_cal", "in_dee"))
        t = self.call(a, "/api/proam/create", {"team": {**TEAM, "open": False}})["team"]
        self.assertEqual(self.call(a, "/api/proam/invite", {"to": {"kind": "player", "username": "IN_BEN"}}), {"result": "invited"})
        self.assertIn("No player", self.call(a, "/api/proam/invite", {"to": {"kind": "player", "username": "ghost"}}, expect=400)["error"])
        inv = self.call(b, "/api/proam")["invites"]
        self.assertEqual([(x["team"]["id"], x["from"]) for x in inv], [(t["id"], "in_ann")])
        self.assertEqual(self.call(b, "/api/proam/accept_invite", {"team_id": t["id"]}), {"result": "joined"}, "an invite gets him onto an invite-only team")
        # any member invites (not just the founder)
        self.assertEqual(self.call(b, "/api/proam/invite", {"to": {"kind": "player", "username": "in_cal"}})["result"], "invited")
        self.call(a, "/api/proam/invite", {"to": {"kind": "player", "username": "in_dee"}})
        sent = self.team(b)["invites_sent"]
        self.assertEqual(sorted((x["username"], x["from"] == b.id) for x in sent), [("in_cal", True), ("in_dee", False)])
        self.assertIn("founder", self.call(b, "/api/proam/uninvite", {"account_id": d.id}, expect=400)["error"], "not his to take back")
        self.assertEqual(self.call(d, "/api/proam/decline_invite", {"team_id": t["id"]}), {"result": "declined"})
        self.assertEqual(self.call(d, "/api/proam")["invites"], [])
        self.assertEqual(self.call(a, "/api/proam/uninvite", {"account_id": c.id}), {"ok": True}, "the founder takes it back")
        self.assertIn("isn't there", self.call(c, "/api/proam/accept_invite", {"team_id": t["id"]}, expect=400)["error"])
        self.assertEqual(sorted(m["username"] for m in self.team(a)["members"]), ["in_ann", "in_ben"])

    def test_the_lineup_humans_ai_members_squad_mates_then_the_draft(self):
        a = self.player("lu_ann", friends=range(70, 80))
        self.call(a, "/api/proam/create", {"team": TEAM})
        for i in (70, 71):
            self.call(a, "/api/proam/invite", {"to": ai(i)})
        proam.QUEUE_WAIT, old = 0, proam.QUEUE_WAIT
        try:
            q = self.call(a, "/api/proam/queue", {"action": "join"})
            if q["state"] != "matched":
                q = self.call(a, "/api/proam/queue", {"action": "poll"})
        finally:
            proam.QUEUE_WAIT = old
        out = self.call(a, "/api/proam/lineup", {"humans": 1, "ai_members": ["ai-70", "ai-71", "ai-5"], "squad": ["ai-5", "ai-200"]})  # (ai-5 isn't a member)
        self.assertEqual((out["humans"], out["members"], out["squad"], len(out["draft"])), (1, ["ai-70", "ai-71"], ["ai-5", "ai-200"], 0), "a full five without the draft")
        self.assertEqual(out["ai"], ["ai-70", "ai-71", "ai-5", "ai-200"])
        out = self.call(a, "/api/proam/lineup", {"humans": 2, "ai_members": ["ai-71"], "squad": []})
        self.assertEqual((out["members"], len(out["draft"]), out["ai"][0]), (["ai-71"], 2, "ai-71"))
        self.assertTrue(set(out["draft"]).isdisjoint({"ai-70", "ai-71"}))


class SpareTime(unittest.TestCase):
    """The AI members' spare-time games (club_simulate), on a clock and a schedule the test sets."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.svc = server_app.Service(Path(self.tmp.name) / "s.sqlite3", dev_accounts=False)
        self.pa = self.svc.proam
        self.aid = self.svc.db.create_account("st_ann", "password123", [])
        with self.svc.db.transaction() as c:
            self.n = proam.current_season(c)["n"]
        self.pa.boot()
        self.old = (crew.AIWorld.online_ms, proam.club_win_chance)
        self.on = set()
        crew.AIWorld.online_ms = lambda w, ai_id, t0, t1: (t1 - t0) if ai_id in self.on else 0.0

    def tearDown(self):
        crew.AIWorld.online_ms, proam.club_win_chance = self.old
        self.svc.close()
        self.tmp.cleanup()

    def club(self, k=4, slot=None):
        E = proam.AI_SIM_EVERY
        self.slot0 = slot if slot is not None else int(time.time() // E) - 20
        with self.svc.db.transaction() as c:
            t = proam.create_team(c, self.aid, TEAM, self.n)
            t["data"]["world"] = {"seed": 4242, "born": 1.7e12}
            t["data"]["club_sim"] = self.slot0
            proam.save_team(c, t)
            for i in range(k):
                c.execute("INSERT INTO pa_ai_members(ai_id,team_id,data,added_by,joined_at) VALUES(?,?,?,?,?)", (f"ai-{i}", t["id"], json.dumps({"name": f"Hooper {i}"}), self.aid, 0))
        return t["id"]

    def sim(self, windows):
        E = proam.AI_SIM_EVERY
        with self.svc.db.transaction() as c:
            t = proam.load_team(c, proam.team_of(c, self.aid))
            played = self.pa.club_simulate(c, t, self.n, (self.slot0 + windows + 1) * E + 1)
            return played, proam.load_team(c, t["id"]), [json.loads(r[0]) for r in c.execute("SELECT data FROM pa_series WHERE team_id=? ORDER BY created_at", (t["id"],))]

    def test_pace_three_on_and_one_series_a_window(self):
        self.club()
        self.on = {"ai-0", "ai-1"}  # (two on: not enough)
        played, t, srs = self.sim(3)
        self.assertEqual((played, srs), ([], []))
        self.on = {"ai-0", "ai-1", "ai-2"}
        played, t, srs = self.sim(5)
        self.assertEqual(len(srs), 2, "windows 4 and 5: one series each")
        for sr in srs:
            self.assertIn(sr["status"], ("won", "lost"))
            self.assertEqual(sr["finished_by"], "ai")
            self.assertLessEqual(len(sr["games"]), sr["length"])
            self.assertEqual({g["by"] for g in sr["games"]}, {"ai"})
            self.assertEqual(sorted(sr["games"][0]["ai"]), ["Hooper 0", "Hooper 1", "Hooper 2"])
            self.assertEqual((sr["bonus"], sr["moved"], sr["players"]), (0, {}, {}))
        self.assertEqual(len(played), sum(len(sr["games"]) for sr in srs))
        self.assertEqual(t["data"]["record"], [sum(sr["wins"] for sr in srs), sum(sr["losses"] for sr in srs)])
        self.assertEqual(len(t["data"]["ai_games"]), len(played))
        again, _, srs2 = self.sim(5)
        self.assertEqual((again, len(srs2)), ([], 2), "each window once")

    def test_ai_games_move_the_team_by_the_shared_rules_and_nothing_for_real_players(self):
        self.club()
        self.on = {"ai-0", "ai-1", "ai-2", "ai-3"}
        bal = self.svc.db.query("SELECT balance FROM wallets WHERE account_id=?", (self.aid,))[0][0]
        proam.club_win_chance = lambda *a: 1.0
        played, t, srs = self.sim(1)
        self.assertEqual(([p["result"] for p in played], srs[0]["status"]), (["W", "W"], "won"), "Bronze: first to 2")
        self.assertEqual((t["div"], t["rp"], t["data"]["series"]), (1, 0, [1, 0]), "+30 RP banked, then the promotion spends 100: up one division (team_series_won)")
        proam.club_win_chance = lambda *a: 0.0
        played, t, srs = self.sim(2)
        self.assertEqual((srs[-1]["status"], t["div"], t["rp"]), ("lost", 0, 0), "lost at 0 RP: down a division (team_series_lost)")
        self.assertEqual(self.svc.db.query("SELECT balance FROM wallets WHERE account_id=?", (self.aid,))[0][0], bal, "no VC")
        st = self.pa.online_status(self.aid)
        self.assertEqual(st["settle"], [], "no personal moves to settle")

    def test_not_while_the_real_members_are_in_a_game(self):
        tid = self.club()
        self.on = {"ai-0", "ai-1", "ai-2"}
        with self.svc.db.transaction() as c:
            t = proam.load_team(c, tid)
            sr = proam.new_series(t, self.n, 0)
            proam.add_game(sr, t, proam.nearest_ai(c, 0, self.n), "ai", 0)  # (matched for the real members, not played)
            self.pa.save_series(c, sr)
        played, t, srs = self.sim(3)
        self.assertEqual((played, len(srs[0]["games"])), ([], 1))

    def test_the_win_chance(self):
        p = proam.club_win_chance(5, 5, [])
        self.assertAlmostEqual(p, 0.5)
        self.assertGreater(proam.club_win_chance(5, 5, [0.95, 0.9, 0.9]), p, "strong members")
        self.assertLess(proam.club_win_chance(5, 5, [0.2, 0.2, 0.2]), p, "weak members")
        self.assertLess(proam.club_win_chance(5, 9, []), p, "a better opponent")


class Online(unittest.TestCase):
    """Over the hub's socket (players on their own copies): AI members of the shared world, invites told at once."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.svc, self.srv, self.base = serve(Path(self.tmp.name) / "hub.sqlite3")

    def tearDown(self):
        while OPEN:
            OPEN.pop().c.close()
        stop(self.svc, self.srv)
        self.tmp.cleanup()

    def test_invite_online_and_ai_members_of_the_shared_world(self):
        a, b = Member(self.base, "on_ann"), Member(self.base, "on_ben")
        t = a.pa("create", {"team": TEAM})["team"]
        self.assertEqual(a.pa("invite", {"to": ai(3, "Shared Guy")})["result"], "joined")
        with self.svc.db.transaction() as c:
            w = proam.load_team(c, t["id"])["data"]["world"]
        sw = self.svc.shared_world()
        self.assertEqual((w["seed"], w["born"]), (sw["seed"], sw["born"]), "the hub's shared AI world")
        self.assertEqual(a.pa("invite", {"to": {"kind": "player", "username": "on_ben"}})["result"], "invited")
        m = b.c.until("pa-invite", limit=100)
        self.assertEqual((m["team"]["id"], m["from"]), (t["id"], "on_ann"))
        self.assertEqual([x["team"]["name"] for x in b.pa("invites")["invites"]], [TEAM["name"]])
        self.assertEqual(b.pa("accept_invite", {"team_id": t["id"]}), {"result": "joined"})
        st = b.pa("status")
        self.assertEqual(sorted((m["kind"], m.get("username") or m.get("name")) for m in st["team"]["members"]), [("ai", "Shared Guy"), ("player", "on_ann"), ("player", "on_ben")])
        self.assertEqual(st["invites"], [])


if __name__ == "__main__":
    unittest.main()
