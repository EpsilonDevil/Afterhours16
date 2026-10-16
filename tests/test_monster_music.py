"""v0.4.8.5 quick patch 3: The Monster Mash's own soundtrack. A 78-minute Halloween party mix split into 27 cuts in
client/audio/monster, on no other list, covering the whole mix in order with no gaps (the mix's last 41 s are digital
silence and are left off). How it plays (only at the Mash's park, a new shuffle on every arrival):
tests/v0485monstermusic.test.mjs.

Run from the project root:  python3 -m unittest tests.test_monster_music -v
"""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MONSTER = ROOT / "client/audio/monster"
MIX_LENGTH = 4690.13  # the whole mix, seconds
MUSIC_ENDS = 4649.25  # where its last note has died away; from here to the end it is digital silence


def tracks(d):
    return json.loads((ROOT / "client/audio" / d / "tracks.json").read_text())["tracks"]


class MonsterSoundtrackFileTests(unittest.TestCase):
    def test_the_mash_soundtrack_is_its_own(self):
        mash = tracks("monster")
        self.assertEqual(len(mash), 27)
        others = {t["file"] for d in ("music", "beat") for t in tracks(d)} | {
            p for d in ("music", "beat") for t in tracks(d) for p in t.get("parts", [])}
        for i, t in enumerate(mash, 1):
            self.assertEqual(t["file"], "monster-%02d.mp3" % i)
            self.assertEqual(t["title"], "Halloween Party Mix · Cut %d of 27" % i)
            self.assertEqual((t["artist"], t["album"]), ("", "The Monster Mash · Event Soundtrack"))
            self.assertTrue((MONSTER / t["file"]).is_file(), t["file"])
            self.assertNotIn(t["file"], others)
            self.assertFalse((ROOT / "client/audio/music" / t["file"]).exists())
            self.assertFalse((ROOT / "client/audio/beat" / t["file"]).exists())
            self.assertTrue(45 <= t["duration"] <= 300, t)  # (one 51 s horror-theme interlude; the rest 1:36 to 4:20)
        self.assertEqual(sorted(p.name for p in MONSTER.iterdir()), sorted([t["file"] for t in mash] + ["tracks.json"]))
        for d in ("music", "beat"):
            self.assertNotIn("monster-", (ROOT / "client/audio" / d / "tracks.json").read_text())

    def test_the_cuts_cover_the_whole_mix_in_order(self):
        mash = tracks("monster")
        self.assertEqual(mash[0]["from"], 0)
        for a, b in zip(mash, mash[1:]):
            self.assertLess(a["from"], b["from"])
            self.assertAlmostEqual(a["from"] + a["duration"], b["from"], delta=1.0)
        self.assertAlmostEqual(mash[-1]["from"] + mash[-1]["duration"], MUSIC_ENDS, delta=1.0)
        self.assertAlmostEqual(sum(t["duration"] for t in mash), MUSIC_ENDS, delta=3)
        self.assertLess(MIX_LENGTH - MUSIC_ENDS, 45)  # (only the silent tail is left off)

    @unittest.skipUnless(shutil.which("ffprobe"), "needs ffprobe")
    def test_the_files_are_as_long_as_the_list_says(self):
        for t in tracks("monster"):
            out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:format_tags", "-of", "json",
                                  str(MONSTER / t["file"])], capture_output=True, text=True, check=True).stdout
            fmt = json.loads(out)["format"]
            self.assertAlmostEqual(float(fmt["duration"]), t["duration"], delta=0.6, msg=t["file"])
            self.assertFalse({k.lower() for k in fmt.get("tags", {})} & {"title", "artist", "album"}, t["file"])  # (no metadata carried over)


if __name__ == "__main__":
    unittest.main()
