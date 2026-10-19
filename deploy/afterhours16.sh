#!/usr/bin/env bash
# RIMRIFT online server: the  afterhours16  command (installed to /usr/local/bin by deploy/install.sh).
#   afterhours16 status            the address players use, the join code, the version, who's on, HTTPS
#   afterhours16 update            get the latest version from GitHub now (restarts the server: games end)
#   afterhours16 joincode NEWCODE  change the join code new players need
#   afterhours16 autoupdate on|off follow GitHub by itself (every 10 minutes, only when no games are on)
#   afterhours16 logs              the server's latest messages
#   afterhours16 restart           restart the server
#   afterhours16 backup            copy the database now (/var/lib/afterhours16/backups, the last 14 kept)
#   afterhours16 tune              apply the network settings for games (the service does this when it starts)
set -uo pipefail
# v0.4.8.6 RIMRIFT: the settings are RIMRIFT_* now; a server set up before the rename has AFTERHOURS16_* ones in its
# settings file, and they still work (the new name wins). The box's own names (this command, its services, its
# folders, the afterhours user) stay as they are
APP=${RIMRIFT_APP:-${AFTERHOURS16_APP:-/opt/afterhours16}}
ENVF=${RIMRIFT_ENV:-${AFTERHOURS16_ENV:-/etc/afterhours16.env}}
BACKUPS=${RIMRIFT_BACKUPS:-${AFTERHOURS16_BACKUPS:-/var/lib/afterhours16/backups}}
PORT=8765
if [ -r "$ENVF" ]; then
  # shellcheck disable=SC1090
  . "$ENVF"
fi
BRANCH=${RIMRIFT_BRANCH:-${AFTERHOURS16_BRANCH:-main}}
URL=${RIMRIFT_PUBLIC_URL:-${AFTERHOURS16_PUBLIC_URL:-}}
JOIN=${RIMRIFT_JOIN_CODE:-${AFTERHOURS16_JOIN_CODE:-}}

