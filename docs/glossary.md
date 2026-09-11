# Glossary

Definitions of every project-specific term, acronym, status value, and named identifier used in airDash and its documentation. Each entry links to the page where the concept is explained in full. General software terms (process, port, commit, transaction) are defined in [foundations](foundations.md) and are listed here only when airDash uses them in a specific way.

## Terms

**Active recall.** Producing or selecting an answer before seeing the explanation, rather than recognizing visible material. The academy records active-recall attempts with confidence.

**Academy.** The dependency-free local application under `academy/` that turns canonical documentation into prerequisite modules, assessment, practical checks, cumulative examinations, delayed review, and capstone evidence. See [academy guide](../academy/README.md).

**Confidence calibration.** Comparing stated confidence from 1 through 5 with actual correctness. An incorrect response at confidence 4 or 5 is an overconfident misconception and blocks a module gate until remediated.

**Evidence level.** One of seven academy states: Unseen, Introduced, Recalled, Applied, Demonstrated, Retained, and Integrated. Each has explicit evidence requirements in the [mastery model](../academy/MASTERY_MODEL.md).

**Mastery gate.** The complete set of prerequisite, study, concept, examination, skill-minimum, lab, and misconception conditions required before a module is demonstrated. It is stricter than a quiz pass.

**Spaced repetition.** Scheduling retrieval after increasing delays. The academy uses 1, 3, 7, 14, 30, 60, and 120 days after successful progression, with a 10-minute retry after failure.

