#!/usr/bin/env sh
# Afterhours 16 v0.3 launcher (macOS / Linux): starts the local game service and opens an app window.
set -eu
cd "$(dirname "$0")"
PORT="${AFTERHOURS16_PORT:-8765}"
URL="http://127.0.0.1:$PORT/"

python3 -m server.app --port "$PORT" "$@" &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' INT TERM EXIT
sleep 1.5

set +e  # a missing browser must not stop the game service
opened=""
for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser; do
  if command -v "$b" >/dev/null 2>&1; then
    "$b" --app="$URL" --window-size=1600,900 >/dev/null 2>&1 &
    opened=1
    break
  fi
done
if [ -z "$opened" ]; then
  if [ -d "/Applications/Google Chrome.app" ]; then open -na "Google Chrome" --args --app="$URL" --window-size=1600,900
  elif [ -d "/Applications/Microsoft Edge.app" ]; then open -na "Microsoft Edge" --args --app="$URL" --window-size=1600,900
  elif command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  else echo "Open $URL in Chrome, Edge or Firefox."
  fi
fi
echo "Afterhours 16 is running at $URL - press Ctrl+C here to stop."
wait "$SERVER"
