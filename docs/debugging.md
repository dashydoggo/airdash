# Debugging and troubleshooting

This page is organized by what you observe, not by component. Find the symptom, run the diagnostic procedure, compare the result to the expected diagnostics, and apply the corrective action. Each entry states the data-loss or security implications and when to stop and escalate to the owner. Commands run from the repository root unless stated; production commands run on the production host as the `dashy` user.

Where an entry says "read the API log", the commands are `pm2 logs airdash-api --nostream --lines 80` on production, or the terminal where you started `node src/server.js` locally. Normal log noise consists of `Warning: The 'NO_COLOR' env is ignored` lines and `[airdash-api] listening on 0.0.0.0:3006` after each start.

## Symptom index

| You observe | Go to |
|---|---|
| `curl` to `/api/health` fails to connect or returns `502` | [API unreachable](#api-unreachable) |
| `/api/health` returns `{"ok":false,"database":false}` | [Database unavailable](#database-unavailable) |
| PM2 shows `errored`, `stopped`, or rising `unstable restarts` | [API exits at startup](#api-exits-at-startup) |
| Page loads but shows "AirDash data is temporarily unavailable" | [API unreachable](#api-unreachable) or [Database unavailable](#database-unavailable) |
| Signed in on dashydoggo.com but airDash shows "sign in" | [Session not recognized](#session-not-recognized) |
| Actions fail with "Invalid request origin" | [Origin rejected](#origin-rejected) |
| Actions fail with "Discord sign-in required" or "Owner access required" | [Session not recognized](#session-not-recognized) |
| Vite development server pages show no data; network tab shows `404` for `/api/...` | [Development proxy returns 404](#development-proxy-returns-404) |
| `localhost:5174` refuses connection or `127.0.0.1:5174` fails | [Development server not reachable](#development-server-not-reachable) |
| After a frontend build the site still shows old content | [Old frontend after build](#old-frontend-after-build) |
| Type check prints `error TS...` | [TypeScript errors](#typescript-errors) |
| Isolated build fails with `Could not resolve entry module "index.html"` | [Build run from the wrong directory](#build-run-from-the-wrong-directory) |
| `npm ci` fails | [Installation failures](installation.md#common-failures) |
| Booking fails with a `409` message | [Booking conflicts](#booking-conflicts) |
| SimBrief import or fetch rejected | [SimBrief rejections](#simbrief-rejections) |
| Pilot report rejected before submission | [Volanta and report rejections](#volanta-and-report-rejections) |
| Notification does not appear, or appears again | [Notification behavior](#notification-behavior) |
| Push notifications never arrive | [Push not delivered](#push-not-delivered) |
| Aircraft stuck in `ASSIGNED`, `INSPECTION`, or `MAINTENANCE` | [Aircraft stuck](#aircraft-stuck) |
| Schedule page empty or stale | [Schedule empty](#schedule-empty) |
| Migration fails | [Migration failure](#migration-failure) |
| `EADDRINUSE` when starting something | [Port already in use](#port-already-in-use) |
| Profile image upload fails | [Profile image upload fails](#profile-image-upload-fails) |
| PowerPoint export or launcher fails | [powerpoint-automation.md](powerpoint-automation.md#troubleshooting) |

## API unreachable

**Symptom.** `curl -fsS https://air.dashydoggo.com/api/health` prints `curl: (22) The requested URL returned error: 502` or hangs; the browser shows the boot logo then "AirDash data is temporarily unavailable".

**Likely causes, in order.** The API process is not running; the API is running on a different port than Caddy forwards to; Caddy is down; the host is down.

**Diagnose (production).**

```bash
pm2 show airdash-api | grep -E 'status|restarts|unstable|uptime'
ss -ltnp | grep ':3006'
docker ps --format '{{.Names}} {{.Status}}' | grep -E 'dashy-(caddy|airdash)'
curl -fsS http://127.0.0.1:3006/health
```

**Expected when healthy.** `status │ online`, a `LISTEN` line on `0.0.0.0:3006` owned by `node`, both containers `Up`, and `{"ok":true,"database":true}` from the direct call.

**Interpretation.** Direct call succeeds but the public URL fails: Caddy or its configuration. Direct call fails and PM2 says `online`: the process is listening elsewhere or hung; check `PORT` in `api/.env` and the Caddyfile. PM2 says `errored` or `stopped`: see [API exits at startup](#api-exits-at-startup). Process missing from `pm2 list`: [recover the PM2 process](backup-and-recovery.md#recover-the-pm2-process).

**Correct.** For a stopped process, `pm2 start airdash-api`. For Caddy, `docker start dashy-caddy` if it is down; if it is up, `docker logs --tail 50 dashy-caddy`.

**Verify.** The health command returns `{"ok":true,"database":true}` and `pm2 show` reports `unstable restarts │ 0`.

**Risk.** None from diagnosis. `pm2 start` has no data risk. Restarting Caddy interrupts every dashydoggo.com service; do not restart it without the owner's agreement.

## Database unavailable

**Symptom.** `/api/health` returns `503 {"ok":false,"database":false}` or fails to connect; the log shows `ECONNREFUSED 127.0.0.1:5432`, `password authentication failed`, or `error: terminating connection due to administrator command` followed by `Unhandled 'error' event`; PM2 shows restarts.

**Likely causes.** The PostgreSQL container is stopped or was restarted; `DATABASE_URL` is wrong after an edit; the database is out of connections or disk.

**How the API behaves.** The `pg` connection pool in `api/src/database.js` has no `error` event handler. When PostgreSQL terminates connections while any pooled connection is idle, the pool emits `error`, Node.js treats it as unhandled, and the process exits. This was verified while writing this page: with a local API running, stopping the database produced `error: terminating connection due to administrator command` and the process exited within two seconds; `/health` then refused connections rather than returning `503`. The `503` response occurs only when a query fails on a connection that is being newly established, for example when the database is down at the moment `/health` runs and no idle connection existed to crash the process first.

Under PM2 the exit is followed by an automatic restart. Startup calls `migrate()`, which fails immediately while the database is down, so each restart is counted as unstable. PM2 reports `max_restarts` of 10 for this process with the default minimum uptime of one second; PM2's documented behavior is to stop restarting and mark the process `errored` once that limit is exceeded. The consequence is that a database outage longer than a few seconds can leave the API stopped even after the database returns, and an operator must start it by hand. This PM2 limit behavior is taken from PM2's documentation and the process configuration; it was not provoked on production.

**Diagnose.**

```bash
docker ps --filter name=dashy-postgres --format '{{.Names}} {{.Status}}'
docker exec dashy-postgres pg_isready -U dashy
docker logs --tail 50 dashy-postgres
pm2 show airdash-api | grep -E 'status|restarts|unstable'
pm2 logs airdash-api --nostream --lines 40 | grep -iE 'econnrefused|terminating|authentication|too many|unhandled'
```

**Expected when healthy.** `Up`, `accepting connections`, no repeated errors, `status │ online`.

**Correct.** Container down: `docker start dashy-postgres`, wait for `pg_isready`, then check `pm2 show airdash-api`; if the status is `errored` or `stopped`, run `pm2 restart airdash-api`. Wrong credentials: fix `api/.env` and `pm2 restart airdash-api`. Locally, start your container or service, confirm `DATABASE_URL`, and start the API again.

**Verify.** `/api/health` returns `{"ok":true,"database":true}` and `pm2 show airdash-api` reports `online`.

**Risk.** Starting the container has no data risk. Never delete the `docker_pgdata` volume. If the container will not start because of disk or corruption, stop and escalate; the [restore procedure](backup-and-recovery.md#restore-the-database-schema-from-a-dump) is destructive. Adding a `pool.on("error", ...)` handler in `database.js` would prevent the crash; that is a source change recorded in [known limitations](known-limitations.md#a-database-restart-crashes-the-api-process).

## API exits at startup

**Symptom.** `pm2 show airdash-api` shows `status │ errored` or `unstable restarts` greater than zero and rising; the log repeats a stack trace between `listening` lines; locally, `node src/server.js` prints an error and returns to the prompt.

**Likely causes, in order.** A migration statement fails (syntax error in SQL, or a new `CHECK` constraint that existing rows violate); the database is unreachable; a JavaScript syntax error; invalid `VAPID_*` values; an invalid `PORT`.

**Diagnose.**

```bash
pm2 logs airdash-api --nostream --lines 80
npm --prefix api run check
docker exec dashy-postgres pg_isready -U dashy
```

**Expected diagnostics and meaning.**

| Log content | Meaning |
|---|---|
| `error: syntax error at or near ...` with a position | SQL syntax error in `database.js`. |
| `error: check constraint "..." of relation "..." is violated by some row` | A new or changed constraint conflicts with existing data. |
| `error: column "..." does not exist` | A statement references a column added later in the file, or a typo. |
| `ECONNREFUSED` | Database down; see above. |
| `SyntaxError: Unexpected token` with a `.js` path | JavaScript syntax error; `npm run check` reports the file. |
| `Vapid public key should be 65 bytes long when decoded.` | Placeholder or truncated VAPID key in `.env`. |
| `RangeError [ERR_SOCKET_BAD_PORT]` | Non-numeric `PORT`. |

**Correct.** Fix the cause in source or `.env`. For a constraint violated by existing rows, either correct the rows with a deliberate, backed-up `UPDATE` or relax the constraint; do not delete rows to make startup succeed. Then run the [backend validation sequence](local-development.md#backend-validation-sequence) and `pm2 restart airdash-api`. If the failing change was deployed moments ago and cannot be fixed quickly, [roll back the API](deployment.md#roll-back-the-api).

**Verify.** `pm2 show airdash-api` reports `online` and `unstable restarts │ 0` after thirty seconds; health is green.

**Risk.** A partially applied migration leaves earlier statements in place. Additive statements are harmless. Anything else requires the [database backup](backup-and-recovery.md#database-backup) taken before deployment.

## Session not recognized

**Symptom.** The user is signed in on dashydoggo.com but airDash shows the "sign in" button; or actions fail with `401 Discord sign-in required` or `403 Owner access required`.

**Likely causes.** The authentication service on port 3002 is down or slow (over five seconds); `AUTH_URL` is wrong; the browser did not send the cookie (third-party cookie settings, or a different parent domain such as a raw IP address); the user's Discord ID does not match `OWNER_DISCORD_ID` for owner routes; locally, the mock service is not running or no cookie is set.

**Diagnose (production).**

```bash
ss -ltnp | grep ':3002'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3002/auth/me
pm2 show dashydex | grep -E 'status|unstable'
grep AUTH_URL api/.env
```

**Expected.** A listener on 3002, `200` from the direct call (with `{"user":null}` because no cookie), `dashydex` online, and `AUTH_URL` pointing at `http://127.0.0.1:3002/auth/me` or equivalent.

**Correct.** If `dashydex` is down, the Discord bot project owns it; restart it only with `pm2 restart dashydex` and only with the owner's agreement, because it serves every dashydoggo.com login. Locally, start the [mock service](local-development.md#mock-authentication-service) and set a cookie in the browser.

**Verify.** `/api/me` with the browser's cookie returns the account.

**Risk.** None from diagnosis. Never change `OWNER_DISCORD_ID` to "make it work"; that changes who controls the airline.

## Origin rejected

**Symptom.** `POST` or `DELETE` requests return `403 {"error":"Invalid request origin"}`. Reads work.

**Cause.** `requireAirDashOrigin` accepts only `Origin: https://air.dashydoggo.com` and `http://localhost:5174`. A development server on another port, a `curl` without an `Origin` header, or a proxy that strips the header produces this error. This was verified: `curl -X POST https://air.dashydoggo.com/api/notifications/read` with no header returns exactly this response.

**Correct.** Use port 5174 for the development server (`npm run dev` uses it by default; do not pass a different `--port`). For `curl`, add `-H 'Origin: http://localhost:5174'` against a local API. Do not add origins to the allow-list without a security review; see [security](security.md).

## Development proxy returns 404

**Symptom.** In the Vite development server, every API call fails; the browser network tab shows `404` for `/api/...` with body `Cannot GET /api/...`.

**Cause.** `web/vite.config.ts` proxies `/api` to the API without removing the prefix, and the API defines routes without it. Verified at commit `5f2e27c`. See [local development](local-development.md#the-proxy-does-not-remove-the-api-prefix).

**Correct.** Apply the documented `rewrite` locally and keep it out of unrelated commits, or propose it as its own change.

**Verify.** `curl -s http://localhost:5174/api/health` returns `{"ok":true,"database":true}`.

## Development server not reachable

**Symptom.** `npm run dev` prints `Local: http://localhost:5174/` but `http://127.0.0.1:5174` refuses the connection; or the browser cannot reach it at all.

**Cause.** Vite binds to `localhost`, which on some hosts resolves to IPv6 `::1` only. Verified on the production host: `ss -ltn` showed `[::1]:5174`. Also, on the production host there is no desktop browser; an SSH tunnel is required.

**Correct.** Use `http://localhost:5174/`. For remote access, `ssh -L 5174:localhost:5174 dashy@<host>` and browse `http://localhost:5174` on the local machine.

## Old frontend after build

**Symptom.** `npm --prefix web run build` completed but the site shows the previous behavior.

**Likely causes, in order.** The build wrote a new hash but the browser cached the page; the build did not actually change the bundle because the source you edited is not the source that was built; the build failed part way and `index.html` was not rewritten.

**Diagnose.**

```bash
grep -oE '/app-assets/index-[^" ]+\.(js|css)' site/index.html
curl -fsS -H 'Cache-Control: no-cache' https://air.dashydoggo.com/ | grep -oE '/app-assets/index-[^" ]+\.js'
js=$(curl -fsS https://air.dashydoggo.com/ | grep -oE '/app-assets/index-[^" ]+\.js')
curl -fsS "https://air.dashydoggo.com$js" | grep -aFq 'your-marker' && echo marker-present
```

**Expected.** The local and live hashes match and the marker is present.

**Correct.** Hash changed and marker present: hard-reload the browser (Ctrl+Shift+R); Nginx sends `no-store` for `index.html` and bundles so this is rare. Hash unchanged: the build did not include your change; confirm you edited `web/src/` and not `site/`. Marker absent with a new hash: the text is not literal in the bundle; choose a different marker.

## TypeScript errors

**Symptom.** `npm --prefix web run typecheck` prints lines of the form `src/App.tsx(504,52): error TS2322: ...`.

| Message | Meaning | Fix |
|---|---|---|
| `Cannot find name 'X'` | `X` is not imported or is misspelled. | Add it to the import list at the top of the file, or correct the spelling. Icons must be imported from `react-icons/fi` or `react-icons/tb`. |
| `Type 'Element' is not assignable to type 'string'` | JSX was passed where a string was expected. | Widen the prop type to `ReactNode`; see [change recipes](change-recipes.md#change-the-portal-pilot-and-base-line). |
| `Property 'x' does not exist on type 'Y'` | The API type in `web/src/types.ts` lacks the field. | Add the field to the interface, optional (`x?:`) if the API may omit it. |
| `'x' is possibly 'null'` | The value may be absent. | Guard it: `me?.pilot?.x` or `if (!me) return`. |
| `Argument of type 'string \| undefined' is not assignable to parameter of type 'string'` | A possibly missing value is passed to something that requires it. | Provide a default with `?? ""` or guard. |

Read the file, line, and column in parentheses; fix; rerun. The check prints nothing when it passes.

## Build run from the wrong directory

**Symptom.** `npm exec vite -- build ...` fails with `Could not resolve entry module "index.html"`.

**Cause.** `npm exec` does not change directory, so Vite looked for `index.html` in the repository root instead of `web/`.

**Correct.** Wrap the command in a subshell that enters `web/`: `( cd web && npm exec vite -- build --outDir "$out" --emptyOutDir )`.

## Booking conflicts

**Symptom.** Booking returns `409` with one of these messages.

| Message | Cause | Action |
|---|---|---|
| `Cancel or complete the current assignment before booking another flight` | The pilot already has a `BOOKED`, `ACTIVE`, or `PIREP_SUBMITTED` assignment. | Finish or cancel it in the Hangar. If the pilot insists they have none, check `SELECT id, status FROM airdash.assignments WHERE discord_id='<id>' AND status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED')`; a `PIREP_SUBMITTED` row awaits owner review. |
| `Aircraft is not available at this origin` | The aircraft moved, was assigned, or was placed on hold between page load and click. | Refresh the Flight Board. |
| `The selected aircraft or pilot now has an active assignment. Refresh the flight board and try again.` | Two bookings raced and the unique index rejected the second. | Refresh. This is the database working as designed. |
| `This pilot has already completed the selected flight` | An assignment for the same route and date is `COMPLETED`. | Choose another date. |
| `Could not assign both flight gates` | No free gate at an airport. Only possible when a pool is exhausted and the overflow also fails, which does not happen with the current pools. | Escalate; inspect `selectGate` inputs. |

## SimBrief rejections

| Message | Cause | Action for the pilot |
|---|---|---|
| `Set your SimBrief username in your profile first` | `pilots.simbrief_username` is null. | Enter the SimBrief username on the Profile page. |
| `Your latest SimBrief OFP is KATL-KMCO, not KATL-KDEN. Generate this route in SimBrief first.` | The most recent OFP on the SimBrief account is for a different route. | Generate the assignment's route from the Hangar link, then fetch again. |
| `Your latest SimBrief OFP is not a BCS3.` or `SimBrief aircraft type must be BCS3` | The OFP airframe is not the A220-300. | Generate with the `BCS3` airframe. The check is hard-coded. |
| `Use a SimBrief flightplans XML URL` | The pasted link is not `https://www.simbrief.com/ofp/flightplans/xml/<name>.xml`. | Copy the XML link from SimBrief's OFP page. |
| `Registration and three-digit tail number must match the assignment` | Manual import fields do not match. | Use the registration shown in the Hangar and its middle three digits. |
| `Recovery ferry OFP must use 0 passengers and 0 cargo` | A recovery ferry OFP carried payload. | Generate from the Hangar link, which sets `pax=0` and `cargo=0`. |
| `Remote service returned 4xx/5xx` or `Remote response is too large` | SimBrief unavailable, or the response exceeded 2 MB. | Retry later. |

Diagnose remote failures with `pm2 logs airdash-api --nostream --lines 40`; the API does not log SimBrief errors beyond the response, so reproduce with `curl -sI 'https://www.simbrief.com/api/xml.fetcher.php?username=<name>'` to see whether SimBrief responds.

## Volanta and report rejections

| Message | Cause | Action |
|---|---|---|
| `Enter a valid Volanta flight link` | No UUID in the link. | Copy the public flight link from Volanta, which contains a UUID. |
| `Volanta has not recorded a finished flight yet. End the flight in Volanta and wait for its public stats to update.` | `analyzeFlightOutcome` found no verified arrival and the state is not `Completed`. | End the flight in Volanta and wait a few minutes. |
| `Volanta planned route KATL-KDEN does not match KATL-KMCO` | The Volanta flight was planned for a different route. | File the correct flight, or cancel and rebook the matching route. |
| `Volanta aircraft N575AD does not match N574AD` | Volanta recorded a different registration. | Set the aircraft registration in the simulator or Volanta to the assigned tail. |
| `Tell Operations what happened before filing a diverted or incomplete flight` | Outcome is `DIVERTED` or `INCOMPLETE` and no reason was chosen. | Choose a reason in the report form. |
| `Landing rate is outside the accepted range` | Manual landing rate outside -5000 to 2000. | Correct it or leave it blank. |
| `Volanta returned invalid flight data` | Volanta responded with non-JSON. | Retry; if persistent, Volanta's API changed. Escalate. |

The API logs report failures with the prefix `[airdash:pirep]` including the user, assignment, status, and message.

## Notification behavior

**Symptom.** A notification does not appear, appears again after being read, or the count differs from the panel.

**How it works.** Notifications are rows in `airdash.notification_history` keyed by `(discord_id, event_key)`; the event key includes a hash of the source record. Reading sets `read_at`. The frontend polls every 60 seconds.

| Observation | Explanation | Action |
|---|---|---|
| The same event appears twice | The source record changed (for example a report was returned and then approved), producing a new key. This is by design. | None. |
| Read on one device, unread on another | Not expected; read state is server-side. | Check that `POST /notifications/read` returned `200` in the network tab; poll again after 60 seconds. |
| Count on the bell but the panel is empty | `total` counts unread rows; `history` shows the latest 100 rows. More than 100 unread rows could hide older ones. | Mark all read. |
| No notification for an event | The event is outside the 7-day window, or the group query excludes it (for example the owner receives `pireps` for `SUBMITTED` reports only). | Inspect `getNotificationPayload` in `api/src/notifications.js`. |

Inspect a user's history with `SELECT id, kind, title, created_at, read_at, pushed_at FROM airdash.notification_history WHERE discord_id='<id>' ORDER BY created_at DESC LIMIT 20`.

## Push not delivered

**Symptom.** The pilot enabled push on the Profile page but never receives background notifications; or `POST /push/test` fails.

**Likely causes, in order.** VAPID keys not configured (`503 Web Push is not configured`); the browser denied permission; the subscription was deleted after a 404 or 410 from the push service; the push worker is not running because the process restarted and logged that push is disabled; the browser or operating system suppresses notifications.

**Diagnose.**

```bash
pm2 logs airdash-api --nostream --lines 200 | grep -i 'airdash-push'
docker exec dashy-postgres psql -U dashy -d dashyden -P pager=off -c "SELECT discord_id, LEFT(endpoint,40) endpoint, created_at, last_success_at, last_error FROM airdash.push_subscriptions ORDER BY created_at DESC LIMIT 10;"
docker exec dashy-postgres psql -U dashy -d dashyden -Atc "SELECT COUNT(*) FROM airdash.notification_history WHERE pushed_at IS NULL;"
```

**Expected.** No `VAPID keys are not configured` line since the last start; a subscription row for the user with a recent `last_success_at` and empty `last_error`; a small or zero pending count.

**Correct.** Missing keys: set them in `api/.env` and restart. `last_error` populated: read it; a `401` or `403` from the push service means the VAPID key pair changed and every subscription must be recreated by the browser. No row: the browser did not complete subscription; check the browser console.

**Verify.** `POST /push/test` from the Profile page shows a notification.

## Aircraft stuck

**Symptom.** An aircraft shows `ASSIGNED` with no active assignment, or remains in `INSPECTION` or `MAINTENANCE` past its expected release.

**Diagnose.**

```sql
SELECT registration, status, status_reason, status_until, current_airport FROM airdash.aircraft WHERE registration='<reg>';
SELECT id, status, expires_at FROM airdash.assignments WHERE registration='<reg>' AND status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED');
```

**Interpretation.** `ASSIGNED` with a `PIREP_SUBMITTED` assignment: the report awaits owner review; approving or rejecting it releases the aircraft. `ASSIGNED` with no active assignment: an inconsistency, usually from a manual data edit; escalate. `INSPECTION` with `status_until` in the past: the expiry job has not run since; it runs every five minutes, and `/pilots`, `/me`, `/flights`, and `/missions` also trigger it. `MAINTENANCE`: released only by the owner unless `status_until` is set.

**Correct.** Owner reviews the report, or sets the aircraft `AVAILABLE` from the Administration Aircraft tab, which writes an audit event. Do not `UPDATE` the row by hand.

## Schedule empty

**Symptom.** The Schedule page shows no flights, or shows only past departures.

**Cause.** `ensureSchedule` has not run since the routes existed. It runs at startup (but before the migration on a fresh database, where it fails silently), every ten minutes, and on every `GET /schedule`.

**Correct.** Load the Schedule page once, which calls `ensureSchedule` synchronously, or wait ten minutes.

**Verify.** `SELECT COUNT(*) FROM airdash.schedule WHERE dep_time > NOW();` is positive.

## Migration failure

See [API exits at startup](#api-exits-at-startup) for the log patterns. Additional guidance for the person who wrote the migration:

- Test against a fresh local database first: `DROP SCHEMA airdash CASCADE;` then start the API twice. The second start proves idempotency.
- A `CHECK` constraint added with `DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT` fails if any existing row violates it. Query for violators before deploying.
- `ADD COLUMN ... NOT NULL` without a `DEFAULT` fails on a table with rows.
- Statements run in file order; a statement that references a column must come after the statement that adds it.

## Port already in use

**Symptom.** `Error: listen EADDRINUSE: address already in use 127.0.0.1:39151` or `:::3006` or `:5174`.

**Cause.** Another process, often a previous test run, still holds the port. This happened while writing this documentation: a backgrounded `cd api && node … &` left a mock service running whose PID differed from the one captured.

**Diagnose and correct.**

```bash
ss -ltnp | grep ':<port>'          # Linux
lsof -i :<port>                    # macOS
Get-NetTCPConnection -LocalPort <port> | Select-Object OwningProcess   # PowerShell
kill <pid>
```

For port 3006 on production, the holder should be the PM2-managed API; do not kill it. Use another port for temporary processes.

## Profile image upload fails

**Symptom.** `500` from `POST /profile/image`, or `400 Profile images are limited to 1.5 MB`.

**Causes.** The image exceeds 1,500,000 bytes after decoding; the format is not PNG, JPEG, or WebP; `PROFILE_IMAGE_DIR` (default `site/downloads/profiles/`) is not writable by the API's user.

**Diagnose.** `ls -ld site/downloads/profiles` should show the directory owned by the user running the API with mode `755`. Read the API log for `EACCES` or `ENOENT`.

**Correct.** Resize the image, or fix ownership with `chown` as the owner of the directory. Do not `chmod 777`.

## Escalation

Stop and involve the owner before any of these: restoring a database dump, editing rows by hand in production, changing the Caddyfile, restarting `dashy-caddy`, `dashy-postgres`, or `dashydex`, changing `OWNER_DISCORD_ID` or the origin allow-list, or deleting files under `site/downloads/`. Each affects other users or other dashydoggo.com services or is irreversible.
