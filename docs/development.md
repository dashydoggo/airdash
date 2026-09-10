# airDash development guide

This guide explains how to prepare a working environment, inspect the running system safely, edit frontend and backend source, validate a change before publication, and diagnose common failures. It assumes no prior experience with the tools involved. Each tool is defined the first time it appears.

## Prerequisites

All development happens on the Rocky Linux host `dashydatabase-1` as the `dashy` user. The following tools are already installed. Verify each one before starting work.

| Tool | What it is | Verify with | Expected |
|---|---|---|---|
| Node.js | The JavaScript runtime that runs the API and the build tools. | `node --version` | `v24.x` |
| npm | The Node.js package manager that installs dependencies and runs scripts defined in `package.json`. | `npm --version` | `11.x` |
| PM2 | A process manager that keeps the API running, restarts it on failure, and restores it after a host reboot. | `pm2 --version` | `7.x` |
| Docker | The container runtime that hosts PostgreSQL, Nginx, and Caddy. | `docker ps` | A list of containers including `dashy-postgres` |
| psql (in container) | The PostgreSQL command-line client. It runs inside the database container. | `docker exec dashy-postgres psql --version` | `psql (PostgreSQL) 16.x` |
| curl | A command-line HTTP client used for health checks and smoke tests. | `curl --version` | Any version |

Dependencies are already installed in `web/node_modules` and `api/node_modules`. If either directory is missing, restore it with:

```bash
cd /opt/dashy-database/projects/airdash
npm --prefix web ci
npm --prefix api ci
```

`npm ci` installs the exact versions recorded in `package-lock.json`. It does not upgrade anything.

## Working directory convention

Every command in this documentation is written to run from the project root unless a `cd` is shown:

```bash
cd /opt/dashy-database/projects/airdash
```

The `--prefix` flag on `npm` runs a script inside a subdirectory without changing the shell's directory. `npm --prefix web run typecheck` is equivalent to entering `web/` and running `npm run typecheck`.

## Read-only inspection

Start every session by confirming the current state of production. None of these commands change anything.

### Production health

```bash
curl -fsS https://air.dashydoggo.com/api/health
```

Expected output:

```json
{"ok":true,"database":true}
```

