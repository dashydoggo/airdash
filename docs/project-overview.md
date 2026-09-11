# Project overview

airDash is a virtual airline platform. A virtual airline is a hobby organization whose members fly simulated airline routes in a flight simulator and record the results as if they were airline operations. airDash provides the website, the rules, the data, and the downloadable content for one such airline, which operates the Airbus A220-300 across North America and the Caribbean under the callsign `AIR DASH` and the commercial designator `D1`.

## Purpose

The platform solves a coordination problem. Without it, a group of simulator pilots has no shared source of truth for which routes exist, which aircraft are where, who is flying what, whether a flight was actually completed, and how each pilot's record compares to the others. airDash provides that source of truth and enforces its rules on the server, so that the record is trustworthy even though every pilot runs the simulator on their own computer.

The platform therefore does four things:

1. It publishes the airline's identity, fleet, routes, and news to the public.
2. It lets approved pilots book a flight, prepare dispatch paperwork, fly it, and file a verified report.
3. It gives the owner tools to review applications and reports, manage the fleet and bases, and audit every decision.
4. It supplies downloadable simulator content and desktop automation that keep the simulator experience consistent with the website.

## Scope

### Supported use

- One airline, one owner, and any number of pilots who have a Discord account on the dashydoggo.com server.
- Microsoft Flight Simulator 2020 and Microsoft Flight Simulator 2024 as the simulators. Livery packages are built for both.
- The Airbus A220-300 (International Civil Aviation Organization type code `BCS3`) as the only aircraft type. SimBrief imports are rejected for any other type.
- SimBrief as the dispatch planning service, Volanta as the flight tracking and verification service, and VATSIM as the optional online air traffic control network.
- A fixed set of operating bases, currently Atlanta (`KATL`), Denver (`KDEN`), Santo Domingo (`MDSD`), and Spokane (`KGEG`), which the owner can extend.
- English as the only language of the interface and documentation.

### Unsupported use

- Multiple airlines or multiple owners. The owner is a single Discord user ID.
- Any authentication method other than the shared dashydoggo.com Discord session.
- Manual pilot reports without a Volanta flight record. Every report requires a public Volanta flight link.
- Real-time position tracking during a flight. The network map estimates positions from booking and start times.
- Mobile applications. The website is responsive, and Web Push works in browsers that support it, but there is no native app.
- Use of the API by third parties for authenticated operations. Authenticated routes accept only requests whose `Origin` header is the airDash site or the local Vite development server.

## Actors and roles

An actor is a person or system that interacts with the platform. A role is a set of permissions the platform grants an actor.

| Actor | Role | How the role is determined | What the role can do |
|---|---|---|---|
| Visitor | Public | No login | View the home page, News Hub, schedule, fleet and liveries, network health, and network map. Download liveries anonymously. |
| Signed-in user | Authenticated | Valid dashydoggo.com Discord session cookie | Everything a visitor can do, plus submit a pilot application and read announcements. |
| Pilot | Authenticated pilot | An `airdash.pilots` row exists with `status='ACTIVE'` | Everything an authenticated user can do, plus book and fly assignments, use dispatch tools, file reports, manage a profile, view the pilot directory, and receive notifications. |
| Owner | Owner | Discord ID equals `OWNER_DISCORD_ID` | Everything a pilot can do, plus review applications and reports, manage pilots, bases, aircraft, settings, and announcements, and read the audit log. |
| Windows automation | Public | None | Reads `/api/live` to render the simulator start video. |
| Background jobs | Internal | Runs inside the API process | Expires assignments, releases aircraft holds, maintains the schedule, and delivers Web Push notifications. |

