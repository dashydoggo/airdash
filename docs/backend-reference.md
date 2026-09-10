# airDash backend and database reference

The airDash backend is an Express application that exposes public, pilot, and owner operations. The backend owns durable state transitions and treats the frontend as an untrusted client. PostgreSQL stores operational records in the `airdash` schema.

## API process

The production process is:

```text
Name: airdash-api
Manager: PM2
Script: /opt/dashy-database/projects/airdash/api/src/server.js
Working directory: /opt/dashy-database/projects/airdash/api
Port: 3006
```

The API starts only after `migrate()` completes successfully.

## Environment variables

`api/.env` contains the following keys. Do not place their values in documentation, commits, screenshots, or browser code.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string for the `dashyden` database. |
| `AUTH_URL` | Shared authentication endpoint used to validate the Discord session cookie. |
| `OWNER_DISCORD_ID` | Discord user ID allowed to use owner-only routes. |
| `PORT` | API listen port, normally 3006. |

The file should remain readable only by the service owner.

```bash
chmod 600 /opt/dashy-database/projects/airdash/api/.env
```

## Authorization classes

| Class | Middleware | Behavior |
|---|---|---|
| Public | None | Does not require a Discord session. |
| Authenticated | `requireUser` | Requires a valid shared auth cookie. |
| Owner | `requireOwner` | Requires the configured owner Discord ID. |
| Mutation origin | `requireAirDashOrigin` | Rejects non-read requests from an unapproved origin. |

## API routes

The production Caddy proxy removes the `/api` prefix before a request reaches Express. The browser calls `/api/health`, while Express defines `/health`.

### Public information

| Method | Express path | Purpose |
|---|---|---|
| GET | `/health` | Reports API and database health. |
| GET | `/public` | Returns aircraft, routes, bases, public pilots, and top pilot. |
| GET | `/schedule` | Returns current schedule rows and active unscheduled assignments. |
| GET | `/live` | Returns booked, active, and report-submitted flights for maps and PowerPoint automation. |
| GET | `/hub-health` | Returns base capacity, demand, trend, and candidate station statistics. |
| GET | `/liveries/:registration/download` | Downloads the default MSFS 2024 package. |
| GET | `/liveries/:registration/:simulator/download` | Downloads a selected simulator package. |

### Profile and pilot directory

| Method | Express path | Authorization | Purpose |
|---|---|---|---|
| GET | `/profile` | User | Reads the current pilot profile and streaks. |
| POST | `/profile` | User | Updates profile, SimBrief name, and base request. |
| POST | `/profile/image` | User | Stores a validated profile image. |
| POST | `/profile/liveries/reset` | User | Clears the pilot's recorded package versions. |
| GET | `/pilots` | User | Lists approved pilots. |
| GET | `/pilots/:id` | User | Returns one pilot and recent flight history. |
| GET | `/me` | User | Returns account, application, pilot, assignment, downloads, and streaks. |

### Applications and organization updates

| Method | Express path | Authorization | Purpose |
|---|---|---|---|
| POST | `/applications` | User | Creates or resubmits a pilot application. |
| GET | `/org-updates` | User | Searches and paginates permanent announcements. |
| POST | `/admin/org-updates` | Owner | Publishes an organization update. |
| POST | `/admin/applications/:id/:decision` | Owner | Approves, returns, or rejects an application. |

### Flight assignment and dispatch

| Method | Express path | Authorization | Purpose |
|---|---|---|---|
| GET | `/flights` | User | Returns bookable routes and available aircraft. |
| POST | `/assignments` | User | Books a Board or Mission assignment. |
| POST | `/assignments/:id/start` | User | Changes `BOOKED` to `ACTIVE` and recalculates expiry. |
| POST | `/assignments/:id/cancel` | User | Applies structured cancellation and releases resources. |
| DELETE | `/assignments/:id` | User | Legacy assignment deletion path. Prefer structured cancellation. |
| POST | `/assignments/:id/gates` | User | Regenerates both gates. |
| POST | `/assignments/:id/departure-gate` | User | Replaces an occupied departure gate. |
| POST | `/assignments/:id/arrival-gate` | User | Replaces an occupied arrival gate. |
| GET | `/assignments/:id/simbrief-generate` | User | Builds a pre-filled SimBrief generation URL. |
| POST | `/assignments/:id/simbrief-fetch` | User | Fetches and saves the pilot's latest SimBrief OFP. |
| POST | `/assignments/:id/simbrief` | User | Imports a specific SimBrief XML URL. |
| POST | `/assignments/:id/volanta` | User | Attaches Volanta tracking data. |
| GET | `/assignments/history` | User | Returns assignment and cancellation history. |
| GET | `/missions` | User | Returns generated continuation missions. |

