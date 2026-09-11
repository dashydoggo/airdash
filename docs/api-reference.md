# API reference

This page documents every route the airDash API exposes at commit `5f2e27c`: 57 routes defined in `api/src/server.js`. For each route it states the method and path, the authorization class, the inputs and their validation, the success response, every error response with its exact message, the side effects, the handler location, and the tests that cover its logic. It is the canonical contract between the frontend, the Windows automation, and the API.

## Conventions

### Paths

The browser and every external client call `https://air.dashydoggo.com/api/<path>`. Caddy removes `/api` before the request reaches Express, so the paths on this page are the Express paths, without `/api`. When you call a local API directly on port 3006, use the Express path.

### Authorization classes

| Class | Middleware | Requirement | Failure |
|---|---|---|---|
| Public | none | none | not applicable |
| User | `requireUser` | A `Cookie` header that the authentication service resolves to a user. | `401 {"error":"Discord sign-in required"}` |
| Owner | `requireOwner` | A resolved user whose `id` equals `OWNER_DISCORD_ID`. | `403 {"error":"Owner access required"}`, also for unauthenticated callers. |
| Pilot | checked inside the handler | A `pilots` row for the user with `status='ACTIVE'`, or for some routes any `pilots` row. | `403` or `404 {"error":"An approved pilot account is required"}` as noted per route. |

In addition, every `POST` and `DELETE` request passes `requireAirDashOrigin` before anything else. If the `Origin` header is not `https://air.dashydoggo.com` or `http://localhost:5174`, the response is `403 {"error":"Invalid request origin"}`. `GET`, `HEAD`, and `OPTIONS` are exempt. Non-browser clients therefore cannot call mutation routes without forging the header, which is deliberate.

### Request and response format

Request bodies are JSON and must be sent with `Content-Type: application/json`. Bodies larger than 2 MB are rejected by Express with `413`. Every response body is JSON. Successful responses are `200` unless noted. Error responses have the shape `{"error":"<message>"}`. Text inputs are sanitized with `clean(value, maxLength)`, which trims whitespace, truncates to the maximum, and treats non-strings as empty.

### Parameters

Path parameters are written `:name`. Query parameters appear after `?`. Body fields are listed per route with their type, whether they are required, and the validation applied. A field marked "cleaned to N" is passed through `clean(value, N)`.

### Pagination, idempotency, and rate limits

Only `GET /news` and `GET /org-updates` paginate, with `limit` and `offset` and a `total` in the response. There is no request rate limiting on any route. Routes marked idempotent below can be repeated safely; `POST /assignments` and `POST /missions/recovery` return the existing record rather than creating a duplicate.

### Handler locations

Line numbers change; search `api/src/server.js` for `app.<method>("<path>"` to find a handler. Handler references below use that form.

### Tests

Route handlers have no automated tests. Where a route's logic lives in a tested module, the covering test script is named. Otherwise the [smoke test](testing.md#smoke-test) is the verification method.

## Public routes

### GET /health

| Item | Value |
|---|---|
| Purpose | Reports whether the API process is up and can query the database. Used by operators, Caddy has no health check configured. |
| Authorization | Public |
| Inputs | none |
| Success | `200 {"ok":true,"database":true}` |
| Errors | `503 {"ok":false,"database":false}` when `SELECT 1` fails. |
| Side effects | none |
| Idempotent | yes |
| Handler | `app.get("/health"` |

Example, verified on September 10, 2026:

```bash
curl -fsS https://air.dashydoggo.com/api/health
```

```json
{"ok":true,"database":true}
```

### GET /public

| Item | Value |
|---|---|
| Purpose | Returns the data the public site and every page's shared context need: the fleet, active routes, active bases, public pilots, and the pilot with the most hours. |
| Authorization | Public |
| Inputs | none |
| Success | `200 { aircraft: Aircraft[], routes: Route[], bases: Base[], pilots: PublicPilot[], topPilot: {discord_id, display_name, total_block_minutes} \| null }` |
| Fields | `aircraft` rows include registration, fleet number, type, status, status reason and until, current airport and gate, livery URLs and SHA-256 values for both simulators, livery name, special flag, thumbnail, totals, and download counts. `routes` are `status='ACTIVE'` only. `bases` are `is_active=TRUE`. `pilots` are `status='ACTIVE'` with `public_profile_enabled=TRUE` and include rank, leadership title, image, totals, join date, and Discord avatar. |
| Errors | `500` on database failure. |
| Side effects | none |
| Handler | `app.get("/public"` |
| Frontend type | `PublicResponse` in `web/src/types.ts` |

### GET /news

| Item | Value |
|---|---|
| Purpose | Lists published public press releases for the News Hub. |
| Authorization | Public |
| Query | `limit` integer 1 to 50, default 12; `offset` integer at least 0, default 0; `q` search text cleaned to 100, matched case-insensitively against title, summary, and body; `kind` category cleaned to 30 and upper-cased. Invalid numbers fall back to defaults. |
| Filter | `is_public=TRUE AND published_at IS NOT NULL AND published_at<=NOW() AND slug IS NOT NULL` |
| Success | `200 { releases: [{id, kind, title, summary, slug, hero_image_url, author_name, published_at}], total, kinds: string[], limit, offset }` ordered by `published_at DESC, id DESC`. The body and creator identity are omitted. |
| Headers | `Cache-Control: public, max-age=60` |
| Errors | `500` |
| Handler | `app.get("/news"` |

Example:

```bash
curl -fsS 'https://air.dashydoggo.com/api/news?limit=3'
```

### GET /news/:slug

| Item | Value |
|---|---|
| Purpose | Returns one published release with its body. |
| Authorization | Public |
| Path | `slug`, which must already be in canonical form: lowercase letters, digits, and single hyphens. The handler normalizes the value and returns `404` if normalization changes it. |
| Success | `200 { release: {id, kind, title, summary, body, slug, hero_image_url, author_name, published_at} }` |
| Headers | `Cache-Control: public, max-age=60` |
| Errors | `404 {"error":"Press release not found"}` when the slug is not canonical, does not exist, is private, or is not yet published. |
| Handler | `app.get("/news/:slug"` |

