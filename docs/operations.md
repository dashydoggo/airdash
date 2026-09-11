# Operations

This page describes how to observe, maintain, and diagnose the production airDash system day to day. It covers health checks, process and container state, logs, verification of the background jobs, audit review, housekeeping, capacity, and the current state of metrics and alerting. Procedures that change or restore production are in [deployment](deployment.md) and [backup and recovery](backup-and-recovery.md); symptom-driven troubleshooting is in [debugging](debugging.md).

All commands run on the production host as the `dashy` user from `/opt/dashy-database/projects/airdash` unless stated. Every command in the "Health checks" and "Logs" sections is read-only.

## Runtime components

| Component | Managed by | Check with | Restart with |
|---|---|---|---|
| API `airdash-api` | PM2, resurrected at boot by `pm2-dashy.service` | `pm2 show airdash-api` | `pm2 restart airdash-api` |
| Static site `dashy-airdash` | Docker, `restart: unless-stopped` | `docker ps --filter name=dashy-airdash` | `docker restart dashy-airdash` (rarely needed; a reload suffices for config) |
| Edge `dashy-caddy` | Docker | `docker ps --filter name=dashy-caddy` | Shared; do not restart without the owner |
| Database `dashy-postgres` | Docker | `docker exec dashy-postgres pg_isready -U dashy` | Shared; do not restart without the owner |
| Auth service `dashydex` | PM2 (Discord bot project) | `pm2 show dashydex` | Shared; `pm2 restart dashydex` only with the owner |
| PM2 daemon | systemd `pm2-dashy.service` | `systemctl is-active pm2-dashy` | `systemctl restart pm2-dashy` restarts every PM2 process; avoid |

## Health checks

Run these at the start of any session and after any change.

```bash
curl -fsS https://air.dashydoggo.com/api/health
curl -fsS -o /dev/null -w 'site %{http_code}\n' https://air.dashydoggo.com/
pm2 show airdash-api | grep -E 'status|restarts|unstable|uptime'
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'dashy-(airdash|postgres|caddy)'
systemctl is-enabled pm2-dashy && systemctl is-active pm2-dashy
grep -oE '/app-assets/index-[^" ]+\.(js|css)' site/index.html
git status --porcelain && git log --oneline -1
```

Expected: `{"ok":true,"database":true}`; `site 200`; `status │ online` with `unstable restarts │ 0`; three `Up` containers; `enabled` and `active`; two bundle names; an empty status line and the deployed commit. A non-empty `git status` means the host has uncommitted changes, which must be reconciled with GitHub before the next deployment.

`restarts` in PM2 counts every restart including deliberate ones; it was 62 on September 10, 2026 after many deployments, which is normal. `unstable restarts` counts crashes shortly after start and should be zero.

## Logs

| Component | Live | Files |
|---|---|---|
| API stdout and stderr | `pm2 logs airdash-api --nostream --lines 100` | `/home/dashy/.pm2/logs/airdash-api-out.log`, `/home/dashy/.pm2/logs/airdash-api-error.log` |
| Nginx access and errors | `docker logs --tail 100 dashy-airdash` | Docker's JSON log driver |
| Caddy | `docker logs --tail 100 dashy-caddy` | Docker |
| PostgreSQL | `docker logs --tail 100 dashy-postgres` | Docker |
| Auth service | `pm2 logs dashydex --nostream --lines 50` | `/home/dashy/.pm2/logs/dashydex-*.log` |

What the API logs, and what each line means:

| Line | Meaning |
|---|---|
| `[airdash-api] listening on 0.0.0.0:3006` | Startup completed. One per start. |
| `[airdash-api] repaired gates for N active assignments` | Startup found active assignments without gates and assigned them. |
| `[airdash-api] assigned parking gates for N aircraft` | Startup found aircraft without `current_gate`. |
| `[airdash-push] VAPID keys are not configured; background push is disabled` | Push is off; check `api/.env`. |
| `[airdash-push] polling failed <message>` | The push worker's poll threw; it retries next minute. |
| `[airdash-notifications] pilot sync failed <message>` or `owner sync failed` | A `/notifications` request failed; the client sees `500`. |
| `[airdash:pirep] { user, assignmentId, status, message }` | A report submission failed; status and message explain why. |
| `Warning: The 'NO_COLOR' env is ignored ...` | Host environment noise. |
| Any stack trace | An unexpected error; see [debugging](debugging.md). |

