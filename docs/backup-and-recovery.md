# Backup and recovery

This page provides the procedures that protect airDash's state and restore it after loss: the release backup that captures what is deployed, the database backup that captures operational data, how to verify both, how to restore, and how to recover each runtime component. It also states what is not backed up and how a complete host loss would be recovered. Every command runs on the production host as the `dashy` user from `/opt/dashy-database/projects/airdash` unless stated.

## What needs protecting and where it lives

| State | Location | Recovered from | Backed up by |
|---|---|---|---|
| Source code | `api/`, `web/`, `docs/`, `scripts/`, `gsx/`, `nginx.conf` | Git, `origin` on GitHub | Every push. |
| Configuration and secrets | `api/.env` | Nothing automatic | The release backup does not include it. Keep a copy in the owner's password manager. |
| Deployed frontend | `site/index.html`, `site/app-assets/` | Rebuild from source, or the release backup | Release backup. |
| Operational data | `airdash` schema in `dashy-postgres`, volume `docker_pgdata` | Database backup | Database backup. |
| Published downloads | `site/downloads/liveries/`, `site/downloads/gsx/` | Rebuild with the livery and GSX builders from private source archives, or the publication archive | Not backed up by these procedures; `site/.publication-archive/` keeps previous livery versions. |
| Uploaded profile images | `site/downloads/profiles/` | Nothing | Not backed up by these procedures. Pilots can re-upload. |
| Static imagery | `site/assets/` | `web/public/assets/` in Git, plus any hand-placed files | Git for the tracked set. |
| Caddyfile | `/opt/dashy-database/configs/Caddyfile` | The timestamped copy made before each edit | Manual copy in the Caddy procedure. |
| PM2 process list | `/home/dashy/.pm2/dump.pm2` | `pm2 start ecosystem.config.js` then `pm2 save` | `pm2 save`. |

**Important:** `site/downloads/` and `api/.env` are the two things a fresh clone plus a database restore cannot reproduce. Include them in any host-level backup strategy.

## Release backup

Purpose: capture the exact deployed frontend and API source immediately before a deployment so that a rollback takes seconds and does not depend on Git state on the host.

When: before every frontend build, API restart, or migration.

```bash
umask 077
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/opt/dashy-database/backups/airdash-release-$timestamp"
mkdir -p "$backup/site/app-assets" "$backup/api"

cp site/index.html "$backup/site/index.html"
grep -oE '/app-assets/index-[^" ]+\.(js|css)' site/index.html | while read -r asset; do
  cp "site$asset" "$backup/site$asset"
done
cp api/src/*.js "$backup/api/"

{
  printf 'created_utc=%s\n' "$timestamp"
  printf 'git_commit=%s\n' "$(git rev-parse HEAD)"
  printf 'pm2_pid=%s\n' "$(pm2 pid airdash-api)"
  printf 'published_assets=\n'
  grep -oE '/app-assets/index-[^" ]+\.(js|css)' site/index.html
} > "$backup/MANIFEST.txt"
( cd "$backup" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS )

echo "backup=$backup"
cat "$backup/MANIFEST.txt"
```

Line by line: `umask 077` makes every new file readable only by `dashy`. `timestamp` is UTC in a sortable form. The `while read` loop copies exactly the two bundles that the live `index.html` references. `cp api/src/*.js` captures the eleven API source files as currently running (assuming the process was restarted after the last edit). The manifest records the time, the Git commit, the PM2 process ID, and the asset names. `SHA256SUMS` lets you prove later that the backup is intact.

Record the printed `backup=` path in your notes. Verify a backup at any time:

```bash
( cd /opt/dashy-database/backups/airdash-release-<timestamp> && sha256sum -c SHA256SUMS )
```

Every line must print `OK`.

Files written: one directory under `/opt/dashy-database/backups/`, a few megabytes. Nothing else changes. Rerunning creates another directory. Undo: `rm -rf` the directory.

**Note:** The release backup does not include `api/.env`, `site/downloads/`, or the database.

## Database backup

Purpose: capture the complete `airdash` schema, structure and data, in a form `pg_restore` can load selectively.

When: before any migration that is not a purely additive `IF NOT EXISTS` statement; before any hand-written `UPDATE` or `DELETE`; weekly as routine; before a smoke test on the host when the change includes a migration.

```bash
umask 077
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
docker exec dashy-postgres pg_dump -U dashy -d dashyden -n airdash -Fc \
  > "/opt/dashy-database/backups/airdash-db-$timestamp.dump"
ls -l "/opt/dashy-database/backups/airdash-db-$timestamp.dump"
```