The roles are cumulative. Authorization is enforced by API middleware on every request, not by hiding interface controls. See [security](security.md#authorization-model).

## The core workflow

The following sequence describes one complete flight from the pilot's perspective. Each step names the page and the API route involved so that you can find the code later.

1. The visitor signs in with Discord and submits an application on the Join page (`POST /applications`).
2. The owner approves the application in Administration (`POST /admin/applications/:id/approved`). The API creates a pilot record with the next pilot number, such as `AD0007`, and publishes a `NEW_PILOT` announcement.
3. The pilot books a flight from the Flight Board or the Missions page (`POST /assignments`). The Schedule page is a read-only timetable at this commit; the API accepts a `scheduleId` and `source='SCHEDULE'`, but the frontend does not send them. The API assigns a departure gate and an arrival gate, marks the aircraft `ASSIGNED`, and sets a filing deadline equal to the block time plus 150 minutes.
4. In the Hangar (the pilot portal), the pilot generates a SimBrief plan (`GET /assignments/:id/simbrief-generate`), imports it (`POST /assignments/:id/simbrief-fetch`), optionally pre-files on VATSIM, and starts the flight (`POST /assignments/:id/start`).
5. The pilot flies in the simulator with Volanta tracking, then submits the public Volanta link on the Pilot Report page (`POST /pireps`). The API verifies the route, aircraft, and timing, detects whether the flight was completed, diverted, or incomplete, and marks the assignment `PIREP_SUBMITTED`.
6. The owner approves the report (`POST /admin/pireps/:id/approved`), or the report is approved automatically when the `autoApprovePireps` setting is enabled. The API credits block minutes and experience, applies streak bonuses, moves the aircraft, and, for a hard landing, places the aircraft in a 48-hour inspection.
7. The pilot's statistics, level, and streaks update in the Hangar, the Pilot Directory, and the public home page.

If the pilot does not file before the deadline, the assignment expiry job marks the assignment `EXPIRED` and releases the aircraft.

## Technology summary

| Layer | Technology | Version | Where |
|---|---|---|---|
| Frontend | React with TypeScript, built by Vite | React 19.2.6, TypeScript 6.0.2, Vite 8.0.12 | `web/` |
| API | Node.js with Express | Node.js 24.16.0, Express 5.2.1 | `api/` |
| Database | PostgreSQL | 16.14 | Docker container `dashy-postgres`, schema `airdash` |
| Edge | Caddy (TLS termination and routing) and Nginx (static files) | Container images `caddy:alpine` and `nginx:alpine` | Docker |
| Process management | PM2 with a systemd unit | PM2 7.0.1 | Host |
| Simulator packages | Python 3 build scripts | 3.12.11 | `scripts/`, `gsx/` |
| Desktop automation | PowerShell 5.1 and PowerPoint COM | Windows | `scripts/` |

The [architecture](architecture.md) page describes how these layers connect.

## Project status

airDash is in production and in active development by a single owner. The following facts describe its current maturity and should shape expectations:

- The source is version-controlled in Git at `git@github.com:dashydoggo/airdash.git`. The repository was created on September 10, 2026, and has two commits. Earlier development happened without version control, so the Git history does not record the platform's full evolution.
- There is one environment, production. There is no staging environment. Validation uses isolated builds and temporary API processes on unused ports.
- There is no continuous integration service. Validation is run by hand before each deployment.
- Automated tests cover the pure calculation modules (streaks, flight outcome analysis, SimBrief parsing, gate selection, recovery missions). Routes, database access, and the frontend have no automated tests.
- Database schema changes are applied by an idempotent migration function at API startup rather than by a versioned migration tool.
- The frontend is concentrated in one 1,561-line file, `web/src/App.tsx`, plus a small number of extracted modules.

The [known limitations](known-limitations.md) page lists each constraint with its consequences.

## Naming notes

Several names in the code and interface differ from what a newcomer might expect. They are recorded here so that they do not cause confusion.

- The pilot portal page at `/portal` is called the **Hangar** in the interface and in `PAGE_TITLES` it is `Pilot Portal`. The code component is `Portal`.
- The assignment status `ACTIVE` is displayed as **FLYING**. Database rows and API requests must continue to use `ACTIVE`.
- A **PIREP** is a pilot report. The table is `airdash.pireps`, and the page is `/report`.
- The flight number shown to pilots as `AIR101` is stored as the integer `101` in `airdash.routes.flight_number`. The `AIR` prefix is added for display, and `D1101` is the commercial identity used on SimBrief paperwork.
- **Organization updates** (`airdash.org_updates`) serve both private announcements for pilots and public press releases for the News Hub. The `is_public` column distinguishes them.
- The static site directory `site/` is both the build output of Vite and the home of manually managed downloads. This dual role is why Vite is configured with `emptyOutDir: false`.
