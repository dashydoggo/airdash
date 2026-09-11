# Local development

This page explains how to run airDash on your own machine, how to sign in without a real Discord session, how to edit the frontend and the API, and how to validate a change before it reaches production. It assumes you have completed [installation](installation.md): the tools are installed, dependencies are present, `api/.env` exists, and a local PostgreSQL database contains the `airdash` schema.

Every command runs from the repository root unless a `cd` is shown. The repository root is the directory containing `README.md`, `api/`, and `web/`.

## The three local processes

A complete local environment consists of three processes plus the database.

| Process | Command | Port | Purpose |
|---|---|---|---|
| Mock authentication service | a ten-line Node.js script shown below | 39151 | Stands in for the dashydoggo.com Discord login service so that `requireUser` and `requireOwner` accept your requests. |
| API | `node src/server.js` from `api/` | 3006 | The Express application. |
| Vite development server | `npm run dev` from `web/` | 5174 | Serves the frontend with instant reload and proxies `/api` to the API. |

Run each in its own terminal window so that you can read its output. Stop any of them with Ctrl+C, which sends `SIGINT`; the API handles that signal with a graceful shutdown.

## Mock authentication service

### Why it exists

Every authenticated API route calls `authenticatedUser` in `api/src/auth.js`, which forwards the browser's `Cookie` header to `AUTH_URL` and expects a JSON body of the form `{ "user": { "id": "...", "username": "...", "displayName": "...", "avatar": null } }`. In production that service is the dashydoggo.com Discord login on port 3002, which requires a real Discord account and a real session. Locally you replace it with a server that returns a fixed user for any cookie.

### Start it

Run from any directory. The script is complete; nothing is elided.

```bash
AUTH_PORT=39151 node --input-type=module -e '
import http from "node:http"
const user = { id: "100000000000000001", username: "localdev", displayName: "Local Dev", avatar: null }
http.createServer((_request, response) => {
  response.setHeader("content-type", "application/json")
  response.end(JSON.stringify({ user }))
}).listen(Number(process.env.AUTH_PORT), "127.0.0.1", () => console.log(`mock auth listening on ${process.env.AUTH_PORT}`))
'
```

Line by line: `node --input-type=module -e` runs the quoted program as an ECMAScript module. `import http` loads Node.js's built-in HTTP server. `user` is the identity every request will receive; change `id` to the value you put in `OWNER_DISCORD_ID` in `api/.env` when you want to act as the owner, or to any other digits when you want to act as a non-owner. The server ignores the request entirely and responds with the user as JSON. It listens on the loopback address only.

Expected output: `mock auth listening on 39151`. The process keeps running until you press Ctrl+C.

Verify from another terminal: `curl -s http://127.0.0.1:39151/auth/me` prints the user object.

**Important:** This service authenticates everyone. Never run it on a machine that is reachable from other computers, and never point the production `AUTH_URL` at it.

### Common failure

`Error: listen EADDRINUSE: address already in use 127.0.0.1:39151` means an earlier copy is still running. Find and stop it with `ss -ltnp | grep 39151` on Linux, `lsof -i :39151` on macOS, or `Get-NetTCPConnection -LocalPort 39151` on Windows, then `kill <pid>`.

## Start the API

Run from `api/`, because `dotenv` reads `.env` from the working directory:

```bash
cd api
node src/server.js
```

Or, equivalently from the repository root, `npm --prefix api start`, because `npm run` changes into the prefix directory before running the script.

Startup sequence, as implemented at the bottom of `api/src/server.js`: load `.env`; construct the Express application and register every route; run `migrate()`, which applies any missing schema and seed data; repair gates for active assignments and parking gates for aircraft; start the Web Push worker, or log that it is disabled; listen on `0.0.0.0:<PORT>`.

Expected output on a fresh database:

```text
[airdash-push] VAPID keys are not configured; background push is disabled
[airdash-api] assigned parking gates for 21 aircraft
[airdash-api] listening on 0.0.0.0:3006
```

The second line appears only on the first start against a fresh database, because after that every aircraft already has a gate. The first line appears only when the `VAPID_*` variables are empty.

Verify from another terminal:

```bash
curl -fsS http://127.0.0.1:3006/health
curl -fsS http://127.0.0.1:3006/public | python3 -c 'import sys,json; d=json.load(sys.stdin); print({k:(len(v) if isinstance(v,list) else v) for k,v in d.items()})'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3006/me
curl -fsS -H 'Cookie: session=anything' http://127.0.0.1:3006/me | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["isOwner"], d["pilot"], d["application"])'
```

