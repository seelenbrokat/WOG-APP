#!/usr/bin/env bash
# Legt einen OpenSSH internal-sftp User für eberle VIP (In + Out) an.
#
# Struktur (Chroot = partners/eberle):
#   outbound/  – VIP-Auftragsdateien zum Abholen (WOG → eberle)
#   inbound/   – Status + POD zum Hochladen (eberle → WOG)
#
# Usage:
#   sudo bash portal/scripts/provision-eberle-sftp.sh
#   sudo bash portal/scripts/provision-eberle-sftp.sh eberle /opt/wog-portal/portal

set -euo pipefail

USERNAME="${1:-eberle}"
APP_DIR="${2:-/opt/wog-portal/portal}"
SFTP_ROOT="${APP_DIR}/data/sftp"
PARTNER_ROOT="${SFTP_ROOT}/partners/${USERNAME}"
OUT_DIR="${PARTNER_ROOT}/outbound"
IN_DIR="${PARTNER_ROOT}/inbound"
CRED_DIR="${SFTP_ROOT}/credentials"
CRED_FILE="${CRED_DIR}/${USERNAME}.txt"
HOST_DEFAULT="wog.logistikberater.at"

mkdir -p "$OUT_DIR" "$IN_DIR/processed" "$IN_DIR/failed" "$IN_DIR/pod" \
  "${SFTP_ROOT}/state/${USERNAME}/exported" "$CRED_DIR"

if [[ ! -f "$CRED_FILE" ]]; then
  PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)"
  umask 077
  cat > "$CRED_FILE" <<EOF
username=${USERNAME}
password=${PASSWORD}
host=${HOST_DEFAULT}
port=22
outbound=partners/${USERNAME}/outbound
inbound=partners/${USERNAME}/inbound
format=VIP
note=eberle VIP – keine Preise in Outbound-Dateien
created=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
  echo "Credentials angelegt: ${CRED_FILE}"
else
  PASSWORD="$(grep '^password=' "$CRED_FILE" | cut -d= -f2-)"
fi

if [[ -z "${PASSWORD:-}" ]]; then
  echo "Kein Passwort in $CRED_FILE" >&2
  exit 1
fi

# Chroot muss root:root und nicht beschreibbar für den User sein
chown root:root "$SFTP_ROOT" "$SFTP_ROOT/partners" "$PARTNER_ROOT" 2>/dev/null || true
chmod 755 "$SFTP_ROOT" "$SFTP_ROOT/partners" "$PARTNER_ROOT"

mkdir -p "$OUT_DIR" "$IN_DIR/processed" "$IN_DIR/failed" "$IN_DIR/pod"
chmod 755 "$OUT_DIR"
chmod 775 "$IN_DIR"
chmod 755 "$IN_DIR/processed" "$IN_DIR/failed" "$IN_DIR/pod"

if ! id "$USERNAME" >/dev/null 2>&1; then
  useradd --system --home-dir "$PARTNER_ROOT" --shell /usr/sbin/nologin \
    --comment "WOG eberle VIP SFTP ($USERNAME)" "$USERNAME"
fi
echo "${USERNAME}:${PASSWORD}" | chpasswd

# Outbound lesbar, Inbound beschreibbar
chown root:root "$OUT_DIR"
chmod 755 "$OUT_DIR"
# Gruppe eberle darf outbound lesen (Dateien 664)
chgrp "$USERNAME" "$OUT_DIR" 2>/dev/null || true
chmod 755 "$OUT_DIR"
chown "${USERNAME}:${USERNAME}" "$IN_DIR" "$IN_DIR/processed" "$IN_DIR/failed" "$IN_DIR/pod"
chmod 775 "$IN_DIR"

SSHD_MARK="# WOG Portal – eberle VIP SFTP ($USERNAME)"
if ! grep -q "^Match User ${USERNAME}\$" /etc/ssh/sshd_config 2>/dev/null; then
  cat >> /etc/ssh/sshd_config <<EOF

${SSHD_MARK}
Match User ${USERNAME}
    ChrootDirectory ${PARTNER_ROOT}
    ForceCommand internal-sftp
    PasswordAuthentication yes
    AllowTcpForwarding no
    X11Forwarding no
    PermitTunnel no
EOF
  sshd -t
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
fi

chmod 700 "$CRED_DIR" 2>/dev/null || true
chown root:root "$CRED_DIR" 2>/dev/null || true
chmod 600 "$CRED_FILE" 2>/dev/null || true

echo "SFTP-User ${USERNAME} bereit (eberle VIP In+Out)"
echo "  host: $(grep '^host=' "$CRED_FILE" | cut -d= -f2-)"
echo "  outbound (Download): /outbound/"
echo "  inbound  (Upload):   /inbound/"
echo "  format: VIP K/L (ohne Preise); Status B001-G0030/G0031 + POD"
echo "  cred: ${CRED_FILE}"
