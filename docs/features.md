# Features

This page describes what airDash does from the user's point of view, page by page and workflow by workflow, and for each feature names the rules the API enforces and the code that implements it. Read [project overview](project-overview.md) first for the actors and the core workflow. The [API reference](api-reference.md) is the authority for request and response details; this page links to it rather than repeating them.

Pages are listed in the order a new pilot encounters them. "Component" names the React function in `web/src/App.tsx` unless another file is given.

## Public pages

### Home (`/`)

Component: `Home`. Data: `GET /public`, `GET /news?limit=3`, `GET /live`.

The landing page presents the airline identity with a video and screenshot showcase (`HomeHeroShowcase` in `HomeMedia.tsx`), then sections built from `/public`: the four bases, the fleet ("N Airbus A220-300 aircraft" with registrations and details), the route network with a live map of active flights (`LiveMap`), and "The people flying airDash" with public pilot cards, roles, and statistics. The latest three press releases follow (`LatestNews` in `News.tsx`), with calls to action to join or sign in. The catch-all route `*` also renders Home.

### News Hub (`/news`, `/news/:slug`)

Components: `NewsHub`, `NewsArticle` in `News.tsx`. Data: `GET /news`, `GET /news/:slug`.

The News Hub lists published press releases with search (debounced 250 ms), a category filter built from the categories present, and "load more" paging of 12. An article page shows the release with a byline, share links (email, Facebook, X, LinkedIn, copy link), a hero image, and updates the document title and meta description. Only releases with `is_public=TRUE`, a slug, and a past `published_at` are visible; the owner publishes them from the Administration Updates tab. Responses carry `Cache-Control: public, max-age=60`.

### Join (`/join`)

Component: `Join`. Data: `POST /applications`, `/me`.