Expected, in order: `{"ok":true,"database":true}`; `{'aircraft': 21, 'routes': 102, 'bases': 4, 'pilots': 0, 'topPilot': None}`; `401` because no cookie was sent; and `True None None` when the mock user's `id` equals `OWNER_DISCORD_ID`, meaning you are the owner but have no pilot record or application yet. These four checks were run while writing this page against a fresh database and produced exactly these results.

**Note:** The API calls the Express route path without `/api`. In production Caddy removes the `/api` prefix before forwarding. When you call the API directly, as above, omit the prefix.

### Configuration precedence during local runs

A variable set in the shell environment overrides the same variable in `api/.env`, which overrides the default in the code. `PORT=39150 node src/server.js` therefore starts on 39150 even if `.env` says 3006. On the production host this matters: any process started from `api/` loads the production `.env`, so a temporary process inherits production database credentials and VAPID keys unless you override them on the command line.

## Start the Vite development server

Vite is the frontend build tool. Its development server compiles TypeScript on demand, reloads the browser when a file changes, and proxies API requests so that the page and the API appear to share one origin.

```bash
cd web
npm run dev
```

Expected output:

```text
  VITE v8.0.12  ready in 170 ms
  ➜  Local:   http://localhost:5174/
  ➜  Network: use --host to expose
```

Open `http://localhost:5174/` in a browser on the same machine. Use `localhost`, not `127.0.0.1`: on hosts where `localhost` resolves to IPv6 first, Vite binds to `[::1]:5174`, and `127.0.0.1:5174` refuses the connection. This was observed on the production host while writing this page.

### The proxy does not remove the `/api` prefix

`web/vite.config.ts` configures the proxy as:

```ts
server: {
  port: 5174,
  proxy: {
    "/api": "http://127.0.0.1:3006",
  },
},
```

The string shorthand forwards `/api/health` to `http://127.0.0.1:3006/api/health` unchanged. The API defines `/health`, not `/api/health`, so every API call made from the development server returns `404` with the body `Cannot GET /api/health`. This was verified while writing this page: the request through the proxy returned 404 while the same request made directly to port 3006 returned 200.