**Aircraft.** One airframe in the fleet, identified by its registration such as `N574AD`. Stored in `airdash.aircraft`. See [data model](data-model.md#aircraft).

**Announcement.** See organization update.

**Application.** A request to become a pilot, one per Discord user, reviewed by the owner. Stored in `airdash.applications`. See [features](features.md#join-join).

**Assignment.** One pilot flying one route in one aircraft on one date, from booking through report. Stored in `airdash.assignments`. See [data model](data-model.md#assignments).

**Audit event.** An append-only record of a consequential change, with actor, action, entity, and details. Stored in `airdash.audit_events`. See [API reference](api-reference.md#audit-actions).

**Auth service.** The dashydoggo.com Discord login service on port 3002 whose `/auth/me` endpoint converts a session cookie into a user. It is the Discord bot process `dashydex`, owned by a different project. See [security](security.md#authentication-flow).

**Base.** An operating base airport such as `KATL`. Pilots belong to a base; hub health is computed per base. Stored in `airdash.bases`.

**Block minutes.** The scheduled duration of a route from off-blocks to on-blocks. `routes.block_minutes`. Credited block minutes are what a pilot earns from an approved report.

**Brief.** The seventeen-card onboarding walkthrough shown to a pilot once per brief version. See [features](features.md#hangar-portal).

**Caddy.** The edge reverse proxy container `dashy-caddy` that terminates TLS and routes `/api/*` to the API and everything else to Nginx. See [architecture](architecture.md#production-runtime-topology).

**Capstone.** The final integrated academy exercise: a controlled repository change, tests, documentation, validation, diff and pull-request evidence, risk and rollback analysis, incident diagnosis, and an own-words explanation scored against a 100-point rubric by a human reviewer.

**Commercial designator.** `D1`, the two-character airline code used on SimBrief paperwork, so a flight appears as `D1101`. Distinct from the callsign `AIR DASH` and the display prefix `AIR`.

**Continuity streak.** The count of consecutive approved flights where each origin equals the previous destination. See the streaks entry below.

**Coverage map.** The table linking each concept to its source, configuration, tests, documentation, and validation method. See [coverage map](coverage-map.md).

**Credit multiplier.** `1.0` for a completed report, `0.9` for diverted or incomplete, applied to eligible block time. `pireps.credit_multiplier`.

**Decision point.** Fifty percent of planned distance; an incomplete flight past it repositions the aircraft to the filed alternate rather than the origin. See [features](features.md#pilot-report-report).

**Discord ID.** The numeric snowflake identifying a Discord account, used as the primary key for users and pilots. Public within Discord; not a secret.

**Dispatch.** Flight planning paperwork, produced by SimBrief and attached to an assignment as `flight_plan`.

**Diversion.** A flight that landed somewhere other than its planned destination. Outcome `DIVERTED`. See recovery ferry.

**Eligible block time.** The lesser of simulator block time and real block time for a report, which neutralizes simulator time acceleration.

**Event key.** The unique string identifying a notification: group, record identity, and a hash of the record. `notification_history.event_key`.

**Expiry.** The deadline `assignments.expires_at`, block minutes plus 150 minutes from booking or start, after which the expiry job marks the assignment `EXPIRED`.

**Filing.** Submitting a pilot report.

**Fin.** The three-digit number inside a registration (`N574AD` gives `574`), used as `tail_number` and as SimBrief's `fin`.

**Flight-day streak.** The count of consecutive UTC days with an approved flight. See streaks.

**Flight Board.** The `/flights` page listing bookable routes and available aircraft.

**Flight number.** The integer in `routes.flight_number`, displayed as `AIR101` and used on SimBrief as `D1101`. `9000` to `9999` are recovery ferries.

**Gate.** A departure or arrival gate string such as `A32`, selected deterministically from a per-airport pool by `selectGate`. Aircraft also have a parking gate, `current_gate`.

**GSX.** Ground Services X, a third-party MSFS add-on for ground vehicles; airDash publishes a branded texture package for it from `gsx/`.

**Hangar.** The pilot portal page at `/portal`; the `Portal` component.

**Hard landing.** A landing rate at or below `-450` feet per minute, which triggers a 48-hour inspection on approval.

**Hub health.** The per-base capacity and demand analysis at `/health`, computed by `GET /hub-health`.

**ICAO code.** A four-letter airport identifier such as `KATL`, or a type designator such as `BCS3`. ICAO is the International Civil Aviation Organization.

**Idempotent.** An operation whose repetition has no further effect. `migrate()` and `POST /assignments` for an existing booking are idempotent.

**Inspection.** Aircraft status `INSPECTION`, a timed 48-hour hold released by the expiry job.

**Isolated build.** A Vite production build into a temporary directory instead of `site/`, used for validation. See [local development](local-development.md#frontend-validation-sequence).

**Landing rate.** Vertical speed at touchdown in feet per minute, negative for descent, from Volanta. Zero is stored as `NULL`.

**Level.** `floor(experience / 600) + 1`, display only.

**LIDO.** The SimBrief OFP layout requested by generated dispatch URLs. Imports accept any layout.

**Livery.** An aircraft paint scheme delivered as an MSFS package ZIP. airDash publishes one per aircraft for MSFS 2020 and MSFS 2024.

**Maintenance.** Aircraft status `MAINTENANCE`, released manually by the owner unless `status_until` is set.

**Marker check.** Searching a built bundle for a literal string introduced by a change, to prove the build included it.

**Migration.** A schema or seed change applied by the idempotent `migrate()` function at API startup. See [data model](data-model.md#migration-behavior).

**Mission.** An assignment booked from the Missions page with `source='MISSION'`. Standard missions earn a block-time-based experience multiplier; recovery missions earn 1.0.

**Mock authentication service.** A local stand-in for the auth service that returns a fixed user for any cookie. See [local development](local-development.md#mock-authentication-service).

**MSFS.** Microsoft Flight Simulator; MSFS 2020 and MSFS 2024 are the two supported simulators.

**Nginx.** The static file server container `dashy-airdash` serving `site/`.

**Notification.** A row in `airdash.notification_history` shown in the bell panel and optionally pushed. Nine groups exist. See [features](features.md#notifications).

**OFP.** Operational flight plan, the SimBrief document describing a planned flight.

**Organization update.** A row in `airdash.org_updates`: a private announcement to pilots or, when `is_public`, a public press release in the News Hub.

**Outcome.** `COMPLETED`, `DIVERTED`, or `INCOMPLETE`, derived by `analyzeFlightOutcome` from Volanta evidence. `pireps.outcome_type`.

**Owner.** The Discord account matching `OWNER_DISCORD_ID`; the only administrator.

**Pilot.** An approved member with an `airdash.pilots` row. Statuses: `ACTIVE`, `LEAVE`, `INACTIVE`, `SUSPENDED`.

**Pilot number.** `AD` plus four digits from `pilot_number_seq`, such as `AD0007`.

**PIREP.** Pilot report; a row in `airdash.pireps` recording one flown assignment with Volanta evidence and review state.

**PM2.** The Node.js process manager that runs `airdash-api` in production and restarts it on failure; resurrected at boot by `pm2-dashy.service`.

**Progress ratio.** Distance flown divided by planned distance, capped at 1. `pireps.progress_ratio`.

**Push.** Web Push: background notifications delivered through the browser vendor's push service using VAPID keys and the service worker `airdash-sw.js`.

**Recovery ferry.** A mission that returns a diverted aircraft to its planned destination with zero passengers and cargo, on a hidden `AIR9xxx` route, `mission_type='RECOVERY'`.

**Registration.** The tail identifier of an aircraft, such as `N574AD`, and the primary key of `airdash.aircraft`.

**Release.** The moment production begins running a specific commit; see [releases](releases.md).

**Release backup.** The directory under `/opt/dashy-database/backups/` capturing the deployed frontend and API source before a deployment. See [backup and recovery](backup-and-recovery.md#release-backup).

**Reposition.** Where the aircraft is placed after an approved report: destination, diversion airport, alternate, or origin. `pireps.reposition_airport` and `reposition_method`.

**Route.** A published origin and destination pair with a flight number and block minutes. Stored in `airdash.routes`.

**Schedule.** Deterministic departures for today and tomorrow generated by `ensureSchedule`, shown at `/schedule`. Stored in `airdash.schedule`.

**Service worker.** `airdash-sw.js`, the browser background script that displays push notifications and handles clicks.

**Settings.** JSON operational settings in `airdash.settings`; currently only `operations.autoApprovePireps`.

**SimBrief.** The third-party flight planning service. airDash generates dispatch URLs for it and imports its XML OFPs.

**Site.** The `site/` directory served by Nginx: build output plus downloads.

**Smoke test.** Starting a second API process on an unused port and calling routes with `curl`. See [testing](testing.md#smoke-test).

**Source.** `assignments.source`: `BOARD`, `MISSION`, or `SCHEDULE`, recording where a booking originated.

**Streaks.** Two per-pilot measures computed from approved reports: the flight-day streak (consecutive UTC days, with a bonus of 5 percent per day from day three, capped at 15) and the continuity streak (consecutive connecting flights). Implemented in `api/src/streaks.js`.

**Tail number.** See fin.

**Time compression.** Simulator time running faster than real time, detected when the simulator block time exceeds real block time by at least 10 percent and 300 seconds. Flagged on the report; eligible block time uses the lesser value.

**Trust boundary.** A line across which trust changes and the receiving side must validate. See [architecture](architecture.md#trust-boundaries).

**VAPID.** Voluntary Application Server Identification, the key pair that identifies the airDash server to push services. See [configuration](configuration.md#vapid_public_key-and-vapid_private_key).

**VATSIM.** The online air traffic control network. airDash builds a pre-file link and records whether a flight was flown on VATSIM. A VATSIM CID is a member's certificate ID.

**Visitor.** A signed-in user with neither an application nor a pilot record, listed on the Administration Visitors tab.

**Vite.** The frontend build tool and development server.

**Volanta.** The third-party flight tracking service whose public flight records are the evidence for every pilot report.

## Status values

| Entity | Values |
|---|---|
| `applications.status` | `SUBMITTED`, `UNDER_REVIEW` (allowed, unused), `APPROVED`, `RETURNED`, `REJECTED` |
| `pilots.status` | `ACTIVE`, `LEAVE`, `INACTIVE`, `SUSPENDED` |
| `aircraft.status` | `PLANNED` (unused), `AVAILABLE`, `ASSIGNED`, `MAINTENANCE`, `INSPECTION`, `RETIRED`, `INACTIVE` (unused) |
| `routes.status` | `ACTIVE`, `INACTIVE` |
| `schedule.status` | `OPEN`, `TAKEN`, `DEPARTED`, `COMPLETED` (unused) |
| `assignments.status` | `BOOKED`, `ACTIVE` (displayed FLYING), `PIREP_SUBMITTED`, `COMPLETED`, `DIVERTED`, `CANCELLED`, `EXPIRED` |
| `assignments.source` | `BOARD`, `MISSION`, `SCHEDULE` |
| `assignments.mission_type` | `STANDARD`, `RECOVERY` |
| `assignments.cancellation_code` | `FILED_IN_ERROR`, `UNABLE_TO_COMPLETE`, `SIMULATOR_ISSUE`, `NETWORK_ISSUE`, `WEATHER_OR_OPERATIONS`, `PERSONAL_INTERRUPTION`, `OTHER`, `DEADLINE_EXPIRED`, `PIREP_REJECTED` |
| `pireps.review_status` | `SUBMITTED`, `APPROVED`, `RETURNED`, `REJECTED` |
| `pireps.outcome_type` | `COMPLETED`, `DIVERTED`, `INCOMPLETE` |
| `pireps.diversion_reason_code` | `EMERGENCY`, `CABIN_PRESSURE`, `TECHNICAL_DIFFICULTY`, `WEATHER`, `ATC_OR_AIRSPACE`, `FUEL_OR_PERFORMANCE`, `SIMULATOR_OR_NETWORK`, `PERSONAL_INTERRUPTION`, `OTHER` |
| `pireps.reposition_method` | `SCHEDULED_DESTINATION`, `VOLANTA_DIVERSION_AIRPORT`, `FILED_ALTERNATE_AFTER_MIDPOINT`, `ORIGIN_BEFORE_MIDPOINT` |
| `org_updates.kind` | `GENERAL`, `OPERATIONS`, `FLEET`, `MAINTENANCE`, `NEW_PILOT`, `ACHIEVEMENT`, `LEVEL_UP` |
| `livery_downloads.simulator` | `MSFS2020`, `MSFS2024` |
| Hub health status | `NO_AIRCRAFT`, `UNDER_SERVED`, `HEALTHY`, `OVER_SERVED`, `DORMANT` |

## Acronyms

| Acronym | Expansion |
|---|---|
| API | Application programming interface |
| ATC | Air traffic control |
| CI | Continuous integration |
| CID | Certificate identifier (VATSIM) |
| COM | Component Object Model (Windows automation interface used by PowerPoint) |
| CSRF | Cross-site request forgery |
| DNS | Domain Name System |
| ERD | Entity relationship diagram |
| GSX | Ground Services X |
| HTTP, HTTPS | Hypertext Transfer Protocol, and the same over TLS |
| ICAO | International Civil Aviation Organization |
| IP | Internet Protocol |
| JSON | JavaScript Object Notation |
| JSX | JavaScript XML, the HTML-like syntax in React components |
| LTS | Long-term support (Node.js release line) |
| MSFS | Microsoft Flight Simulator |
| OFP | Operational flight plan |
| PID | Process identifier |
| PIREP | Pilot report |
| PM2 | The Node.js process manager (a product name, not an acronym expansion) |
| SPA | Single-page application |
| SQL | Structured Query Language |
| SSH | Secure Shell |
| TCP | Transmission Control Protocol |
| TLS | Transport Layer Security |
| URL | Uniform Resource Locator |
| UTC | Coordinated Universal Time (also "Zulu" in aviation) |
| UUID | Universally unique identifier |
| VAPID | Voluntary Application Server Identification |
| VATSIM | Virtual Air Traffic Simulation Network |
| XP | Experience points |