### Pilot reports

| Method | Express path | Authorization | Purpose |
|---|---|---|---|
| GET | `/pireps` | User | Returns the current pilot's report history. |
| POST | `/pireps` | User | Validates Volanta data and submits a pilot report. |
| POST | `/volanta/import` | User | Imports and validates a Volanta public flight. |
| POST | `/admin/pireps/:id/:decision` | Owner | Approves, returns, or rejects a report. |

### Notifications

| Method | Express path | Authorization | Purpose |
|---|---|---|---|
| GET | `/notifications` | User | Returns recent pilot report, progress, announcement, equipment, expiry, deadline, and gate-change notifications. |
| GET | `/admin/notifications` | Owner | Returns applications, reports, equipment, base requests, owner progress, and announcements. |

The API returns current notification candidates. The browser persists dismissal fingerprints in local storage and recalculates the visible count. New or changed records have different fingerprints and reappear.

### Owner administration

| Method | Express path | Authorization | Purpose |
|---|---|---|---|
| GET | `/admin/overview` | Owner | Returns the administration data set. |
| GET | `/admin/pilots/:id/flights` | Owner | Returns a pilot's complete assignment and report history. |
| POST | `/admin/pilots/:id/manage` | Owner | Changes pilot status or base. |
| POST | `/admin/pilots/:id/base` | Owner | Decides a base-change request. |
| DELETE | `/admin/assignments/:id` | Owner | Removes an assignment and reverses approved statistics when necessary. |
| POST | `/admin/bases` | Owner | Creates or updates a base. |
| DELETE | `/admin/bases/:code` | Owner | Removes an eligible base. |
| POST | `/admin/aircraft/:registration/status` | Owner | Sets available, maintenance, inspection, or retired state. |
| POST | `/admin/settings` | Owner | Updates operational settings. |

## Background jobs

### Assignment expiry

Every five minutes, the API:

1. Finds `BOOKED` or `ACTIVE` assignments past `expires_at`.
2. Marks the assignments `EXPIRED` with structured cancellation data.
3. Releases assigned aircraft.
4. Writes audit events.
5. Releases timed maintenance or inspection holds that have ended.

### Schedule maintenance

Every ten minutes, the API:

1. Ensures deterministic schedule rows exist for today and tomorrow.
2. Marks past open rows as departed.
3. Removes departed rows older than six hours.

The schedule job also runs once during API startup.

## External integration controls

### SimBrief

- Only HTTPS is accepted.
- The hostname must be `www.simbrief.com`.
- Imported URLs must match the expected flightplans XML path.
- Responses are limited to 2 MB.
- Requests time out after 15 seconds.
- Generated airDash dispatch URLs request the LIDO layout and send `D1` as the airline/commercial designator. They continue to send `AIR<number>` as the operational ATC callsign.
- Imported XML retains the provider's raw ICAO airline and ATC callsign, while airDash renders the numeric flight as `D1<number>` for its commercial identity.
- Manual imports and latest-OFP fetches accept any declared SimBrief layout because the standardized XML fields used by airDash are layout-independent. The imported layout is retained in the saved flight plan.
- Assignment origin, destination, aircraft type, registration, and fin are validated where applicable.

### Volanta

- A UUID is extracted from the public flight URL.
- Responses are limited to 16 MB.
- Requests time out after 20 seconds.
- Route and aircraft values are validated against the assignment.
- Real and simulated block times are compared for time compression.
- A landing rate at or below the configured hard-landing threshold creates a 48-hour inspection.

## Database architecture

The database name is `dashyden`, and all airDash objects are under the `airdash` schema. The migration entry point is `api/src/database.js`.

### Database tables