### GET /hub-health

| Item | Value |
|---|---|
| Purpose | Computes capacity, demand, growth, forecast, status, and a recommendation for each active base, plus candidate stations that are not bases, from approved reports in the last 60 days. |
| Authorization | Public |
| Inputs | none |
| Success | `200 { bases: [{...base, capacity, demand, previous, growthPct, forecast, perAircraft, status, score, recommendation}], candidates: [{code, recent, previous, growthPct}], totals: {completed30, completed60} }` |
| Statuses | `NO_AIRCRAFT`, `UNDER_SERVED` (8 or more recent flights per aircraft), `HEALTHY` (3 or more), `DORMANT` (no recent flights), `OVER_SERVED` (otherwise). |
| Errors | `500` |
| Handler | `app.get("/hub-health"` |

### GET /live

| Item | Value |
|---|---|
| Purpose | Lists flights that are `BOOKED`, `ACTIVE`, or `PIREP_SUBMITTED` for the live map, the network map, and the Windows exporter. |
| Authorization | Public |
| Inputs | none |
| Success | `200 { flights: [{id, registration, status, source, mission_type, recovery_of_assignment_id, flight_date, booked_at, started_at, expires_at, departure_gate, arrival_gate, flight_number, origin, destination, block_minutes, discord_id, pilot_number, pilot, profile_image_url, avatar_url}] }`, newest first, at most 50. |
| Errors | `500` |
| Handler | `app.get("/live"` |
| Consumers | `LiveMap` and `AdvancedNetworkMap` in the frontend; `scripts/Update-AirDashPressStartVideo.ps1`. |

