# Deployment

This page provides the procedures that change production. There is one production environment, on the host `dashydatabase-1`, and no staging environment. Every procedure is written to be followed literally on that host as the `dashy` user from the repository root `/opt/dashy-database/projects/airdash`, and each states its prerequisites, the exact commands, what they change, how to verify the result, and how to roll back.

Deployment in airDash is not a single pipeline. The deployable unit depends on what changed, so the first step is always to classify the change with the [change classification table](README.md#change-classification).

## Environments

| Environment | Where | Data | Purpose |
|---|---|---|---|
| Development | A contributor's machine, or a temporary process on the production host | A local database, or on the host the production database read-only | Editing and validation. See [local development](local-development.md). |
| Production | `dashydatabase-1` | The `airdash` schema in `dashy-postgres` | The live site. |

There is no test or staging environment. Isolated builds and temporary API processes provide pre-production validation; the [known limitations](known-limitations.md) page records the consequences.

## Operating principles

1. Validate before you publish. Complete the relevant validation sequence in [local development](local-development.md#the-edit-validate-and-review-loop). Production is not the place to find out.
2. Merge before you deploy. Production should run code that exists on the `release/*` branch in GitHub, so that the deployed state can be reconstructed. See [releases](releases.md).
3. Back up before you change. The [release backup](backup-and-recovery.md#release-backup) is the fastest rollback point for the frontend and API; Git is the durable record.
4. Change only what changed. A frontend build never requires an API restart; an API change never requires a frontend build unless the UI also changed.
5. Verify after you publish, with the commands in each procedure.
6. Respect shared infrastructure. Caddy and PostgreSQL serve other dashydoggo.com services.

## Production inventory

| Item | Value |
|---|---|
| Public URL | `https://air.dashydoggo.com` |
| Health endpoint | `https://air.dashydoggo.com/api/health` |
| Repository root | `/opt/dashy-database/projects/airdash` |
| Deployed branch | `release/airdash-platform-20260910` (check with `git branch --show-current`) |
| Published site | `/opt/dashy-database/projects/airdash/site` |
| API process | PM2 `airdash-api`, script `api/src/server.js`, port 3006 |
| API environment | `/opt/dashy-database/projects/airdash/api/.env` |
| Static container | `dashy-airdash` (`nginx:alpine`, restart `unless-stopped`, network `docker_web`) |
| Static container config | `/opt/dashy-database/projects/airdash/nginx.conf` |
| Edge proxy | `dashy-caddy`, config `/opt/dashy-database/configs/Caddyfile` |
| Database | `dashy-postgres`, database `dashyden`, schema `airdash` |
| PM2 persistence | systemd unit `pm2-dashy.service`, dump `/home/dashy/.pm2/dump.pm2` |
| Backup directory | `/opt/dashy-database/backups/` |

## Pre-deployment checklist

Complete every applicable line before any procedure below.

```text
[ ] Change classified (frontend / API / migration / static / Nginx / Caddy / Windows / docs)
[ ] Change merged to the release branch, and the working tree on the host is that commit (git status clean, git log matches)
[ ] Validation sequence passed on the host: check, tests, typecheck, isolated build as applicable
[ ] Release backup created and its path recorded
[ ] Database backup created if the change includes a migration or any hand-written data change
[ ] Current live bundle names recorded (grep -oE '/app-assets/index-[^" ]+\.(js|css)' site/index.html)
```

## Get the code onto the host

The host's working tree is the deployment source. Bring it to the merged commit:

```bash
cd /opt/dashy-database/projects/airdash
git status --porcelain
git fetch origin
git checkout release/airdash-platform-20260910
git pull --ff-only origin release/airdash-platform-20260910
git log --oneline -1
```

`git status --porcelain` must print nothing; if it does, someone edited production files directly, and you must reconcile that before pulling (see [debugging](debugging.md) and talk to the owner). `--ff-only` refuses to create a merge commit, which keeps the host identical to GitHub. If dependencies changed in the commit, also run `npm --prefix api ci` and `npm --prefix web ci --include=dev`.

## Deploy a frontend-only change

Use when only `web/` changed. The API keeps running throughout. The site is live the moment Vite finishes writing `site/index.html`, because `site/` is bind-mounted into the running Nginx container.

Prerequisites: checklist complete; [frontend validation](local-development.md#frontend-validation-sequence) passed.

1. Record the current bundle names for rollback:

   ```bash
   grep -oE '/app-assets/index-[^" ]+\.(js|css)' site/index.html
   ```

2. Build and publish:

   ```bash
   npm --prefix web run build
   grep -oE '/app-assets/index-[^" ]+\.(js|css)' site/index.html
   ```

   `build` runs `tsc -b`, then `vite build` into `site/`, then `postbuild`, which sets directories to `755` and files to `644` so the Nginx container can read them. Expected output ends with `✓ built in <n>ms` and the `postbuild` banner, and the final `grep` prints the new names. The chunk-size warning is normal.

3. Verify:

   ```bash
   curl -fsS -H 'Cache-Control: no-cache' https://air.dashydoggo.com/ | grep -oE '/app-assets/index-[^" ]+\.(js|css)'
   js=$(curl -fsS https://air.dashydoggo.com/ | grep -oE '/app-assets/index-[^" ]+\.js')
   curl -fsS "https://air.dashydoggo.com$js" | grep -aFq 'your-marker-text' && echo marker-present
   curl -fsS https://air.dashydoggo.com/api/health
   ```

   Replace `your-marker-text` with a class name or string introduced by the change. Then open the changed page in a browser.

4. If something is wrong, [roll back the frontend](#roll-back-the-frontend).

Files changed: `site/index.html`, new files in `site/app-assets/`, `site/airdash-sw.js`, and `site/assets/` (copied from `web/public/`). Nothing else. Rerunning the build is safe.

## Deploy an API-only change

Use when `api/src/` changed. This restarts the shared API process and interrupts in-flight API requests for one to three seconds. Scheduled jobs pause for the same period and resume on the next interval.

Prerequisites: checklist complete; [backend validation](local-development.md#backend-validation-sequence) passed, including a smoke test of the changed route; database backup taken if the change contains a migration statement.

1. Final syntax check and restart:

   ```bash
   npm --prefix api run check
   pm2 restart airdash-api
   sleep 3
   pm2 show airdash-api | grep -E 'status|restarts|unstable'
   ```

   Expected: `status │ online` and `unstable restarts │ 0`. The restart loads the new source, runs `migrate()`, repairs gates, starts the push worker, and listens. If `migrate()` fails, the process exits and PM2 restarts it repeatedly; `unstable restarts` rises. See [API exits at startup](debugging.md#api-exits-at-startup).

2. Verify:

   ```bash
   curl -fsS https://air.dashydoggo.com/api/health
   curl -fsS https://air.dashydoggo.com/api/live | head -c 400; echo
   pm2 logs airdash-api --nostream --lines 15
   ```

   Request the specific route you changed and confirm the new behavior or field.

3. If something is wrong, [roll back the API](#roll-back-the-api).

Files changed: none on disk; the process image in memory. Database: whatever `migrate()` adds.

## Deploy a combined change

When both `web/src/` and `api/src/` changed, deploy the API first and the frontend second. The frontend may depend on a new API field; the reverse is rare. Take one release backup, restart and verify the API, then build and verify the frontend.

## Deploy a migration

A migration is an API change whose `database.js` edit alters the schema or data. It follows the API procedure with three additions:

1. Before anything else, take the [database backup](backup-and-recovery.md#database-backup) and record its path.
2. The smoke test on the host applies the migration to production, because the temporary process loads the production `api/.env`. That is intended: it proves the statement runs. It is also why the backup comes first.
3. After the restart, confirm the schema change directly:

   ```bash
   docker exec dashy-postgres psql -U dashy -d dashyden -Atc \
     "SELECT column_name FROM information_schema.columns WHERE table_schema='airdash' AND table_name='<table>' AND column_name='<column>';"
   ```

**Important:** Rolling back API source does not roll back the migration. See [roll back the API](#roll-back-the-api).

## Deploy a static file change

Files under `site/assets/` and `site/downloads/` are not produced by the build. Prefer adding images to `web/public/assets/` so that the next build reproduces them; use direct placement for downloads and for files that must not wait for a build. Copy with `install` so that ownership and permissions are correct:

```bash
install -m 644 /path/to/new-image.png site/assets/new-image.png
curl -fsS -o /dev/null -w '%{http_code}\n' https://air.dashydoggo.com/assets/new-image.png
```

Nginx serves `site/assets/` with a one-day cache and `site/downloads/` with a one-hour cache. A replaced file with the same name may remain cached in browsers for that period; use a new file name when immediate visibility matters. Livery packages additionally require updating the SHA-256 and URL columns in `aircraft` through `database.js` (the fleet seed upserts them on every migration) and the catalog files; treat that as a migration.

**Warning:** Never run `vite build` with `--emptyOutDir` against `site/`. The configuration disables emptying deliberately because `site/assets/` and `site/downloads/` contain files that no build regenerates.

## Deploy an Nginx configuration change

`nginx.conf` is bind-mounted read-only into `dashy-airdash`. Editing the file on the host changes what the container sees, but Nginx reads its configuration only at start or reload.

```bash
docker exec dashy-airdash nginx -t
docker exec dashy-airdash nginx -s reload
curl -fsS -o /dev/null -w '%{http_code}\n' https://air.dashydoggo.com/
```

`nginx -t` tests the configuration and prints `syntax is ok` and `test is successful`. Do not reload if it reports an error; fix the file first. Reload is graceful and drops no requests. Rollback: `git checkout -- nginx.conf` on the host and reload again.

## Deploy a Caddy configuration change

**Warning:** Caddy serves every dashydoggo.com subdomain. A configuration error takes all of them offline. Confirm with the owner before changing the Caddyfile, and back it up first.

```bash
cp /opt/dashy-database/configs/Caddyfile "/opt/dashy-database/backups/Caddyfile-$(date -u +%Y%m%dT%H%M%SZ)"
# edit /opt/dashy-database/configs/Caddyfile
docker exec dashy-caddy caddy validate --config /etc/caddy/Caddyfile
docker exec dashy-caddy caddy reload --config /etc/caddy/Caddyfile
curl -fsS https://air.dashydoggo.com/api/health
```

The Caddyfile lives outside this repository and is not versioned by it. Rollback: copy the backup over the file and reload.

## Deploy a Windows automation change

The PowerShell scripts under `scripts/` run on the Windows PC from copies under `D:\Creations\AirDash\Scripts\`. Deployment is a copy plus hash verification plus a dry run, documented in [powerpoint-automation.md](powerpoint-automation.md#updating-a-script). No host process changes.

## Roll back the frontend

A frontend rollback restores the previous `index.html`. Previous bundles remain in `site/app-assets/` because builds never delete old hashes, and the release backup contains them regardless.

```bash
backup=/opt/dashy-database/backups/airdash-release-<timestamp>
( cd "$backup" && sha256sum -c SHA256SUMS )
install -m 644 "$backup"/site/app-assets/index-* site/app-assets/
install -m 644 "$backup/site/index.html" site/index.html
grep -oE '/app-assets/index-[^" ]+\.(js|css)' site/index.html
curl -fsS -H 'Cache-Control: no-cache' https://air.dashydoggo.com/ | grep -oE '/app-assets/index-[^" ]+\.js'
```

The rollback is live immediately. Then revert the source change through a pull request so that the next build does not reintroduce the problem. Alternatively, with Git: `git revert <commit>` on a branch, merge, pull on the host, and rebuild.

## Roll back the API

An API rollback restores the previous source and restarts. Two methods exist.

With Git, preferred because it keeps the host and GitHub aligned:

```bash
git log --oneline -3
git checkout <previous-commit> -- api/src
npm --prefix api run check
pm2 restart airdash-api
sleep 3
curl -fsS https://air.dashydoggo.com/api/health
pm2 show airdash-api | grep -E 'status|unstable'
```

Then open a revert pull request so that the release branch matches what runs. `git checkout <commit> -- api/src` leaves the working tree modified; `git status` will show it until the revert lands and the host pulls it.

With the release backup, when Git is unavailable:

```bash
backup=/opt/dashy-database/backups/airdash-release-<timestamp>
( cd "$backup" && sha256sum -c SHA256SUMS )
cp "$backup"/api/*.js api/src/
npm --prefix api run check
pm2 restart airdash-api
```

**Important:** Rolling back source does not roll back a migration that already ran. Additive columns remain and are harmless because the old code ignores them. A changed constraint or a data migration needs a deliberate reverse statement planned from the database backup; do not improvise it. See [backup and recovery](backup-and-recovery.md#restore-the-database-schema-from-a-dump).

## Post-deployment verification

After any deployment, complete this list:

```text
[ ] https://air.dashydoggo.com/api/health returns {"ok":true,"database":true}
[ ] pm2 show airdash-api: status online, unstable restarts 0 (API changes)
[ ] Live index references the new bundle and the marker is present (frontend changes)
[ ] The changed page or route behaves as intended in a browser
[ ] pm2 logs airdash-api --nostream --lines 20 shows no new errors
[ ] Documentation updated if a documented path, command, variable, route, table, or procedure changed
```

## Rollout strategy and readiness

There is one instance of each component, so every deployment is an in-place replacement with no canary and no blue-green stage. Readiness is the `listening` log line followed by a green health check. Because PM2 restarts the process in place, the site's static pages remain available during an API restart; only API calls fail for the one to three seconds until the new process listens.
