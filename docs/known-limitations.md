# Known limitations

This page records every constraint, defect, technical debt item, and unresolved contradiction that was verified while documenting airDash at commit `5f2e27c`. Each entry states what is true, why it matters, what to do about it today, and what change would remove it. Entries are grouped by the area they affect. An item leaves this page only when a merged change removes it and the documentation is updated.

## Development environment

### Vite development proxy does not strip the `/api` prefix

`web/vite.config.ts` uses the string shorthand `"/api": "http://127.0.0.1:3006"`, which forwards `/api/health` to the API as `/api/health`. The API defines `/health`. Every API call from the development server therefore returns `404 Cannot GET /api/...`. Verified on September 10, 2026: through the proxy the request returned 404; directly to port 3006 it returned 200; with a `rewrite` added to the proxy it returned 200 through the proxy.

Consequence: the development server cannot load data as committed. Today: apply the `rewrite` locally without committing it, as described in [local development](local-development.md#the-proxy-does-not-remove-the-api-prefix). Remedy: change the proxy entry to `{ target: "http://127.0.0.1:3006", rewrite: path => path.replace(/^\/api/, "") }` in its own pull request. This is a one-line source change and was not made by the documentation work because that work was authorized to change documentation only.

### The development server binds to IPv6 localhost

Vite binds `localhost`, which resolved to `[::1]` on the production host, so `127.0.0.1:5174` refuses connections. Use `http://localhost:5174/`. Not a defect; recorded because it costs beginners time.

### Only port 5174 is an allowed origin

`requireAirDashOrigin` accepts `http://localhost:5174` and the production origin only. A development server on any other port cannot perform mutations. This is deliberate; run Vite on its default port.

### No local end-to-end sign-in

Real Discord sign-in works only for the production domain. Local development uses the mock authentication service, which trusts every cookie. It must never be exposed beyond the loopback interface.

## Reliability

### A database restart crashes the API process

`api/src/database.js` creates the `pg` pool without an `error` event handler. When PostgreSQL terminates connections while any pooled connection is idle, the pool emits `error`, Node.js treats it as unhandled, and the process exits. Verified locally: stopping the database printed `error: terminating connection due to administrator command` and the process exited within two seconds. Under PM2 the process restarts, but each restart fails fast while the database is down, and PM2's limit for this process is 10 restarts, after which it stops trying and reports `errored`.

Consequence: a database outage of more than a few seconds can leave the API stopped after the database returns. Today: after any database restart, check `pm2 show airdash-api` and run `pm2 restart airdash-api` if needed ([debugging](debugging.md#database-unavailable)). Remedy: add `pool.on("error", error => console.error("[airdash-db]", error.message))` in `database.js` so idle-connection errors are logged instead of fatal, and consider `exp_backoff_restart_delay` in `ecosystem.config.js`.

### Background jobs fail silently

The expiry and schedule timers discard errors (`catch(() => {})`), and no job logs success. A broken job is visible only through its missing effects. See [operations](operations.md#background-jobs) for the verification queries. Remedy: log job failures with a prefix.

### Schedule generation runs before the migration on a fresh database

`ensureSchedule()` is called at module load, before `await migrate()`. On a fresh database it fails silently because the tables do not exist; the ten-minute timer and the `/schedule` route repair it shortly after. Harmless in practice; recorded because the ordering is a historical accident rather than intent.

### Application and report decision routes return before rollback on 404

In `POST /admin/applications/:id/:decision` and `POST /admin/pireps/:id/:decision`, the "not found" branch returns without `ROLLBACK`, leaving the transaction open until `client.release()` returns the client to the pool, which ends it. No incorrect data results; it is untidy and should be a `ROLLBACK` before the return.

### No request rate limiting

The API applies no per-client rate limits. Protection comes from Caddy, from the small user base, and from size and timeout limits on outbound calls. A hostile client could issue many `GET /pilots` requests, each computing streaks per pilot. Remedy: a rate-limiting middleware, or Caddy rate limiting.

### Single instance, no horizontal scaling

One API process, one Nginx container, one PostgreSQL instance. Background jobs and the deterministic schedule assume a single process; profile images are written to the local filesystem. See [architecture](architecture.md#scaling-model). Adequate for the current user base; recorded so nobody adds a second instance casually.

## Data and schema

### Migrations are idempotent but not versioned or reversible

`migrate()` re-executes every statement in file order on each start. There is no record of what ran when, no down migration, and the whole run is not one transaction. A constraint that existing rows violate stops startup. See [data model](data-model.md#migration-behavior). Today: back up before any non-additive change; test on a fresh database twice. Remedy: a numbered migration directory with a tracking table.

### Growing tables have no retention

`audit_events` and `notification_history` grow without bound. Neither is large today. Remedy: a retention policy, for example deleting read notifications older than 90 days.

### `credited_minutes` stores experience points

The column name predates the experience system; it holds total experience, while `credited_block_minutes` holds minutes. Renaming would require a data migration; the [data model](data-model.md#pireps) documents the meaning instead.

### Some allowed status values are never used

`applications.status='UNDER_REVIEW'`, `aircraft.status` `PLANNED` and `INACTIVE`, and `schedule.status='COMPLETED'` are permitted by constraints but never written by current code. `push_subscriptions.disabled_at` is never set. They are harmless and are listed in the [glossary](glossary.md#status-values).

### Seeded routes cannot be edited by re-seeding

Route seeds use `ON CONFLICT (flight_number) DO NOTHING`, so changing a seeded tuple's block time or days has no effect on an existing row. An explicit `UPDATE` after a backup is required. See [change recipes](change-recipes.md#add-or-edit-a-route-flight).

### `assignments.source` and `org_updates.kind` are not constrained by the database

The API validates them against allow-lists, but the columns accept any text. A `CHECK` constraint would add defense in depth.

## Frontend

### The application is concentrated in one file

`web/src/App.tsx` is 1,561 lines and contains the shell, shared components, and thirteen pages. Extraction has begun (`News.tsx`, `HomeMedia.tsx`, `AdvancedNetworkMap.tsx`). Consequence: higher merge-conflict and regression risk. Remedy: continue extracting one page or shared component per pull request, preserving behavior.

### One bundle, no code splitting

The production build emits a single 737 kB JavaScript chunk (216 kB gzipped) and Vite warns that it exceeds 500 kB. First load is slower than it needs to be. Remedy: dynamic `import()` for the map and administration pages.

### Legacy notification helpers are dead code

`web/src/notificationState.ts` exports `notificationRecordKey`, `notificationRecordKeys`, and `filterDismissedNotifications` from the former browser-local dismissal model. Only the type exports are used. Remove them.

### Several `any` types

`LiveMap`, `Schedule`, `Profile`, and parts of `Admin` read API responses as `any`, so the type check cannot catch field renames there. Remedy: add interfaces to `types.ts` and use them.

### Schedule booking exists in the API but not in the interface

`POST /assignments` accepts `scheduleId` and `source='SCHEDULE'`, but the Schedule page is read-only and never sends them. Either a booking control should be added or the API parameters documented as reserved; currently the [API reference](api-reference.md#post-assignments) documents them as accepted.

### `POST /assignments/:id/gates` ignores occupancy

Regenerating both gates uses a time-based seed and does not exclude gates occupied by other active assignments, unlike the single-gate reassignment routes and the booking path. Two assignments could share a gate after regeneration. Remedy: pass occupied gates to `generateGates`.

### A CARTO basemap key is embedded in the frontend

`App.tsx` and `AdvancedNetworkMap.tsx` include a CARTO tile key in the tile URL. It is delivered to every visitor and is inherently public; it authorizes tile requests only. If CARTO usage limits are exceeded by third parties reusing it, the maps degrade. Remedy: a key restricted by referrer in the CARTO console, or a proxy.

### No automated accessibility audit

The interface uses semantic elements, labels, and reduced-motion support, but no tool such as axe or Lighthouse has been run and no screen reader testing is recorded.

## Security

### `X-Powered-By: Express` is sent

Express discloses itself in a response header. `app.disable("x-powered-by")` removes it.

### No Content-Security-Policy header

The frontend loads third-party fonts, tiles, and pilot-supplied image URLs, so a policy requires an allow-list. None is set today.

### Public profile visibility has no opt-out interface

`pilots.public_profile_enabled` defaults to true and no page changes it. Pilots appear on the public home page and in `/public` unless the owner changes the column by SQL.

### Volanta consent is recorded but not optional

Every booking sets `volanta_tracking_consent=TRUE`; the interface offers no alternative because a Volanta record is required to file a report. The column documents intent rather than a choice.

### Bindings reachable on the local network

The API listens on `0.0.0.0:3006` and PostgreSQL publishes `0.0.0.0:5432`. Host firewall rules were not audited by the documentation work. See [security](security.md#known-assumptions).

## Process

### No staging environment and no continuous integration

Production is the only environment with real data, and no service runs the tests automatically. Validation is manual and recorded in pull requests. See [testing](testing.md#continuous-integration) and [releases](releases.md).

### Route handlers and the frontend have no automated tests

Unit tests cover the pure modules only. Everything else relies on the smoke test and visual checks.

### No branch protection on the release branch

GitHub reports no protection rules for `release/airdash-platform-20260910`. The pull request workflow in [contributing](contributing.md) is a convention, not an enforcement.

### No license

The repository is public but contains no license file. All rights remain with the owner by default, and reuse is not permitted. Adding a license is the owner's decision.

### Git history does not cover the platform's evolution

The repository has two commits dated September 10, 2026. Everything before that was developed without version control. Earlier release backups under `/opt/dashy-database/backups/` are the only record of prior states.

### Windows automation is not testable from the host

The PowerShell exporter requires an interactive Windows desktop session with PowerPoint. From Linux only the parse check and `-DryRun` are possible.

### Downloads and profile images are outside every documented backup

`site/downloads/` and `api/.env` are not captured by the release backup or the database dump. See [backup and recovery](backup-and-recovery.md#what-needs-protecting-and-where-it-lives).

## Documentation

### Concurrent edits on the production working tree

While this documentation was written, uncommitted edits to `web/src/App.tsx`, `web/src/HomeMedia.tsx`, `web/src/styles.css`, `web/src/types.ts`, and `api/src/server.js`, plus a new `web/public/assets/home-showcase/screenshot-10.webp`, appeared in the production working tree from other work in progress, and production was rebuilt and restarted from that uncommitted state at about 22:10 on September 10, 2026 (PM2 restart count 62 to 63; new bundle hashes in `site/index.html`). Production therefore ran code that was not on any branch at that moment. This documentation describes commit `5f2e27c` and does not include those changes. When they are committed, the [maintenance triggers](README.md#maintenance-triggers) apply: `HomeMedia.tsx` shows ten screenshots, `/public` gains `favorite_flight_count` and `favorite_pilot` per aircraft, and `/me`, `/profile`, and `/pilots/:id` gain a `flightStats` object. The [deployment](deployment.md#get-the-code-onto-the-host) procedure requires a clean working tree precisely so that this situation does not recur.

### What the documentation work could not validate

Recorded in the [coverage map](coverage-map.md#validation-record): the production database restore, PM2 recovery, and Caddy reload were not executed because they interrupt service; the macOS and Windows installation commands were not run because no such machine was available; the Windows automation was not run.
