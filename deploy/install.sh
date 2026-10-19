#!/usr/bin/env bash
# RIMRIFT: set up an online server on a fresh Ubuntu machine (24.04 LTS), or set it up again (safe to re-run).
# README: "Host on a server". On DigitalOcean the startup script (deploy/digitalocean-startup.sh) runs this for you.
#
#   sudo JOIN_CODE=yourcode bash /opt/afterhours16/deploy/install.sh
#
# Optional:  DOMAIN=game.example.com   a name of your own pointed at this server (otherwise one is made from its IP:
#                                      203-0-113-7.sslip.io, which works with no setup)
#            EMAIL=you@example.com     for Let's Encrypt's certificate notices
#            PUBLIC_IP=203.0.113.7     this server's address, if it isn't found by itself (outside DigitalOcean)
#
# What it sets up:
#   /opt/afterhours16          the game, a copy of the GitHub repository (the service runs it as the user afterhours)
#   afterhours16.service       the game service (python3 -m server.app --server), on 127.0.0.1:8765 only
#   Caddy                      the HTTPS front: a free Let's Encrypt certificate, renewed by itself; passes the game and
#                              its sockets through to the service
#   afterhours16-update.timer  every 10 minutes: a new commit on GitHub is pulled, and the service restarts once no
#                              games are being played (everyone's copy must match the server's, so it follows GitHub)
#   afterhours16-backup.timer  a copy of the database every night (the last 14 kept)
#   the firewall               SSH, HTTP and HTTPS only
#   network settings           tuned for many small messages that can't wait (deploy/sysctl-afterhours16.conf: the
#                              service applies them each time it starts, afterhours16 tune)
#   afterhours16 (command)     status, update, joincode, logs, restart, backup, autoupdate
set -euo pipefail

