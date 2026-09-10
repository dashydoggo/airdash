# airDash platform architecture

airDash is a single-page React application backed by an Express API and a PostgreSQL schema. Production combines host processes and Docker containers. This guide describes the current implementation rather than the earlier proposed architecture.

## System purpose

The platform supports four related audiences:

- Public visitors view airline identity, routes, fleet status, pilots, schedules, and live flights.
- Approved pilots book flights, start assignments, prepare dispatch data, submit pilot reports, view progress, and download liveries.
- The owner reviews applications and pilot reports, manages pilots, bases, aircraft, settings, audit records, and announcements.
- Windows automation reads public live-flight data and builds an MSFS press-start video from a PowerPoint template.

## Request flow

The production request path is:

```text
Browser
  |
  | HTTPS for air.dashydoggo.com
  v
Caddy container: dashy-caddy
  |
  | Page, asset, and download requests
  +----------------------> Nginx container: dashy-airdash
  |                          |
  |                          +--> Read-only bind mount: site/
  |
  | /api/* requests, with /api removed
  +----------------------> PM2 process: airdash-api on host port 3006
                             |
                             +--> PostgreSQL container: dashy-postgres
                             +--> Auth service on host port 3002
                             +--> SimBrief HTTPS API
                             +--> Volanta HTTPS API
```

Caddy terminates Transport Layer Security, which is the HTTPS encryption boundary. Caddy routes static requests to the Nginx container and API requests to the host. The browser therefore uses one origin, `https://air.dashydoggo.com`, for both the website and API.

## Production runtime topology

| Component | Runtime | Current resource | Responsibility |
|---|---|---|---|
| TLS and edge routing | Docker | `dashy-caddy` | Terminates HTTPS and routes the airDash domain. |
| Static frontend | Docker | `dashy-airdash`, image `nginx:alpine` | Serves `site/`, applies cache headers, and falls back to `index.html` for client routes. |
| API | Host PM2 | `airdash-api`, port 3006 | Runs Express routes, migrations, schedule maintenance, and assignment expiry. |
| Database | Docker | `dashy-postgres`, PostgreSQL 16 with pgvector image | Stores the `airdash` schema and durable operational data. |
| Authentication | Host service | `AUTH_URL`, normally port 3002 | Resolves the existing Discord login cookie into a user identity. |
| Browser | User device | React application | Renders pages, stores transient browser state, and calls `/api`. |
| PowerPoint automation | Windows desktop | PowerShell and PowerPoint COM | Builds generated presentations and MSFS videos from `/api/live`. |

The static container has these read-only mounts:

```text
/opt/dashy-database/projects/airdash/site
  to /usr/share/nginx/html

/opt/dashy-database/projects/airdash/nginx.conf
  to /etc/nginx/conf.d/default.conf
```

Because `site/` is a bind mount, a successful frontend build becomes visible without restarting Nginx.

The Caddy source configuration is:

```text
/opt/dashy-database/configs/Caddyfile
```

The airDash site block strips `/api` and forwards API traffic to `172.17.0.1:3006`. Static traffic goes to `dashy-airdash:80` over the `docker_web` network.

## Source layout

```text
airdash/
├── README.md
├── nginx.conf
├── api/
│   ├── .env
│   ├── ecosystem.config.js
│   ├── package.json
│   ├── scripts/
│   │   ├── migrate.js
│   │   └── test-streaks.js
│   └── src/
│       ├── auth.js
│       ├── database.js
│       ├── integrations.js
│       ├── server.js
│       └── streaks.js
├── docs/
├── gsx/
├── livery-templates/
├── scripts/
├── site/
│   ├── index.html
│   ├── app-assets/
│   ├── assets/
│   └── downloads/
└── web/
    ├── index.html
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx
        ├── api.ts
        ├── flightPlan.ts
        ├── hangarQuips.ts
        ├── main.tsx
        ├── notificationState.ts
        ├── styles.css
        ├── types.ts
        └── volanta.ts
```

