# airDash deployment and operations guide

This guide provides the procedures that change or restore production. It covers release backups, frontend deployment, API deployment, health verification, log inspection, rollback, and recovery of each runtime component. Every procedure is written to be followed literally on `dashydatabase-1` as the `dashy` user.

## Operating principles

1. **Back up before you change.** The project is not in Git. The release backup you create immediately before a deployment is the only rollback point.
2. **Validate before you publish.** Run the validation sequence in the [development guide](development.md) first. Do not use production as the test.
3. **Restart only what changed.** A frontend build never requires an API restart. An API change never requires a frontend build unless the UI also changed.
4. **Verify after you publish.** Confirm the live site references the new bundle, the health endpoint is green, and PM2 reports zero unstable restarts.
5. **Respect shared infrastructure.** Caddy and PostgreSQL serve other dashydoggo.com services. Reloading Caddy or restarting PostgreSQL affects all of them.

## Production inventory

| Item | Value |
|---|---|
| Public URL | `https://air.dashydoggo.com` |
| Health endpoint | `https://air.dashydoggo.com/api/health` |
| Project root | `/opt/dashy-database/projects/airdash` |
| Published site | `/opt/dashy-database/projects/airdash/site` |
| API process | PM2 `airdash-api`, script `api/src/server.js`, port 3006 |
| API environment | `/opt/dashy-database/projects/airdash/api/.env` |
| Static container | `dashy-airdash` (`nginx:alpine`, restart `unless-stopped`) |
| Static container config | `/opt/dashy-database/projects/airdash/nginx.conf` |
| Edge proxy | `dashy-caddy`, config `/opt/dashy-database/configs/Caddyfile` |
| Database | `dashy-postgres`, database `dashyden`, schema `airdash` |
| PM2 persistence | systemd unit `pm2-dashy.service`, dump `/home/dashy/.pm2/dump.pm2` |
| Backup directory | `/opt/dashy-database/backups/` |

## Release backup

Create this backup before every frontend build, API restart, or migration. It takes seconds and it is the rollback boundary.

```bash
cd /opt/dashy-database/projects/airdash
umask 077
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/opt/dashy-database/backups/airdash-release-$timestamp"
mkdir -p "$backup/site/app-assets" "$backup/api"

# Published frontend entry point and the bundles it references
cp site/index.html "$backup/site/index.html"
grep -oE '/app-assets/index-[^" ]+\.(js|css)' site/index.html | while read -r asset; do
  cp "site$asset" "$backup/site$asset"
done

# API source as currently running
cp api/src/*.js "$backup/api/"

# Manifest and checksums
{
  printf 'created_utc=%s\n' "$timestamp"
  printf 'pm2_pid=%s\n' "$(pm2 pid airdash-api)"
  printf 'published_assets=\n'
  grep -oE '/app-assets/index-[^" ]+\.(js|css)' site/index.html
} > "$backup/MANIFEST.txt"
( cd "$backup" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS )

echo "backup=$backup"
cat "$backup/MANIFEST.txt"
```

Record the printed `backup=` path. The `SHA256SUMS` file lets you verify later that the backup was not altered:

```bash
( cd /opt/dashy-database/backups/airdash-release-<timestamp> && sha256sum -c SHA256SUMS )
```

**Note:** `umask 077` makes the new files readable only by the `dashy` user. The API source copy may reference secret variable names, and the backup directory should not be world-readable.

## Database backup

Take a database backup in addition to the release backup when a change adds a migration statement, alters a constraint, or runs any hand-written `UPDATE` or `DELETE`.

```bash
umask 077
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
docker exec dashy-postgres pg_dump -U dashy -d dashyden -n airdash -Fc \
  > "/opt/dashy-database/backups/airdash-db-$timestamp.dump"
ls -l "/opt/dashy-database/backups/airdash-db-$timestamp.dump"
```

The `-Fc` flag produces PostgreSQL's custom compressed format, which `pg_restore` can selectively restore. The `-n airdash` flag limits the dump to the airDash schema so other services' data is not included.

