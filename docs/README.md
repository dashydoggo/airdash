# airDash documentation

This documentation explains how airDash is structured, how requests move through the system, how to change source code safely, how to validate a release, and how to operate or recover the production service. The intended reader does not need prior experience with React, Node.js, PostgreSQL, Docker, Nginx, Caddy, or PM2.

**Last verified:** September 10, 2026

## Documentation map

| Guide | Purpose |
|---|---|
| [Platform architecture](architecture.md) | Explains components, request flow, source layout, runtime topology, security boundaries, and current limitations. |
| [Backend and database reference](backend-reference.md) | Describes API route groups, authentication middleware, integrations, background jobs, and all 13 database tables. |
| [Development guide](development.md) | Explains prerequisites, safe editing, frontend and API development, validation commands, and debugging. |
| [Deployment and operations guide](deployment-and-operations.md) | Provides backup, frontend deployment, API deployment, health checks, logging, rollback, and recovery procedures. |
| [Common change recipes](change-recipes.md) | Provides inspectable examples for text, icons, CSS, routes, API fields, database migrations, notifications, and static files. |
| [PowerPoint and MSFS video automation](powerpoint-automation.md) | Explains the Windows PowerPoint template, dynamic assignment fields, exporter, launcher, and troubleshooting. |
| [Platform design](designdoc.md) | Records product decisions and historical plans. It is not the current operations manual. |
| [Documentation style standard](documentation-style.md) | Defines the required writing style for durable airDash documentation. |

## Zero-to-hero learning path

Follow these sections in order when learning the platform.

### 1. Learn the source and runtime distinction

Read [Source layout](architecture.md#source-layout) and [Production runtime topology](architecture.md#production-runtime-topology).

The most important distinction is that source files and production files are different artifacts:

- `web/src/` contains editable frontend source.
- `api/src/` contains editable API source.
- `site/` contains the published static website.
- The PM2 process has API code loaded in memory until it is restarted.
- PostgreSQL stores durable operational data separately from source code.

### 2. Learn the request path

Read [Request flow](architecture.md#request-flow).

A browser request first reaches Caddy. Caddy sends page and asset requests to Nginx, but sends `/api/*` requests to the PM2 API process. The API reads PostgreSQL and validates the existing dashydoggo.com Discord session when authentication is required.

### 3. Learn safe local inspection

Read [Read-only inspection](development.md#read-only-inspection).

Start with commands that do not change anything:

```bash
cd /opt/dashy-database/projects/airdash
curl -fsS https://air.dashydoggo.com/api/health
pm2 show airdash-api
docker ps --filter name=dashy-airdash --filter name=dashy-postgres --filter name=dashy-caddy
```

### 4. Make a frontend-only change

Follow [Change the Portal pilot and base line](change-recipes.md#change-the-portal-pilot-and-base-line). This worked example changes a text-only `Page` intro into React content containing a home icon and the value `AD0001; KATL.`

A frontend-only change normally touches `web/src/`, passes TypeScript and an isolated build, and then publishes through `npm --prefix web run build`. It does not require an API restart.

### 5. Make a backend change

Read [Backend development](development.md#backend-development) and [Deploy an API-only change](deployment-and-operations.md#deploy-an-api-only-change).

An API change normally touches `api/src/`, passes the API syntax check and applicable tests, and requires `pm2 restart airdash-api` before production uses the new code.

### 6. Understand database changes

Read [Database architecture](backend-reference.md#database-architecture) and [Add a database column](change-recipes.md#add-a-database-column).

The migration function is additive and runs at API startup. A database change can affect durable data, so create a database backup before a substantive schema or data migration.

### 7. Learn deployment and rollback

Read the complete [deployment and operations guide](deployment-and-operations.md).

The current project does not have Git history. A release backup is therefore the rollback boundary. Do not skip the backup step.

### 8. Learn the Windows automation

Read [PowerPoint and MSFS video automation](powerpoint-automation.md) after understanding the website and API. The PowerPoint exporter consumes the public live-flight API and must run in the interactive Windows desktop session.

## Change classification

Use this table to determine which validation and deployment procedure applies.

| Changed area | Examples | Build required | PM2 restart required | Database backup recommended |
|---|---|---:|---:|---:|
| Frontend source | JSX, CSS, icons, browser state | Yes | No | No |
| API source | Endpoint, validation, response field | No frontend build unless UI also changed | Yes | Usually no |
| Database migration | Table, column, index, seed | No frontend build unless UI also changed | Yes | Yes |
| Static site file | Image, download, manifest | Usually no Vite build | No | No |
| Nginx configuration | Cache or SPA routing | No | No, but Nginx reload or recreation may be needed | No |
| Caddy configuration | Domain, TLS, reverse proxy | No | No, but shared Caddy reload is required | No |
| Windows automation | PowerShell exporter or launcher | No | Only if API payload also changes | No |

## Current operational constraints

- The project has no dedicated staging environment.
- Vite development mode proxies to the production API on host port 3006.
- The project is excluded from Git tracking.
- Frontend builds publish directly into the live bind-mounted `site/` directory.
- API restarts cause a brief interruption for in-flight API requests.
- Database migrations are implemented in application code rather than a versioned migration framework.
- Old hashed frontend bundles accumulate because `emptyOutDir` is disabled to preserve manually managed static files and downloads.
- Notification dismissal state is browser-specific local storage, not account-wide server state.

These constraints do not prevent safe operation, but each constraint changes how a developer must validate, back up, and deploy a change.
