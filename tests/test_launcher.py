"""v0.4.8.6: the launcher is RIMRIFT through and through (launcher/, RIMRIFT.exe). Every name a player can see in it says
RIMRIFT; the only old names left are the ones that keep an existing install working (an "Afterhours16" game folder, a
service from before the update answering "afterhours16", the AFTERHOURS16_BROWSER variable), each beside its RIMRIFT
one. Its resources (icon, version info, manifest) are res/rimrift.*, compiled into rsrc_windows_amd64.syso, and the
built RIMRIFT.exe carries them. (The health check itself: launcher/main_test.go, go test ./... in launcher/.)

Run from the project root:  python -m unittest discover -s tests -v
"""
import re
import struct
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
L = ROOT / "launcher"
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
VERSION_INFO = {"CompanyName": "Silverback Studios", "FileDescription": "RIMRIFT", "FileVersion": "0.4.8.7", "InternalName": "RIMRIFT",
                "LegalCopyright": "MIT License", "OriginalFilename": "RIMRIFT.exe", "ProductName": "RIMRIFT", "ProductVersion": "0.4.8.7"}


def go_sources():
    return {p.name: p.read_text(encoding="utf-8") for p in sorted(L.glob("*.go")) if not p.name.endswith("_test.go")}


def code(src):
    # the Go source without its comments (a // inside a string literal is kept)
    out = []
    for line in src.splitlines():
        s, q = [], None
        i = 0
        while i < len(line):
            ch = line[i]
            if q:
                s.append(ch)
                if ch == "\\" and q == '"' and i + 1 < len(line):
                    s.append(line[i + 1]); i += 1
                elif ch == q:
                    q = None
            elif ch in "\"`":
                q = ch; s.append(ch)
            elif line.startswith("//", i):
                break
            else:
                s.append(ch)
            i += 1
        out.append("".join(s))
    return "\n".join(out)


def utf16(s):
    return s.encode("utf-16-le")


class LauncherStrings(unittest.TestCase):
    def test_what_a_player_sees_says_rimrift(self):
        src = go_sources()
        w, m, o = src["platform_windows.go"], src["main.go"], src["platform_other.go"]
        for text in ['"RIMRIFT can\'t find its files.\\n\\nKeep RIMRIFT.exe inside the RIMRIFT game folder (next to the \\"server\\" and \\"client\\" folders)."',
                     '"RIMRIFT launcher %s in %s"']:
            self.assertIn(text, m)
        for text in ['msgBox(msg, "RIMRIFT", mbOK|mbIconError)', '"RIMRIFT runs its game service on Python 3.10 or newer', '"RIMRIFT — one-time setup"',
                     '"Installing Python for RIMRIFT"', 'then start RIMRIFT again.", "RIMRIFT"', '"Python was installed. Please start RIMRIFT again.", "RIMRIFT"']:
            self.assertIn(text, w)
        self.assertIn('"RIMRIFT needs Python 3.10+', o)
        self.assertEqual((L / "go.mod").read_text().split()[:2], ["module", "rimrift/launcher"])

    def test_old_names_only_where_they_keep_an_old_install_working(self):
        found = []
        for name, src in go_sources().items():
            for line in code(src).splitlines():
                for lit in re.findall(r'"([^"\\]*(?:\\.[^"\\]*)*)"', line):
                    if re.search(r"after\s*hours", lit, re.I):
                        found.append((name, lit, line.strip()))
        self.assertEqual(sorted(lit for _, lit, _ in found), ["AFTERHOURS16_BROWSER", "Afterhours16", "afterhours16"], found)
        partner = {"Afterhours16": 'filepath.Join(dir, "RIMRIFT")', "afterhours16": 'h["app"] == "rimrift"', "AFTERHOURS16_BROWSER": '"RIMRIFT_BROWSER"'}
        for name, lit, line in found:
            self.assertIn(partner[lit], line, f"{name}: {line}")
        # (the game folder: next to the exe, one up, then a RIMRIFT folder beside it before an Afterhours16 one)
        folder = next(line for _, lit, line in found if lit == "Afterhours16")
        self.assertLess(folder.find('"RIMRIFT"'), folder.find('"Afterhours16"'))

    def test_one_version_everywhere(self):
        m = re.search(r'const version = "([\d.]+)"', go_sources()["main.go"]).group(1)
        rc = (L / "res" / "rimrift.rc").read_text()
        man = (L / "res" / "rimrift.exe.manifest").read_text()
        self.assertEqual(m, "0.4.8.7")
        self.assertIn("FILEVERSION 0,4,8,7", rc); self.assertIn("PRODUCTVERSION 0,4,8,7", rc)
        # (an assembly version has exactly four parts, or Windows won't start the exe)
        self.assertRegex(man, r'<assemblyIdentity version="0\.4\.8\.7" processorArchitecture="amd64" name="RIMRIFT\.Launcher" type="win32"/>')


