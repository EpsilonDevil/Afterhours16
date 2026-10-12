#!/bin/bash
# Afterhours 16: your own online server on DigitalOcean (README: "Host on a server").
# Paste ALL of this into the "Startup scripts" box (Advanced options → Add initialization scripts) when you create
# the Droplet. Change only the join code on the next line. The server is up 5-20 minutes after the Droplet starts (a new
# server installs Ubuntu's own updates first); open the Droplet's Console and type   afterhours16 status   to see it.
JOIN_CODE="change-me"   # your friends type this once, to make their online account (letters, digits, - _ .)

# (nothing to change below)
REPO="https://github.com/EpsilonDevil/Afterhours16"
export HOME=/root DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
exec > >(tee -a /var/log/afterhours16-setup.log) 2>&1
echo "Afterhours 16 server setup, started $(date)"
# (a new Ubuntu server installs its own updates first, 5-20 minutes on a small one: wait for them, quietly)
n=0; while pgrep -x unattended-upgr >/dev/null || pgrep -f apt.systemd.daily >/dev/null || pgrep -x apt-get >/dev/null || pgrep -x dpkg >/dev/null; do
  [ $((n % 60)) = 0 ] && echo "Waiting for Ubuntu's own first updates to finish ($((n / 60)) min so far; this is normal)..."; n=$((n + 5)); sleep 5; done
for _ in 1 2 3 4 5; do apt-get -qq -o DPkg::Lock::Timeout=1800 update && apt-get -qq -o DPkg::Lock::Timeout=1800 install -y git && break; sleep 20; done
[ -d /opt/afterhours16/.git ] || { echo "Downloading the game from GitHub (about 600 MB)..."; git clone -q --depth 1 "$REPO" /opt/afterhours16; }
JOIN_CODE="$JOIN_CODE" bash /opt/afterhours16/deploy/install.sh
