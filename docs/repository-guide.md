# Repository guide

This page describes every top-level directory and every architecturally important file in the airDash repository, states whether each is handwritten or generated, who is responsible for it, how changes to it are tested, and whether contributors are expected to modify it. It ends with a traced execution path from a browser click to a database write and back, so that you can see how the pieces connect in practice.

The merged technical-reference release contains 143 tracked files at commit `291860f`. The interactive academy adds 43 files, producing 186 tracked files when this follow-up change is committed. Two large runtime directories that may exist on disk, `site/` and `node_modules/`, remain deliberately untracked.

## Root files

| File | Handwritten | Purpose | Modify directly |
|---|---|---|---|
| `README.md` | Yes | Landing page: definition, capabilities, status, prerequisites, quick start, links. | Yes, following [documentation-style.md](documentation-style.md). |
| `.gitignore` | Yes | Excludes `node_modules/`, `.env*` except `.env.example`, `site/`, `dist/`, tooling state, Python caches, editor files, and `gsx/*.zip`. | Yes, when a new generated artifact appears. |
| `.gitattributes` | Yes | Forces LF line endings for every text type and marks images, archives, presentations, and video as binary. | Rarely. |
| `nginx.conf` | Yes | Configuration for the `dashy-airdash` container: static root, cache headers per path, SPA fallback. | Yes, with the [Nginx deployment procedure](deployment.md#deploy-an-nginx-configuration-change). |

**Note:** On the production host, `README.md` has mode `600` and `scripts/` and `gsx/` have mode `700`, which means only the `dashy` user can read them there. Git does not track read permissions, so clones have normal permissions. This is a local filesystem quirk, not a project rule.

## api/

The Express API. Owned by the backend concern. Every file is handwritten.

| Path | Purpose | Tested by | Modify directly |
|---|---|---|---|
| `api/package.json` | Name, ECMAScript module flag, four pinned dependencies, five scripts (`start`, `check`, `migrate`, `test:streaks`, `test:flight-outcomes`). | `npm ci` fails if it disagrees with the lock file. | Yes, together with the lock file. |
| `api/package-lock.json` | Exact dependency tree, lockfile version 3, 96 packages. | `npm ci`. | Never by hand; regenerate with `npm install`. |
| `api/.env.example` | Template for `api/.env`. | None automated. | Yes, when a variable is added. |
| `api/.env` | Real configuration and secrets. Untracked. | None. | Yes, on each machine, never committed. |
| `api/ecosystem.config.js` | PM2 process definition for production. | `pm2 start ecosystem.config.js` during recovery. | Rarely. |
| `api/scripts/migrate.js` | Loads `.env`, runs `migrate()`, prints `airDash database migration complete`, closes the pool. | Running it. | Rarely. |
| `api/scripts/test-streaks.js` | Assertions for `streaks.js`. | It is a test. | Yes, when streak logic changes. |
| `api/scripts/test-flight-outcomes.js` | Assertions for `flightOutcome.js`, `recoveryMissions.js`, and the pure parts of `integrations.js`. | It is a test. | Yes, when those modules change. |

### api/src/

| File | Lines | Exports | Responsibility | Reads | Writes |
|---|---|---|---|---|---|
| `server.js` | 1314 | none (entry point) | Express application, global middleware, all 57 routes, `expireAssignments`, `ensureSchedule`, `applyPirepReview`, `loadAccount`, `syncUser`, startup, shutdown. | Every table; `process.env.PORT`, `PROFILE_IMAGE_DIR`, `SIMBRIEF_AIRFRAME`. | Every table; profile image files. |
| `database.js` | 485 | `pool`, `migrate`, `audit`, `publishOrgUpdate` | Connection pool; idempotent schema, constraint, and seed migration; audit event insert; organization update insert. | `DATABASE_URL`. | Schema and seeds; `audit_events`; `org_updates`. |
| `auth.js` | 40 | `OWNER_ID`, `authenticatedUser`, `requireUser`, `requireOwner`, `requireAirDashOrigin` | Authentication delegation and authorization middleware. | `AUTH_URL`, `OWNER_DISCORD_ID`. | Nothing. |
| `integrations.js` | 243 | `AIRDASH_COMMERCIAL_DESIGNATOR`, `selectGate`, `generateGates`, `importSimBrief`, `importSimBriefByUsername`, `parseSimBriefXml`, `extractLandingRate`, `importVolanta` | Gate pools per airport with deterministic hashed selection; SimBrief XML fetch and parse; Volanta JSON fetch and normalization including time-compression detection. | HTTPS. | Nothing. |
| `streaks.js` | 92 | `streakBonusPercent`, `applyStreakBonus`, `computeStreaks`, `publicStreaks`, `calculatePilotStreaks` | Flight-day streaks over UTC days, route continuity, per-report award snapshots, bonus percent. | `pireps`, `assignments`, `routes` through a passed executor. | Nothing. |
| `flightOutcome.js` | 111 | `PIREP_OUTCOME_TYPES`, `NON_COMPLETE_OUTCOMES`, `DIVERSION_REASON_CODES`, `isNonCompleteOutcome`, `normalizeDiversionReasonCode`, `analyzeFlightOutcome` | Decides `COMPLETED`, `DIVERTED`, or `INCOMPLETE` from Volanta evidence; chooses the reposition airport; sets the credit multiplier. | Function arguments only. | Nothing. |
| `notifications.js` | 171 | `notificationGroups`, `getNotificationPayload`, `syncNotificationHistory`, `markNotificationsRead` | Nine notification groups; owner and pilot payload queries; stable event keys; history insert and unread count; mark read. | `applications`, `pireps`, `aircraft`, `pilots`, `org_updates`, `audit_events`, `assignments`, `notification_history`. | `notification_history`. |
| `push.js` | 131 | `pushConfiguration`, `savePushSubscription`, `removePushSubscription`, `sendTestPush`, `startPushWorker` | VAPID setup; subscription validation and storage; delivery with dead-subscription cleanup; polling worker. | `VAPID_*`; `push_subscriptions`, `notification_history`. | `push_subscriptions`, `notification_history.pushed_at`. |
| `recoveryMissions.js` | 106 | `RECOVERY_MISSION_TYPE`, `STANDARD_MISSION_TYPE`, `suggestedRecoveryFlightNumber`, `estimateRecoveryBlockMinutes`, `buildRecoveryMission`, `buildSimBriefDispatchParams`, `assignmentExperienceMultiplier`, `recoveryPayloadIsValid`, `ensureRecoveryRoute` | Recovery ferry proposals after diversions; SimBrief dispatch parameters; mission experience multiplier; hidden `AIR9xxx` recovery routes. | `routes` through a passed client. | `routes`. |
| `gates.js` | 25 | `repairMissingActiveGates` | At startup, assigns gates to active assignments that lack them. | `assignments`, `routes`. | `assignments`; audit. |
| `aircraftGates.js` | 51 | `selectAircraftGate`, `repairAircraftParkingGates` | Parking gate selection that avoids gates occupied by other aircraft or active departures; startup repair for the fleet. | `aircraft`, `assignments`, `routes`. | `aircraft.current_gate`; audit. |

Contributors are expected to modify these files. Every change is validated by `npm --prefix api run check`, the two test scripts, and the smoke test described in [testing](testing.md).

## web/

The React frontend. Owned by the frontend concern.

| Path | Handwritten | Purpose | Modify directly |
|---|---|---|---|
| `web/package.json` | Yes | Seven runtime and six development dependencies, all pinned; scripts `dev`, `build`, `postbuild`, `typecheck`, `preview`. | Yes, with the lock file. |
| `web/package-lock.json` | Generated by npm | 68 lock entries, 32 of them optional platform-specific packages. | Never by hand. |
| `web/index.html` | Yes | HTML shell with metadata, Open Graph tags, font links, favicon, `<div id="root">`, and the `main.tsx` script tag. Vite rewrites the script tag in the built copy. | Yes, for metadata. |
| `web/vite.config.ts` | Yes | React plugin; output to `../site` with `app-assets` and `emptyOutDir: false`; dev server port 5174 and `/api` proxy. | Yes, but note the [proxy limitation](known-limitations.md#vite-development-proxy-does-not-strip-the-api-prefix). |
| `web/tsconfig.json`, `web/tsconfig.app.json` | Yes | TypeScript solution and project configuration; strict mode, ES2022, bundler resolution, `noEmit`. | Rarely. |
| `web/public/airdash-sw.js` | Yes | Service worker: push display, click handling that marks read and focuses or opens a window, subscription renewal. Copied verbatim to `site/airdash-sw.js`. | Yes. It is plain JavaScript and is not type-checked. |
| `web/public/assets/` | Yes (binary assets) | Logo, favicon, aircraft imagery, `plane.png` Open Graph image, News Hub artwork under `news/`, and the home showcase video, poster, and nine screenshots under `home-showcase/`. Copied verbatim to `site/assets/`. | Yes, by adding files; reference them as `/assets/<name>`. |

### web/src/

| File | Lines | Purpose | Modify directly |
|---|---|---|---|
| `main.tsx` | 14 | Mounts `App` in `StrictMode` and `BrowserRouter`; imports Leaflet CSS and `styles.css`. | Rarely. |
| `App.tsx` | 1561 | `AppContext`, page title map, level and streak helpers, shared components (`Button`, `Status`, `Page`, `Metric`, `ExpiryBar`, `Spinner`, `Empty`, dialogs, `Toast`, `Brief`), `Layout`, `LiveMap`, and the pages `Home`, `Join`, `Portal`, `Announcements`, `Flights`, `Schedule`, `Report`, `Fleet`, `Profile`, `Pilots`, `Missions`, `Health`, `Admin`, plus the `App` root with the route table. | Yes. This is where most frontend changes happen. |
| `AdvancedNetworkMap.tsx` | 379 | The `/map` page: Leaflet map with bases, routes, estimated aircraft positions from `/live`, RainViewer radar layers, and layer toggles. | Yes. |
| `News.tsx` | 96 | `LatestNews` (home page section), `NewsHub` (`/news` with search, category, paging), `NewsArticle` (`/news/:slug` with share links). | Yes. |
| `HomeMedia.tsx` | 45 | `HomeHeroShowcase`: the home page video and screenshot carousel with progress and pause. | Yes. |
| `api.ts` | 20 | `ApiError`, `api<T>`, `post`, `remove`. | Rarely. |
| `types.ts` | 18 | One interface per API response shape. | Yes, whenever the API adds or renames a field the frontend reads. |
| `airportData.ts` | 43 | Names, cities, countries, and coordinates for 28 airports; `airportCoordinate`. | Yes, when a route touches a new airport. |
| `flightPlan.ts` | 33 | Appends the airDash remark to an ATC flight plan and builds the VATSIM pre-file URL. | Yes. |
| `hangarQuips.ts` | 227 | Phrases for the Hangar heading and `pickHangarQuip`. | Yes. |
| `volanta.ts` | 10 | Opens `volanta://` through a hidden link. | Rarely. |
| `webPush.ts` | 75 | Support detection, service worker registration, subscribe, unsubscribe, test. | Yes. |
| `browserNotifications.ts` | 63 | Web Notifications API opt-in stored under `airdash-browser-notifications`; shows a desktop notification when the tab is hidden. | Yes. |
| `notificationState.ts` | 83 | `NotificationHistoryItem` and `NotificationPayload` types, `notificationGroups`, and the unused fingerprint helpers `notificationRecordKey`, `notificationRecordKeys`, `filterDismissedNotifications`. | Types yes; the helpers are dead code and candidates for removal. |
| `styles.css` | 541 | The complete stylesheet. Many rules are written on long single lines. | Yes; append overrides at the end. |
| `vite-env.d.ts` | 1 | Vite client type reference. | Never. |

Every change is validated by `npm --prefix web run typecheck`, the isolated build, and the marker check described in [local development](local-development.md#frontend-validation-sequence).

## docs/

Durable documentation, all handwritten Markdown, following [documentation-style.md](documentation-style.md). The [index](README.md) lists every page and its class. Contributors are expected to update documentation in the same pull request as the change it describes; the [maintenance triggers](README.md#maintenance-triggers) say which page.

## academy/

The local interactive learning application. It is a separate dependency-free Node.js package and is not part of the production website build.

| Path | Handwritten | Purpose | Modify directly |
|---|---|---|---|
| `academy/README.md` | Yes | Learner and maintainer entry point, commands, privacy, check boundaries, and accessibility. | Yes. |
| `academy/MASTERY_MODEL.md` | Yes | Canonical evidence levels, gates, scoring, review intervals, practical classes, capstone, and proof limits. | Yes, only with tests and review of every claim. |
| `academy/SCHEMA.md` | Yes | Human-readable contract for modules, concepts, questions, labs, exams, capstone, and progress. | Yes, with validator and migration implications. |
| `academy/index.html`, `styles.css`, `app.mjs` | Yes | Accessible browser shell, visual system, dashboard, study, quiz, review, lab, exam, capstone, and settings interface. | Yes; validate keyboard and browser behavior. |
| `academy/engine.mjs` | Yes | Pure grading, deterministic sampling, weighted results, spaced scheduling, misconception remediation, evidence derivation, gates, and progress validation. | Yes, with engine and progress tests. |
| `academy/server.mjs` | Yes | Loopback-only static server and fixed checker API with CSP, safe path allow-list, Origin, body, and concurrency controls. | Yes, with server boundary tests. |
| `academy/checks.mjs` | Yes | Eighteen fixed no-shell, redacted repository checkers. Browser and JSON input can select an ID but cannot provide a command. | Yes; new checker requires a documented automated lab and safety review. |
| `academy/validate.mjs` | Yes | Curriculum schema, link/anchor/source, concept coverage, critical evidence, exam feasibility, question quality, checker mapping, and capstone validation. | Yes; do not weaken thresholds to conceal missing content. |
| `academy/data/modules.json` | Yes | 21 ordered modules, prerequisites, skills, gates, references, and question files. | Yes. IDs remain stable after release. |
| `academy/data/concepts.json` | Yes | 105 atomic concepts with definitions, outcomes, canonical references, source evidence, and critical classification. | Yes whenever documented behavior changes. |
| `academy/data/questions/*.json` | Yes | One maintainable bank per module, 252 authored questions total. | Yes; follow question-quality and coverage rules. |
| `academy/data/labs.json` | Yes | 24 guided and independent labs, including 21 fixed automated checks and 3 human-inspected exercises. | Yes. JSON never defines a command. |
| `academy/data/exams.json` | Yes | Six cumulative phase and final examination specifications. | Yes, with feasibility validation. |
| `academy/data/capstones.json` | Yes | One 100-point human-reviewed integrated rubric mapping all concepts. | Yes. |
| `academy/test/*.test.mjs` | Yes | Engine, progress, checker, validator, and server tests. | Yes with behavior changes. |
| `academy/package.json`, `package-lock.json` | Yes / npm-generated | Dependency-free npm scripts and lock contract. | Manifest yes; lock through npm. |

The academy stores no repository progress file. Browser evidence remains in `localStorage`; export and import are explicit. The server may create and remove isolated build output only under the operating-system temporary directory.

## gsx/

Source trees for the airDash GSX ground handling packages. GSX (Ground Services X) is a third-party MSFS add-on that animates ground vehicles; these packages recolor its vehicles with airDash branding.

| Path | Handwritten | Purpose |
|---|---|---|
| `gsx/airdash-gsx-handling/` | Yes, plus generated `layout.json` | Package whose texture directories are named `texture.AIRDASH`. |
| `gsx/airdash-gsx-handling-aird/` | Same | Variant whose texture directories are named `texture.AIRD`, for simulators that key on a four-letter code. |
| `*/manifest.json` | Yes | MSFS package manifest: title `airDash Ground Handling`, version `1.0.0`, `content_type` `SCENERY`, `minimum_game_version` `1.37.19`. |
| `*/layout.json` | Generated by `build.py` | MSFS content listing with sizes and Windows FILETIME dates. |
| `*/build.py` | Yes | Walks the package, writes `layout.json`. Run from inside the package directory with `python3 build.py`. |
| `*/SimObjects/GroundVehicles/<vehicle>/texture.<CODE>/texture.CFG` | Yes | Texture fallback configuration per vehicle. |
| `.../FSDT_Staircase_TLD_ABS-580/texture.<CODE>/GSX_LOGO_4X1.PNG.DDS` and companions | Yes (binary) | The single branded texture, plus its `.json` and `.FLAGS` metadata. |

Generated ZIP archives are ignored by Git and published to `site/downloads/gsx/`. Changes are tested by building the package and loading it in the simulator, which cannot be automated on the production host.

## livery-templates/

`livery-templates/msfs2020-a220/` holds the generic structural files (`model.ATC/exterior.bin`, `exterior.gltf`, `Exterior.xml`, `model.CFG`, and `TEXTURE.CFG`) that a Synaptic A220 MSFS 2020 livery package requires. Its `README.md` records the SHA-256 of the private source archive and states that no airline-specific content was retained. `scripts/build-msfs2020-liveries.py` combines these files with airDash texture data to produce MSFS 2020 packages. Handwritten and binary; modified only when the template aircraft changes.

## scripts/

Automation sources. All handwritten.

| File | Language | Purpose | Runs on |
|---|---|---|---|
| `Update-AirDashPressStartVideo.ps1` | PowerShell | Reads `/api/live`, fills the PowerPoint template, exports the MSFS start video, replaces it atomically, verifies the hash, writes `last-export.json`. Parameters listed in [powerpoint-automation.md](powerpoint-automation.md#export-parameters). | Windows desktop session |
| `Start-AirDashMSFS2024.ps1` | PowerShell | Refuses to run if MSFS or PowerPoint is open, runs the exporter, verifies `last-export.json`, starts Steam app `2537590`, logs. | Windows |
| `Launch-AirDashMSFS2024.vbs` | VBScript | Starts the launcher with a hidden window so no console appears. | Windows |
| `Install-AirDashMSFSShortcut.ps1` | PowerShell | Creates the desktop shortcut that runs the VBScript wrapper, with the MSFS icon. | Windows |
| `Create-AirDashDemoVideo.ps1`, `Create-AirDashSampleVideo.ps1` | PowerShell | Render demonstration videos from the JSON fixtures instead of the live API. | Windows |
| `powerpoint-demo-flight.json`, `powerpoint-mission-flight.json` | JSON | Fixtures in the shape of `/api/live` for `-FlightDataPath`. | Any |
| `build-msfs2020-liveries.py` | Python 3 | Converts MSFS 2024 livery archives (KTX2 textures) into MSFS 2020 packages (DDS textures) using the template, writes reproducible ZIPs with SHA-256, and a `catalog-msfs2020.json`. Arguments: `--liveries-root`, `--template-root`, `--output-root`, optional repeated `--registration`. Requires Pillow. | Any with Python 3.10+ |

The Windows copies that actually run live at `D:\Creations\AirDash\Scripts\` on the Windows PC; the repository copies are the source of truth, and [powerpoint-automation.md](powerpoint-automation.md#updating-a-script) describes how to synchronize them and verify hashes. PowerShell changes are tested with a parse check and a `-DryRun`; the Python builder is tested by building a package and comparing the recorded SHA-256.

## site/ (untracked)

`site/` is the directory Nginx serves. It is excluded from Git because it mixes generated output with operational artifacts that are restored separately.

| Path | Origin | Modify directly |
|---|---|---|
| `site/index.html` | Generated by `vite build` from `web/index.html`. | Never. |
| `site/app-assets/index-<hash>.js`, `index-<hash>.css` | Generated by `vite build`. Old hashes accumulate. | Never. |
| `site/airdash-sw.js` | Copied from `web/public/airdash-sw.js` by the build. | Never; edit the source. |
| `site/assets/` | Copied from `web/public/assets/` by the build; may also contain files added by hand with `install -m 644`. | Prefer adding to `web/public/assets/` so the build reproduces them. |
| `site/downloads/liveries/<reg>/` | Published livery ZIPs, thumbnails, and per-registration manifests. `catalog.json` and `catalog-msfs2020.json` at the top describe them. | Yes, with the livery publication process and a backup. |
| `site/downloads/gsx/` | The GSX ZIP, `manifest.json`, and `SHA256SUMS.txt`. | Yes, when rebuilding the package. |
| `site/downloads/profiles/` | Uploaded profile images named `<discord_id>.<ext>`, written by the API. | Never by hand. |
| `site/.publication-archive/` | Previous versions of published livery packages, kept when a package is replaced. | Housekeeping only. |

**Important:** Never fix a frontend problem by editing a file in `site/app-assets/` or `site/index.html`. The next build replaces the active hash and discards the manual change. Edit `web/src/` and rebuild.

## node_modules/ (untracked)

`api/node_modules/` and `web/node_modules/` are restored exactly from the lock files with `npm ci`. Never edit their contents; a change there is lost on the next install and is invisible to other machines.

## Traced execution path: booking a flight

This walkthrough follows one user action from the click to the database and back, naming every file and function. It is the pattern that every mutation in airDash follows.

**Starting state:** a signed-in pilot with no active assignment is on `/flights`, has chosen an operating date, expanded route `AIR101` (Atlanta to Denver), and clicked an available aircraft, `N574AD`. The booking dialog is open and the pilot has clicked "Open Volanta" and then the confirm button.

1. **Browser, `web/src/App.tsx`, `Flights` component, `confirmBooking`.** The handler guards that a route is pending and Volanta was opened, sets `booking` to true to disable the button, and calls:

   ```ts
   const result = await post<{ existing?: boolean; rebooked?: boolean }>("/assignments", { routeId: pending.route.id, registration: pending.registration, flightDate: date, volantaTrackingConsent: volantaConsent })
   ```

2. **Browser, `web/src/api.ts`, `post` then `api`.** `post` serializes the body to JSON and calls `api` with method `POST`. `api` sends `fetch("/api/assignments", { credentials: "include", method: "POST", headers: { "Content-Type": "application/json" }, body })`. The browser attaches the dashydoggo.com session cookie and, because this is a `POST`, the header `Origin: https://air.dashydoggo.com`.

3. **Caddy.** Matches `handle /api/*`, removes the prefix, and forwards `POST /assignments` to `172.17.0.1:3006`.

4. **API, `api/src/server.js`, global middleware.** `express.json` parses the body into `req.body`. The security headers are set. `requireAirDashOrigin` (from `api/src/auth.js`) sees a `POST`, reads `Origin`, finds it allowed, and calls `next()`.

5. **API, route middleware `requireUser`.** `authenticatedUser(req.headers.cookie)` forwards the cookie to `AUTH_URL`, receives the user, and sets `req.user`. A missing or invalid session would have ended here with `401`.

6. **API, handler `app.post("/assignments", ...)`.** In order:
   - Validates `flightDate` with the `isDate` regular expression and responds `400` if it fails.
   - Coerces `routeId` to a number and normalizes `registration` with `clean(...).toUpperCase()`.
   - Borrows a dedicated client with `pool.connect()` and runs `BEGIN`.
   - Locks the pilot row with `SELECT ... FOR UPDATE` and responds `403` if the pilot is not `ACTIVE`.
   - Loads the route and responds `404` if it is not `ACTIVE`.
   - Looks for an existing assignment for the same route, date, and pilot. If one is active, it commits and returns it with `existing: true`; if one is `COMPLETED`, it responds `409`.
   - Checks for any other active assignment for the pilot and responds `409` with "Cancel or complete the current assignment before booking another flight".
   - Locks the aircraft row and responds `409` unless it is `AVAILABLE` at the route's origin.
   - Collects gates occupied at the origin and destination by other active assignments, prefers the aircraft's current gate or its last arrival gate at this airport if free, otherwise calls `selectGate` from `api/src/integrations.js`, which hashes a seed of route, date, registration, and direction to pick a deterministic free gate from the airport's pool.
   - Inserts the assignment (or updates a cancelled one for the same route and date) with `expires_at = NOW() + block_minutes + 150 minutes`, then sets consent, `file_vatsim`, `source`, and `mission_type` in a second `UPDATE`.
   - Sets the aircraft to `ASSIGNED` and parks it at the departure gate.
   - If a `scheduleId` was supplied, marks that schedule row `TAKEN` and links it.
   - `COMMIT`.

7. **API, audit.** After the commit, `audit(req.user.id, "ASSIGNMENT_CREATED", "assignment", id, { registration, routeId })` from `api/src/database.js` inserts a row into `airdash.audit_events`.

8. **API, response.** `res.status(201).json({ assignment, rebooked: false })`.

9. **Failure paths in the same handler.** Any thrown error runs `ROLLBACK`. A PostgreSQL unique violation (`error.code === "23505"`), which occurs when two requests race for the same aircraft or pilot and the partial unique indexes `assignments_active_aircraft` or `assignments_active_pilot` reject the second insert, becomes `409` with "The selected aircraft or pilot now has an active assignment. Refresh the flight board and try again." An error with a `status` returns its message; anything else returns `500` with "Assignment could not be created". `finally` releases the client in every case.

10. **Browser, back in `confirmBooking`.** On success, `notify(...)` shows a toast with a "Go to hangar" action, the dialog closes, and `await refresh()` reloads `/public` and `/me` so that the Hangar shows the new assignment and the Flight Board shows the aircraft as no longer available. On `ApiError`, the message from step 6 or 9 is shown as an error toast.

11. **Side effects visible elsewhere.** The aircraft appears `ASSIGNED` on the Fleet page and in `/public`; the flight appears in `/live` for the network map and the Windows exporter; the schedule row, if any, shows `TAKEN`; the audit row appears in the Administration Audit tab; and the notification job will produce a `filingSoon` reminder thirty minutes before `expires_at` if the pilot has not filed.

**Final state:** one new row in `airdash.assignments` with `status='BOOKED'`, the aircraft row updated to `ASSIGNED` with a `current_gate`, optionally one schedule row updated, and one row in `airdash.audit_events`.

To trace any other action, start from the `api(`, `post(`, or `remove(` call in the frontend component, find the matching `app.<method>("<path>"` in `server.js`, and read the handler top to bottom. The [API reference](api-reference.md) links each route to its handler and lists its side effects.