Production is unaffected because Caddy performs the prefix removal. The development server as committed at `5f2e27c` therefore cannot load data, and this is recorded in [known limitations](known-limitations.md#vite-development-proxy-does-not-strip-the-api-prefix).

The corrected configuration, which was tested and returned `{"ok":true,"database":true}` through the proxy, is:

```ts
proxy: {
  "/api": { target: "http://127.0.0.1:3006", rewrite: path => path.replace(/^\/api/, "") },
},
```

Until that correction is merged, apply it locally as an uncommitted edit to `web/vite.config.ts` while you develop, and exclude the file from your commits with `git restore web/vite.config.ts` before staging. Do not include it in an unrelated pull request; propose it as its own change so that it is reviewed on its merits.

### Sign in locally

The "sign in" button sends the browser to `https://dashydoggo.com/auth/login`, which cannot create a session for `localhost`. Instead, give the browser any cookie so that `requireUser` forwards one to the mock service. Open the browser's developer tools (F12), choose the Console tab, and run:

```js
document.cookie = "airdash_local=1; path=/"
```

Reload the page. The top bar greets the mock user, and if its `id` matches `OWNER_DISCORD_ID`, the "admin" link appears under "more". Because the mock service returns the same user for every cookie, the value does not matter. To sign out, delete the cookie from the developer tools Application (or Storage) tab, or run `document.cookie = "airdash_local=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/"`.

The `Origin` header the browser sends from `http://localhost:5174` is one of the two origins `requireAirDashOrigin` accepts, so `POST` requests from the development server succeed. Requests from any other port are rejected with `403`, which is why the port is fixed at 5174.

### Create a pilot for yourself locally

A fresh database has no pilots. Acting as the owner (mock `id` equal to `OWNER_DISCORD_ID`): open `/join`, submit an application with any name, a numeric VATSIM CID of 4 to 12 digits, one of the four seeded bases, a simulator, and an experience level; then open `/admin`, select the Applications tab, and approve it. The API creates pilot `AD0001` and you can book flights. Every one of those actions is a real write to your local database only.

## The edit, validate, and review loop

### Where things live

| You want to change | Edit | Validate with | Deploy with |
|---|---|---|---|
| What a page shows or does | `web/src/App.tsx` or the module that owns the page | Type check, isolated build, marker check | Frontend build |
| Appearance | `web/src/styles.css` | Same as above | Frontend build |
| The shape of an API response the frontend reads | `web/src/types.ts` | Type check | Frontend build |
| A route, validation rule, or response field | `api/src/server.js` | Syntax check, unit tests, smoke test | API restart |
| Schema or seed data | `api/src/database.js` | Same as above, plus a database backup first | API restart |
| Streak, outcome, SimBrief, Volanta, gate, or recovery calculation | The matching module in `api/src/` | Syntax check and the unit test that covers it | API restart |
| Notification content or grouping | `api/src/notifications.js` | Syntax check, smoke test of `/notifications` | API restart |

The [repository guide](repository-guide.md) describes every file, and [change recipes](change-recipes.md) has worked examples.

### Finding the code for something you see

Search for the visible text. Static text appears literally in the source; dynamic text is built from a template string, so search for its static fragment or for the CSS class name shown in the browser's element inspector:

```bash
grep -n 'Finish or cancel the current assignment' web/src/App.tsx
grep -n 'class-name-from-inspector' web/src/styles.css
```

### Frontend validation sequence

Run all three after every frontend edit. Each catches a different class of failure.

Step 1, type check. TypeScript verifies that names exist, props have the right types, and imports resolve:

```bash
npm --prefix web run typecheck
```

Expected: no output after the banner. Any line containing `error TS` names the file, line, and problem. Common messages are explained in [debugging](debugging.md#typescript-errors).

Step 2, isolated production build. This compiles exactly what production would, but into a temporary directory, so `site/` is untouched:

```bash
out=$(mktemp -d /tmp/airdash-check.XXXXXX)
( cd web && npm exec vite -- build --outDir "$out" --emptyOutDir )
ls "$out/app-assets"
```

`mktemp -d` creates a uniquely named temporary directory and prints its path. The parentheses run `cd web` in a subshell so your working directory is unchanged afterward. `npm exec vite -- build` runs the Vite binary from `web/node_modules/.bin/`; the `--` separates npm's arguments from Vite's. `--outDir` overrides the configured `../site`, and `--emptyOutDir` is safe here because the directory is temporary.

Expected: `✓ 483 modules transformed.`, a listing of `index.html`, one `index-<hash>.css`, and one `index-<hash>.js`, and `✓ built in <n>ms`. One warning is normal and can be ignored: `Some chunks are larger than 500 kB after minification`. The application is one bundle by design; see [known limitations](known-limitations.md).

**Note:** `npm --prefix web run build` works from the repository root because `npm run` changes into `web/` first, but `npm exec` does not change directory. Running the isolated build without the subshell fails with `Could not resolve entry module "index.html"`.

Step 3, marker check. Confirm the built bundle contains your change by searching for a literal string you introduced:

```bash
grep -aFq 'your-marker-text' "$out"/app-assets/index-*.js && echo present
grep -aFq 'your-class-name' "$out"/app-assets/index-*.css && echo css-present
```

`-a` treats the minified file as text, `-F` searches for a fixed string, `-q` suppresses output and sets only the exit code. If the marker is absent, either the build used different source than you edited, or the text is generated at runtime and not present literally.

Clean up: `rm -rf "$out"`.

### Backend validation sequence

Step 1, syntax check. Node parses each file without running it:

```bash
npm --prefix api run check
```

Step 2, unit tests. Run both; they take under a second:

```bash
npm --prefix api run test:streaks
npm --prefix api run test:flight-outcomes
```

Step 3, smoke test. Start a second API process on an unused port against your local database, request the routes you changed, and stop it. The full procedure, including the mock authentication service for authenticated routes, is in [testing](testing.md#smoke-test). The short form is:

```bash
cd api
PORT=39150 node src/server.js > /tmp/airdash-smoke.log 2>&1 &
smoke_pid=$!
sleep 3
curl -fsS http://127.0.0.1:39150/health
curl -fsS http://127.0.0.1:39150/live | head -c 600
kill "$smoke_pid"
cd ..
```

**Warning:** On the production host, the smoke test process loads the production `api/.env` and therefore runs `migrate()` against the production database. A new `IF NOT EXISTS` statement is applied for real. Take a database backup before smoke-testing a migration there, as described in [backup and recovery](backup-and-recovery.md#database-backup).

### Review before committing

Run `git status` and `git diff`. Confirm that only the files you meant to change are modified, that `web/vite.config.ts` is not accidentally included if you applied the proxy workaround, and that no `.env` file appears. Then follow [contributing](contributing.md).

## Working on the production host

On `dashydatabase-1`, the repository at `/opt/dashy-database/projects/airdash` is the live deployment. The rules differ from a personal machine:

- Start every session with the read-only checks in [operations](operations.md#health-checks). None of them change anything.
- Never run `npm --prefix web run build` unless you intend to publish; it writes to the live `site/` directory. Use the isolated build for validation.
- Never edit files under `site/app-assets/` or `site/index.html` by hand. The next build discards the edit.
- The Vite development server on the host proxies to the production API on port 3006. Every write you perform through it is a production action. Prefer the isolated build for validation and a personal machine for interactive development.
- Because the host has no desktop browser, reaching `localhost:5174` requires an SSH tunnel from a machine with a browser: `ssh -L 5174:localhost:5174 dashy@<host>`, then open `http://localhost:5174` on that machine.

## Database inspection

Reading data never changes it. Use `SELECT` statements freely. Local:

```bash
psql "$DATABASE_URL" -P pager=off -c "SELECT id, discord_id, registration, status, booked_at, expires_at FROM airdash.assignments ORDER BY booked_at DESC LIMIT 20;"
```

Production, inside the container:

```bash
docker exec dashy-postgres psql -U dashy -d dashyden -P pager=off -c "SELECT registration, status, current_airport, current_gate FROM airdash.aircraft ORDER BY fleet_number;"
```

`-P pager=off` prints the whole result instead of opening an interactive pager. `-A` and `-t` produce unaligned output without headers, which is useful in scripts.

**Warning:** `UPDATE`, `DELETE`, `INSERT`, `DROP`, and `TRUNCATE` change data with no undo. On production, never run them as an experiment. Take a backup, write the statement with an explicit `WHERE` clause, run it inside `BEGIN; ...; ROLLBACK;` to see the affected row count, and only then run it with `COMMIT`.

## Normal shutdown

Press Ctrl+C in each terminal. The API logs nothing on shutdown; it closes the listener, ends the database pool, and exits with code 0. Vite exits immediately. The mock service exits immediately. Stop a local Docker database with `docker stop airdash-postgres`; its data is preserved in the volume.

## Cleanup and reset

| Goal | Command | Effect |
|---|---|---|
| Remove build output from an isolated build | `rm -rf /tmp/airdash-check.*` | Deletes temporary directories only. |
| Reinstall dependencies from scratch | `rm -rf api/node_modules web/node_modules && npm --prefix api ci && npm --prefix web ci` | Identical tree to before. |
| Reset the local database to seed state | `psql "$DATABASE_URL" -c "DROP SCHEMA airdash CASCADE;"` then `npm --prefix api run migrate` | Deletes every local row, recreates the schema and seeds. Local only. |
| Discard uncommitted edits | `git restore <path>` or `git restore .` | Working tree matches the last commit. |
| Clear browser state | Developer tools, Application tab, clear site data for `localhost:5174` | Removes the mock cookie and the `airdash-*` local storage keys listed in [features](features.md#browser-state). |

## Command reference

| Command | Directory | Purpose | Reads | Writes |
|---|---|---|---|---|
| `npm --prefix api ci` | root | Install API dependencies | `api/package-lock.json` | `api/node_modules/` |
| `npm --prefix academy run validate` | root | Validate curriculum, references, coverage, critical evidence, exam feasibility, and question quality | `academy/data/`, source and Markdown references | nothing |
| `npm --prefix academy test` | root | Run academy engine, progress, checker, validator, and server tests | `academy/`, selected repository files and fixed scripts | temporary test resources only |
| `npm --prefix academy start` | root | Serve the local academy on `127.0.0.1:4174` | allow-listed academy, docs, source, and configuration files | browser localStorage; temporary output only when a build checker is explicitly run |
| `npm --prefix web ci` | root | Install frontend dependencies | `web/package-lock.json` | `web/node_modules/` |
| `npm --prefix api run check` | root | Syntax-check the eleven API files | `api/src/*.js` | nothing |
| `npm --prefix api run test:streaks` | root | Unit-test streak calculations | `api/src/streaks.js` | nothing |
| `npm --prefix api run test:flight-outcomes` | root | Unit-test outcomes, SimBrief parsing, landing rates, gates, recovery | five `api/src/` modules | nothing |
| `npm --prefix api run migrate` | root | Apply schema and seeds | `api/.env`, database | database |
| `npm --prefix api start` | root | Run the API | `api/.env`, database | database, `site/downloads/profiles/` on image upload |
| `npm --prefix web run typecheck` | root | Type-check the frontend | `web/src/**` | `web/*.tsbuildinfo` |
| `npm --prefix web run dev` | root | Vite development server on 5174 | `web/**` | nothing |
| `npm --prefix web run build` | root | Production build into `site/` | `web/**` | `site/index.html`, `site/app-assets/`, `site/airdash-sw.js`, `site/assets/` |
| `npm --prefix web run preview` | root | Serve the last build from `site/` for inspection | `site/` | nothing |
| `( cd web && npm exec vite -- build --outDir "$out" --emptyOutDir )` | root | Isolated build | `web/**` | `$out` only |

`npm run preview` serves the already-built `site/` directory on port 4173 without a proxy, so API calls fail unless an API is reachable at `/api` on that origin. It is useful only for checking the static bundle.