| Table | Purpose | Important relationships |
|---|---|---|
| `users` | Local cache of authenticated Discord identity and login status. | Parent of applications and pilots. |
| `applications` | Pilot application content and review decision. | One row per Discord user. |
| `pilots` | Approved pilot identity, profile, base, statistics, experience, rank, and integrations. | Primary key is Discord ID. |
| `bases` | Airport base metadata, coordinates, role, status, and display order. | Referenced logically by pilot base codes. |
| `aircraft` | Fleet identity, current airport, status, maintenance state, liveries, hours, cycles, and download totals. | Registration is the primary key. |
| `routes` | Published flight number, origin, destination, block time, days, and status. | Referenced by schedule and assignments. |
| `schedule` | Deterministic departure and arrival rows with optional assignment link. | References routes and assignments. |
| `assignments` | Pilot booking, route, aircraft, lifecycle, gates, dispatch, Volanta, source, and cancellation data. | References pilot, route, aircraft, and optional schedule. |
| `pireps` | Pilot report data, review status, Volanta evidence, credited time, and streak award snapshot. | One report per assignment. |
| `livery_downloads` | Per-pilot, per-aircraft, per-simulator recorded download version. | Composite primary key. |
| `org_updates` | Permanent organization announcements and optional pilot or aircraft association. | References users, pilots, and aircraft where present. |
| `audit_events` | Append-only operational audit records with JSON details. | Actor may reference a user. |
| `settings` | JSON operational settings keyed by name. | `operations` currently stores automatic report-review settings. |

### Important uniqueness rules

- Pilot numbers are unique.
- Aircraft fleet numbers are unique.
- Flight numbers are unique.
- Route origin and destination pairs are unique.
- One active assignment may use an aircraft at a time.
- One active assignment may belong to a pilot at a time.
- One pilot report may exist for an assignment.
- One schedule row may exist for a route and departure time.

### Assignment lifecycle

The primary assignment statuses are:

```text
BOOKED
ACTIVE
PIREP_SUBMITTED
COMPLETED
CANCELLED
EXPIRED
```

The frontend displays `ACTIVE` as `FLYING`. Database code and API requests must continue to use `ACTIVE`.

### Aircraft lifecycle

The active operational statuses include:

```text
PLANNED
AVAILABLE
ASSIGNED
MAINTENANCE
INSPECTION
RETIRED
INACTIVE
```

Maintenance is released manually unless it has a timed end. Inspection normally has a 48-hour end and is released by the background expiry job.

### Audit behavior

`audit()` writes action, actor, entity type, entity ID, JSON details, and timestamp. Audit records provide operational traceability for decisions such as application review, report review, aircraft status changes, gate changes, cancellation, and assignment expiry.

## Migration behavior

`migrate()` performs four categories of work:

1. Creates the schema, tables, sequences, and indexes when absent.
2. Adds columns and replaces constraints as the application evolves.
3. Inserts default settings and base records.
4. Seeds or updates fleet and route definitions.

**Important:** The migration is idempotent, but not transactionally versioned as a sequence of independent migration files. Back up the schema before a substantive migration and inspect every data-changing statement.

Run the migration manually with:

```bash
cd /opt/dashy-database/projects/airdash
npm --prefix api run migrate
```

Expected output:

```text
airDash database migration complete
```

## Safe read-only database inspection

List tables:

```bash
docker exec dashy-postgres \
  psql -U dashy -d dashyden -P pager=off \
  -c "SELECT table_name FROM information_schema.tables WHERE table_schema='airdash' ORDER BY table_name;"
```

Inspect current assignments without changing data:

```bash
docker exec dashy-postgres \
  psql -U dashy -d dashyden -P pager=off \
  -c "SELECT id, discord_id, registration, status, booked_at, expires_at FROM airdash.assignments ORDER BY booked_at DESC LIMIT 20;"
```

## Database backup

Create a private schema backup before a schema or risky data change:

```bash
umask 077
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
docker exec dashy-postgres \
  pg_dump -U dashy -d dashyden -n airdash -Fc \
  > "/opt/dashy-database/backups/airdash-db-$timestamp.dump"
```

**Warning:** Do not restore a database dump directly into production as an exploratory action. Inspect the dump and create a tested restore plan first. A restore can overwrite or conflict with current operational records.

## Diversions and incomplete flight reports

