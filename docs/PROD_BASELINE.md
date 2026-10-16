# WOG Portal – Produktions-Baseline & Update-Prozess

Stand: **2026-10-03**

## Zielbild

- **Ein** produktives Portal mit **allen** Bereichen und Integrationen.
- Jede Erweiterung = **kleiner Patch-PR** auf die Baseline → Merge → Image-Deploy.
- **Keine** dauerhaften Live-Patches im Container (`sed`/JS-Edit). Der nächste Deploy würde sie sonst überschreiben.
- **Keine** langen Branchen-Stacks als Deploy-Quelle. Stacks nur kurzzeitig zum Review; Prod zieht immer von der Baseline.

---

## 1. Was ist die Portal-Baseline?

| Begriff | Bedeutung |
|---------|-----------|
| `origin/main` | Derzeit Android-App – **nicht** die Portal-Laufzeit |
| **Portal-Baseline** | Branch, der dem **aktuell deploybaren Portal-Stand** entspricht (inkl. aller Module) |
| Feature-Branch | `cursor/<thema>-7079` – Patch darauf, PR gegen Baseline |

Empfohlener Baseline-Name (VPS + Git):

```text
portal-prod
```

Solange `portal-prod` noch nicht als Remote-Branch existiert, gilt als **arbeitsfähige Basis** der Tip der letzten gemergten Portal-Linie bzw. der Branch, von dem der VPS gebaut wird. Nach Konsolidierung: einmalig `portal-prod` aus dem aktuellen guten Stand anlegen und VPS darauf umstellen.

### Baseline anlegen (einmalig, wenn bereit)

```bash
# Auf dem Stand, der Prod wirklich entspricht (nach Review):
git checkout -b portal-prod <bekannter-guter-commit>
git push -u origin portal-prod

# VPS: tracking branch setzen
cd /opt/wog-portal
git fetch origin portal-prod
git checkout -B portal-prod origin/portal-prod
```

---

## 2. Sicherung (immer vor Deploy / großen Änderungen)

### 2.1 Agent / Entwickler-Workspace

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "_backup/${STAMP}/critical"
git bundle create "_backup/${STAMP}/wog-app.bundle" --all
tar -C portal -czf "_backup/${STAMP}/portal-src.tgz" \
  --exclude=node_modules --exclude='apps/web/.next' --exclude='apps/api/dist' .
git -C . rev-parse HEAD > "_backup/${STAMP}/HEAD.txt"
git -C . status -sb > "_backup/${STAMP}/git-status.txt"
git -C . log --oneline -20 > "_backup/${STAMP}/git-log.txt"
# Kritische Zoll-Quellen:
cp portal/apps/api/src/customs/ezoll-soloplan.service.ts "_backup/${STAMP}/critical/"
cp portal/apps/api/src/integrations/soloplan-order.mapper.ts "_backup/${STAMP}/critical/"
cp portal/apps/api/test/ezoll-soloplan.write-safety.test.ts "_backup/${STAMP}/critical/" 2>/dev/null || true
```

`_backup/` ist gitignored – nur lokal/VPS.

### 2.2 Produktion (VPS)

```bash
# DB + data/
/opt/wog-portal/portal/scripts/backup-portal.sh

# Optional: Git-Snapshot des Deploy-Repos
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
tar -C /opt/wog-portal -czf "/opt/wog-portal/_backup/${STAMP}.tgz" \
  --exclude=portal/node_modules --exclude='portal/apps/web/.next' .
```

Cron: siehe [BACKUP_MONITORING.md](../portal/docs/BACKUP_MONITORING.md).

---

## 3. Patch-Workflow (Erweiterung)

1. **Sicherung** (§2)
2. Branch von Baseline: `git checkout -b cursor/<kurz>-7079 portal-prod`
3. Änderung + Tests (`npm test` im `portal/`)
4. PR **gegen `portal-prod`** (nicht gegen Android-`main`, nicht gegen einen 20er-Stack)
5. Nach Merge: auf VPS pullen und **Image bauen** (§4)
6. Smoke-Checkliste aus [HANDBUCH.md](./HANDBUCH.md) §6

Verboten als Dauerzustand:

- JS im laufenden API-Container patchen und „fertig“ nennen
- Deploy von Feature-Branches, die nicht in der Baseline landen
- Dual-Write von Zollflags über OrderImport „weil schneller“

---

## 4. Deploy (dauerhaft aus Git)

### 4.1 Schonender API/Worker-Deploy (ohne Web-Rebuild)

```bash
cd /opt/wog-portal
git fetch origin portal-prod
git checkout portal-prod
git pull --ff-only origin portal-prod

# Vorher Backup
portal/scripts/backup-portal.sh

cd portal
bash scripts/deploy-api-safe.sh
```

`deploy-api-safe.sh` baut **Images** aus dem aktuellen Tree und startet api/worker neu. Kein Live-`sed`.

### 4.2 Voll-Deploy (inkl. Web)

```bash
cd /opt/wog-portal/portal
bash scripts/deploy-server.sh
# oder:
docker compose -p wogportal up -d --build
```

### 4.3 Nach Deploy verifizieren

```bash
docker compose -p wogportal ps
# Image-Label / Commit im Container sollte dem Git-HEAD entsprechen
git rev-parse --short HEAD
# OrderImport / OrderEzoll Pickup erreichbar:
ls -la data/sftp/outbound/soloplan/orders/ | tail
ls -la data/sftp/outbound/soloplan/ezoll/consignment/ | tail
```

Wenn jemand Live-Patches braucht (Notfall): **sofort** denselben Diff ins Git committen und beim nächsten Deploy mitbauen. Sonst ist der Notfall beim nächsten Rebuild weg.

---

## 5. Zollflags – Deploy-Hinweis

Änderungen an `ezoll-soloplan.service.ts` / `soloplan-order.mapper.ts` sind **nur** wirksam, wenn:

1. sie im Git der Baseline liegen, und  
2. api/worker-Images neu gebaut wurden.

Live-Patch der kompilierten `dist/*.js` hält höchstens bis zum nächsten `docker compose build`.

Tests:

```bash
cd portal && npm test
# relevant: apps/api/test/ezoll-soloplan.write-safety.test.ts
#           apps/api/test/soloplan-smartborder-fields.test.ts
```

---

## 6. Rollback

1. Letztes Backup unter `/var/backups/wog-portal/<stamp>/` bzw. `/opt/wog-portal/_backup/`
2. Git: `git checkout <vorheriger-commit>` auf `portal-prod`, Images neu bauen
3. DB nur bei Schema-Problemen restore (`pg_restore` laut backup-portal.sh)

---

## 7. Beziehung zu bestehenden Docs

| Doc | Rolle |
|-----|--------|
| [HANDBUCH.md](./HANDBUCH.md) | Fachliche Bereiche + Checkliste |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Erstinstallation / Nginx |
| [BACKUP_MONITORING.md](../portal/docs/BACKUP_MONITORING.md) | Cron, Monitoring |
| [PORTAL_TODO.md](../portal/docs/PORTAL_TODO.md) | Offene technische Schulden |

Dieser Prozess ersetzt **nicht** die Fachdocs – er stellt sicher, dass der Code, der dort beschrieben ist, **auch im Image** ankommt.