`ok: false` or a connection error means the API process or the database is unavailable. Consult [Diagnose an unhealthy API](deployment-and-operations.md#diagnose-an-unhealthy-api).

### API process state

```bash
pm2 show airdash-api
```

The important fields are `status` (should be `online`), `restarts`, `unstable restarts` (should be `0`), and `script path`. A rising `unstable restarts` count means the process is crashing at startup.

### Currently published frontend

```bash
grep -oE '/app-assets/index-[^" ]+\.(js|css)' site/index.html
```

This prints the JavaScript and CSS bundle names that the live site currently loads. Record these before any deployment; they identify what to restore in a rollback.

### Container state

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'dashy-(airdash|postgres|caddy)'
```

All three should report `Up`.

## Frontend development

The frontend is a single-page application. Source lives in `web/src/`. The published site lives in `site/`. You edit the former; a build produces the latter.

### Key files

| File | Contents | When you edit it |
|---|---|---|
| `web/src/App.tsx` | Every page, the layout shell, shared components, and application state. | Changing what appears on a page, adding a page, changing behavior. |
| `web/src/styles.css` | The complete stylesheet. | Changing appearance, spacing, colors, responsive layout. |
| `web/src/types.ts` | TypeScript interfaces describing API response shapes. | Adding or renaming a field the API returns. |
| `web/src/api.ts` | The fetch wrapper that prefixes `/api` and handles errors. | Rarely. |
| `web/src/notificationState.ts` | Notification fingerprinting and persistent dismissal. | Changing how notifications are identified or cleared. |
| `web/src/flightPlan.ts` | VATSIM pre-file URL construction. | Changing the remarks or pre-file format. |
| `web/src/hangarQuips.ts` | The pool of personalized Hangar headings. | Adding or editing quips. |
| `web/src/volanta.ts` | Volanta desktop protocol launch. | Rarely. |

### Finding the code for something you see on screen

The fastest method is to search for the visible text. For example, to find where the Portal heading intro is produced:

```bash
grep -n 'is based at\|portal-pilot-base' web/src/App.tsx
```

If the text is dynamic, search for a nearby static label or the CSS class name visible in the browser's element inspector. Right-click an element in the browser, choose Inspect, and read its `class` attribute. Then search `styles.css` for that class and `App.tsx` for `className="that-class"`.

### Understanding JSX

JSX is the HTML-like syntax inside `.tsx` files. Three rules cover most edits:

1. Text between tags is literal: `<p>Hello</p>` renders `Hello`.
2. Curly braces switch to JavaScript: `<p>{me.pilot.pilot_number}</p>` renders the value of that variable.
3. Template strings use backticks and `${}`: `` `${a} is at ${b}` `` produces `A is at B`.

A prop (a named value passed to a component) that accepts only a string cannot accept an icon. If you want an icon inside it, the component's type must accept `ReactNode`, which is TypeScript's name for anything React can render. The [Portal pilot and base recipe](change-recipes.md#change-the-portal-pilot-and-base-line) shows exactly this situation.

### Icons

Icons come from the `react-icons` package. Feather icons are imported from `react-icons/fi` and Tabler icons from `react-icons/tb`. To use an icon, it must appear in the import list at the top of `App.tsx`:

```tsx
import { FiHome, FiBell, FiMap } from "react-icons/fi"
```

Then it is used as a component: `<FiHome />`. Adding an icon that is not imported fails the TypeScript check with `Cannot find name 'FiSomething'`. That is the intended safety net; add the import and rerun the check.

Browse available icon names at the react-icons website, or search the installed package:

```bash
grep -o 'Fi[A-Z][A-Za-z]*' web/node_modules/react-icons/fi/index.d.ts | sort -u | head -50
```

### CSS conventions

- Colors are CSS variables defined in `:root` at the top of `styles.css`: `var(--teal)`, `var(--muted)`, `var(--white)`, `var(--panel)`, `var(--danger)`, `var(--warning)`.
- New rules are appended at the end of the file. Later rules override earlier rules of equal specificity, which is why appended fixes work.
- Responsive rules use `@media(max-width:650px)` for phones and `@media(max-width:950px)` for tablets.
- A global rule disables all animation when the visitor's system requests reduced motion. Do not add animations that bypass it.

### The validation sequence for a frontend change

Run these three commands after every edit and before any publication. Each catches a different failure class.

**Step 1: Type check.** TypeScript verifies that names exist, props have the right types, and imports resolve.

```bash
npm --prefix web run typecheck
```

Expected: the command prints the script name and exits with no error lines. Any line containing `error TS` is a failure; the message names the file and line.

**Step 2: Isolated production build.** This compiles exactly what production would compile, but writes to a temporary directory instead of `site/`. Production is not touched.

```bash
out=$(mktemp -d /tmp/airdash-check.XXXXXX)
( cd web && npm exec vite -- build --outDir "$out" --emptyOutDir )
ls "$out/app-assets"
```

Expected: `vite ... built in ...ms` and a listing showing `index-<hash>.js` and `index-<hash>.css`. Two warnings are normal and can be ignored: one about `/assets/airdash-aircraft-cutout.png` not resolving at build time, and one about chunks larger than 500 kB.

**Note:** The parentheses create a subshell that enters `web/` for this one command and returns afterward. `npm --prefix web run build` works from the project root because `npm run` changes into the prefix directory before running a script, but `npm exec` does not change directory, so Vite would look for `index.html` in the wrong place and fail with `Cannot resolve entry module index.html`.

**Step 3: Marker check.** Confirm the built bundle contains your change. Search for a literal string you added:

```bash
grep -aFq 'portal-pilot-base' "$out"/app-assets/index-*.js && echo present
```

If the marker is absent, the source you edited is not the source the build used, or the text is generated at runtime rather than present in source.

When all three pass, the change is ready for the [frontend deployment procedure](deployment-and-operations.md#deploy-a-frontend-only-change).

### Vite development server

Vite offers a development server with instant reload. It is optional for this project and carries a caveat.

```bash
cd web
npm run dev
```

The server listens on `http://localhost:5174` and proxies `/api` to the production API on `127.0.0.1:3006`.

**Warning:** The development server uses the production database through the production API. Any booking, cancellation, or report you submit in the development server is a real production action. Use it for visual inspection only, and prefer the isolated build for validation.

Because the host has no desktop browser, reaching `localhost:5174` requires an SSH tunnel from a machine with a browser:

```bash
ssh -L 5174:127.0.0.1:5174 dashy@10.0.0.11
```

Then open `http://localhost:5174` on that machine.

## Backend development

The API is an Express application. Source lives in `api/src/`. The running process is managed by PM2 and does not pick up edits until restarted.

### Key files

| File | Contents |
|---|---|
| `api/src/server.js` | All 49 routes, middleware, background jobs, and startup. |
| `api/src/database.js` | Connection pool, migration, seeds, `audit()`, and `publishOrgUpdate()`. |
| `api/src/auth.js` | `requireUser`, `requireOwner`, `requireAirDashOrigin`. |
| `api/src/integrations.js` | Gate selection, SimBrief and Volanta clients. |
| `api/src/streaks.js` | Streak and bonus calculation. |

### Anatomy of a route

Every route follows this shape:

```js
app.get("/notifications", requireUser, async (req, res) => {
  const result = await pool.query("SELECT ... WHERE discord_id=$1", [req.user.id])
  res.json({ rows: result.rows })
})
```

- `app.get` or `app.post` selects the HTTP method.
- The first string is the path as Express sees it, without `/api`.
- `requireUser` or `requireOwner` is optional middleware that runs before the handler. Omit it for public routes.
- `pool.query(text, values)` runs SQL. Values are passed as a separate array and referenced as `$1`, `$2`, and so on. This is parameterized SQL, and it is the only acceptable way to include user input in a query. Never concatenate a request value into SQL text.
- `res.json(...)` sends the response. `res.status(400).json({ error: "..." })` sends an error the frontend will display.

### Input handling

Use the existing `clean(value, maxLength)` helper for string inputs. It trims, truncates, and returns an empty string for non-strings. Validate enumerations against explicit lists before use, as the aircraft-status route does.

### The validation sequence for a backend change

**Step 1: Syntax check.** Node parses each file without executing it.

```bash
npm --prefix api run check
```

Expected: no output beyond the script name.

**Step 2: Unit tests.** The streak module has a test script. Run it whenever `streaks.js` or PIREP crediting changes, and it is cheap enough to run always.

```bash
npm --prefix api run test:streaks
```

Expected: `streak calculations verified`.

**Step 3: Temporary process smoke test.** Start a second copy of the API on an unused port, request the changed route, and stop it. Production keeps running on 3006 throughout. This is safe because the temporary process reads the same database but you only send read requests.

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

If the health call fails, read `/tmp/airdash-smoke.log` for the startup error. A common cause is a syntax error in a SQL string, which only surfaces when the query executes.

**Note:** The temporary process runs `migrate()` at startup. If your change added a migration statement, the smoke test applies it to the production database. That is acceptable for additive `IF NOT EXISTS` statements, and it is why the smoke test is a real validation of the migration. It is also why you must take a database backup first when the migration is anything more than additive.

Testing an authenticated route requires a session cookie. The simplest approach is to point the temporary process at a local mock of the auth service:

```bash
AUTH_PORT=39151 node --input-type=module -e '
import http from "node:http"
http.createServer((_q, r) => { r.setHeader("content-type","application/json"); r.end(JSON.stringify({ user: { id: "860900952097030184", username: "dashy", displayName: "Dashy", avatar: null } })) }).listen(Number(process.env.AUTH_PORT), "127.0.0.1")
' &
auth_pid=$!
cd api
PORT=39150 AUTH_URL=http://127.0.0.1:39151/auth/me node src/server.js > /tmp/airdash-smoke.log 2>&1 &
smoke_pid=$!
sleep 3
curl -fsS -H 'Cookie: any=value' http://127.0.0.1:39150/notifications | head -c 800
kill "$smoke_pid" "$auth_pid"
cd ..
```

The mock returns a fixed identity for any cookie. Replace the Discord ID with the account you want to test as. Only use owner IDs for read-only owner routes.

When all steps pass, the change is ready for the [API deployment procedure](deployment-and-operations.md#deploy-an-api-only-change).

## Database development

The schema is created and evolved by `migrate()` in `api/src/database.js`. There is no separate migration tool.

### Adding a column

Append an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statement in the alteration block near the existing ones. Use `IF NOT EXISTS` so repeated startups are safe. Give the column a `DEFAULT` or allow `NULL` so existing rows remain valid.

See [Add a database column](change-recipes.md#add-a-database-column) for the complete recipe.

### Changing a constraint

The migration drops and recreates named check constraints when the allowed set of values changes. Follow the existing pattern for `aircraft_status_check`. Take a database backup first because a constraint that rejects existing rows makes the migration fail and the API refuse to start.

### Inspecting data safely

`SELECT` statements never modify data. Run them through `docker exec`:

```bash
docker exec dashy-postgres psql -U dashy -d dashyden -P pager=off \
  -c "SELECT registration, status, current_airport FROM airdash.aircraft ORDER BY fleet_number;"
```

**Warning:** `UPDATE`, `DELETE`, `INSERT`, `DROP`, and `TRUNCATE` change production data with no undo. Do not run them by hand as an experiment. Take a backup, write the statement with an explicit `WHERE` clause, run it inside `BEGIN; ... ; ROLLBACK;` first to see the affected row count, and only then run it with `COMMIT`.

## Debugging

### Reading the production API log

```bash
pm2 logs airdash-api --nostream --lines 60
```

Normal output is repeated `[airdash-api] listening on 0.0.0.0:3006` lines from each restart and Node's `NO_COLOR` warning. Route errors appear as JSON with a `[airdash:...]` prefix.

### A page shows old content after a build

Nginx sets `Cache-Control: no-store` on `index.html` and bundles, so browser caching is not the usual cause. Confirm the build actually wrote to `site/` by checking `site/index.html` for the new hash. If the hash is new but the browser is old, perform a hard reload. If the hash did not change, the build failed; re-read its output.

### TypeScript error you do not understand

Read the file and line number in the error. The most common messages are:

| Message | Meaning | Fix |
|---|---|---|
| `Cannot find name 'X'` | `X` is not imported or is misspelled. | Add it to the import list or correct the spelling. |
| `Type 'Element' is not assignable to type 'string'` | You passed JSX where a string was expected. | Widen the prop type to `ReactNode`. |
| `Property 'x' does not exist on type 'Y'` | The API type in `types.ts` lacks the field. | Add the field to the interface. |
| `'x' is possibly 'null'` | The value may be absent. | Guard it: `me?.pilot?.x` or `if (!me) return`. |

### The API exits immediately after restart

Read the log. Startup failures are almost always one of:

- A SQL syntax error in `migrate()`.
- A constraint that existing rows violate.
- `DATABASE_URL` unreachable because the PostgreSQL container is down.
- A JavaScript syntax error that `node --check` would have caught.

Fix the cause, run the API validation sequence, and restart.

### Notification does not clear or reappears

Dismissal state is stored in browser local storage under a key that includes the user's Discord ID and role. A different browser or a cleared browser profile starts fresh. A changed record produces a new fingerprint by design. See `notificationState.ts` for the exact fields that participate in the fingerprint.

## Conventions summary

- Edit source, never generated files.
- Validate with type check, isolated build, and marker check before publishing frontend changes.
- Validate with syntax check, tests, and a temporary process before restarting the API.
- Use parameterized SQL only.
- Back up before schema changes and before every deployment.
- Follow the [documentation style standard](documentation-style.md) when updating these guides.