A pilot report has an `outcome_type` of `COMPLETED`, `DIVERTED`, or `INCOMPLETE`. The API derives the outcome from Volanta evidence during import and re-derives it during submission. The browser does not decide the outcome.

| Outcome | Detection | Aircraft position on approval | Pilot credit |
|---|---|---|---|
| `COMPLETED` | Volanta has verified arrival or on-block evidence and no diversion evidence. | Scheduled destination. | 100 percent of eligible verified block time. |
| `DIVERTED` | Volanta provides a diversion airport, diversion reason, or `hasDiverted=true` and has verified arrival evidence. | Volanta diversion airport when available. | 90 percent of eligible verified block time. |
| `INCOMPLETE` | Volanta ended the record but has no verified arrival or on-block evidence. | Filed SimBrief alternate after the 50 percent distance decision point; otherwise origin. | 90 percent of eligible verified block time. |

Volanta's `hasDiverted` field is not authoritative by itself. Some real diverted records report `hasDiverted=false` while also supplying `diversionAirportIcao` and `diversionReason`. The importer treats those explicit fields as diversion evidence.

The decision point uses `distanceFlownInNauticalMiles / plannedDistance`. It is a midpoint or equal-time-point proxy, not a true meteorological equal-time point, because airDash does not have independent route wind forecasts for each record.

Non-complete reports require a pilot-selected reason. `OTHER` additionally requires details. Approved non-complete reports:

- Store outcome, reason, details, verified actual destination when available, reposition airport, method, progress ratio, multiplier, and credited block minutes.
- Move the aircraft using actual operational minutes and one cycle.
- Credit pilot block time and base experience at 90 percent after time-compression protection.
- Do not increment completed-flight, assignment-completion, or mission-completion totals.
- Set the assignment status to `DIVERTED`.
- Write audit records at submission and approval.

A PIREP cannot be filed for a flight that has not ended. A `Completed` Volanta state plus an end timestamp can support an incomplete report even when no verified actual arrival exists.

### Missing landing rates

Volanta does not always provide a landing rate, especially for incomplete flights. airDash accepts only a nonzero root `landingRate` or an explicit event `landingRate`. Generic event `rate` fields are simulator-state values and are never treated as feet-per-minute landing data.

A missing, empty, or zero provider value is stored as SQL `NULL`. PostgreSQL `AVG` ignores `NULL`, so untracked landings do not affect pilot landing averages. The database constraint `pireps_landing_rate_nonzero` rejects future zero values, and average queries also exclude zero defensively.

### Diversion recovery ferries

An approved `DIVERTED` or `INCOMPLETE` PIREP can create an Operations recovery mission when the aircraft remains available at the recorded recovery airport and that airport differs from the original destination. The recovery mission uses a hidden `INACTIVE` AIR9xxx route so it does not appear on the public Flight Board. The assignment stores `mission_type='RECOVERY'` and `recovery_of_assignment_id` for traceability.

A recovery mission represents an aircraft ferry after the original passengers have been reaccommodated. SimBrief generation therefore sets `pax=0`, `cargo=0`, and an explicit ferry remark. Imported or fetched recovery OFPs are rejected unless both values are explicitly zero. Crew and standard operating equipment remain part of aircraft operating empty weight rather than passenger payload.

Approved recovery ferries earn normal minute-for-minute base experience rather than the scaled standard-mission multiplier. Normal streak bonuses still apply. The report counts as one approved flight and one completed mission.

### Public News Hub

`org_updates` remains the source for both pilot-only communications and public press releases. New records default to `is_public=FALSE`. Public routes return only rows with `is_public=TRUE`, a valid `slug`, and `published_at<=NOW()`.

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| GET | `/news` | Public | Lists published release metadata with search, category, limit, and offset filters. The full body and creator identity are omitted. |
| GET | `/news/:slug` | Public | Returns one explicitly published release with body, summary, generic byline, artwork, and publication date. |
| POST | `/admin/org-updates` | Owner | Creates either a private pilot update or an explicitly public News Hub release. |

Public release metadata includes `slug`, `summary`, `hero_image_url`, `author_name`, and `published_at`. Internal automatic updates and existing pilot announcements remain private unless an owner explicitly publishes them. Notification payloads use a 240-character summary rather than the full release body.