## Deploy a frontend-only change

Use this procedure when only files under `web/src/` changed. The API keeps running throughout.

### Step 1: Validate

Complete the [frontend validation sequence](development.md#the-validation-sequence-for-a-frontend-change). Do not continue until the type check and isolated build pass.

### Step 2: Back up

Run the [release backup](#release-backup) and record the printed path.

### Step 3: Build and publish

```bash
cd /opt/dashy-database/projects/airdash
npm --prefix web run build
grep -oE '/app-assets/index-[^" ]+\.(js|css)' site/index.html
```

The `build` script runs `tsc -b` and then `vite build`, then a post-build step that sets directory permissions to `755` and file permissions to `644` so the Nginx container can read them. The final `grep` prints the new bundle names. The site is live the moment `vite build` finishes writing `site/index.html`, because `site/` is bind-mounted into the running Nginx container.

### Step 4: Verify

```bash
# The live index references the new hash
curl -fsS -H 'Cache-Control: no-cache' https://air.dashydoggo.com/ | grep -oE '/app-assets/index-[^" ]+\.(js|css)'

# The live bundle contains your change marker
js=$(curl -fsS https://air.dashydoggo.com/ | grep -oE '/app-assets/index-[^" ]+\.js')
curl -fsS "https://air.dashydoggo.com$js" | grep -aFq 'your-marker-text' && echo marker-present

# The API was not disturbed
curl -fsS https://air.dashydoggo.com/api/health
```

Replace `your-marker-text` with a class name or string you introduced. Then open `https://air.dashydoggo.com` in a browser and look at the changed page.

### Step 5: If something is wrong

Follow [Roll back the frontend](#roll-back-the-frontend).

## Deploy an API-only change

Use this procedure when files under `api/src/` changed. This procedure restarts the shared API process and interrupts API requests for roughly one to three seconds.

### Step 1: Validate

Complete the [backend validation sequence](development.md#the-validation-sequence-for-a-backend-change): syntax check, streak tests, and a temporary-process smoke test.

### Step 2: Back up

Run the [release backup](#release-backup). If the change includes a migration statement, also run the [database backup](#database-backup).

### Step 3: Restart

```bash
cd /opt/dashy-database/projects/airdash
npm --prefix api run check
pm2 restart airdash-api
sleep 3
pm2 show airdash-api | grep -E 'status|restarts|unstable'
```

Expected: `status │ online` and `unstable restarts │ 0`.

The restart loads the new source, runs `migrate()`, and begins listening. If `migrate()` fails, the process exits and PM2 restarts it repeatedly. The `unstable restarts` counter rises, and the health endpoint fails. See [Diagnose an unhealthy API](#diagnose-an-unhealthy-api).

### Step 4: Verify

```bash
curl -fsS https://air.dashydoggo.com/api/health
curl -fsS https://air.dashydoggo.com/api/live | head -c 400
pm2 logs airdash-api --nostream --lines 15
```

Request the specific route you changed and confirm the new behavior or field is present.

### Step 5: If something is wrong

Follow [Roll back the API](#roll-back-the-api).

## Deploy a combined change

When both `web/src/` and `api/src/` changed, deploy the API first and the frontend second. The frontend may depend on a new API field; the reverse is rarely true. Validate both, take one release backup, restart the API and verify it, then build the frontend and verify it.

## Deploy a static file change

Files under `site/assets/` and `site/downloads/` are not produced by the build. Copy them into place with `install` so permissions are correct:

```bash
install -m 644 /path/to/new-image.png site/assets/new-image.png
```

Nginx serves `site/assets/` with a one-day cache and `site/downloads/` with a one-hour cache. A replaced file with the same name may remain cached in browsers for that period. Use a new filename when immediate visibility matters.

**Warning:** Do not run `vite build` with `--emptyOutDir` against `site/`. The project disables emptying deliberately because `site/assets/` and `site/downloads/` contain files that no build regenerates.

## Roll back the frontend

A frontend rollback restores the previous `index.html`. The previous bundles are still present in `site/app-assets/` because builds do not delete old hashes, and the backup contains them regardless.

```bash
cd /opt/dashy-database/projects/airdash
backup=/opt/dashy-database/backups/airdash-release-<timestamp>

# Verify the backup first
( cd "$backup" && sha256sum -c SHA256SUMS )

# Restore bundles (harmless if they already exist) and the entry point
install -m 644 "$backup"/site/app-assets/index-* site/app-assets/
install -m 644 "$backup/site/index.html" site/index.html

# Confirm
grep -oE '/app-assets/index-[^" ]+\.(js|css)' site/index.html
curl -fsS -H 'Cache-Control: no-cache' https://air.dashydoggo.com/ | grep -oE '/app-assets/index-[^" ]+\.js'
```

The rollback is live immediately. Then correct the source in `web/src/` so the next build does not reintroduce the problem.

## Roll back the API

An API rollback restores the previous source files and restarts.

```bash
cd /opt/dashy-database/projects/airdash
backup=/opt/dashy-database/backups/airdash-release-<timestamp>
( cd "$backup" && sha256sum -c SHA256SUMS )
cp "$backup"/api/*.js api/src/
npm --prefix api run check
pm2 restart airdash-api
sleep 3
curl -fsS https://air.dashydoggo.com/api/health
pm2 show airdash-api | grep -E 'status|unstable'
```

**Important:** Rolling back source does not roll back a migration that already ran. Additive columns remain in the database, which is harmless because the old code ignores them. A changed constraint or a data migration may need a manual reverse statement; plan that from the database backup, and do not improvise it.

## Diagnose an unhealthy API

Symptoms: the health endpoint returns an error or `{"ok":false,...}`, or PM2 shows `errored` or rising `unstable restarts`.

```bash
pm2 show airdash-api | grep -E 'status|restarts|unstable|uptime'
pm2 logs airdash-api --nostream --lines 80
docker ps --filter name=dashy-postgres --format '{{.Names}} {{.Status}}'
docker exec dashy-postgres pg_isready -U dashy
```

Interpretation:

| Observation | Likely cause | Action |
|---|---|---|
| Log ends in a SQL error immediately after start | Migration statement failed | Fix `database.js` or roll back the API. |
| Log shows `ECONNREFUSED` to the database | PostgreSQL container down | `docker start dashy-postgres`, then `pm2 restart airdash-api`. |
| Log shows a JavaScript `SyntaxError` | Source file damaged | `npm --prefix api run check`, fix, restart. |
| Status `online`, health returns `database:false` | Database reachable but query failed | Check PostgreSQL logs: `docker logs --tail 50 dashy-postgres`. |
| Status `stopped` | Someone ran `pm2 stop` | `pm2 start airdash-api`. |
| Process missing from `pm2 list` | PM2 list was lost | Run [Recover the PM2 process](#recover-the-pm2-process). |

## Log locations

| Component | Command |
|---|---|
| API output and errors | `pm2 logs airdash-api --nostream --lines 100` |
| API log files | `/home/dashy/.pm2/logs/airdash-api-out.log` and `airdash-api-error.log` |
| Nginx (static site) | `docker logs --tail 100 dashy-airdash` |
| Caddy (edge) | `docker logs --tail 100 dashy-caddy` |
| PostgreSQL | `docker logs --tail 100 dashy-postgres` |

## Recovery procedures

### Recover the PM2 process

If `pm2 list` does not show `airdash-api`, restore it from the ecosystem file:

```bash
cd /opt/dashy-database/projects/airdash/api
pm2 start ecosystem.config.js
pm2 save
```

`pm2 save` writes the process list to `/home/dashy/.pm2/dump.pm2`, which the `pm2-dashy` systemd service resurrects at boot. Confirm the boot service is enabled:

```bash
systemctl is-enabled pm2-dashy
systemctl is-active pm2-dashy
```

Both should print `enabled` and `active`.

### Recover the static site container

`dashy-airdash` is not defined in the central Docker Compose file. Recreate it with the exact mounts and network it uses today:

```bash
docker rm -f dashy-airdash 2>/dev/null || true
docker run -d \
  --name dashy-airdash \
  --restart unless-stopped \
  --network docker_web \
  -v /opt/dashy-database/projects/airdash/site:/usr/share/nginx/html:ro \
  -v /opt/dashy-database/projects/airdash/nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:alpine
docker ps --filter name=dashy-airdash
curl -fsS -o /dev/null -w '%{http_code}\n' https://air.dashydoggo.com/
```

The container does not publish a host port. Caddy reaches it by container name over the `docker_web` network, which is why `--network docker_web` is required.

### Reload Nginx after editing nginx.conf

```bash
docker exec dashy-airdash nginx -t
docker exec dashy-airdash nginx -s reload
```

`nginx -t` tests the configuration. Do not reload if it reports an error.

### Reload Caddy after editing the Caddyfile

**Warning:** Caddy serves every dashydoggo.com subdomain. A configuration error takes all of them offline. Validate first.

```bash
docker exec dashy-caddy caddy validate --config /etc/caddy/Caddyfile
docker exec dashy-caddy caddy reload --config /etc/caddy/Caddyfile
```

Confirm with Dashy before changing the Caddyfile, and back up the file first:

```bash
cp /opt/dashy-database/configs/Caddyfile "/opt/dashy-database/backups/Caddyfile-$(date -u +%Y%m%dT%H%M%SZ)"
```

### Recover the database container

```bash
docker start dashy-postgres
docker exec dashy-postgres pg_isready -U dashy
pm2 restart airdash-api
```

The database files live in the Docker volume `docker_pgdata`. Starting the container does not lose data. If the volume itself is damaged, restore from the most recent `airdash-db-*.dump` using `pg_restore`, and plan that restore with Dashy before executing it because it replaces live operational records.

### Restore the database schema from a dump

This procedure is destructive to current airDash data. It exists for disaster recovery, not for undoing a routine mistake.

```bash
# 1. Stop the API so nothing writes during restore
pm2 stop airdash-api

# 2. Restore into the existing database, replacing airdash objects
docker exec -i dashy-postgres pg_restore -U dashy -d dashyden --clean --if-exists -n airdash \
  < /opt/dashy-database/backups/airdash-db-<timestamp>.dump

# 3. Start the API and verify
pm2 start airdash-api
sleep 3
curl -fsS https://air.dashydoggo.com/api/health
```

## Housekeeping

### Remove stale frontend bundles

Every build adds a new hashed bundle pair and leaves the old ones. They are harmless but accumulate. Remove bundles that are neither referenced by `site/index.html` nor by any release backup manifest you intend to keep:

```bash
cd /opt/dashy-database/projects/airdash/site/app-assets
current=$(grep -oE 'index-[^" /]+\.(js|css)' ../index.html)
for f in index-*.js index-*.css; do
  echo "$current" | grep -qx "$f" || echo "unreferenced: $f"
done
```

Review the list, then delete only files older than your oldest retained backup. Keep at least the current pair and the previous pair.

### Review the audit log

The `airdash.audit_events` table records operational decisions. Read recent entries with:

```bash
docker exec dashy-postgres psql -U dashy -d dashyden -P pager=off \
  -c "SELECT created_at, actor_discord_id, action, entity_type, entity_id FROM airdash.audit_events ORDER BY created_at DESC LIMIT 30;"
```

## Deployment checklist

Copy this list into the terminal history or a note for each release.

```text
[ ] Change classified (frontend / API / migration / static / config)
[ ] Validation sequence passed
[ ] Release backup created and path recorded
[ ] Database backup created (if migration or data change)
[ ] Published (build) or restarted (API) only what changed
[ ] Live index references new bundle (frontend)
[ ] Live bundle contains marker (frontend)
[ ] PM2 online, unstable restarts 0 (API)
[ ] Health endpoint {"ok":true,"database":true}
[ ] Visual check in browser
[ ] Documentation updated if a documented path, command, or behavior changed
```
