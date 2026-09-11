# Configuration reference

This page documents every configuration value that changes how airDash behaves: the environment variables the API reads, the database-backed operational settings, the build and runtime configuration files, and the order in which sources take precedence. It is the canonical list. When a variable is added, renamed, or removed, this page, `api/.env.example`, and the [coverage map](coverage-map.md) must change in the same pull request.

## Configuration sources and precedence

The API has three sources of configuration, applied in this order of decreasing priority:

1. The process environment. Variables set by the shell, by PM2's `ecosystem.config.js`, or on the command line before `node`.
2. The `api/.env` file, loaded by `import "dotenv/config"` as the first statement of `api/src/server.js`, `api/src/push.js`, and `api/scripts/migrate.js`. `dotenv` never overwrites a variable that already exists in the process environment.
3. Defaults written in the code with the `??` or `||` operator.

The file is read once at startup. Changing `api/.env` has no effect on a running process; the API must be restarted. There is no command-line option parsing; everything is an environment variable.

The frontend has no runtime configuration. Its behavior is fixed at build time by `web/vite.config.ts` and by constants in the source such as the allowed API prefix `/api` in `web/src/api.ts`.

## Environment variables

All variables are strings. "Required" means the API cannot function correctly without a value; it does not mean the API refuses to start, because no variable is validated at startup.

### DATABASE_URL

| Property | Value |
|---|---|
| Purpose | PostgreSQL connection string used to create the connection pool. |
| Type | String in PostgreSQL URI form: `postgresql://<user>:<password>@<host>:<port>/<database>`. |
| Required | Yes. |
| Default | None. When unset, the `pg` library falls back to its own defaults (`PGHOST`, `PGUSER`, and similar variables, then localhost), which is never what airDash wants. |
| Read by | `api/src/database.js`, at module load, once. |
| Sensitive | Yes. Contains the database password. |
| Restart required | Yes. |
| When missing or invalid | `migrate()` fails on its first query with `ECONNREFUSED`, `password authentication failed`, or `database "..." does not exist`, and the process exits before listening. Under PM2 this appears as rising `unstable restarts`. |
| Safe example | `postgresql://airdash:<local-password>@127.0.0.1:5432/airdash`, where `<local-password>` is the password you chose for the local database role |
| Production shape | Points at the `dashyden` database in the `dashy-postgres` container. All airDash objects are in the `airdash` schema inside that database; the schema is not part of the URL. |
| Related | `PGSSLMODE` and other `pg` environment variables are honored by the library but are not used by airDash. |

### AUTH_URL

