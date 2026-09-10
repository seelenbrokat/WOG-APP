#!/usr/bin/env bash
# Legt einen OpenSSH internal-sftp User für Partner-Statusmeldungen an
# (z. B. BT Swiss FORTRAS STAT512).
#
# Usage:
#   sudo bash portal/scripts/provision-partner-status-sftp.sh btswiss
#   sudo bash portal/scripts/provision-partner-status-sftp.sh btswiss /opt/wog-portal/portal

set -euo pipefail

USERNAME="${1:-}"
APP_DIR="${2:-/opt/wog-portal/portal}"
SFTP_ROOT="${APP_DIR}/data/sftp"
CRED_FILE="${SFTP_ROOT}/credentials/${USERNAME}.txt"
DROP_DIR="${SFTP_ROOT}/inbound/partner-status/${USERNAME}"

if [[ -z "$USERNAME" ]]; then
  echo "Usage: $0 <sftpUsername> [portal-dir]" >&2
  exit 1
fi
if [[ ! -f "$CRED_FILE" ]]; then
  echo "Credentials fehlen: $CRED_FILE" >&2
  echo "Zuerst Credentials-Datei anlegen (siehe docs/BT_SWISS_STATUS_SFTP.md)." >&2
  exit 1
fi

PASSWORD="$(grep '^password=' "$CRED_FILE" | cut -d= -f2-)"
if [[ -z "$PASSWORD" ]]; then
  echo "Kein Passwort in $CRED_FILE" >&2
  exit 1
fi

mkdir -p "$DROP_DIR/processed" "$DROP_DIR/failed"
chmod 755 "$SFTP_ROOT" "$SFTP_ROOT/inbound" "$SFTP_ROOT/inbound/partner-status" 2>/dev/null || true
chmod 755 "$DROP_DIR" "$DROP_DIR/processed" "$DROP_DIR/failed"

if ! id "$USERNAME" >/dev/null 2>&1; then
  useradd --system --home-dir "$DROP_DIR" --shell /usr/sbin/nologin \
    --comment "WOG Partner-Status SFTP ($USERNAME)" "$USERNAME"
fi
echo "${USERNAME}:${PASSWORD}" | chpasswd

chown root:root "$SFTP_ROOT"
chown root:root "$SFTP_ROOT/inbound" "$SFTP_ROOT/inbound/partner-status" 2>/dev/null || true
chown "${USERNAME}:${USERNAME}" "$DROP_DIR"
chmod 775 "$DROP_DIR"
chown "${USERNAME}:${USERNAME}" "$DROP_DIR/processed" "$DROP_DIR/failed"

SSHD_MARK="# WOG Portal – Partner-Status SFTP ($USERNAME)"
DROP_CHROOT="/inbound/partner-status/${USERNAME}"
if ! grep -q "^Match User ${USERNAME}\$" /etc/ssh/sshd_config 2>/dev/null; then
  cat >> /etc/ssh/sshd_config <<EOF

${SSHD_MARK}
Match User ${USERNAME}
    ChrootDirectory ${SFTP_ROOT}
    ForceCommand internal-sftp -d ${DROP_CHROOT}
    PasswordAuthentication yes
    AllowTcpForwarding no
    X11Forwarding no
    PermitTunnel no
EOF
  sshd -t
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
fi
chmod 700 "${SFTP_ROOT}/credentials" 2>/dev/null || true
chown root:root "${SFTP_ROOT}/credentials" 2>/dev/null || true

echo "SFTP-User ${USERNAME} bereit (Partner-Status)"
echo "  host: $(grep '^host=' "$CRED_FILE" | cut -d= -f2-)"
echo "  path: inbound/partner-status/${USERNAME}/"
echo "  format: FORTRAS STAT512"
echo "  cred: ${CRED_FILE}"