need_root() { [ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo afterhours16 $*"; exit 1; }; }
as_app() { if [ "$(id -u)" = 0 ] && id afterhours >/dev/null 2>&1; then runuser -u afterhours -- "$@"; else "$@"; fi; }
hosting() { curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/hosting.txt" 2>/dev/null; }
line() { printf '  %-13s %s\n' "$1" "$2"; }

status() {
  local h build online games state since cert
  h=$(hosting)
  build=$(printf '%s\n' "$h" | awk '$1=="BUILD" {print $2" "$3}')
  online=$(printf '%s\n' "$h" | awk '$1=="ONLINE" {print $2}')
  games=$(printf '%s\n' "$h" | awk '$1=="GAMES" {print $2}')
  state=$(systemctl is-active afterhours16 2>/dev/null || true)
  since=$(systemctl show afterhours16 -p ActiveEnterTimestamp --value 2>/dev/null || true)
  echo "RIMRIFT online server"
  line "Address:" "${URL:-?}   (players type this in the Online tab, then Connect)"
  line "Join code:" "${JOIN:-(none)}   (new players type it once, to make their online account)"
  line "Version:" "${build:-?}   (commit $(git -C "$APP" log -1 --format='%h, %cd' --date=format:'%b %d %H:%M' 2>/dev/null || echo ?))"
  line "Server:" "${state:-?}${since:+ since $since}"
  if [ -n "$h" ]; then line "Online now:" "${online:-0} player(s), ${games:-0} game(s) being played"; fi
  if [ -n "$URL" ]; then
    if curl -fsS --max-time 6 "$URL/api/health" >/dev/null 2>&1; then
      cert=$(echo | openssl s_client -connect "${URL#https://}:443" -servername "${URL#https://}" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
      line "HTTPS:" "working${cert:+ (certificate renews by itself; this one runs to $cert)}"
    else
      line "HTTPS:" "not answering yet (a new server's certificate can take a few minutes; see: afterhours16 logs)"
    fi
  fi
  line "Auto-update:" "$(systemctl is-enabled afterhours16-update.timer 2>/dev/null | grep -q enabled && echo 'on (follows GitHub every 10 minutes, restarting only when no games are on)' || echo off)"
}

update() {
  local auto=$1 old new h games
  need_root update
  old=$(git -C "$APP" rev-parse HEAD)
  as_app git -C "$APP" fetch --quiet --depth 1 origin "$BRANCH" || { echo "Couldn't reach GitHub."; return 1; }
  new=$(git -C "$APP" rev-parse FETCH_HEAD)
  if [ "$old" = "$new" ]; then [ "$auto" = 1 ] || echo "Up to date ($(git -C "$APP" log -1 --format='%h %s'))."; return 0; fi
  if [ "$auto" = 1 ]; then
    h=$(hosting); games=$(printf '%s\n' "$h" | awk '$1=="GAMES" {print $2}')
    if [ -n "$h" ] && [ "${games:-0}" != 0 ]; then echo "A new version is on GitHub; waiting for the ${games} game(s) being played to end."; return 0; fi
  fi
  as_app git -C "$APP" reset --quiet --hard FETCH_HEAD || return 1
  # (the server's own files may have changed too)
  install -m 755 "$APP/deploy/afterhours16.sh" /usr/local/bin/afterhours16
  for u in "$APP"/deploy/systemd/*; do install -m 644 "$u" "/etc/systemd/system/$(basename "$u")"; done
  systemctl daemon-reload
  systemctl restart afterhours16
  for _ in $(seq 1 20); do hosting >/dev/null && break; sleep 1; done
  echo "Updated ${old:0:7} -> ${new:0:7}: $(git -C "$APP" log -1 --format='%s'). Version now: $(hosting | awk '$1=="BUILD" {print $2" "$3}')"
}

joincode() {
  need_root joincode
  local code=${1:-}
  [[ "$code" =~ ^[A-Za-z0-9._-]{4,64}$ ]] || { echo "Usage: afterhours16 joincode NEWCODE (letters, digits, - _ and ., 4 to 64 of them)"; exit 1; }
  # (the settings file from before the rename has the old name: whichever is there changes; neither: the new one is added)
  sed -i -e "s/^RIMRIFT_JOIN_CODE=.*/RIMRIFT_JOIN_CODE=$code/" -e "s/^AFTERHOURS16_JOIN_CODE=.*/AFTERHOURS16_JOIN_CODE=$code/" "$ENVF"
  grep -qE '^(RIMRIFT|AFTERHOURS16)_JOIN_CODE=' "$ENVF" || echo "RIMRIFT_JOIN_CODE=$code" >> "$ENVF"
  systemctl restart afterhours16
  echo "Join code is now: $code (accounts made before keep working)."
}

# v0.4.8.6 RIMRIFT: the save is data/rimrift.sqlite3; the service moves one from before the rename (afterhours.sqlite3)
# over when it starts, and keeps using the old one when it can't, so whichever is there is the save (the new name
# first, as the service does). The copies are rimrift-*; the last 14 are kept counting the old afterhours-* ones too
backup() {
  local db="$APP/data/rimrift.sqlite3" out
  [ -f "$db" ] || db="$APP/data/afterhours.sqlite3"
  [ -f "$db" ] || { echo "No database yet."; return 0; }
  mkdir -p "$BACKUPS"
  out="$BACKUPS/rimrift-$(date +%Y%m%d-%H%M).sqlite3"
  # (SQLite's own online backup: safe while the server is running)
  as_app python3 -c 'import sqlite3, sys; s = sqlite3.connect(sys.argv[1]); d = sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()' "$db" "$out" || { echo "Backup failed."; return 1; }
  find "$BACKUPS" -maxdepth 1 \( -name 'rimrift-*.sqlite3' -o -name 'afterhours-*.sqlite3' \) -printf '%T@ %p\n' | sort -rn | tail -n +15 | cut -d' ' -f2- | xargs -r rm -f
  echo "Backed up to $out"
}

# the network settings for games (deploy/sysctl-afterhours16.conf), applied quietly; never fails the service start
tune() {
  [ "$(id -u)" = 0 ] || return 0
  [ -f "$APP/deploy/sysctl-afterhours16.conf" ] || return 0
  modprobe tcp_bbr >/dev/null 2>&1 || true
  install -m 644 "$APP/deploy/sysctl-afterhours16.conf" /etc/sysctl.d/90-afterhours16.conf 2>/dev/null || return 0
  sysctl -q -p /etc/sysctl.d/90-afterhours16.conf >/dev/null 2>&1 || true
  return 0
}

case "${1:-status}" in
  status) status ;;
  update) update "$([ "${2:-}" = --auto ] && echo 1 || echo 0)" ;;
  joincode) joincode "${2:-}" ;;
  autoupdate)
    need_root autoupdate
    case "${2:-}" in
      on) systemctl enable --now afterhours16-update.timer >/dev/null && echo "Auto-update is on." ;;
      off) systemctl disable --now afterhours16-update.timer >/dev/null && echo "Auto-update is off (update by hand: sudo afterhours16 update)." ;;
      *) echo "Usage: afterhours16 autoupdate on|off" ;;
    esac ;;
  logs) journalctl -u afterhours16 -u caddy -n "${2:-60}" --no-pager ;;
  restart) need_root restart; systemctl restart afterhours16 && echo "Restarted." ;;
  backup) backup ;;
  tune) tune ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