| Property | Value |
|---|---|
| Purpose | The endpoint that converts a browser cookie into a user identity. The API forwards the incoming `Cookie` header to this URL with a five-second timeout and expects `{"user":{"id":...}}`. |
| Type | Absolute HTTP or HTTPS URL. |
| Required | Yes for any authenticated route. Public routes work without it. |
| Default | `http://127.0.0.1:3002/auth/me`, the dashydoggo.com Discord login service on the production host. |
| Read by | `api/src/auth.js`, at module load. |
| Sensitive | No. |
| Restart required | Yes. |
| When missing | The default is used, which is correct on the production host and wrong everywhere else. |
| When unreachable or returning non-2xx | Every request to an authenticated route returns `401 Discord sign-in required` (or `403 Owner access required`), because `authenticatedUser` returns `null` on any failure. Public routes are unaffected. |
| Safe example | `http://127.0.0.1:39151/auth/me` for the mock service in [local development](local-development.md#mock-authentication-service). |
| Related | `OWNER_DISCORD_ID`. |

### OWNER_DISCORD_ID

| Property | Value |
|---|---|
| Purpose | The Discord user ID that is granted the owner role. `requireOwner` compares the authenticated user's `id` to this value, and `/me` reports `isOwner` from it. |
| Type | String of digits, a Discord snowflake identifier. |
| Required | Yes for owner routes. |
| Default | `860900952097030184`, the production owner. |
| Read by | `api/src/auth.js`, at module load, exported as `OWNER_ID`. |
| Sensitive | No. A Discord user ID is a public identifier, not a credential. |
| Restart required | Yes. |
| When missing | The production owner's ID is used. On a local installation this means the mock user must use that ID to reach owner routes unless you set your own. |
| Safe example | `100000000000000001` |
| Related | The migration in `api/src/database.js` also contains a hard-coded `UPDATE` that sets rank and title for the production owner ID; that statement does not read this variable. |

### PORT

| Property | Value |
|---|---|
| Purpose | TCP port the Express server listens on, bound to `0.0.0.0`. |
| Type | Integer as a string. |
| Required | No. |
| Default | `3006`. |
| Read by | `api/src/server.js`, at module load, via `Number(process.env.PORT ?? 3006)`. |
| Sensitive | No. |
| Restart required | Yes. |
| When invalid | A non-numeric value becomes `NaN`, and `app.listen(NaN)` throws `RangeError [ERR_SOCKET_BAD_PORT]: options.port should be >= 0 and < 65536. Received type number (NaN).` |
| Safe example | `39150` for a temporary smoke-test process. |
| Related | The Caddyfile forwards to `172.17.0.1:3006`; changing the production port requires a matching Caddy change. `ecosystem.config.js` also sets `PORT: "3006"`. |

### PROFILE_IMAGE_DIR

| Property | Value |
|---|---|
| Purpose | Directory where uploaded pilot profile images are written by `POST /profile/image`. |
| Type | Absolute or relative filesystem path. A relative path is resolved against the process working directory. |
| Required | No. |
| Default | `path.resolve(process.cwd(), "../site/downloads/profiles")`, which is `site/downloads/profiles/` when the API runs from `api/`. |
| Read by | `api/src/server.js`, inside the `/profile/image` handler, on every upload. |
| Sensitive | No. |
| Restart required | Yes. |
| When missing | The default is used. The handler creates the directory with mode `755` if it does not exist. |
| When invalid | `fs.mkdir` or `fs.writeFile` throws; the route responds `500` and the image is not saved. |
| Safe example | `/tmp/airdash-profiles` |
| Related | Nginx serves `site/downloads/` with a one-hour cache. The saved URL includes `?v=<timestamp>` so a replaced image is fetched fresh. The [data model](data-model.md#pilots) describes `pilots.profile_image_url`. |
| Not in `.env.example` | Correct. This variable is an override for non-standard layouts and is not needed in a normal installation. |

### SIMBRIEF_AIRFRAME

| Property | Value |
|---|---|
| Purpose | The SimBrief airframe type sent as the `type` parameter of the generated dispatch URL. |
| Type | SimBrief aircraft type code. |
| Required | No. |
| Default | `BCS3` (Airbus A220-300). |
| Read by | `api/src/server.js`, inside `GET /assignments/:id/simbrief-generate`, on every request, via `process.env.SIMBRIEF_AIRFRAME \|\| "BCS3"`. |
| Sensitive | No. |
| Restart required | Yes. |
| When invalid | SimBrief rejects or ignores the unknown type when the pilot opens the generated URL. Separately, imports are rejected unless the plan's `aircraftIcao` is exactly `BCS3`; that check is hard-coded and does not read this variable. |
| Safe example | `BCS3` |

### VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY

| Property | Value |
|---|---|
| Purpose | The Voluntary Application Server Identification (VAPID) key pair that identifies the airDash server to browser push services. The public key is sent to browsers so they can subscribe; the private key signs each push message. |
| Type | Base64url strings as produced by `npx --yes web-push@3.6.7 generate-vapid-keys`. |
| Required | Only for Web Push. |
| Default | Empty string for each. |
| Read by | `api/src/push.js`, at module load. Both must be non-empty for `configured` to be true. |
| Sensitive | The private key is a secret. The public key is sent to every subscribing browser and is not secret. |
| Restart required | Yes. |
| When either is missing | The API logs `[airdash-push] VAPID keys are not configured; background push is disabled` at startup. `GET /push/public-key`, `POST /push/subscriptions`, and `POST /push/test` return `503 Web Push is not configured`. The in-app notification bell continues to work. |
| When invalid | `webpush.setVapidDetails` throws at startup with a message describing the malformed key, and the process exits. |
| Safe example | Leave empty locally, or generate a throwaway pair. Never reuse the production pair on another machine, because subscriptions are bound to the public key. |
| Related | `VAPID_SUBJECT`; the `push_subscriptions` and `notification_history` tables. |

### VAPID_SUBJECT

| Property | Value |
|---|---|
| Purpose | A contact URL or `mailto:` address that push services can use to reach the operator. Sent with every push message. |
| Type | `https://` URL or `mailto:` URI. |
| Required | Only when the VAPID keys are set. |
| Default | `https://air.dashydoggo.com`. |
| Read by | `api/src/push.js`, at module load. |
| Sensitive | No. |
| Restart required | Yes. |
| When invalid | `webpush.setVapidDetails` throws at startup. |
| Safe example | `http://localhost:5174` is accepted by the library for local use; production uses the default. |

### NODE_ENV

`ecosystem.config.js` sets `NODE_ENV: "production"` for the PM2 process. No airDash source file reads `NODE_ENV`, and Express 5 does not change behavior based on it except for its default error handler's stack-trace output. The variable is therefore harmless but has no documented effect. It is listed here so that nobody searches for its meaning.

### Variables that affect tooling but not airDash

`NO_COLOR` and `FORCE_COLOR` are read by Node.js itself; when both are set, Node.js prints a warning on every start. `npm_config_*` variables affect npm. `PG*` variables are read by the `pg` library only when `DATABASE_URL` omits a component.

## Template file

`api/.env.example` is the committed template. Copy it to `api/.env` and fill in the values. Its contents at this commit are:

```text
DATABASE_URL=postgresql://airdash@127.0.0.1:5432/airdash
AUTH_URL=https://example.com/api/auth/me
OWNER_DISCORD_ID=replace-with-owner-discord-id
PORT=3006
SIMBRIEF_AIRFRAME=BCS3
VAPID_SUBJECT=https://example.com
VAPID_PUBLIC_KEY=replace-with-public-key
VAPID_PRIVATE_KEY=replace-with-private-key
```

`PROFILE_IMAGE_DIR` is deliberately absent because its default is correct for the repository layout. The `VAPID_*` placeholder values are not valid keys; leave them empty or replace them. With the placeholders in place, `setVapidDetails` throws `Vapid public key should be 65 bytes long when decoded.` at startup and the API does not start.

## Database-backed settings

The `airdash.settings` table stores operational settings as JSON documents keyed by name. It is read at request time, so changes take effect without a restart.

| Key | Field | Type | Default | Purpose | Changed by | Read by |
|---|---|---|---|---|---|---|
| `operations` | `autoApprovePireps` | boolean | `false` | When true, a submitted pilot report is approved immediately in the same request, with reviewer `null` and notes `Automatically approved`, and an `PIREP_AUTO_APPROVED` audit event is written. | `POST /admin/settings` from the Administration Settings tab | `POST /pireps` |

The row is seeded by `migrate()` with `INSERT ... ON CONFLICT (key) DO NOTHING`. `POST /admin/settings` updates only the `autoApprovePireps` field with `jsonb_set`, so other fields added later to the same document are preserved.

## Hard-coded operational constants

These values shape behavior but are constants in source, not configuration. Changing any of them is a code change that follows the [contributing](contributing.md) process.

| Constant | Value | Location | Effect |
|---|---|---|---|
| Allowed mutation origins | `https://air.dashydoggo.com`, `http://localhost:5174` | `api/src/auth.js`, `requireAirDashOrigin` | Any other `Origin` on a non-read request is rejected with `403`. |
| Authentication timeout | 5000 ms | `api/src/auth.js` | Slow auth service means `401`. |
| JSON body limit | `2mb` | `api/src/server.js` | Larger request bodies are rejected by Express with `413`. |
| Assignment filing deadline | block minutes + 150 | `api/src/server.js`, booking and start handlers | `expires_at` for `BOOKED` and `ACTIVE` assignments. |
| Expiry job interval | 5 minutes | `api/src/server.js` | How often expired assignments and ended holds are released. |
| Schedule job interval | 10 minutes | `api/src/server.js` | How often schedule rows are generated and cleaned. |
| Schedule window | today and tomorrow, 2 slots per active route, 05:00 to 23:00 UTC | `api/src/server.js`, `ensureSchedule` | Deterministic departures derived from a hash of route, day, and slot. |
| Departed row retention | 6 hours | `ensureSchedule` | Departed schedule rows are deleted after this. |
| Push worker interval | 60 seconds, first run after 5 seconds | `api/src/push.js`, `startPushWorker` | How often pending notifications are pushed. |
| Push message TTL | 86400 seconds | `api/src/push.js` | How long a push service holds an undelivered message. |
| Hard landing threshold | landing rate at or below -450 fpm | `api/src/server.js`, `applyPirepReview` | Triggers a 48-hour `INSPECTION`. |
| Inspection duration | 48 hours | `applyPirepReview` and `POST /admin/aircraft/:registration/status` | Released by the expiry job. |
| Non-complete credit multiplier | 0.9 | `api/src/flightOutcome.js` | Diverted and incomplete reports earn 90 percent of eligible block time. |
| Decision point | progress ratio 0.5 | `api/src/flightOutcome.js` | Incomplete flights past this point reposition to the filed alternate. |
| Standard mission experience multiplier | `min(2.5, 1 + minutes / 240 * 1.5)` | `api/src/recoveryMissions.js` | Longer standard missions earn more experience; recovery ferries earn 1.0. |
| Streak bonus | 0 percent below day 3, then 5 percent per day, capped at 15 | `api/src/streaks.js` | Applied to base experience on approval. |
| Experience per level | 600 | `web/src/App.tsx`, `XP_PER_LEVEL` | Display only. |
| SimBrief fetch limits | 2,000,000 bytes, 15 seconds | `api/src/integrations.js` | Larger or slower responses fail with `413` or a timeout. |
| Volanta fetch limits | 16,000,000 bytes, 20 seconds | `api/src/integrations.js` | Same. |
| Profile image limits | PNG, JPEG, or WebP; 128 bytes to 1,500,000 bytes | `POST /profile/image` | Enforced on the decoded image. |
| Time compression detection | ratio at or above 1.1 and at least 300 seconds difference | `api/src/integrations.js`, `importVolanta` | Flags reports where simulator time ran faster than real time. |
| Notification history window | 7 days for most groups, 30 minutes for filing reminders | `api/src/notifications.js` | Which records become notifications. |
| Public news cache | `Cache-Control: public, max-age=60` | `/news` and `/news/:slug` | Browsers and Caddy may reuse the response for a minute. |

## Build configuration

### web/vite.config.ts

| Setting | Value | Effect |
|---|---|---|
| `plugins` | `[react()]` | Enables JSX transformation and fast refresh. |
| `build.outDir` | `path.resolve(__dirname, "../site")` | Output goes to `site/` at the repository root. |
| `build.assetsDir` | `"app-assets"` | Hashed bundles go to `site/app-assets/`. |
| `build.emptyOutDir` | `false` | The build never deletes existing files in `site/`, because `site/assets/` and `site/downloads/` hold content no build regenerates. Old hashed bundles therefore accumulate. |
| `server.port` | `5174` | Development server port, which must match the allowed origin in `api/src/auth.js`. |
| `server.proxy` | `"/api": "http://127.0.0.1:3006"` | Forwards API calls without removing the prefix. See the [known limitation](known-limitations.md#vite-development-proxy-does-not-strip-the-api-prefix). |

### web/tsconfig.json and web/tsconfig.app.json

`tsconfig.json` is a solution file that references `tsconfig.app.json`; `tsc -b` builds the referenced project. `tsconfig.app.json` targets ES2022, uses the `Bundler` module resolution strategy, enables `strict`, `isolatedModules`, and `noEmit` (Vite emits the JavaScript, not `tsc`), and includes only `src/`. The `react-jsx` setting lets `.tsx` files omit `import React`.

### Package scripts

`api/package.json` and `web/package.json` define the scripts listed in the [local development command reference](local-development.md#command-reference). The `postbuild` script in `web/package.json` runs automatically after `build` and normalizes permissions in `site/`.

## Runtime configuration files

### api/ecosystem.config.js

The PM2 process definition for production:

```js
export default {
  apps: [
    {
      name: "airdash-api",
      script: "src/server.js",
      cwd: "/opt/dashy-database/projects/airdash/api",
      env: {
        NODE_ENV: "production",
        PORT: "3006",
      },
    },
  ],
}
```

PM2 starts `node src/server.js` with the given working directory, so `dotenv` finds `api/.env` there. Only `NODE_ENV` and `PORT` are set by PM2; every other variable comes from `.env`. The file is used by `pm2 start ecosystem.config.js` during [recovery](backup-and-recovery.md#recover-the-pm2-process) and is not read by a running process.

### nginx.conf

Mounted read-only into the `dashy-airdash` container as `/etc/nginx/conf.d/default.conf`. It listens on port 80 inside the container, serves `/usr/share/nginx/html` (the bind-mounted `site/`), and sets cache headers per path:

| Location | Cache-Control | Fallback |
|---|---|---|
| `/app-assets/` | `no-store, no-cache, must-revalidate, max-age=0` | `404` if the file is missing |
| `/downloads/` | `public, max-age=3600`, plus `X-Content-Type-Options: nosniff` | `404` |
| `/assets/` | `public, max-age=86400` | `404` |
| `/` | `no-store, no-cache, must-revalidate, max-age=0` | `index.html`, so client-side routes such as `/portal` load the application |

Changing this file requires `docker exec dashy-airdash nginx -t` and `nginx -s reload`; see [deployment](deployment.md#deploy-an-nginx-configuration-change).

### Caddyfile

Located outside the repository at `/opt/dashy-database/configs/Caddyfile` on the production host and shared with every other dashydoggo.com service. The airDash block routes `/api/*` to the API after removing the prefix, and everything else to the Nginx container:

```text
air.dashydoggo.com {
  handle /api/* {
    uri strip_prefix /api
    reverse_proxy 172.17.0.1:3006
  }
  handle {
    reverse_proxy dashy-airdash:80
  }
}
```

`172.17.0.1` is the default Docker bridge gateway, the address at which a container reaches the host. Caddy obtains and renews the TLS certificate automatically. See [deployment](deployment.md#deploy-a-caddy-configuration-change) for the change procedure and its blast radius.

### .gitattributes and .gitignore

`.gitattributes` forces LF line endings on every text file type in the repository and marks images, archives, presentations, and video as binary, so that contributors on Windows do not introduce CRLF line endings. `.gitignore` excludes dependencies, environment files, generated output, tooling state, Python caches, editor files, and generated GSX archives. Both are documented in the [repository guide](repository-guide.md#root-files).
