"""v0.4.8.5 quick patch 8: the AI world climbs past 90 to 99 by the players' own rules. The client's Icon Legend upgrade
(sim/builds.js legendRaise) must be the server's legend_raise to the letter, and an AI hooper's build at any point of his
climb (sim/world.js climb) must be one the server's rules accept: every attribute within its caps (max OVR, cap breakers,
the legend floor), the cap breakers his Hall of Fame badges earned, his Icon badge with the HOF count it takes, and the
server's icon_status_info saying ICON for exactly the AI the client calls ICON, who are exactly the 99s.

Run from the project root:  python3 -m unittest tests.test_ai_ladder -v
"""
import copy
import json
import shutil
import subprocess
import unittest
from pathlib import Path

from server import builds

ROOT = Path(__file__).resolve().parents[1]


def node(script, *args):
    out = subprocess.run(["node", "--input-type=module", "-e", script, *args], cwd=ROOT, capture_output=True, text=True, timeout=600)
    if out.returncode:
        raise AssertionError(out.stderr)
    return json.loads(out.stdout)


def legal_builds():
    for pos, (lo, hi) in builds.POSITIONS.items():
        for arch in builds.ARCHETYPES:
            for h in (lo, (lo + hi) // 2, hi):
                for w in (160, 230, 290):
                    yield builds.spec({"position": pos, "archetype": arch, "height": h, "weight": w, "wingspan": h + (w % 7)})


@unittest.skipUnless(shutil.which("node"), "node not installed")
class LegendRaiseTests(unittest.TestCase):
    def test_the_clients_legend_raise_is_the_servers(self):
        samples = []
        for i, b in enumerate(list(legal_builds())[::7]):
            c = {**b, "attributes": builds.caps(b, 90)}
            if i % 3 == 1:  # (some with cap breakers in, some a few points under their caps)
                fit = sorted(builds.ATTRIBUTES, key=lambda a: -c["attributes"][a])[:3]
                c["cap_breakers"] = {"earned": 15, "applied": {a: 5 for a in fit}}
                for a in fit:
                    c["attributes"][a] = min(99, c["attributes"][a] + 5)
            if i % 3 == 2:
                c["attributes"] = {a: max(40, v - (i % 5)) for a, v in c["attributes"].items()}
            samples.append(c)
        script = ("import('./client/js/sim/builds.js').then(B => { const input = JSON.parse(process.argv[1]); console.log(JSON.stringify(input.map(c => {"
                  " const steps = []; for (let i = 0; i < 14; i++) { const r = B.legendRaise(c); if (!r) break; steps.push(r); }"
                  " return { steps, attrs: c.attributes, floor: (c.legend || {}).floor || {}, caps: B.caps(c, 90) }; }))); });")
        js = node(script, json.dumps(samples))
        self.assertGreater(len(samples), 40)
        for c, j in zip(samples, js):
            c = copy.deepcopy(c)
            steps = []
            for _ in range(14):
                r = builds.legend_raise(c)
                if not r:
                    break
                steps.append(r)
            self.assertEqual(steps, j["steps"], c["archetype"])
            self.assertEqual(c["attributes"], j["attrs"])
            self.assertEqual((c.get("legend") or {}).get("floor", {}), j["floor"])
            self.assertEqual(builds.caps(c, 90), j["caps"])  # (the legend floor raises the caps on both sides)
            self.assertEqual(builds.overall(c["attributes"], c["position"]), 99)


@unittest.skipUnless(shutil.which("node"), "node not installed")
class ClimbTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # every AI past 90 (and a few who aren't) in two worlds, a year and two years old
        script = ("import('./client/js/sim/world.js').then(async W => { const B = await import('./client/js/sim/builds.js'); const fs = await import('node:fs');"
                  " const cat = Object.fromEntries(JSON.parse(fs.readFileSync('server/catalog.json', 'utf8')).map(i => [i.id, i])); const out = [];"
                  " for (const [seed, days] of [[4242, 365], [777, 730]]) { const w = new W.AIWorld({ seed, born: Date.now() - days * 86400000 }, cat);"
                  " for (const id of w.ids()) { const e = w.entry(id); if (!e.climb && out.length % 9) continue;"
                  " out.push({ id, climb: e.climb || null, build: e.build, badges: e.badges, icon: B.iconStatus(e.build), max: B.maxOvr(e.build) }); } }"
                  " console.log(JSON.stringify(out)); });")
        cls.rows = node(script)

    def test_every_climb_is_a_build_the_server_accepts(self):
        climbers = [r for r in self.rows if r["climb"]]
        self.assertGreater(len(climbers), 300)
        icons = 0
        for r in climbers:
            c = copy.deepcopy(r["build"])
            caps = builds.caps(c)
            self.assertEqual(builds.max_ovr(c), builds.OVR_CAP, r["id"])
            self.assertEqual(r["max"], builds.OVR_CAP)
            for a, v in c["attributes"].items():
                self.assertLessEqual(v, caps[a], f"{r['id']} {a}: within its cap, as yours")
            hof = builds.hof_count(c)
            self.assertEqual(hof, r["climb"]["hof"])
            self.assertLessEqual(hof, builds.HOF_LIMIT)
            self.assertEqual(c["cap_breakers"]["earned"], builds.CAP_BREAKERS_PER_HOF * min(builds.CAP_BREAKER_HOF_LIMIT, hof))
            self.assertLessEqual(sum(c["cap_breakers"]["applied"].values()), c["cap_breakers"]["earned"])
            for k, b in c["badges"].items():
                self.assertLessEqual(b["tier"], builds.badge_caps(c)[k])
            self.assertEqual(bool(c.get("icon_badge")), hof >= builds.icon_need(c), r["id"])
            if c.get("icon_badge"):
                self.assertEqual(c["icon_badge"], builds.ICON_FOR_ARCH[c["archetype"]])
            else:
                self.assertEqual(c["legend"]["upgrades"], 0)  # (Legend only with the Icon badge)
            ovr = builds.overall(c["attributes"], c["position"])
            self.assertEqual(ovr, c["overall"])
            # ICON: the server's icon_status_info says what the client's iconStatus says, and only ever at 99
            info = builds.icon_status_info(c)
            self.assertEqual(info["active"], r["icon"], r["id"])
            self.assertEqual(info["active"], ovr == 99, f"{r['id']} {ovr}")
            icons += info["active"]
        self.assertGreater(icons, 60)

    def test_the_rest_are_where_they_were(self):
        rest = [r for r in self.rows if not r["climb"]]
        self.assertTrue(rest)
        for r in rest:
            self.assertLessEqual(r["build"]["overall"], builds.OVR_CAP)
            self.assertFalse(r["icon"])
            for k in ("cap_breakers", "legend", "icon_badge", "progression"):
                self.assertNotIn(k, r["build"])


if __name__ == "__main__":
    unittest.main()
