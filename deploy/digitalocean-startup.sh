#!/bin/bash
# Afterhours 16: your own online server on DigitalOcean (README: "Host on a server").
# Paste ALL of this into the "Startup scripts" box (Advanced options → Add initialization scripts) when you create
# the Droplet. Change only the join code on the next line. About 5 minutes after the Droplet starts, the server is up;
# open the Droplet's Console and type   afterhours16 status   to see its address.
JOIN_CODE="change-me"   # your friends type this once, to make their online account (letters, digits, - _ .)

# (nothing to change below)
REPO="https://github.com/EpsilonDevil/Afterhours16"
export HOME=/root DEBIAN_FRONTEND=noninteractive
exec > >(tee -a /var/log/afterhours16-setup.log) 2>&1
for _ in 1 2 3 4 5; do apt-get -o DPkg::Lock::Timeout=600 update -y && apt-get -o DPkg::Lock::Timeout=600 install -y git && break; sleep 20; done
[ -d /opt/afterhours16/.git ] || git clone --depth 1 "$REPO" /opt/afterhours16
JOIN_CODE="$JOIN_CODE" bash /opt/afterhours16/deploy/install.sh
