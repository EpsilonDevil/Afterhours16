"""v0.4.7.5 bug reports: the in-game "Report a bug" form (F8, Settings, the pause menus) writes each report to
Afterhours16_Bug_Reports.txt in the game's folder (next to Afterhours16.exe), as plain text you can open, read and
send along. Each report has what the player wrote, where they were in the game, recent errors and game events, the
system and settings, and a JSON block with the full context for whoever fixes it."""
import datetime
import json
import threading

BUG_FILE = "Afterhours16_Bug_Reports.txt"
CATEGORIES = {
    "gameplay": "Gameplay",
    "animation": "Animation / visuals",
    "controls": "Controls",
    "ai": "AI teammates / opponents",
    "ui": "Menus / HUD",
    "audio": "Audio / music",
    "progress": "VC / Rep / progression",
    "crash": "Crash / freeze / error",
    "performance": "Performance",
    "other": "Other",
}
MAX_TEXT = 4000
MAX_CONTEXT = 24000
_lock = threading.Lock()


class BadReport(ValueError):
    pass


def _text(v, n=MAX_TEXT):
    if v is None:
        return ""
    if not isinstance(v, str):
        raise BadReport("Report fields must be text.")
    v = v.replace("\r\n", "\n").replace("\r", "\n")
    v = "".join(ch for ch in v if ch == "\n" or ch == "\t" or ord(ch) >= 32)
    return v.strip()[:n]


def _indent(v):
    return "\n".join("  " + line for line in v.split("\n")) if v else "  (not given)"


def _lines(ctx, key, limit):
    v = ctx.get(key)
    if not isinstance(v, list):
        return []
    return [_text(x if isinstance(x, str) else json.dumps(x, separators=(",", ":"))[:300], 300) for x in v[-limit:]]


def write_report(root, data, version, now=None):
    """Append one report to <root>/Afterhours16_Bug_Reports.txt. Returns {number, file, path}."""
    if not isinstance(data, dict):
        raise BadReport("Invalid report.")
    category = data.get("category") if data.get("category") in CATEGORIES else "other"
    what = _text(data.get("what"))
    if len(what) < 3:
        raise BadReport("Say what happened (a few words is fine).")
    expected = _text(data.get("expected"))
    steps = _text(data.get("steps"))
    ctx = data.get("context") if isinstance(data.get("context"), dict) else {}
    raw = json.dumps(ctx, indent=1, sort_keys=True, default=str)
    if len(raw) > MAX_CONTEXT:
        raw = raw[:MAX_CONTEXT] + "\n... (cut)"
    now = now or datetime.datetime.now()
    path = root / BUG_FILE
    where = _text(ctx.get("where") if isinstance(ctx.get("where"), str) else "", 400) or "(unknown)"
    system = _text(ctx.get("system") if isinstance(ctx.get("system"), str) else "", 600)
    errors = _lines(ctx, "errors", 25)
    events = _lines(ctx, "events", 40)
    with _lock:
        n = 1
        if path.exists():
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                n = sum(1 for line in f if line.startswith("BUG REPORT #")) + 1
        out = [
            "=" * 96,
            f"BUG REPORT #{n} · {now.strftime('%Y-%m-%d %H:%M:%S')} · Afterhours16 v{version} · {CATEGORIES[category]}",
            "=" * 96,
            f"Where: {where}",
            "",
            "What happened:",
            _indent(what),
            "",
            "What should have happened:",
            _indent(expected),
            "",
            "Steps to make it happen again:",
            _indent(steps),
            "",
            "Recent errors:",
            *(["  - " + e for e in errors] or ["  (none)"]),
            "",
            "Recent game events (oldest first):",
            *(["  - " + e for e in events] or ["  (none)"]),
            "",
            f"System: {system or '(unknown)'}",
            "",
            "Full context (for the fix):",
            raw,
            "",
            "",
        ]
        new = not path.exists()
        with open(path, "a", encoding="utf-8", newline="\r\n") as f:
            if new:
                f.write("Afterhours16 bug reports. Each report below was written from the game (Report a bug: F8, Settings or the\n"
                        "pause menu). Send this file along with the version you were playing to get the bugs in it fixed.\n\n")
            f.write("\n".join(out))
    return {"number": n, "file": BUG_FILE, "path": str(path)}