**Important:** This route is public and exposes pilot display names, Discord IDs, and avatars of pilots with active flights. Adding a private column here would leak it. See [security](security.md#sensitive-data-handling).

### GET /schedule

| Item | Value |
|---|---|
| Purpose | Returns the deterministic schedule for the recent past and near future, merged with active assignments that were not booked from the schedule. |
| Authorization | Public |
| Inputs | none |
| Behavior | Calls `ensureSchedule()` first, so the route can take a few hundred milliseconds when new rows must be generated. |
| Success | `200 { schedule: [{id, dep_time, arr_time, status, flight_number, origin, destination, block_minutes, registration, assignment_status, pilot, profile_image_url, avatar_url, actual_out_at, actual_in_at, pirep_status, assignment_source, unscheduled_assignment}] }` ordered by departure, at most 160 rows. Rows for unscheduled active assignments have `id` prefixed `assignment-` and `status='TAKEN'`. |
| Errors | `500` |
| Handler | `app.get("/schedule"` |

### GET /liveries/:registration/:simulator/download and GET /liveries/:registration/download

| Item | Value |
|---|---|
| Purpose | Anonymous livery download. Increments the public download counter and redirects to the stored package path. The two-segment form defaults to MSFS 2024. |
| Authorization | Public |
| Path | `registration` cleaned to 10 and upper-cased; `simulator` one of `2020`, `2024`, `MSFS2020`, `MSFS2024` in any case. |
| Success | `302` redirect to the `/downloads/liveries/...` path, with `Cache-Control: no-store`. |
| Errors | `400 {"error":"Choose MSFS 2020 or MSFS 2024"}`; `404 {"error":"Livery package not found"}` when the registration is unknown or the stored URL does not start with `/downloads/liveries/`. |
| Side effects | `aircraft.livery_download_count` or `livery_msfs2020_download_count` incremented by one. |
| Idempotent | no (counter) |
| Handler | `publicLiveryDownload` via `app.get("/liveries/:registration/:simulator/download"` and `app.get("/liveries/:registration/download"` |

## Authenticated routes

All routes in this section require the User class. Routes that also require a pilot record say so.

### GET /me

| Item | Value |
|---|---|
| Purpose | Returns everything the frontend needs about the signed-in account. Called on every page load and after every mutation. |
| Authorization | User |
| Behavior | Runs `expireAssignments()`, then upserts the `users` row (`syncUser`), then loads the account. |
| Success | `200 { user: DiscordUser, isOwner: boolean, application: Application \| null, pilot: Pilot \| null, assignment: Assignment \| null, lastFlightAt, downloadedLiveries: string[], downloadedLiveryVersions: [{registration, simulator}], streaks: StreakSummary }`. `assignment` is the newest `BOOKED`, `ACTIVE`, or `PIREP_SUBMITTED` assignment joined with its route. |
| Errors | `401` |
| Side effects | `users` insert or update including `last_login_at`; expired assignments released. |
| Handler | `app.get("/me"` |
| Tests | `test-streaks.js` covers `calculatePilotStreaks` logic. |

### GET /profile

| Item | Value |
|---|---|
| Purpose | Returns the pilot's own full profile and streaks. |
| Authorization | User; requires a `pilots` row. |
| Success | `200 { profile: Pilot & {username, avatar_url}, streaks }` |
| Errors | `404 {"error":"An approved pilot account is required"}` |
| Side effects | `syncUser`. |
| Handler | `app.get("/profile"` |

### POST /profile

| Item | Value |
|---|---|
| Purpose | Updates profile fields and optionally requests a base change. |
| Authorization | User; requires a `pilots` row. |
| Body | `displayName` string, required, cleaned to 60. `pronouns` cleaned to 50. `aboutMe` cleaned to 1000. `profileImageUrl` cleaned to 500; must start with `/downloads/profiles/` or be a parseable `https://` URL. `homeBaseRequest` cleaned to 4, upper-cased; must be an active base code when present. `homeBaseRequestReason` cleaned to 500. `simbriefUsername` cleaned to 50; must match `^[A-Za-z0-9_.-]{2,50}$` when present. |
| Success | `200 { profile }` |
| Errors | `400 "Enter a pilot display name"`, `400 "Enter a valid SimBrief username"`, `400 "Use a valid HTTPS profile image URL"`, `400 "Choose an airDash operating base"`, `404 "An approved pilot account is required"`. |
| Side effects | `pilots` updated; `home_base_requested_at` set to now when a request is present, otherwise cleared; an empty image URL keeps the existing one; audit `PILOT_PROFILE_UPDATED`. |
| Handler | `app.post("/profile"` |

### POST /profile/image

| Item | Value |
|---|---|
| Purpose | Uploads a profile image as a data URL and stores it under `PROFILE_IMAGE_DIR`. |
| Authorization | User; requires a `pilots` row. |
| Body | `imageData` string matching `^data:image/(png\|jpeg\|webp);base64,<base64>$`. Decoded size must be at least 128 bytes and at most 1,500,000 bytes. |
| Success | `200 { profile }` with `profile_image_url` set to `/downloads/profiles/<discord_id>.<png\|jpg\|webp>?v=<timestamp>`. |
| Errors | `400 "Upload a PNG, JPEG, or WebP image"`, `400 "The uploaded image is empty"`, `400 "Profile images are limited to 1.5 MB"`, `404 "An approved pilot account is required"`, `500` on filesystem failure. |
| Side effects | Creates the directory if needed with mode `755`; removes the user's files with the other two extensions; writes the new file with mode `644`; updates `pilots.profile_image_url`; audit `PILOT_PROFILE_IMAGE_UPLOADED` with byte count and type. |
| Handler | `app.post("/profile/image"` |

### POST /profile/liveries/reset

| Item | Value |
|---|---|
| Purpose | Forgets which livery versions the pilot has downloaded so the Hangar shows every package as new. |
| Authorization | User |
| Body | none |
| Success | `200 {"ok":true}` |
| Side effects | Deletes the user's `livery_downloads` rows. |
| Handler | `app.post("/profile/liveries/reset"` |

### POST /liveries/:registration/:simulator/download and POST /liveries/:registration/download

| Item | Value |
|---|---|
| Purpose | Authenticated livery download that records the download per pilot, registration, and simulator, and increments the counter. The browser then opens the returned URL. |
| Authorization | User |
| Path | As for the public form. |
| Success | `200 { url, downloadCount, simulator: "MSFS2020" \| "MSFS2024" }` |
| Errors | `400 "Choose MSFS 2020 or MSFS 2024"`, `404 "Livery package not found"` when the aircraft has no URL for that simulator. |
| Side effects | `livery_downloads` upsert with `downloaded_at=NOW()`; counter incremented. |
| Handler | `authenticatedLiveryDownload` |

### GET /pilots

| Item | Value |
|---|---|
| Purpose | Pilot directory with statistics, average landing rate, active flight, and streaks. |
| Authorization | User; requires an `ACTIVE` pilot. |
| Behavior | Runs `expireAssignments()` first. |
| Success | `200 { pilots: [...] }` ordered by pilot number; each includes `average_landing_rate` over approved reports excluding null and zero, and `streaks`. |
| Errors | `403 "An approved pilot account is required"` |
| Handler | `app.get("/pilots"` |

### GET /pilots/:id

| Item | Value |
|---|---|
| Purpose | One pilot's public directory entry and their last 20 approved flights. |
| Authorization | User; requires an `ACTIVE` pilot. Any active pilot may view any pilot. |
| Path | `id` is a Discord ID. |
| Success | `200 { pilot: {...with streaks}, flights: [{flight_number, origin, destination, registration, actual_out_at, actual_in_at, landing_rate, reviewed_at}] }` |
| Errors | `403 "An approved pilot account is required"`, `404 "Pilot not found"` |
| Handler | `app.get("/pilots/:id"` |

### POST /applications

| Item | Value |
|---|---|
| Purpose | Submits or resubmits a pilot application. |
| Authorization | User |
| Body | `preferredName` cleaned to 60, required. `vatsimCid` cleaned to 12, must match `^\d{4,12}$`. `baseCode` cleaned to 4, upper-cased, must be an active base. `simulator` cleaned to 80, required. `experience` cleaned to 80, required. `introduction` cleaned to 1000. |
| Success | `201 { application }` |
| Errors | `400 "Complete every required application field"`, `409 "An application already exists"` unless the existing status is `RETURNED` or `REJECTED`. |
| Side effects | `syncUser`; upsert into `applications` resetting status to `SUBMITTED` and clearing reviewer notes; audit `APPLICATION_SUBMITTED`. |
| Handler | `app.post("/applications"` |

### GET /org-updates

| Item | Value |
|---|---|
| Purpose | Searches and pages the announcement archive, private and public alike. |
| Authorization | User |
| Query | `limit` 1 to 100, default 20; `offset` default 0; `q` cleaned to 120, matched against title, body, kind, pilot name, pilot number, and aircraft registration; `kind` must be one of `GENERAL`, `OPERATIONS`, `FLEET`, `MAINTENANCE`, `NEW_PILOT`, `ACHIEVEMENT`, `LEVEL_UP`; `sort=oldest` for ascending, otherwise descending. |
| Success | `200 { updates: [OrgUpdate & {pilot_name, pilot_number, registration}], total, limit, offset, kinds }` |
| Errors | `400 "Choose a supported update category"` |
| Handler | `app.get("/org-updates"` |

### GET /flights

| Item | Value |
|---|---|
| Purpose | The Flight Board data: every active route with the registrations of `AVAILABLE` aircraft at its origin, plus the account. |
| Authorization | User |
| Behavior | Runs `expireAssignments()` and `syncUser`. |
| Success | `200 { routes: [Route & {available_aircraft: string[]}], ...account fields as in /me }` |
| Handler | `app.get("/flights"` |

### POST /assignments

| Item | Value |
|---|---|
| Purpose | Books a flight. The complete transaction is traced in the [repository guide](repository-guide.md#traced-execution-path-booking-a-flight). |
| Authorization | User; requires an `ACTIVE` pilot. |
| Body | `flightDate` `YYYY-MM-DD`, required. `routeId` integer. `registration` cleaned to 10, upper-cased. `fileVatsim` boolean. `source` one of `BOARD`, `MISSION`, `SCHEDULE`, default `BOARD`. `scheduleId` integer, optional. |
| Success | `201 { assignment, rebooked: false }` for a new booking; `200 { assignment, rebooked: true }` when a cancelled assignment for the same route and date is reused; `200 { assignment, existing: true }` when an active one already exists. |
| Errors | `400 "Use a valid flight date"`, `403 "An approved pilot account is required"`, `404 "Flight not found"`, `409 "This pilot has already completed the selected flight"`, `409 "Cancel or complete the current assignment before booking another flight"`, `409 "Aircraft is not available at this origin"`, `409 "Could not assign both flight gates"`, `409 "The selected aircraft or pilot now has an active assignment. Refresh the flight board and try again."` on unique violation, `500 "Assignment could not be created"`. |
| Side effects | Assignment insert or update with `expires_at = NOW() + block_minutes + 150 min`, gates, `tail_number` (registration characters 2 to 4), consent, source; aircraft set `ASSIGNED` and parked at the departure gate; schedule row `TAKEN` when supplied; audit `ASSIGNMENT_CREATED` or `ASSIGNMENT_REBOOKED`. |
| Idempotent | yes, for the same route, date, and pilot while active. |
| Handler | `app.post("/assignments"` |
| Tests | `test-flight-outcomes.js` covers `selectGate` and `generateGates`. |

### GET /assignments/history

| Item | Value |
|---|---|
| Purpose | The pilot's last 60 assignments with cancellation and report outcome details. |
| Authorization | User |
| Success | `200 { assignments: [...] }` |
| Handler | `app.get("/assignments/history"` |

### POST /assignments/:id/start

| Item | Value |
|---|---|
| Purpose | Moves a `BOOKED` assignment to `ACTIVE` and resets the deadline from now. |
| Authorization | User; the assignment must belong to the caller. |
| Success | `200 { assignment }` with `started_at` set and `expires_at = NOW() + block_minutes + 150 min`. |
| Errors | `404 "Only your booked flight can be started"` |
| Side effects | Audit `ASSIGNMENT_STARTED`. |
| Handler | `app.post("/assignments/:id/start"` |

### POST /assignments/:id/cancel

| Item | Value |
|---|---|
| Purpose | Structured cancellation of a `BOOKED` or `ACTIVE` assignment. |
| Authorization | User; owner of the assignment. |
| Body | `reasonCode` one of `FILED_IN_ERROR`, `UNABLE_TO_COMPLETE`, `SIMULATOR_ISSUE`, `NETWORK_ISSUE`, `WEATHER_OR_OPERATIONS`, `PERSONAL_INTERRUPTION`, `OTHER`. `details` cleaned to 300, required when `reasonCode` is `OTHER`. |
| Success | `200 { assignment }` |
| Errors | `400 "Choose a cancellation reason"`, `400 "Describe the cancellation reason"`, `404 "Only your booked or flying assignment can be cancelled"`, `500 "Flight could not be cancelled"`. |
| Side effects | In a transaction: status `CANCELLED` with code, reason label plus details, `cancelled_by`, `cancelled_at`; aircraft released if `ASSIGNED`; a linked schedule row reopened if the assignment was still `BOOKED` and the departure is in the future, otherwise marked `DEPARTED`; audit `ASSIGNMENT_CANCELLED`. |
| Handler | `app.post("/assignments/:id/cancel"` |

### DELETE /assignments/:id

| Item | Value |
|---|---|
| Purpose | Legacy cancellation of a `BOOKED` assignment without a reason. The frontend uses `POST .../cancel`; this route remains for compatibility. |
| Authorization | User; owner of the assignment. |
| Success | `200 {"ok":true}` |
| Errors | `404 "Only an active booked flight can be cancelled"`, `500 "Booking could not be cancelled"`. |
| Side effects | Status `CANCELLED` with code `OTHER` and reason `Cancelled by pilot`; aircraft set `AVAILABLE` unconditionally; audit `ASSIGNMENT_CANCELLED`. Does not touch the schedule row. |
| Handler | `app.delete("/assignments/:id"` |

### POST /assignments/:id/gates

| Item | Value |
|---|---|
| Purpose | Regenerates both gates for a `BOOKED` assignment. |
| Authorization | User; owner. |
| Success | `200 { assignment }` |
| Errors | `404 "Booked assignment not found"`, `409 "Could not assign both flight gates"`. |
| Side effects | Gates replaced with a seed that includes the current time; aircraft `current_gate` updated; audit `ASSIGNMENT_GATES_GENERATED`. Does not exclude gates occupied by others. |
| Handler | `app.post("/assignments/:id/gates"` |

### POST /assignments/:id/departure-gate and POST /assignments/:id/arrival-gate

| Item | Value |
|---|---|
| Purpose | Replaces one gate with an alternate that is not the current gate and not occupied by another active assignment at that airport. |
| Authorization | User; owner; assignment must be `BOOKED`. |
| Success | `200 { assignment, previousGate, departureGate }` or `{ assignment, previousGate, arrivalGate }` |
| Errors | `404 "Booked assignment not found"`, `409 "No alternate gate is configured at <origin>"` or `409 "No alternate gate is available at <destination>"`. |
| Side effects | Gate updated; for departure, aircraft `current_gate` updated; audit `DEPARTURE_GATE_REASSIGNED` or `ARRIVAL_GATE_REASSIGNED` with `from` and `to`. Arrival reassignments later surface as `gateChanges` notifications. |
| Handlers | `app.post("/assignments/:id/departure-gate"`, `app.post("/assignments/:id/arrival-gate"` |

### GET /assignments/:id/simbrief-generate

| Item | Value |
|---|---|
| Purpose | Builds a pre-filled SimBrief dispatch URL for a `BOOKED` or `ACTIVE` assignment. |
| Authorization | User; owner. |
| Success | `200 { url: "https://dispatch.simbrief.com/options/custom?..." }` with `airline=D1`, `fltnum`, `orig`, `dest`, `reg`, `fin`, `type` from `SIMBRIEF_AIRFRAME`, `callsign=AIR<number>`, `manualrmk`, `planformat=LIDO`, `units=LBS`, `navlog=1`, and for recovery ferries `pax=0` and `cargo=0`. |
| Errors | `404 "Assignment not found"` |
| Handler | `app.get("/assignments/:id/simbrief-generate"` |
| Tests | `test-flight-outcomes.js` covers `buildSimBriefDispatchParams`. |

### POST /assignments/:id/simbrief-fetch

| Item | Value |
|---|---|
| Purpose | Fetches the pilot's latest SimBrief OFP by username and attaches it. |
| Authorization | User; owner; assignment `BOOKED` or `ACTIVE`. |
| Body | none. Uses `pilots.simbrief_username`. |
| Success | `200 { assignment, plan: SimBriefPlan }` |
| Errors | `404 "Assignment not found"`, `400 "Set your SimBrief username in your profile first"`, `400 "Your latest SimBrief OFP is <o>-<d>, not <o>-<d>. Generate this route in SimBrief first."`, `400 "Your latest SimBrief OFP is not a BCS3. ..."`, `400 "Your recovery ferry OFP must use 0 passengers and 0 cargo. ..."`, `400 "SimBrief returned no flight plan"`, `400 "SimBrief OFP does not declare a flight-plan layout"`, `502 "Remote service returned <status>"`, `413 "Remote response is too large"`, `500 "SimBrief fetch failed"`. |
| Side effects | `simbrief_url`, `simbrief_format`, `flight_plan` (the parsed plan as JSON), `tail_number` updated; audit `SIMBRIEF_FETCHED`. |
| Handler | `app.post("/assignments/:id/simbrief-fetch"` |
| Tests | `test-flight-outcomes.js` covers `parseSimBriefXml` and `recoveryPayloadIsValid`. |

### POST /assignments/:id/simbrief

| Item | Value |
|---|---|
| Purpose | Imports a specific SimBrief XML URL. |
| Authorization | User; owner; assignment `BOOKED` or `ACTIVE`. |
| Body | `url` cleaned to 500; must be `https://www.simbrief.com/ofp/flightplans/xml/<name>.xml`. `registration` cleaned to 10, upper-cased, must equal the assignment's. `tailNumber` cleaned to 3, must equal registration characters 2 to 4. |
| Success | `200 { assignment, plan }` |
| Errors | `404 "Assignment not found"`, `400 "Registration and three-digit tail number must match the assignment"`, `400 "Enter a valid SimBrief XML URL"`, `400 "Use a SimBrief flightplans XML URL"`, `400 "SimBrief route <o>-<d> does not match <o>-<d>"`, `400 "SimBrief aircraft type must be BCS3"`, `400 "Recovery ferry OFP must use 0 passengers and 0 cargo"`, plus the fetch errors above, `500 "SimBrief import failed"`. |
| Side effects | As for fetch; audit `SIMBRIEF_IMPORTED`. |
| Handler | `app.post("/assignments/:id/simbrief"` |

### POST /assignments/:id/volanta

| Item | Value |
|---|---|
| Purpose | Links a Volanta flight to a `BOOKED` or `ACTIVE` assignment for tracking. |
| Authorization | User; owner. |
| Body | `url` cleaned to 500; must contain a UUID. |
| Success | `200 { assignment, flight: VolantaFlight }` |
| Errors | `404 "Assignment not found"`, `400 "Enable Volanta tracking consent before linking a flight"`, `400 "Enter a valid Volanta flight link"`, `400 "Volanta flight must match the assigned route and aircraft"`, `502 "Volanta returned invalid flight data"`, `502`/`413` fetch errors, `500 "Volanta tracking could not be linked"`. |
| Side effects | `volanta_tracking_url`, `volanta_tracking_data`, `volanta_last_synced_at`; audit `VOLANTA_TRACKING_LINKED`. |
| Handler | `app.post("/assignments/:id/volanta"` |

### GET /missions

| Item | Value |
|---|---|
| Purpose | Suggests continuation missions from the pilot's last approved flight, including a recovery ferry after a diversion. |
| Authorization | User; requires an `ACTIVE` pilot. |
| Behavior | Runs `expireAssignments()`. Picks the aircraft the pilot last flew if `AVAILABLE`, else an available aircraft at the last destination or base, else any. |
| Success | `200 { lastFlight, aircraft, suggestions: [Route & {mission_type}], recoveryMission, fallback: boolean, flownDestinations: string[] }` |
| Errors | `403 "An approved pilot account is required"` |
| Handler | `app.get("/missions"` |
| Tests | `test-flight-outcomes.js` covers `buildRecoveryMission`. |

### POST /missions/recovery

| Item | Value |
|---|---|
| Purpose | Books the recovery ferry that returns a diverted aircraft to its planned destination. |
| Authorization | User; requires an `ACTIVE` pilot. |
| Body | `flightDate` `YYYY-MM-DD`; `sourceAssignmentId` positive integer referring to the caller's `DIVERTED` assignment with an approved non-complete report. |
| Success | `201 { assignment, rebooked: false }`, `200 { assignment, rebooked: true }` when a cancelled ferry is reused, or `200 { assignment, existing: true }`. |
| Errors | `400 "Use a valid flight date"`, `400 "Choose a valid recovery mission"`, `403`, `409 "Cancel or complete the current assignment before booking the recovery ferry"`, `404 "This diversion no longer has an open recovery mission"`, `409 "The aircraft has already moved since this diversion"`, `409 "This recovery ferry has already been completed"`, `409 "The diverted aircraft is no longer available at the recovery airport"`, `409 "The recovery route is not valid"`, `409 "No recovery flight number is available"`, `409 "Could not assign both recovery gates"`, `500 "Recovery ferry could not be booked"`. |
| Side effects | Creates or reuses a hidden `INACTIVE` route numbered `9000 + (source id mod 1000)` with `days='Recovery ferry'`; inserts or rebooks the assignment with `source='MISSION'`, `mission_type='RECOVERY'`, `recovery_of_assignment_id`; aircraft `ASSIGNED`; audit `RECOVERY_FERRY_BOOKED`. |
| Handler | `app.post("/missions/recovery"` |
| Tests | `test-flight-outcomes.js` covers `estimateRecoveryBlockMinutes`, `buildRecoveryMission`. |

### POST /volanta/import

| Item | Value |
|---|---|
| Purpose | Previews a Volanta flight and, when an assignment is given, its outcome analysis, without saving anything. Used by the Pilot Report page before submission. |
| Authorization | User |
| Body | `url` cleaned to 500; `assignmentId` integer, optional. |
| Success | `200 { flight, analysis: FlightOutcomeAnalysis \| null }` |
| Errors | Volanta fetch errors; `404 "Assignment not found"`; `400 "Volanta planned route <o>-<d> does not match <o>-<d>"`; `400 "Volanta aircraft <reg> does not match <reg>"`; `400 "Volanta has not recorded a finished flight yet. End the flight in Volanta and wait for its public stats to update."`; `500 "Volanta import failed"`. |
| Side effects | none |
| Handler | `app.post("/volanta/import"` |
| Tests | `test-flight-outcomes.js` covers `analyzeFlightOutcome` and `extractLandingRate`. |

### GET /pireps

| Item | Value |
|---|---|
| Purpose | The pilot's last 50 reports with review, timing, credit, compression, and outcome fields joined to assignment and route. |
| Authorization | User |
| Success | `200 { pireps: [...] }` |
| Handler | `app.get("/pireps"` |

### POST /pireps

| Item | Value |
|---|---|
| Purpose | Submits a pilot report from a Volanta flight. Outcome, credit multiplier, and reposition airport are derived on the server. |
| Authorization | User; the assignment must be the caller's and `BOOKED` or `ACTIVE`. |
| Body | `assignmentId` integer, required. `volantaUrl` cleaned to 500, required. `landingRate` number, optional, used only when Volanta provides none; zero becomes `NULL`; must be between -5000 and 2000. `vatsimFlown` boolean. `remarks` cleaned to 1500. `diversionReasonCode` one of `EMERGENCY`, `CABIN_PRESSURE`, `TECHNICAL_DIFFICULTY`, `WEATHER`, `ATC_OR_AIRSPACE`, `FUEL_OR_PERFORMANCE`, `SIMULATOR_OR_NETWORK`, `PERSONAL_INTERRUPTION`, `OTHER`, required when the outcome is not `COMPLETED`. `diversionDetails` cleaned to 500, required when the code is `OTHER`. |
| Success | `201 { pirep, outcome: FlightOutcomeAnalysis, autoApproved: boolean }` |
| Errors | `400 "A public Volanta flight link is required"`, `404 "Assignment not found"`, route and aircraft mismatch messages as in `/volanta/import`, `400 "Volanta has not recorded a finished flight yet. ..."`, `400 "Volanta did not provide a valid flight start and end time"`, `400 "Landing rate is outside the accepted range"`, `400 "Tell Operations what happened before filing a diverted or incomplete flight"`, `400 "Provide details when selecting Other"`, `500 "Pilot report submission failed"`. |
| Side effects | `pireps` insert with 29 columns including the full Volanta record; assignment `PIREP_SUBMITTED`; audit `PIREP_SUBMITTED`; when `settings.operations.autoApprovePireps` is true, `applyPirepReview(... "APPROVED", null, "Automatically approved")` runs in a transaction and audit `PIREP_AUTO_APPROVED` is written. Errors are logged with prefix `[airdash:pirep]`. |
| Handler | `app.post("/pireps"` |
| Tests | `test-flight-outcomes.js`. |

### GET /notifications

| Item | Value |
|---|---|
| Purpose | Synchronizes and returns the caller's notification history and unread count. The owner receives the owner payload here as well as at `/admin/notifications`. |
| Authorization | User |
| Success | `200 { applications, pireps, aircraft, baseRequests, progress, orgUpdates, expired, filingSoon, gateChanges, total, history: NotificationHistoryItem[] }`. `total` is the unread count; `history` is the latest 100 records. |
| Errors | `500 "Notifications could not be loaded"`, logged as `[airdash-notifications] pilot sync failed`. |
| Side effects | Inserts new `notification_history` rows. |
| Handler | `app.get("/notifications"` |

### POST /notifications/read

| Item | Value |
|---|---|
| Purpose | Marks notifications read. |
| Authorization | User |
| Body | `ids` array of integers, at most 250 used; when absent or empty, every unread record for the caller is marked. |
| Success | `200 { ok: true, count }` |
| Side effects | `notification_history.read_at` set where null. |
| Idempotent | yes |
| Handler | `app.post("/notifications/read"` |

### GET /push/public-key

| Item | Value |
|---|---|
| Purpose | Returns the VAPID public key the browser needs to subscribe. |
| Authorization | User |
| Success | `200 { publicKey }` |
| Errors | `503 "Web Push is not configured"` |
| Handler | `app.get("/push/public-key"` |

### POST /push/subscriptions

| Item | Value |
|---|---|
| Purpose | Stores a browser push subscription and baselines existing notifications so they are not all pushed at once. |
| Authorization | User |
| Body | `subscription` object with `endpoint` (`https://`, at most 2000 characters) and `keys.p256dh` and `keys.auth` (strings at most 500 characters). |
| Success | `201 {"ok":true}` |
| Errors | `503 "Web Push is not configured"`, `400 "Invalid push subscription"`, `500 "Push subscription could not be saved"`. |
| Side effects | `push_subscriptions` upsert keyed by endpoint, clearing `disabled_at` and `last_error`; notification history synchronized; every existing record for the user gets `pushed_at` set if null. The `User-Agent` header is stored, truncated to 500. |
| Handler | `app.post("/push/subscriptions"` |

### DELETE /push/subscriptions

| Item | Value |
|---|---|
| Purpose | Removes one subscription. |
| Authorization | User |
| Body | `endpoint` string. |
| Success | `200 {"ok":true}` even when nothing matched. |
| Handler | `app.delete("/push/subscriptions"` |

### POST /push/test

| Item | Value |
|---|---|
| Purpose | Sends a test push to the caller's subscriptions, or to one endpoint. |
| Authorization | User |
| Body | `endpoint` cleaned to 2000, optional. |
| Success | `200 { ok: true, delivered: <count> }` |
| Errors | `503 "Web Push is not configured"`, `404 "This browser is not subscribed"`, `500 "Test notification could not be delivered"`. |
| Handler | `app.post("/push/test"` |

## Owner routes

All routes in this section require the Owner class. There are thirteen.

### GET /admin/overview

| Item | Value |
|---|---|
| Purpose | Loads every administration tab in one call. |
| Success | `200 { applications (all, with username and avatar), pireps (all, with pilot, aircraft, plan, route), pilots (all), assignments (latest 100 with pilot and canceller names), aircraft (all), audit (latest 500 with actor name), visitors (latest 100 users with no application and no pilot record), orgUpdates (latest 50 with creator name), settings (the operations document), bases (all with pilot_count) }` |
| Handler | `app.get("/admin/overview"` |
| Frontend type | `AdminOverview` |

### GET /admin/notifications

| Item | Value |
|---|---|
| Purpose | Owner notification payload and history: pending applications, reports awaiting review, aircraft on hold, base requests, the owner's own progress, and recent announcements. |
| Success | As `/notifications`, with `expired`, `filingSoon`, and `gateChanges` empty. |
| Errors | `500 "Notifications could not be loaded"` |
| Handler | `app.get("/admin/notifications"` |

### POST /admin/org-updates

| Item | Value |
|---|---|
| Purpose | Publishes a private announcement or a public News Hub release. |
| Body | `kind` cleaned to 30, upper-cased, default `GENERAL`, must be a supported kind. `title` cleaned to 120, required. `isPublic` boolean. `body` cleaned to 10000 when public, else 1000, required. `summary` cleaned to 320, required when public. `heroImageUrl` cleaned to 500, must be empty, start with `/assets/news/`, or be a parseable `https://` URL. `authorName` cleaned to 80, default `Staff Writer`. `slug` cleaned to 100, optional; derived from the title when absent, made unique with a numeric suffix. `pilotDiscordId` cleaned to 30. `aircraftRegistration` cleaned to 10, upper-cased. |
| Success | `201 { update }` |
| Errors | `400 "Choose a supported update category"`, `400 "Title and body are required"`, `400 "A public press release requires a summary"`, `400 "Use a managed News Hub image or a valid HTTPS image URL"`, `409 "Could not allocate a unique news slug"`. |
| Side effects | `org_updates` insert with `published_at=NOW()` when public; audit `ORG_UPDATE_CREATED`. |
| Handler | `app.post("/admin/org-updates"` |

### POST /admin/applications/:id/:decision

| Item | Value |
|---|---|
| Purpose | Decides an application. |
| Path | `decision` one of `approved`, `returned`, `rejected` in any case. |
| Body | `notes` cleaned to 1000. |
| Success | `200 { application }` |
| Errors | `400 "Invalid decision"`, `404 "Application not found"`, `500 "Application decision failed"`. |
| Side effects | In a transaction: application status, notes, reviewer, timestamps updated; on approval, `nextval('airdash.pilot_number_seq')` formatted as `AD` plus four digits, a `pilots` row inserted (`ON CONFLICT DO NOTHING`), and a `NEW_PILOT` organization update published; audit `APPLICATION_<DECISION>`. |
| Handler | `app.post("/admin/applications/:id/:decision"` |

**Note:** The `404` branch returns before `ROLLBACK`, leaving the transaction open until `client.release()` in `finally` returns the client to the pool. The `pg` pool ends the open transaction when the client is released. This is harmless but untidy and is listed in [known limitations](known-limitations.md).

### GET /admin/pilots/:id/flights

| Item | Value |
|---|---|
| Purpose | A pilot's complete assignment and report history for the Pilots tab. |
| Success | `200 { flights: [...] }`, empty for an unknown ID. |
| Handler | `app.get("/admin/pilots/:id/flights"` |

### POST /admin/pilots/:id/manage

| Item | Value |
|---|---|
| Purpose | Changes a pilot's base and/or status. |
| Body | `baseCode` cleaned to 4, upper-cased, must be active when present. `status` one of `ACTIVE`, `LEAVE`, `INACTIVE`, `SUSPENDED` when present. Empty values leave the field unchanged. |
| Success | `200 { pilot }` |
| Errors | `404 "Pilot not found"`, `400 "Choose an active operating base"`, `400 "Invalid pilot status"`. |
| Side effects | Audit `PILOT_MANAGED`. |
| Handler | `app.post("/admin/pilots/:id/manage"` |

### POST /admin/pilots/:id/base

| Item | Value |
|---|---|
| Purpose | Approves or denies a pending base-change request. |
| Body | `decision` cleaned to 10; `approve` approves, anything else denies. |
| Success | `200 {"ok":true}` |
| Errors | `404 "Pilot not found"`, `400 "No pending base request"`, `400 "The requested base is no longer active"`. |
| Side effects | On approve, `base_code` replaced; in both cases the request fields are cleared; audit `BASE_REQUEST_APPROVED` or `BASE_REQUEST_DENIED`. |
| Handler | `app.post("/admin/pilots/:id/base"` |

### DELETE /admin/assignments/:id

| Item | Value |
|---|---|
| Purpose | Deletes an assignment and its report, reversing credited statistics when the report was approved. |
| Success | `200 {"ok":true}` |
| Errors | `404 "Assignment not found"`, `500 "Could not delete the flight"`. |
| Side effects | In a transaction: for each approved report with valid times, subtracts credited block minutes, experience, one flight, and one mission or assignment completion from the pilot, floored at zero; deletes the reports and the assignment; audit `ASSIGNMENT_DELETED`. Does not change the aircraft's position, hours, or cycles. |
| Handler | `app.delete("/admin/assignments/:id"` |

### POST /admin/bases

| Item | Value |
|---|---|
| Purpose | Creates or updates a base. |
| Body | `code` cleaned to 4, upper-cased, must match `^[A-Z]{3,4}$`. `name` cleaned to 60, required. `role` cleaned to 60. `lat` number -90 to 90. `lon` number -180 to 180. `sortOrder` integer, default 100. `isActive` boolean, default true. |
| Success | `200 { base }` |
| Errors | `400 "Enter a 3 or 4 letter ICAO code"`, `400 "Enter a base name"`, `400 "Enter valid latitude and longitude"`. |
| Side effects | Upsert on `code`; audit `BASE_SAVED`. |
| Handler | `app.post("/admin/bases"` |

### DELETE /admin/bases/:code

| Item | Value |
|---|---|
| Purpose | Deletes a base that no pilot uses. |
| Success | `200 {"ok":true}` |
| Errors | `400 "<n> pilot(s) are based here. Reassign them or deactivate the base instead."`, `404 "Base not found"`. |
| Side effects | Row deleted; audit `BASE_DELETED`. |
| Handler | `app.delete("/admin/bases/:code"` |

### POST /admin/aircraft/:registration/status

| Item | Value |
|---|---|
| Purpose | Sets an aircraft's operational status. |
| Body | `status` one of `AVAILABLE`, `MAINTENANCE`, `INSPECTION`, `RETIRED`. `reason` cleaned to 300, required unless `AVAILABLE`. |
| Success | `200 { aircraft }` |
| Errors | `400 "Choose a supported aircraft status"`, `400 "Provide a reason code or description"`, `404 "Aircraft not found"`, `409 "Cancel the active assignment before changing this aircraft"` when `ASSIGNED`, `500 "Aircraft status change failed"`. |
| Side effects | `INSPECTION` sets `status_until = NOW() + 48 hours`; others clear it; `status_set_by` and `status_set_at` recorded; audit `AIRCRAFT_STATUS_SET`. |
| Handler | `app.post("/admin/aircraft/:registration/status"` |

### POST /admin/pireps/:id/:decision

| Item | Value |
|---|---|
| Purpose | Reviews a report. |
| Path | `decision` one of `approved`, `returned`, `rejected`. |
| Body | `notes` cleaned to 1000. |
| Success | `200 {"ok":true}` |
| Errors | `400 "Invalid decision"`, `404 "PIREP not found"`, `500 "PIREP decision failed"`. |
| Side effects | `applyPirepReview` in a transaction. On `APPROVED`: computes eligible minutes as the lesser of simulator and real block time (or measured out-to-in), applies the credit multiplier, computes base experience with the mission multiplier and the streak bonus, updates the report's credit columns, adds to the pilot's totals, moves the aircraft to the reposition airport with a parking gate and adds hours and one cycle, sets `INSPECTION` for 48 hours when the landing rate is -450 or below, and sets the assignment to `COMPLETED` or `DIVERTED`; audit `AIRCRAFT_INSPECTION_TRIGGERED` and `PIREP_NON_COMPLETE_APPROVED` when applicable. On `REJECTED`: aircraft `AVAILABLE`, assignment `CANCELLED` with code `PIREP_REJECTED`. On `RETURNED`: only the review fields change. Always: audit `PIREP_<DECISION>`. |
| Handler | `app.post("/admin/pireps/:id/:decision"`, `applyPirepReview` |
| Tests | `test-streaks.js` covers `applyStreakBonus`; `test-flight-outcomes.js` covers `assignmentExperienceMultiplier`. |

**Note:** The `404` branch here also returns before `ROLLBACK`; see the note under application decisions.

### POST /admin/settings

| Item | Value |
|---|---|
| Purpose | Updates operational settings. Only one field exists today. |
| Body | `autoApprovePireps` boolean. |
| Success | `200 { settings }` |
| Side effects | `settings.value` updated with `jsonb_set` for key `operations`; audit `SETTINGS_UPDATED`. |
| Handler | `app.post("/admin/settings"` |

## Audit actions

Every mutation writes an `audit_events` row through `audit(actor, action, entityType, entityId, details)`. The complete set of `action` values at this commit is: `PILOT_PROFILE_UPDATED`, `PILOT_PROFILE_IMAGE_UPLOADED`, `RECOVERY_FERRY_BOOKED`, `ORG_UPDATE_CREATED`, `APPLICATION_SUBMITTED`, `ASSIGNMENT_CREATED`, `ASSIGNMENT_REBOOKED`, `ASSIGNMENT_CANCELLED`, `ASSIGNMENT_STARTED`, `VOLANTA_TRACKING_LINKED`, `ASSIGNMENT_GATES_GENERATED`, `SIMBRIEF_IMPORTED`, `ARRIVAL_GATE_REASSIGNED`, `DEPARTURE_GATE_REASSIGNED`, `SIMBRIEF_FETCHED`, `ASSIGNMENT_DELETED`, `PILOT_MANAGED`, `BASE_REQUEST_APPROVED`, `BASE_REQUEST_DENIED`, `AIRCRAFT_INSPECTION_TRIGGERED`, `PIREP_NON_COMPLETE_APPROVED`, `PIREP_SUBMITTED`, `PIREP_AUTO_APPROVED`, `BASE_SAVED`, `BASE_DELETED`, `SETTINGS_UPDATED`, `APPLICATION_APPROVED`, `APPLICATION_RETURNED`, `APPLICATION_REJECTED`, `AIRCRAFT_STATUS_SET`, `PIREP_APPROVED`, `PIREP_RETURNED`, `PIREP_REJECTED`, `ASSIGNMENT_EXPIRED`, `AIRCRAFT_RELEASED_FROM_HOLD`, `ASSIGNMENT_GATES_REPAIRED`, and `AIRCRAFT_PARKING_GATE_ASSIGNED`. System-initiated events have a null actor.

## Calling authenticated routes from a script

Authenticated routes are designed for the browser. A script must supply a cookie that the production authentication service accepts, which means a real dashydoggo.com session, and a forged `Origin` header for mutations. Against a local API with the [mock authentication service](local-development.md#mock-authentication-service), any cookie works:

```bash
curl -fsS -H 'Cookie: session=anything' http://127.0.0.1:3006/me
curl -fsS -X POST -H 'Origin: http://localhost:5174' -H 'Cookie: session=anything' \
  -H 'Content-Type: application/json' -d '{"ids":[]}' http://127.0.0.1:3006/notifications/read
```

The second command returns `{"ok":true,"count":0}` on a fresh database. Both were verified while writing this page.