The API does not log successful requests. Nginx logs every static request; Caddy logs at its configured level. There is no log aggregation and no log rotation configured for PM2 beyond PM2's defaults; check file sizes occasionally with `ls -lh ~/.pm2/logs/`.

## Background jobs

Three in-process jobs run inside `airdash-api` and only while it is online. They produce no log lines on success, so verify them through their effects.

| Job | Interval | Verify |
|---|---|---|
| Assignment expiry | 5 min | `SELECT MAX(created_at) FROM airdash.audit_events WHERE action IN ('ASSIGNMENT_EXPIRED','AIRCRAFT_RELEASED_FROM_HOLD');` should be recent if any assignment or hold has expired. Also `SELECT COUNT(*) FROM airdash.assignments WHERE status IN ('BOOKED','ACTIVE') AND expires_at < NOW() - INTERVAL '10 minutes';` should be `0`. |
| Schedule maintenance | 10 min, plus on `/schedule` | `SELECT MAX(dep_time) FROM airdash.schedule;` should be tomorrow; `SELECT COUNT(*) FROM airdash.schedule WHERE status='DEPARTED' AND dep_time < NOW() - INTERVAL '7 hours';` should be `0`. |
| Push delivery | 60 s | `SELECT COUNT(*) FROM airdash.notification_history WHERE pushed_at IS NULL AND discord_id IN (SELECT discord_id FROM airdash.push_subscriptions);` should be small; `SELECT MAX(last_success_at) FROM airdash.push_subscriptions;` should be recent when notifications occurred. |

Run queries through `docker exec dashy-postgres psql -U dashy -d dashyden -Atc "<sql>"`.

If a job is not producing effects and the process is online, restart the API; the timers are created at startup and have no other recovery path. If the process restarted recently, the first push poll happens five seconds after start and the first schedule run happens at start.

## Audit review

The `airdash.audit_events` table is the operational record. Review it after any incident and periodically.

```bash
docker exec dashy-postgres psql -U dashy -d dashyden -P pager=off -c \
  "SELECT created_at, actor_discord_id, action, entity_type, entity_id FROM airdash.audit_events ORDER BY created_at DESC LIMIT 30;"
```

Useful filters: `WHERE actor_discord_id IS NULL` for system actions; `WHERE action LIKE 'PIREP_%'` for report decisions; `WHERE entity_type='aircraft'` for fleet changes; `WHERE created_at > NOW() - INTERVAL '1 day'`. The Administration Audit tab shows the latest 500 with actor names.

## Routine maintenance