`docker exec dashy-postgres pg_dump` runs the dump tool inside the database container, where it matches the server version. `-U dashy -d dashyden` selects the role and database. `-n airdash` limits the dump to the airDash schema so that other services' data is excluded. `-Fc` writes PostgreSQL's custom compressed format, which supports selective restore and is not human-readable. The shell redirection writes the container's stdout to a file on the host.

Expected: a file of some hundreds of kilobytes to a few megabytes, depending on how many reports and audit rows exist. A zero-byte file means the command failed; the error was printed to the terminal.

Verify without restoring:

```bash
docker exec -i dashy-postgres pg_restore --list < "/opt/dashy-database/backups/airdash-db-<timestamp>.dump" | head -40
```

`pg_restore --list` prints the table of contents: one line per schema, table, sequence, index, and constraint. Seeing the fifteen `TABLE DATA airdash <name>` entries confirms the dump contains data.

Retention: keep at least the last four weekly dumps and every dump taken before a migration until the next one. Dumps are private files; do not copy them off the host without encryption, because they contain personal data.

## Restore the database schema from a dump

**Warning:** This procedure replaces the current airDash data with the dump's contents. Every report, booking, and audit row created after the dump is lost. It exists for disaster recovery, not for undoing a routine mistake. Plan it with the owner before executing.

Prerequisites: the API stopped; the dump verified with `--list`; a fresh database backup of the current state taken first, so that the restore itself can be undone.

```bash
pm2 stop airdash-api
umask 077
docker exec dashy-postgres pg_dump -U dashy -d dashyden -n airdash -Fc > "/opt/dashy-database/backups/airdash-db-pre-restore-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker exec -i dashy-postgres pg_restore -U dashy -d dashyden --clean --if-exists -n airdash \
  < /opt/dashy-database/backups/airdash-db-<timestamp>.dump

pm2 start airdash-api
sleep 3
curl -fsS https://air.dashydoggo.com/api/health
docker exec dashy-postgres psql -U dashy -d dashyden -Atc "SELECT COUNT(*) FROM airdash.pireps;"
```

`--clean` drops each object before recreating it; `--if-exists` suppresses errors for objects that do not exist; `-n airdash` restricts the restore to the schema. `pg_restore` may print warnings about objects that already exist or about ownership; read them, but they do not indicate data loss. The API's `migrate()` runs at start and reapplies any schema statement newer than the dump, which is safe because every statement is idempotent.

To restore a single table instead of the schema, add `-t airdash.<table>` and omit `--clean`, then reconcile foreign keys by hand; this requires understanding the [data model](data-model.md) and is not a routine operation.

## Recover the PM2 process

Symptom: `pm2 list` does not show `airdash-api`, or it shows `stopped` after a reboot.

```bash
cd /opt/dashy-database/projects/airdash/api
pm2 start ecosystem.config.js
pm2 save
cd ..
pm2 show airdash-api | grep -E 'status|unstable'
systemctl is-enabled pm2-dashy
systemctl is-active pm2-dashy
```

`pm2 start ecosystem.config.js` reads the process definition (name, script, working directory, `PORT`). `pm2 save` writes the running list to `/home/dashy/.pm2/dump.pm2`, which `pm2-dashy.service` resurrects at boot. Both `systemctl` commands must print `enabled` and `active`; if not, `sudo systemctl enable --now pm2-dashy`.

