# AGENTS.md

## Cursor Cloud specific instructions

The main product is the **WOG Portal** in `portal/` (an npm workspaces monorepo). Standard run/build/db scripts are defined in `portal/package.json` and the workspace `package.json` files; setup steps are documented in `README.md` and `docs/DEPLOYMENT.md`. The `app/` Android module is a stub (no `gradlew`, no `AndroidManifest.xml`) and cannot be built from the repo — treat it as out of scope for local dev.

### Services (all run from `portal/`)

| Service | Command | Port | Notes |
|---------|---------|------|-------|
| PostgreSQL 16 | `sudo pg_ctlcluster 16 main start` | 5432 | Installed natively (not Docker). Must be (re)started each session; the update script does NOT start it. |
| API (NestJS) | `npm run dev:api` | 3001 | Watch mode. Base path is `/api`, health at `GET /api/health`. |
| Web (Next.js) | `npm run dev:web` | 3000 | Browser calls the API at `http://localhost:3001/api` by default. |
| Worker | `npm run build:api` then `npm run start:worker` | — | Optional (partner import / integration polling). No watch script. |

Redis, SFTPGo and the SMTP/Soloplan/LDV/Mercurio integrations are optional and default to stub/off; core flows work without them. Without SMTP, verification/reset emails are logged to the console as `[DEV-MAIL]` and stored in the `emailOutbox` table.

### Non-obvious caveats

- **`.env` location:** npm scripts run per-workspace via `-w @wog/api`, so their working directory is `portal/apps/api`, not `portal/`. Both NestJS `ConfigModule` and Prisma only read `.env` from that CWD. A symlink `portal/apps/api/.env -> ../../.env` makes the single real env file at `portal/.env` visible to them. If migrations/seed report `Environment variable not found: DATABASE_URL`, that symlink is missing — recreate it with `ln -sf ../../.env portal/apps/api/.env`. The env files are gitignored.
- **Local dev env values:** `portal/.env` is configured for local dev (`DATABASE_URL=postgresql://wog:wog_secret@localhost:5432/wog_portal`, `NODE_ENV=development`, `APP_URL=http://localhost:3000`). The committed `.env.example` targets production, so do not copy it verbatim for local work.
- **Seed script quoting bug:** `npm run db:seed` fails under `sh`/`dash` because the `--compiler-options {...}` JSON loses its quotes. Seed instead by running, from `portal/apps/api`:
  `export $(grep -E '^(DATABASE_URL|SEED_ADMIN_EMAIL|SEED_ADMIN_PASSWORD)=' .env | xargs -d '\n') && npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' prisma/seed.ts`
  Migrations (`npm run db:migrate`) and client generation (`npm run db:generate`) work normally.
- **No lint or automated test scripts** are defined anywhere in the repo. "Build" for the portal is `npm run build` (shared + api + web) in `portal/`; `npm run build:api` builds just shared + api.

### Seed logins (default)

Admin `admin@wog.logistikberater.at` / `ChangeMe123!`; Dispo AG `dispatch.ag@wog.logistikberater.at` / `DispatchAg123!`; Kunde `kunde@example.com` / `Kunde123!`. Demo tracking `WOGDEMO0001` / PIN `1234`.