### Source and generated files

| Path | Classification | Edit directly |
|---|---|---:|
| `web/src/` | Frontend source | Yes |
| `api/src/` | Backend source | Yes |
| `docs/` | Durable documentation | Yes |
| `scripts/` | Build and Windows automation source | Yes |
| `site/index.html` | Generated frontend entry point | No |
| `site/app-assets/index-*.js` | Generated JavaScript bundles | No |
| `site/app-assets/index-*.css` | Generated CSS bundles | No |
| `site/assets/` | Manually managed static assets | Yes, with backup |
| `site/downloads/` | Published packages and manifests | Yes, with package-specific process |

**Important:** Never fix a frontend problem by editing a hashed file in `site/app-assets/`. The next build replaces the active hash and discards the manual change. Edit `web/src/` and rebuild.

## Frontend architecture

The frontend uses React 19, React Router 7, Vite 8, TypeScript 6, Framer Motion, Leaflet, React Leaflet, and React Icons.

### Application entry

`web/src/main.tsx` mounts the React application. `web/src/App.tsx` currently contains the application shell, shared components, and page components. This large file is a monolith by historical growth rather than a deliberate modular boundary.

The primary page components are:

- `Home`
- `Join`
- `Portal`
- `Announcements`
- `Flights`
- `Schedule`
- `Report`
- `Fleet`
- `Profile`
- `Pilots`
- `Missions`
- `Health`
- `Admin`

`Layout` owns navigation, profile menus, the notification bell, and the site footer. `Page` provides the shared page heading. Smaller components include `Button`, `Status`, `ExpiryBar`, `Metric`, and the confirmation dialogs.

### Routing

React Router handles browser routes. Nginx uses `try_files` to return `index.html` for routes that do not correspond to physical files. This fallback allows a direct request to `/portal` or `/fleet` to load the React application.

### API client

`web/src/api.ts` prefixes requests with `/api`, sends cookies with `credentials: "include"`, and converts non-success responses into `ApiError` objects. Vite development mode proxies `/api` to `http://127.0.0.1:3006`.

### Shared application state

The `AppContext` in `App.tsx` stores:

- Public data
- The authenticated account and assignment
- Loading state
- Toast notifications
- Notification payloads
- Refresh functions
- Pilot brief controls

Notification dismissal is implemented in `web/src/notificationState.ts`. Dismissed notification fingerprints are stored per browser, user, and role in local storage. Polling continues every 60 seconds, but dismissed records are filtered before `Layout` or `Portal` receives them.

### Styling

`web/src/styles.css` contains the complete application style system. The project uses one stylesheet rather than CSS modules or a component library. Most design changes therefore require coordinated JSX class names and stylesheet rules.

## Backend architecture

The API uses Express 5 and the `pg` PostgreSQL client. `api/src/server.js` defines 49 routes and starts the server on `0.0.0.0:3006` by default.

### Backend modules

| File | Responsibility |
|---|---|
| `api/src/server.js` | Express middleware, route handlers, background schedules, and process startup. |
| `api/src/database.js` | Pool creation, idempotent schema migration, seed data, audit writes, and organization-update writes. |
| `api/src/auth.js` | Cookie validation through the shared auth service, owner checks, and mutation-origin validation. |
| `api/src/integrations.js` | Gate generation, SimBrief parsing, and Volanta import. |
| `api/src/streaks.js` | Flight-day streaks, route continuity, and experience bonus calculations. |