If the process exists but is `stopped`, `pm2 start airdash-api` is sufficient. If it is `errored`, read the log first ([debugging](debugging.md#api-exits-at-startup)), fix the cause, then `pm2 restart airdash-api`.

## Recover the static site container

Symptom: `docker ps` does not list `dashy-airdash`, or the site returns `502` while the API is healthy.

`dashy-airdash` is not defined in any Compose file. Recreate it with the exact settings it uses today, which were confirmed with `docker inspect` on September 10, 2026:

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

The container publishes no host port. Caddy reaches it by name over the `docker_web` network, which is why `--network docker_web` is required. Both mounts are read-only so that the container cannot alter the site. Data risk: none; the container holds no state.

## Recover the database container

Symptom: `docker ps` shows `dashy-postgres` as exited, or `pg_isready` fails.

```bash
docker start dashy-postgres
docker exec dashy-postgres pg_isready -U dashy
pm2 show airdash-api | grep -E 'status'
pm2 restart airdash-api
curl -fsS https://air.dashydoggo.com/api/health
```

The data lives in the Docker volume `docker_pgdata`, so starting the container loses nothing. The API restart is required because a database outage crashes the API process and may leave PM2 in `errored` state ([debugging](debugging.md#database-unavailable)). If the container will not start, read `docker logs dashy-postgres`; a corrupted data directory is the case for the dump restore above, planned with the owner.

**Warning:** `dashy-postgres` serves other homelab services. Restarting it affects all of them. Do not restart it without the owner.

## Recover the Caddy configuration

If a Caddyfile edit broke routing, copy the most recent timestamped backup over the file and reload:

```bash
ls -t /opt/dashy-database/backups/Caddyfile-* | head -3
cp /opt/dashy-database/backups/Caddyfile-<timestamp> /opt/dashy-database/configs/Caddyfile
docker exec dashy-caddy caddy validate --config /etc/caddy/Caddyfile
docker exec dashy-caddy caddy reload --config /etc/caddy/Caddyfile
```

## Recover the deployed frontend

Use the [frontend rollback](deployment.md#roll-back-the-frontend) with a release backup, or rebuild from the correct commit with `git checkout <commit> && npm --prefix web ci && npm --prefix web run build`. A rebuild reproduces byte-identical bundles for the same source and dependency versions; this was confirmed on the evening of September 10, 2026, when an isolated build of commit `5f2e27c` produced the same hashes (`index-Dg7CDhf-.js`, `index-BFsZchn3.css`) that the live site referenced at that time. Later the same evening the site was rebuilt from uncommitted working-tree changes and now references different hashes, which is expected: the hash follows the source.

## Recover uploaded profile images

There is no backup. If `site/downloads/profiles/` is lost, `pilots.profile_image_url` still points at the missing files and the browser shows a broken image until each pilot re-uploads. To clear the dangling references so that the Discord avatar is shown instead, an owner-planned `UPDATE airdash.pilots SET profile_image_url=NULL WHERE profile_image_url LIKE '/downloads/profiles/%'` after a database backup is the remedy.

## Recover published downloads

Livery packages are built by `scripts/build-msfs2020-liveries.py` (MSFS 2020) and by an MSFS 2024 process from private source archives that are not in the repository. `site/.publication-archive/` keeps the previous version of each published package. The `aircraft` table records each package's SHA-256, so a recovered file can be verified with `sha256sum` against `SELECT registration, livery_sha256, livery_msfs2020_sha256 FROM airdash.aircraft`. The GSX package is rebuilt from `gsx/` with `python3 build.py` inside the package directory followed by zipping, and its hash is recorded in `site/downloads/gsx/SHA256SUMS.txt`. Recovering downloads requires the owner's private archives and is not a routine procedure.

## Disaster recovery: complete host loss

Order of operations to rebuild on a new host. Each step names its prerequisite.

1. Install the tools per [installation](installation.md) and Docker, PM2, and Caddy per the homelab's own procedures (outside this repository).
2. Clone the repository to `/opt/dashy-database/projects/airdash` and check out the release branch. Run `npm --prefix api ci` and `npm --prefix web ci`.
3. Recreate `api/.env` from the owner's password manager. Without it, the API cannot reach the database and push subscriptions cannot be served.
4. Start PostgreSQL with the `docker_pgdata` volume if it survived, or create an empty database and restore the latest `airdash-db-*.dump` with the procedure above.
5. Start the API with `pm2 start api/ecosystem.config.js` and `pm2 save`; `migrate()` brings the schema current.
6. Build the frontend with `npm --prefix web run build`.
7. Restore `site/downloads/` from the host backup, if any; otherwise rebuild packages.
8. Recreate `dashy-airdash` with the procedure above, and configure the Caddy block as shown in [configuration](configuration.md#caddyfile).
9. Run the [health checks](operations.md#health-checks).

Recovery point: the latest database dump plus whatever is in Git. Recovery time: an hour or two of operator work, dominated by tool installation and download restoration. Neither figure is a commitment; they describe what the procedures allow.

## Verification of the backup procedures

While writing this page, the following were performed against a scratch PostgreSQL 16 container populated by `migrate()`: `pg_dump -n airdash -Fc` produced a 52 kB dump; `pg_restore --list` showed fifteen `TABLE DATA airdash` entries; and `pg_restore --clean --if-exists -n airdash` restored the dump into the same scratch database with exit code 0, after which the route count (102) and table count (15) were unchanged. The release backup script's commands were reviewed against the live `site/index.html` structure, and `docker inspect dashy-airdash` confirmed the mounts, network, and restart policy in the container recreation command. The schema restore and the PM2 recovery were not executed against production, because both interrupt service; their commands match the ones exercised on the scratch database and the ones recorded as used in the previous operations guide.