APP=/opt/afterhours16
REPO=${REPO:-https://github.com/EpsilonDevil/Afterhours16}
BRANCH=${BRANCH:-main}
ENVF=/etc/afterhours16.env
PORT=8765
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a HOME=${HOME:-/root}

say() { printf '\n== %s\n' "$*"; }
apt_() { apt-get -o DPkg::Lock::Timeout=1800 -y "$@"; }  # (waits for Ubuntu's own updates on a new machine)
# a new Ubuntu machine installs its own updates first (5-20 minutes on a small one): wait for them quietly, and keep
# its update timers from starting another round until the setup is done
wait_for_updates() {
  local n=0
  while pgrep -x unattended-upgr >/dev/null || pgrep -f apt.systemd.daily >/dev/null || pgrep -x apt-get >/dev/null || pgrep -x dpkg >/dev/null; do
    if [ $((n % 60)) = 0 ]; then echo "Waiting for Ubuntu's own updates to finish ($((n / 60)) min so far; this is normal)..."; fi
    n=$((n + 5)); sleep 5
  done
}
die() { printf '\n!! %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "Run this as root (sudo)."

# ---- settings: the ones given now, otherwise the ones from last time ----
if [ -f "$ENVF" ]; then
  # shellcheck disable=SC1090
  . "$ENVF"
fi
# (v0.4.8.6 RIMRIFT: the settings file is written with RIMRIFT_* names; one from before the rename has AFTERHOURS16_*)
JOIN_CODE=${JOIN_CODE:-${RIMRIFT_JOIN_CODE:-${AFTERHOURS16_JOIN_CODE:-}}}
DOMAIN=${DOMAIN:-${RIMRIFT_DOMAIN:-${AFTERHOURS16_DOMAIN:-}}}
EMAIL=${EMAIL:-${RIMRIFT_EMAIL:-${AFTERHOURS16_EMAIL:-}}}
if [ -z "$JOIN_CODE" ] || [ "$JOIN_CODE" = "change-me" ]; then
  JOIN_CODE="hoops-$(printf '%04d' $((RANDOM % 10000)))"
  say "No join code given: using $JOIN_CODE (change it any time: afterhours16 joincode NEWCODE)"
fi
[[ "$JOIN_CODE" =~ ^[A-Za-z0-9._-]{4,64}$ ]] || die "The join code can only have letters, digits, - _ and . (4 to 64 of them)."
[ -z "$EMAIL" ] || [[ "$EMAIL" =~ ^[^[:space:]@\"\']+@[^[:space:]@\"\']+\.[A-Za-z]{2,}$ ]] || die "That email doesn't look right: $EMAIL"

# ---- this server's address ----
IP=${PUBLIC_IP:-}  # (another host: give it, or it's looked up)
[[ "$IP" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || IP=$(curl -fsS --max-time 3 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address 2>/dev/null || true)  # (DigitalOcean)
[[ "$IP" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || IP=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
[[ "$IP" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || IP=$(hostname -I | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | grep -vE '^(10|127|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\.' | head -1 || true)
[[ "$IP" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || die "Couldn't find this server's public IPv4 address."
DOMAIN=$(printf '%s' "${DOMAIN:-${IP//./-}.sslip.io}" | tr '[:upper:]' '[:lower:]')
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "That domain doesn't look right: $DOMAIN"
URL="https://$DOMAIN"
say "Setting up the RIMRIFT online server at $URL"

# ---- packages ----
say "Packages"
systemctl stop apt-daily.timer apt-daily-upgrade.timer >/dev/null 2>&1 || true
trap 'systemctl start apt-daily.timer apt-daily-upgrade.timer >/dev/null 2>&1 || true' EXIT
wait_for_updates
apt_ update
apt_ install git python3 curl ca-certificates gnupg ufw unattended-upgrades openssl
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || die "Python 3.10 or newer is needed."
if ! command -v caddy >/dev/null 2>&1; then
  # Caddy's own repository (its latest release), else Ubuntu's package
  if curl -fsSL --max-time 30 https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
     && curl -fsSL --max-time 30 https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list \
     && chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list \
     && apt_ update && apt_ install caddy; then
    :
  else
    rm -f /etc/apt/sources.list.d/caddy-stable.list
    { apt_ update && apt_ install caddy; } || die "Couldn't install Caddy."
  fi
fi

# ---- a little swap (the smallest Droplets have 512 MB-1 GB of memory) ----
if [ "$(swapon --show --noheadings | wc -l)" = 0 ] && [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ]; then
  say "Swap (1 GB)"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---- the game ----
say "The game ($APP)"
id afterhours >/dev/null 2>&1 || useradd --system --home-dir /var/lib/afterhours16 --create-home --shell /usr/sbin/nologin afterhours
if [ ! -d "$APP/.git" ]; then
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP"
fi
chown -R afterhours:afterhours "$APP"
git config --system --get-all safe.directory 2>/dev/null | grep -qx "$APP" || git config --system --add safe.directory "$APP"  # (root reads it too)
mkdir -p /var/lib/afterhours16/backups && chown -R afterhours:afterhours /var/lib/afterhours16

umask 077
cat > "$ENVF" <<EOF
# RIMRIFT online server settings (deploy/install.sh). Change the join code with: afterhours16 joincode NEWCODE
RIMRIFT_JOIN_CODE=$JOIN_CODE
RIMRIFT_PUBLIC_URL=$URL
RIMRIFT_DOMAIN=$DOMAIN
RIMRIFT_EMAIL=$EMAIL
RIMRIFT_BRANCH=$BRANCH
EOF
umask 022

# ---- services ----
say "Services"
install -m 755 "$APP/deploy/afterhours16.sh" /usr/local/bin/afterhours16
afterhours16 tune  # (the network settings; the service also applies them each time it starts)
for u in afterhours16.service afterhours16-update.service afterhours16-update.timer afterhours16-backup.service afterhours16-backup.timer; do
  install -m 644 "$APP/deploy/systemd/$u" "/etc/systemd/system/$u"
done
{
  echo "# RIMRIFT online server (deploy/install.sh): HTTPS in front of the game service"
  if [ -n "$EMAIL" ]; then printf '{\n\temail %s\n}\n\n' "$EMAIL"; fi
  printf '%s {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT"
} > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || die "Caddy didn't accept its settings."
systemctl daemon-reload
systemctl enable --now afterhours16.service
systemctl restart afterhours16.service
systemctl enable --now afterhours16-update.timer afterhours16-backup.timer
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy

# ---- firewall: SSH (the Droplet Console uses it), HTTP (for the certificate) and HTTPS ----
say "Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

# ---- check it works ----
say "Checking"
for _ in $(seq 1 30); do curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null || die "The game service didn't start: afterhours16 logs"
ok=""
for _ in $(seq 1 60); do curl -fsS --max-time 5 "$URL/api/health" >/dev/null 2>&1 && { ok=1; break; }; sleep 3; done
[ -n "$ok" ] || echo "(HTTPS isn't answering yet: the certificate can take a few minutes. Check later with: afterhours16 status)"
afterhours16 status || true
echo
echo "Done. Players connect to $URL (Online tab → Connect)."