A visitor must sign in first; the page shows the sign-in prompt otherwise. The application form asks for preferred name, VATSIM CID, base (one of the active bases from `/public`), simulator, experience, and an introduction. After submission the page shows the application status and reviewer notes, and allows resubmission when the status is `RETURNED` or `REJECTED`. Once approved, the page shows "Pilot account active" and links to the Hangar. Rules: one application per user; CID must be 4 to 12 digits; base must be active. See [POST /applications](api-reference.md#post-applications).

### Schedule (`/schedule`)

Component: `Schedule`. Data: `GET /schedule` every 60 seconds.

A read-only timetable in UTC ("Zulu"). Rows come from the deterministic schedule generator plus every active assignment booked elsewhere (flagged with its source: Flight Board or Mission). Filters: all, open, in progress; search by flight number, origin, or destination. Departed rows are hidden. There is no booking control on this page at this commit even though the API supports `scheduleId`; booking happens on the Flight Board or Missions.

### Fleet and liveries (`/fleet`)

Component: `Fleet`. Data: `/public`, `POST /liveries/:registration/:simulator/download` when signed in, `GET /liveries/...` otherwise.

Lists the 21 aircraft with fleet number, status, current airport and gate, hours and cycles, special livery badge, thumbnail, and download counts. Each aircraft offers MSFS 2020 and MSFS 2024 livery downloads. A signed-in pilot's download is recorded in `livery_downloads` so the Hangar can indicate new versions; an anonymous download increments the public counter and redirects. Package integrity can be checked against the SHA-256 shown from `aircraft.livery_sha256`.

### Network health (`/health`)

Component: `Health`. Data: `GET /hub-health`.

For each base: aircraft capacity, demand (flights touching the base in the last 30 days), previous period, growth, forecast, flights per aircraft, a status (`UNDER_SERVED`, `HEALTHY`, `OVER_SERVED`, `DORMANT`, `NO_AIRCRAFT`), a score, and a recommendation. Also lists candidate stations with recent traffic that are not bases. All computed from approved reports in the last 60 days.

### Network map (`/map`)

Component: `AdvancedNetworkMap` in `AdvancedNetworkMap.tsx`. Data: `/public`, `GET /live`, RainViewer public API.

A Leaflet map on CARTO dark tiles showing bases, the route network, and active flights with estimated positions interpolated from `booked_at`, `started_at`, and `block_minutes` (there is no real-time telemetry). Layer toggles include weather radar from RainViewer with recent and forecast frames. Airport names and coordinates come from `airportData.ts`.

## Pilot pages

All pilot pages require an `ACTIVE` pilot record; otherwise they render an empty state pointing to `/join`.

### Hangar (`/portal`)

Component: `Portal`. Data: `/me`, `/public`, `GET /org-updates?limit=5`, the notification payload, and the assignment routes.

The Hangar is the pilot's dispatch desk. Its heading is a rotating phrase from `hangarQuips.ts`. Sections, each with an anchor id used by notifications:

| Section | Anchor | Contents and actions |
|---|---|---|
| Current assignment | `portal-current-assignment` | Flight number, route, aircraft, gates, status (`BOOKED` shown as booked, `ACTIVE` shown as FLYING), the `ExpiryBar` counting down to `expires_at`, and buttons: Start flight (`POST /assignments/:id/start`), Cancel with a structured reason dialog (`POST /assignments/:id/cancel`), change departure gate or destination gate (`POST .../departure-gate`, `.../arrival-gate`), regenerate both gates (`POST .../gates`). |
| Flight planning | `portal-flight-planning` | Generate SimBrief plan (`GET .../simbrief-generate` opens SimBrief with `D1` airline, `AIR<n>` callsign, LIDO format, and the airDash remark), Fetch latest OFP (`POST .../simbrief-fetch`), import a specific XML URL (`POST .../simbrief`), link a Volanta flight (`POST .../volanta`), open Volanta desktop (`volanta://`), and a VATSIM pre-file link built by `flightPlan.ts` from the imported ATC plan with the airDash remark appended. |
| Updates | `portal-updates` | Recent announcements, equipment alerts (aircraft in maintenance or inspection), progress notices, and notification history, with "mark as read". |
| Statistics | `portal-statistics` | Level and experience bar (`600` XP per level), block hours, flights, missions, streak cards (flight-day streak with bonus tier, route continuity), and time since last flight. |

Rules enforced by the API for these actions: only the owner of a `BOOKED` assignment can start it, only `BOOKED` assignments can change gates, only `BOOKED` or `ACTIVE` assignments can be cancelled or receive plans, SimBrief plans must match the route and be `BCS3`, recovery ferries must have zero payload, and Volanta links must match route and aircraft.

A first-visit "brief" (`Brief` component, seventeen cards from "Welcome to airDash" through "You are ready") opens automatically once per pilot per brief version (`BRIEF_VERSION` in `App.tsx`) and can be reopened from the "New pilot brief" section of the Profile page.

### Flight Board (`/flights`)

Component: `Flights`. Data: `GET /flights`, `/public`; action `POST /assignments`.

Lists active routes grouped by origin with the aircraft currently `AVAILABLE` at each origin. Controls: operating date (today or later), search, sort (by origin, shortest, longest, aircraft ready). Selecting an aircraft opens a booking dialog that requires the pilot to open Volanta first (the "Open Volanta" button must be clicked before confirm is enabled), then books with `source: BOARD`. The page warns when the pilot already has an assignment. Rules: one active assignment per pilot and per aircraft (unique indexes), aircraft must be at the origin, one booking per pilot per route per date. The full server path is traced in the [repository guide](repository-guide.md#traced-execution-path-booking-a-flight).

### Missions (`/missions`)

Component: `Missions`. Data: `GET /missions`; actions `POST /assignments` with `source: MISSION`, `POST /missions/recovery`.

Suggests continuation flights from where the pilot's last approved flight ended, using the same aircraft when it is available, otherwise another available aircraft at that airport, otherwise anywhere (flagged `fallback`). Standard missions earn a multiplier on experience that rises with block time (`1 + minutes/240 × 1.5`, capped at 2.5). The page shows a mission "expiry" derived from a hash of the route ID and the current two-hour window (`missionExpiry`); this is a presentation device to encourage timely booking and is not enforced by the API. After a diverted or incomplete flight, a recovery ferry back to the planned destination is offered first, with zero passengers and cargo, a hidden `AIR9xxx` flight number, and normal (1.0) experience. Destinations already flown are marked.

### Pilot report (`/report`)

Component: `Report`. Data: `/me`, `GET /pireps`; actions `POST /volanta/import`, `POST /pireps`.

The pilot pastes the public Volanta flight link. The page first calls `/volanta/import` with the assignment to preview the flight and its outcome analysis: route and aircraft match, arrival verified or not, time compression, landing rate, and the derived outcome (`COMPLETED`, `DIVERTED`, or `INCOMPLETE`) with the reposition airport. For non-complete outcomes the form requires a reason from the nine codes and details when the reason is `OTHER`. Optional fields: VATSIM flown, remarks. Submission (`POST /pireps`) re-derives everything server-side; the browser's preview is never trusted. Submitted reports remain listed on the page with their review status. When `autoApprovePireps` is enabled, the report is approved in the same request and the page says so.

Outcome rules, implemented in `api/src/flightOutcome.js` and tested by `test-flight-outcomes.js`:

| Outcome | Condition | Aircraft position on approval | Credit |
|---|---|---|---|
| `COMPLETED` | Verified arrival or on-blocks and no diversion evidence | Scheduled destination, at the arrival gate | 100 percent of eligible block time |
| `DIVERTED` | Verified arrival and any of `hasDiverted`, a diversion airport, or a diversion reason | Volanta's diversion airport when given | 90 percent |
| `INCOMPLETE` | Flight ended (state `Completed`) but no verified arrival | Filed alternate if past 50 percent of planned distance, else origin | 90 percent |

Eligible block time is the lesser of simulator and real block time, which neutralizes simulator time acceleration. A landing rate at or below -450 feet per minute places the aircraft in a 48-hour inspection on approval. Zero landing rates are stored as `NULL` so they do not distort averages.

### Pilot profile (`/profile`)

Component: `Profile`, with `BrowserNotificationSetting` and `NotificationPushPrompt`. Data: `GET /profile`; actions `POST /profile`, `POST /profile/image`, `POST /profile/liveries/reset`, and the `/push/*` routes.

Editable: pilot nickname (display name), pronouns, about me, profile image (upload of PNG, JPEG, or WebP up to 1.5 MB, or an `https://` URL), SimBrief username, and a home base change request with a reason, which the owner approves or denies. Notification settings: desktop notifications while the tab is hidden (Web Notifications API, opt-in stored in local storage under `airdash-browser-notifications`) and Web Push for background delivery (service worker `airdash-sw.js`; subscribe, test, unsubscribe). The "Reset downloads" button forgets recorded livery downloads so every package shows as new; it is disabled when nothing has been downloaded. The "New pilot brief" section reopens the onboarding brief.

### Pilot directory (`/pilots`)

Component: `Pilots`. Data: `GET /pilots`, `GET /pilots/:id`.

Lists active pilots with number, base, rank, level, hours, flights, missions, average landing rate, current flight, and streaks; highlights the pilot with the most hours. Selecting a pilot shows their last 20 approved flights.

### Announcements (`/announcements`)

Component: `Announcements`. Data: `GET /org-updates` with search, category, sort, and paging (25 per page).

The archive of every organization update, private and public, including automatic `NEW_PILOT` welcomes. Categories: `GENERAL`, `OPERATIONS`, `FLEET`, `MAINTENANCE`, `NEW_PILOT`, `ACHIEVEMENT`, `LEVEL_UP`.

## Notifications

Implemented server-side in `api/src/notifications.js`, delivered in-app by `Layout` and `NotificationPanel`, by desktop notification through `browserNotifications.ts`, and by push through `push.js` and the service worker.

| Group | Recipient | Trigger | Link |
|---|---|---|---|
| `applications` | Owner | Application `SUBMITTED` or `UNDER_REVIEW` | `/admin?tab=applications` |
| `pireps` | Owner | Report `SUBMITTED` | `/admin?tab=pireps` |
| `pireps` | Pilot | Own report `RETURNED` or `REJECTED` within 7 days | `/report` |
| `aircraft` | Both | Aircraft in `INSPECTION` or `MAINTENANCE` | Admin aircraft tab, or Hangar equipment |
| `baseRequests` | Owner | Pending base change request | `/admin?tab=pilots` |
| `progress` | Both (own) | Approved report with credit within 7 days | Hangar progress |
| `orgUpdates` | Both | Update created within 7 days | Hangar announcements |
| `expired` | Pilot | Own `ASSIGNMENT_EXPIRED` audit event within 7 days | `/flights` |
| `filingSoon` | Pilot | Own `BOOKED` assignment expiring within 30 minutes | `/report` |
| `gateChanges` | Pilot | Own `ARRIVAL_GATE_REASSIGNED` audit event within 7 days | Hangar current assignment |

Each candidate record is fingerprinted into an `event_key`; a new key inserts a history row; the bell shows the unread count; closing the panel marks the visible unread rows read. A record that changes (for example a report that is returned and later approved) produces a new notification by design. The frontend polls every 60 seconds. Push delivers rows with `pushed_at IS NULL` every 60 seconds to subscribed browsers; clicking a push notification marks it read and opens its link.

## Owner pages

### Administration (`/admin`)

Component: `Admin`. Data: `GET /admin/overview` (everything in one call) and `GET /admin/notifications`. The active tab is in the URL as `?tab=<name>`, which notification links use.

| Tab | Shows | Actions |
|---|---|---|
| `applications` | Every application with applicant identity, VATSIM CID, base, simulator, experience, introduction, status | Approve, return, reject with notes (`POST /admin/applications/:id/:decision`). Approval assigns the next pilot number and publishes a welcome. |
| `updates` | Composer and the latest 50 updates | Publish a private announcement or a public press release with slug, summary, hero image, author, and optional pilot or aircraft link (`POST /admin/org-updates`). |
| `pireps` | Every report with pilot, route, aircraft, times, landing rate, compression flags, outcome, flight plan, Volanta link | Approve, return, reject with notes (`POST /admin/pireps/:id/:decision`). Approval credits the pilot, moves the aircraft, and may trigger inspection. |
| `pilots` | Every pilot with status, base, statistics, pending base request | Change status or base (`POST /admin/pilots/:id/manage`), decide base requests (`POST /admin/pilots/:id/base`), view complete flight history (`GET /admin/pilots/:id/flights`). |
| `bases` | Every base with pilot count | Create or edit (`POST /admin/bases`), delete when unused (`DELETE /admin/bases/:code`). |
| `visitors` | Signed-in users with no application and no pilot record | None; awareness only. |
| `assignments` | Latest 100 assignments with pilot and canceller | Delete an assignment and its report, reversing credited statistics (`DELETE /admin/assignments/:id`) after a confirmation dialog. |
| `aircraft` | The fleet with status, reason, hold end, position, gate | Set `AVAILABLE`, `MAINTENANCE`, `INSPECTION` (48 hours), or `RETIRED` with a reason (`POST /admin/aircraft/:registration/status`). Refused while `ASSIGNED`. |
| `audit` | Latest 500 audit events with actor names | None. Viewing records the time in local storage (`airdash-audit-seen`) to highlight newer events. |
| `settings` | Operational settings | Toggle automatic report approval (`POST /admin/settings`). |

The owner also sees the operations notification bell in the top bar and the "admin" link under "more".

## Downloads and simulator content

| Content | Location | Built by | Verified by |
|---|---|---|---|
| MSFS 2024 liveries, 21 aircraft | `site/downloads/liveries/<reg>/synaptic-a220-livery-air-<REG>.zip` and `catalog.json` | Private MSFS 2024 process, not in the repository | SHA-256 in `aircraft.livery_sha256` and the catalog |
| MSFS 2020 liveries, 21 aircraft | `.../synaptic-a220-livery-air-<REG>-msfs2020.zip` and `catalog-msfs2020.json` | `scripts/build-msfs2020-liveries.py` from the 2024 archives and `livery-templates/msfs2020-a220/` | `aircraft.livery_msfs2020_sha256` |
| GSX ground handling | `site/downloads/gsx/airdash-gsx-handling-v1.0.0.zip`, `manifest.json`, `SHA256SUMS.txt` | `gsx/airdash-gsx-handling/build.py` then zip | `SHA256SUMS.txt` |
| Profile images | `site/downloads/profiles/<discord_id>.<ext>` | `POST /profile/image` | none |

The special livery `FWA2027` on `N514AD` is flagged with `special_livery=TRUE` and shows a badge on the Fleet page.

## Windows automation

The PowerShell exporter reads `GET /live`, selects the configured pilot's active flight, fills a PowerPoint template, renders the MSFS 2024 press-start video, and replaces it atomically with hash verification; the launcher runs it before starting MSFS through Steam. It is documented completely in [powerpoint-automation.md](powerpoint-automation.md).

## Browser state

The frontend keeps a small amount of state in the browser's local storage. Clearing site data resets all of it; none of it affects server-side records.

| Key | Set by | Purpose |
|---|---|---|
| `airdash-brief-seen:<version>:<pilot id>` | `App` | The first-visit brief has been shown for this brief version. |
| `airdash-progress-seen:<pilot id>` | `Portal` | Experience value last acknowledged, for the progress highlight. |
| `airdash-announcements-seen:<pilot id>` | `Portal` | Highest announcement ID seen. |
| `airdash-equipment-seen:<pilot id>` | `Portal` | Fingerprint of equipment alerts seen. |
| `airdash-updates-coachmark:<pilot id>` | `Portal` | Signature of the updates coachmark dismissed. |
| `airdash-audit-seen` | `Admin` | Time the audit tab was last viewed. |
| `airdash-browser-notifications` | `browserNotifications.ts` | Desktop notification opt-in. |

Notification read state is not in this list because it is server-side in `notification_history.read_at`.

## Accessibility

Interactive controls are native `<button>` and `<a>` elements with `aria-label` where the visible content is an icon; menus use `aria-expanded` and `aria-haspopup`; the media showcase exposes `aria-live`, `aria-current`, and labeled controls; images carry `alt` text or empty `alt` when decorative. A global stylesheet rule disables animation when the operating system requests reduced motion. Colors are supplemented by text (status words, labels) rather than relied on alone. No automated accessibility audit has been run; this is recorded in [known limitations](known-limitations.md).