| Task | Frequency | Procedure |
|---|---|---|
| Health checks | Each session and after each change | Above. |
| Database backup | Before every migration or data change; weekly otherwise | [Database backup](backup-and-recovery.md#database-backup). |
| Verify PM2 persistence | After any `pm2 start` or `pm2 delete` | `pm2 save`, then `systemctl is-enabled pm2-dashy`. Without `pm2 save`, a reboot resurrects the previous process list. |
| Dependency audit | Before each release | `npm --prefix api audit` and `npm --prefix web audit`. Both reported `found 0 vulnerabilities` on September 10, 2026. |
| Remove stale frontend bundles | Monthly or when `site/app-assets/` exceeds a few hundred files | Below. |
| Check disk | Monthly | `df -h /opt /var/lib/docker` and `du -sh site/ /opt/dashy-database/backups/`. |
| Review growing tables | Quarterly | `SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname='airdash' ORDER BY n_live_tup DESC;`. `audit_events` and `notification_history` have no retention and grow without bound; plan a retention policy when they matter. |
| Confirm the auth service | With each health check | `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3002/auth/me` returns `200`. |
| Renewals | None | Caddy renews TLS certificates automatically. No domain, key, or token in this project expires. |

### Remove stale frontend bundles

Every build adds a hashed JavaScript and CSS pair and leaves the old ones. On September 10, 2026 `site/app-assets/` held 246 files. They are harmless but accumulate. List the unreferenced ones:

```bash
cd site/app-assets
current=$(grep -oE 'index-[^" /]+\.(js|css)' ../index.html)
for f in index-*.js index-*.css; do
  echo "$current" | grep -qx "$f" || echo "unreferenced: $f"
done
cd ../..
```

Review the list and delete only files that are older than the oldest release backup you intend to keep, so that every retained backup's `MANIFEST.txt` still points at existing files. Keep at least the current pair and the previous pair. Deletion is `rm site/app-assets/index-<hash>.js`; it is irreversible except from a backup.

## Capacity and performance

The system serves a few dozen pilots. Observed characteristics at this commit:

- The frontend bundle is 737 kB of JavaScript (216 kB gzipped) and 148 kB of CSS (31 kB gzipped) in one chunk. First load on a slow connection is the main performance cost; there is no code splitting.
- `GET /public` and `GET /me` run six or more queries each and are called on every page load. `GET /pilots` computes streaks per pilot with one query each. None has been a bottleneck at this scale.
- `GET /notifications` performs seven queries plus one insert per new record, every 60 seconds per signed-in browser.
- The `pg` pool uses the library default of 10 connections. PostgreSQL's default `max_connections` is 100 and is shared with other services on the host.
- The API is a single process on a single core. Node.js is single-threaded for JavaScript; long synchronous work would block every request. The code has no such work.

Scaling options are described in [architecture](architecture.md#scaling-model). There is nothing to tune in the current configuration; if latency becomes a concern, measure first with `curl -w '%{time_total}\n'` against specific routes.

## Metrics, traces, and alerts

There are none. The API exposes no metrics endpoint, emits no traces, and nothing pages anyone. The health endpoint is the only machine-readable signal, and it is polled by nobody except humans. Adding an external uptime monitor that requests `https://air.dashydoggo.com/api/health` every minute and notifies the owner on failure would be the simplest improvement; it requires no code change. This gap is recorded in [known limitations](known-limitations.md).

## Incident diagnosis

When something is wrong and the cause is unknown, work through this order. Each step is read-only.

1. Health checks above. Note which fail.
2. If the API health fails: `pm2 show airdash-api`, then `pm2 logs airdash-api --nostream --lines 80`. Match the log against [debugging](debugging.md#api-exits-at-startup).
3. If the database check fails: `docker exec dashy-postgres pg_isready -U dashy` and `docker logs --tail 50 dashy-postgres`. Remember that a database restart crashes the API process ([debugging](debugging.md#database-unavailable)).
4. If the site returns non-200: `docker logs --tail 50 dashy-airdash` and `docker logs --tail 50 dashy-caddy`.
5. If sign-in fails for everyone: `pm2 show dashydex` and `curl -s http://127.0.0.1:3002/auth/me`.
6. If one feature fails: reproduce with `curl` against `http://127.0.0.1:3006/<route>` and read the response body; the API returns readable error messages listed in the [API reference](api-reference.md).
7. Check what changed: `git log --oneline -5`, `ls -lt site/app-assets | head`, `ls -lt /opt/dashy-database/backups | head`, and the audit log for the last hour.
8. Record what you found before acting. Then apply the corrective action from [debugging](debugging.md), or if it involves a shared component or destructive step, involve the owner.

## Shutdown and startup of the whole system

Planned host maintenance:

1. Announce downtime to pilots through an organization update.
2. `pm2 stop airdash-api` stops the API gracefully (in-flight queries finish).
3. Containers stop with the Docker daemon or with `docker stop`; do not stop `dashy-postgres` or `dashy-caddy` without the owner because other services depend on them.
4. After the host restarts, systemd starts Docker (containers with `unless-stopped` return) and `pm2-dashy.service` resurrects the saved PM2 list, including `airdash-api` if `pm2 save` was run after it was last started. Confirm with the health checks.

If `airdash-api` does not return after a reboot, follow [recover the PM2 process](backup-and-recovery.md#recover-the-pm2-process).