The API calls `await migrate()` before it starts listening. The migration function uses `CREATE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and guarded seed operations. This makes normal startup idempotent, which means repeated startup should converge on the same schema.

### Background work

The API schedules two in-process jobs:

- Assignment expiry runs every five minutes.
- Schedule generation and cleanup runs every ten minutes.

These jobs run only while the PM2 process is online. PM2 restarts the API after failure and systemd resurrects the saved PM2 process list after host startup.

## Database architecture

The `airdash` schema shares the `dashyden` PostgreSQL database with other homelab services. The API accesses PostgreSQL through `DATABASE_URL` in `api/.env`.

The schema currently contains 13 tables. See [Backend and database reference](backend-reference.md#database-tables) for table purposes and relationships.

The PostgreSQL container uses the Docker volume:

```text
/var/lib/docker/volumes/docker_pgdata/_data
```

Do not manipulate files in this volume directly. Use PostgreSQL tools such as `psql`, `pg_dump`, and `pg_restore`.

## Authentication and authorization

Authentication reuses the existing dashydoggo.com Discord session.

1. The browser sends the session cookie to airDash.
2. The API forwards that cookie to `AUTH_URL`.
3. The auth service returns a user object when the session is valid.
4. `requireUser` allows any authenticated user.
5. `requireOwner` also requires the configured owner Discord ID.

Mutation requests must have an allowed `Origin` header. Current allowed origins are:

```text
https://air.dashydoggo.com
http://localhost:5174
```

This origin check reduces cross-site request forgery exposure. It does not replace authentication or authorization.

## External integrations

| Integration | Direction | Purpose |
|---|---|---|
| Discord auth service | API to host service | Resolves the login cookie. |
| SimBrief | API to HTTPS service | Reads generated operational flight plans and validates LIDO format. |
| Volanta | API to HTTPS service | Reads public flight data for route, timing, landing, and time-compression validation. |
| VATSIM | Browser link generation | Opens a pre-filled flight-plan page. |
| Volanta desktop URI | Browser to local protocol handler | Opens the installed Volanta application. |
| PowerPoint COM | Windows PowerShell to desktop Office | Creates generated presentations and videos. |

## Build and publication architecture

Vite is configured with:

```text
outDir: ../site
assetsDir: app-assets
emptyOutDir: false
```

`emptyOutDir: false` is required because `site/` also contains manually managed assets and downloads that a normal Vite clean would remove. The tradeoff is that old hashed bundles accumulate and require deliberate cleanup.

A production frontend build performs these actions:

1. TypeScript compiles the frontend.
2. Vite creates a new hashed JavaScript bundle.
3. Vite creates a new hashed CSS bundle when CSS changed.
4. Vite rewrites `site/index.html` to reference the new hashes.
5. The post-build script normalizes directory and file permissions.
6. Nginx immediately sees the changed bind-mounted files.

An API source edit does not affect the running process until PM2 restarts it.

## Security boundaries

- Secrets are stored in `api/.env`, not in browser code.
- Public browser bundles must never contain database passwords or private tokens.
- Owner access is enforced by API middleware, not only by hidden UI controls.
- Download paths are constrained to published site files.
- SimBrief URLs are restricted to the official host and expected path format.
- External responses have size limits and timeouts.
- The PowerPoint exporter refuses non-interactive SSH or service sessions.
- Caddy and PostgreSQL are shared infrastructure. Changes to either have impact outside airDash.

## Current technical debt and limits

### Source is not version-controlled

The parent `.gitignore` excludes `projects/`. Release backups are mandatory until airDash has a dedicated Git repository.

### The frontend is concentrated in one file

`App.tsx` is large. This makes searching simple but raises merge and regression risk. Future extraction should preserve behavior and proceed one page or shared component at a time.

### Database migrations are not versioned

`database.js` contains both initial schema and later alterations. The migration remains functional, but a numbered migration directory would provide clearer history and rollback planning.

### There is no staging environment

Isolated builds and temporary API ports provide pre-production validation, but production PostgreSQL remains the only operational data environment.

### The static container is not in the central Compose file

`dashy-airdash` is a manually configured Nginx container with no Docker Compose labels. Recovery therefore uses the documented mount, network, image, and restart settings rather than `docker compose up`.

### Browser state is device-specific

Notification dismissals, coachmark state, and seen fingerprints use local storage. Clearing them on one browser does not clear another browser or device.
