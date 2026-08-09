#!/usr/bin/env bash
# Legt einen OpenSSH internal-sftp User für einen Portal-Kunden/Partner an.
# Voraussetzung: SFTP-Inbound im Portal freigeschaltet, Credentials-Datei vorhanden.
#
# Usage:
#   sudo bash portal/scripts/provision-partner-sftp.sh quehenberger
#   sudo bash portal/scripts/provision-partner-sftp.sh quehenberger /opt/wog-portal/portal

set -euo pipefail

USERNAME="${1:-}"
APP_DIR="${2:-/opt/wog-portal/portal}"
SFTP_ROOT="${APP_DIR}/data/sftp"
CRED_FILE="${SFTP_ROOT}/credentials/${USERNAME}.txt"
DROP_DIR="${SFTP_ROOT}/inbound/partner-orders/${USERNAME}"

if [[ -z "$USERNAME" ]]; then
  echo "Usage: $0 <sftpUsername> [portal-dir]" >&2
  exit 1
fi
if [[ ! -f "$CRED_FILE" ]]; then
  echo "Credentials fehlen: $CRED_FILE" >&2
  echo "Zuerst im Portal SFTP für den Kunden freischalten." >&2
  exit 1
fi

PASSWORD="$(grep '^password=' "$CRED_FILE" | cut -d= -f2-)"
if [[ -z "$PASSWORD" ]]; then
  echo "Kein Passwort in $CRED_FILE" >&2
  exit 1
fi

mkdir -p "$DROP_DIR/processed" "$DROP_DIR/failed"
chmod 755 "$SFTP_ROOT" "$SFTP_ROOT/inbound" "$SFTP_ROOT/inbound/partner-orders"
chmod 755 "$DROP_DIR" "$DROP_DIR/processed" "$DROP_DIR/failed"

if ! id "$USERNAME" >/dev/null 2>&1; then
  useradd --system --home-dir "$DROP_DIR" --shell /usr/sbin/nologin \
    --comment "WOG Partner-Orders SFTP ($USERNAME)" "$USERNAME"
fi
echo "${USERNAME}:${PASSWORD}" | chpasswd

# Chroot auf SFTP_ROOT; User sieht inbound/partner-orders/<user>
chown root:root "$SFTP_ROOT"
chown root:root "$SFTP_ROOT/inbound" "$SFTP_ROOT/inbound/partner-orders" 2>/dev/null || true
chown "${USERNAME}:${USERNAME}" "$DROP_DIR"
chmod 755 "$DROP_DIR"
# Upload-Ordner beschreibbar
chmod 775 "$DROP_DIR"
chown "${USERNAME}:${USERNAME}" "$DROP_DIR/processed" "$DROP_DIR/failed"

SSHD_MARK="# WOG Portal – Partner-Orders SFTP ($USERNAME)"
if ! grep -q "^Match User ${USERNAME}\$" /etc/ssh/sshd_config 2>/dev/null; then
  cat >> /etc/ssh/sshd_config <<EOF

${SSHD_MARK}
Match User ${USERNAME}
    ChrootDirectory ${SFTP_ROOT}
    ForceCommand internal-sftp
    PasswordAuthentication yes
    AllowTcpForwarding no
    X11Forwarding no
    PermitTunnel no
EOF
  sshd -t
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
fi

echo "SFTP-User ${USERNAME} bereit"
echo "  host: $(grep '^host=' "$CRED_FILE" | cut -d= -f2-)"
echo "  path: inbound/partner-orders/${USERNAME}/"
echo "  cred: ${CRED_FILE}"