class LauncherResources(unittest.TestCase):
    def test_the_resource_script_uses_the_rimrift_files_and_nothing_else(self):
        rc = (L / "res" / "rimrift.rc").read_text()
        self.assertIn('1 ICON "rimrift.ico"', rc)
        self.assertIn('1 RT_MANIFEST "rimrift.exe.manifest"', rc)
        for k, v in VERSION_INFO.items():
            self.assertIn(f'VALUE "{k}", "{v}"', rc)
        self.assertIn("<description>RIMRIFT</description>", (L / "res" / "rimrift.exe.manifest").read_text())
        for p in [*L.glob("*.go"), *L.glob("res/rimrift.*"), L / "go.mod"]:
            if p.suffix in (".ico", ".png", ".res"):
                continue
            self.assertNotIn("afterhours16.", p.read_text(encoding="utf-8").lower(), f"{p.name} points at an old resource file")
        for n in ("rimrift.ico", "rimrift.png", "rimrift.rc", "rimrift.exe.manifest", "rimrift.res"):
            self.assertTrue((L / "res" / n).is_file(), n)

    def test_the_icon_has_every_size_from_16_to_256(self):
        b = (L / "res" / "rimrift.ico").read_bytes()
        _, kind, n = struct.unpack_from("<HHH", b)
        self.assertEqual(kind, 1)
        ents = [struct.unpack_from("<BBBBHHII", b, 6 + 16 * i) for i in range(n)]
        self.assertEqual([e[0] or 256 for e in ents], SIZES)
        self.assertTrue(all(e[5] == 32 for e in ents), "32-bit colour with alpha")
        for w, h, _, _, _, _, size, off in ents:
            img = b[off:off + size]
            if (w or 256) == 256:
                self.assertEqual(img[:8], b"\x89PNG\r\n\x1a\n")
            else:  # a DIB: its header says the same size (height doubled for the mask)
                self.assertEqual(struct.unpack_from("<Iii", img), (40, w, h * 2))

    def test_the_compiled_resources_are_rimrift(self):
        b = (L / "rsrc_windows_amd64.syso").read_bytes()
        for v in VERSION_INFO.values():
            self.assertIn(utf16(v), b)
        self.assertIn(b'name="RIMRIFT.Launcher"', b)
        self.assertNotIn(utf16("Afterhours"), b)
        self.assertNotIn(b"Afterhours", b)

    def test_rimrift_exe(self):
        exe = ROOT / "RIMRIFT.exe"
        if not exe.is_file():
            self.skipTest("RIMRIFT.exe isn't built here")
        b = exe.read_bytes()
        self.assertEqual(b[:2], b"MZ")
        pe = struct.unpack_from("<I", b, 0x3C)[0]
        self.assertEqual(b[pe:pe + 4], b"PE\0\0")
        self.assertEqual(struct.unpack_from("<H", b, pe + 4)[0], 0x8664, "amd64")
        self.assertEqual(struct.unpack_from("<H", b, pe + 24 + 68)[0], 2, "a windows (GUI) program: no console window")
        for v in VERSION_INFO.values():
            self.assertIn(utf16(v), b)
        self.assertIn(b'name="RIMRIFT.Launcher"', b)
        self.assertNotIn(utf16("Afterhours"), b)
        for text in (b"RIMRIFT can't find its files.", b"Installing Python for RIMRIFT", b"RIMRIFT launcher %s in %s"):
            self.assertIn(text, b)


if __name__ == "__main__":
    unittest.main()
