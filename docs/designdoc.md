# airDash Platform Design

**Status:** Proposed
**Version:** 1.1
**Date:** September 8, 2026
**Owner:** airDash
**Audience:** Product owner, developers, operations staff, and future virtual-airline administrators

## Current implementation status

The first production platform version was deployed on September 9, 2026. The public website,
pilot portal, owner administration interface, Node API, and PostgreSQL data model are active.
Discord authentication currently reuses the existing dashydoggo.com session service.

The initial fleet contains 20 Airbus A220-300 aircraft: N572AD, N573AD, N574AD, N575AD,
N772AD, N773AD, N791AD, N793AD, N794AD, N796AD, N797AD, N798AD, N801AD, N802AD,
N803AD, N804AD, N805AD, N806AD, N807AD, and N820AD. Every aircraft has a downloadable
Synaptic A220-300 package, a public manifest, a SHA-256 checksum file, and a unique
registration-specific thumbnail. The packages passed unpacked-layout, ZIP-integrity,
registration, texture, and thumbnail validation before publication.

The website presents KATL, KDEN, and MDSD as the initial operating bases. Sixteen proposed
route directions connect those bases with each other and with the first candidate stations.
These routes are proposals rather than completed flight history.


## 1. Executive summary

airDash will operate a public virtual-airline website and an authenticated operations portal for pilots. Discord will be the primary authentication provider, following the same general login experience used by dashydoggo.com. Each authenticated Discord user will have a separate airDash pilot record, pilot identifier, roles, qualifications, flight history, and privacy settings.

The long-term platform may support Discord authentication, pilot applications, pilot profiles, routes, scheduled flights, aircraft booking, pilot reports (PIREPs), staff review, statistics, audit records, and VATSIM-assisted tracking.

Development does not follow fixed phases. airDash implements one small, usable change at a time and uses each completed change to decide what to build next. The current implementation increment is limited to correcting the public airline identity, selecting the first aircraft, and publishing a matching versioned livery package. The authenticated operations portal remains a future capability until the public foundation is accurate.

## 2. Airline identity decisions

| Identity | Value | Status and use |
|---|---|---|
| Airline name | airDash | Public brand |
| Operational designator | AIR | Used in VATSIM callsigns and operational records; provisional pending VATSIM acceptance |
| Voice callsign | AIR DASH | Spoken on VATSIM and used in operational communication |
| Virtual commercial designator | D1 | Passenger-facing and internal commercial identifier; not IATA-assigned |
| Official IATA designator | None | Store as null and display as N/A |
| Aircraft type | BCS3 | ICAO aircraft type for the Airbus A220-300 |
| Headquarters | Atlanta, Georgia | Corporate and administrative location |
| Operating base | Santo Domingo | Primary simulated aircraft and crew base |

IATA's public lookup returned no assigned airline for `D1` on September 8, 2026. This does not assign or reserve the code for airDash. The website must label it **Virtual commercial designator**, not **IATA**.

The system must store the numeric flight number separately from all designators. For example, flight 461 would use the following identities:

| Context | Rendered identity |
|---|---|
| Passenger-facing schedule | D1 461 |
| Internal commercial identifier | D1-461 |
| Operational identifier | AIR461 |
| VATSIM callsign | AIR461 |
| Spoken callsign | Air Dash four sixty-one |

This separation allows the virtual commercial designator to change later without rewriting historical flights.

## 3. Fleet identity

N572AD and N573AD are the first created airDash aircraft records. The `Created` status means that an aircraft record exists; it does not mean that the aircraft is operationally active. Both aircraft remain `PLANNED` until their matching livery packages, current airports, and operating statuses are complete. No previous airDash flight is carried into the new fleet history.

The following registrations form the current fleet plan:

| Registration | Aircraft type | Record status |
|---|---|---|
| N572AD | A220-300 (BCS3) | Created |
| N573AD | A220-300 (BCS3) | Created |
| N574AD | A220-300 (BCS3) | Not created |
| N575AD | A220-300 (BCS3) | Not created |
| N772AD | A220-300 (BCS3) | Not created |
| N773AD | A220-300 (BCS3) | Not created |
| N791AD | A220-300 (BCS3) | Not created |
| N793AD | A220-300 (BCS3) | Not created |
| N794AD | A220-300 (BCS3) | Not created |
| N796AD | A220-300 (BCS3) | Not created |
| N797AD | A220-300 (BCS3) | Not created |
| N798AD | A220-300 (BCS3) | Not created |
| N801AD | A220-300 (BCS3) | Not created |
| N802AD | A220-300 (BCS3) | Not created |
| N803AD | A220-300 (BCS3) | Not created |
| N804AD | A220-300 (BCS3) | Not created |
| N805AD | A220-300 (BCS3) | Not created |
| N806AD | A220-300 (BCS3) | Not created |
| N807AD | A220-300 (BCS3) | Not created |
| N820AD | A220-300 (BCS3) | Not created |
| N831AD | A220-300 (BCS3) | Not created |
| N835AD | A220-300 (BCS3) | Not created |
| N836AD | A220-300 (BCS3) | Not created |
| N837AD | A220-300 (BCS3) | Not created |
| N838AD | A220-300 (BCS3) | Not created |

These registrations are simulated airDash identifiers and are not FAA reservations. Apparent availability must be checked again before a registration is created because public registration data can change.

An aircraft becomes `ACTIVE` only when its fleet record, matching livery package, current airport, and operating status are complete.

## 4. Goals and non-goals

### 4.1 Goals

1. Allow a community member to sign in with Discord and submit a pilot application.
2. Give staff a controlled process for approving pilots and assigning pilot identifiers.
3. Let an approved pilot select a scheduled flight and an available aircraft.
4. Prevent conflicting assignments of the same aircraft.
5. Collect a consistent PIREP after every flight.
6. Maintain aircraft location, hours, cycles, and status.
7. Publish safe aggregate statistics without exposing private account data.
8. Provide public, versioned, verifiable livery downloads.
9. Preserve a complete audit trail for material administrative changes.
10. Support later VATSIM tracking without redesigning the core flight model.

### 4.2 Non-goals for the current increment

- Discord authentication and pilot applications
- Aircraft booking and PIREP workflows
- Administrative portals and role management
- VATSIM or simulator tracking
- Real ticket sales or passenger reservations
- Real IATA, ICAO, FAA, DOT, JAC, or IDAC authority
- Crew pairing or legal duty-time calculations
- Simulated revenue accounting
- Mobile applications or native ACARS software
- Public user-uploaded liveries
- Automatic Discord direct messages
- Complex ranks, awards, or virtual currency

## 5. Users and roles

| Role | Responsibilities |
|---|---|
| Visitor | View public pages, schedules, fleet, statistics, and downloads |
| Applicant | Complete and monitor a pilot application |
| Pilot | Book flights, select aircraft, submit PIREPs, and manage profile settings |
| Dispatcher | Review flights, release flights, manage aircraft assignments, and record operational notes |
| Reviewer | Review and approve or return PIREPs |
| Operations staff | Manage routes, schedules, fleet status, delays, and occurrences |
| Administrator | Manage users, roles, configuration, and audit records |
| Owner | Full platform authority and irreversible configuration approval |

Platform roles are authoritative. Discord server roles may be synchronized for convenience, but a Discord role alone must not grant platform administration without an explicit local authorization rule.

## 6. System architecture

The design is implementation-neutral, but it assumes four logical components:

```text
Public and pilot browser
        |
        v
air.dashydoggo.com
  - Public website
  - Authenticated operations portal
        |
        v
Application API
  - Discord OAuth callback
  - Pilot and flight workflows
  - Administrative authorization
        |
        +--------------------+
        |                    |
        v                    v
Relational database      Public file storage
  - Pilots               - Livery ZIP files
  - Routes               - Manifests
  - Flights              - Preview images
  - Aircraft             - Checksums
  - PIREPs
  - Audit events
        |
        v
Scheduled worker and integrations
  - VATSIM live-data polling
  - Booking expiration
  - Notifications
  - Statistics refresh
```

### 6.1 Recommended URL structure

```text
https://air.dashydoggo.com/                   Public website
https://air.dashydoggo.com/ops                Authenticated pilot portal
https://air.dashydoggo.com/admin              Staff portal
https://air.dashydoggo.com/api/v1             Application API
https://air.dashydoggo.com/auth/discord        Discord login start
https://air.dashydoggo.com/auth/discord/callback
https://air.dashydoggo.com/downloads           Public livery files
```

A separate API hostname is acceptable if required by hosting constraints. If used, it must have an explicit origin allowlist and must not allow wildcard credentialed cross-origin requests.

### 6.2 Data store

Use a relational database, preferably PostgreSQL or an equivalent managed relational service. Aircraft assignment, flight-number uniqueness, PIREP approval, and aircraft-position changes require transactions and database constraints.

Public livery files may remain on the current static host or move to object storage with a content-delivery layer. All authoritative download URLs must be versioned.

## 7. Discord authentication

### 7.1 Authentication model

Discord is the primary login identity. An airDash account is keyed to the immutable Discord user ID, not the mutable username or display name.

Use Discord's OAuth 2.0 authorization code grant. Do not use the implicit grant.

### 7.2 Initial scopes

Request only:

```text
identify
```

This provides the Discord user ID, username, global display name, and avatar. Do not request `email` unless airDash establishes a specific need for email communication. Do not request `guilds`, `connections`, or unrelated scopes.

If membership in a specific airDash Discord server becomes mandatory, add:

```text
guilds.members.read
```

Alternatively, a server-side bot may verify membership. The chosen method must be documented before implementation.

### 7.3 Login flow

1. The user selects **Sign in with Discord**.
2. The application generates a cryptographically random OAuth `state` value.
3. The application stores the state in a short-lived, secure session.
4. The browser is redirected to Discord authorization.
5. Discord redirects to the registered callback with a code and state.
6. The application rejects the callback if state does not match.
7. The server exchanges the code for an access token.
8. The server requests the current Discord user with the `identify` scope.
9. The server creates or updates the local identity record.
10. The server discards the Discord access token after identity retrieval unless a documented feature requires token persistence.
11. The application issues its own local session cookie.

### 7.4 Session requirements

- Use a secure, HTTP-only cookie.
- Use `SameSite=Lax` or stricter unless a documented flow requires otherwise.
- Rotate the session identifier after login and privilege changes.
- Set a finite idle timeout and absolute lifetime.
- Reauthenticate for owner-level changes.
- Scope the cookie to the airDash application rather than all dashydoggo.com subdomains unless central single sign-on is deliberately implemented.

### 7.5 Account and pilot separation

A Discord login creates an account, not an approved pilot. The account state and pilot state are separate:

```text
Account: ACTIVE, DISABLED
Pilot: NONE, APPLICANT, ACTIVE, LEAVE, INACTIVE, SUSPENDED
```

An authenticated user without a pilot record can submit an application. Staff approval creates the pilot record and permanent pilot ID.

## 8. Pilot onboarding

### 8.1 Application fields

Required:

- Discord identity, supplied by OAuth
- Preferred display name
- VATSIM CID
- Preferred base, ATL or SDQ
- Simulator
- A220 add-on version
- Time zone
- VATSIM experience category
- Agreement to the terms, privacy policy, and code of conduct
- Age-eligibility confirmation

Optional:

- Short introduction
- Previous virtual-airline experience
- Accessibility or support notes

Do not collect a legal name, home address, Discord password, VATSIM password, or full date of birth.

### 8.2 Pilot identifiers

Use sequential pilot identifiers:

```text
AD0001
AD0002
AD0003
```

The database must not recycle a pilot ID after a pilot leaves.

### 8.3 Application states

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED
                                  -> RETURNED
                                  -> REJECTED
```

Every state change records the actor, timestamp, reason, and previous state.

## 9. Information architecture

### 9.1 Public pages

- Home
- About airDash
- Destinations and route map
- Schedule
- Fleet
- Live flights
- Statistics
- News
- Livery downloads
- Join
- Privacy policy
- Terms of use
- Code of conduct
- Virtual-airline disclaimer

### 9.2 Pilot portal

- Dashboard
- Flight board
- My bookings
- Active flight
- Submit PIREP
- Logbook
- Fleet and downloads
- Qualifications
- Documents
- Profile and privacy

### 9.3 Staff portal

- Applicant queue
- Pilot roster
- Flight operations board
- PIREP review queue
- Aircraft status and position
- Route management
- Schedule management
- Livery package management
- Qualifications
- Occurrence reports
- Audit log
- Configuration

## 10. Domain definitions

- **Airport:** A reusable airport record identified operationally by ICAO code.
- **Route:** A reusable ordered airport pair, such as KATL to MDSD.
- **Schedule:** A flight number, route, days, planned times, and effective date range.
- **Flight:** One dated occurrence of a schedule.
- **Assignment:** A pilot and aircraft allocated to a flight.
- **Dispatch release:** The planned route, fuel, alternate, timing, and operational authorization for one flight.
- **PIREP:** The submitted record of what occurred during a flight.
- **Telemetry:** Time-stamped VATSIM or simulator observations.
- **Occurrence:** A delay, diversion, return, cancellation, tracking issue, or safety report.
- **Fleet number:** airDash's permanent internal aircraft identifier.
- **Registration:** The simulated external registration displayed on the aircraft.

## 11. Data model

### 11.1 Core entities

#### users

- `id`
- `discord_user_id`, unique
- `discord_username`
- `discord_global_name`
- `discord_avatar_hash`
- `account_status`
- `created_at`
- `last_login_at`

#### pilots

- `id`
- `user_id`, unique
- `pilot_number`, unique
- `display_name`
- `vatsim_cid`
- `vatsim_verified_at`
- `base_airport_id`
- `pilot_status`
- `joined_at`
- `last_flight_at`
- `public_profile_enabled`
- `total_block_minutes`
- `total_flights`

#### roles and user_roles

- Platform role definitions
- User-to-role assignments
- Assignment source
- Effective and expiration timestamps

#### airports

- `id`
- `icao_code`, unique
- `iata_code`, nullable
- `name`
- `city`
- `country_code`
- `time_zone`
- `active`

#### routes

- `id`
- `origin_airport_id`
- `destination_airport_id`
- `route_status`
- `estimated_block_minutes`
- `qualification_code`, nullable
- `effective_from`
- `effective_to`, nullable

Unique constraint: active origin and destination pair.

#### schedules

- `id`
- `flight_number`, integer
- `route_id`
- `days_of_week`
- `scheduled_out_utc`
- `scheduled_in_utc`
- `effective_from`
- `effective_to`
- `schedule_status`

The designators are not embedded in `flight_number`.

#### flights

- `id`
- `schedule_id`, nullable for charters
- `flight_number`
- `flight_date_utc`
- `origin_airport_id`
- `destination_airport_id`
- `scheduled_out_at`
- `scheduled_in_at`
- `flight_status`
- `created_at`

Unique constraint: flight date plus flight number, subject to an operational suffix policy if suffixes are later supported.

#### aircraft

- `id`
- `fleet_number`, unique
- `registration`, unique
- `registration_type`, default `SIMULATED`
- `aircraft_type`, `BCS3`
- `current_airport_id`
- `aircraft_status`
- `total_block_minutes`
- `total_cycles`
- `livery_package_id`, nullable
- `last_registry_check_at`

#### assignments

- `id`
- `flight_id`, unique while active
- `pilot_id`
- `aircraft_id`
- `assignment_status`
- `booked_at`
- `expires_at`
- `started_at`, nullable
- `released_at`, nullable

#### dispatch_releases

- `id`
- `flight_id`
- `assignment_id`
- `route_text`
- `alternate_airport_id`, nullable
- `planned_fuel`
- `fuel_unit`
- `planned_cruise_level`, nullable
- `weather_checked_at`
- `notams_checked_at`
- `released_by_pilot_id`
- `released_at`

#### pireps

- `id`
- `flight_id`
- `assignment_id`
- `pilot_id`
- `aircraft_id`
- `actual_out_at`
- `actual_off_at`, nullable
- `actual_on_at`, nullable
- `actual_in_at`
- `departure_fuel`, nullable
- `arrival_fuel`, nullable
- `fuel_unit`, nullable
- `completion_status`
- `vatsim_flown`
- `evidence_url`, nullable
- `remarks`, nullable
- `review_status`
- `reviewed_by_pilot_id`, nullable
- `reviewed_at`, nullable
- `review_notes`, nullable
- `submitted_at`

#### livery_packages

- `id`
- `aircraft_id`
- `version`
- `simulator`
- `addon_name`
- `download_url`
- `manifest_url`
- `preview_url`
- `sha256`
- `file_size_bytes`
- `package_status`
- `published_at`

Unique constraint: aircraft plus version.

#### qualifications

- `id`
- `code`, unique
- `name`
- `aircraft_type`, nullable
- `validity_days`, nullable

#### pilot_qualifications

- `pilot_id`
- `qualification_id`
- `issued_at`
- `expires_at`, nullable
- `issued_by_pilot_id`

#### occurrences

- `id`
- `flight_id`, nullable
- `reported_by_pilot_id`
- `occurrence_type`
- `severity`
- `summary`
- `details`
- `status`
- `created_at`
- `closed_at`, nullable

#### audit_events

- `id`
- `actor_user_id`
- `action`
- `entity_type`
- `entity_id`
- `before_json`, nullable
- `after_json`, nullable
- `created_at`
- `request_id`

### 11.2 Required constraints

1. Discord user IDs are unique and immutable.
2. Pilot numbers are unique and never recycled.
3. Aircraft registrations and fleet numbers are unique.
4. One aircraft cannot have overlapping active assignments.
5. One pilot cannot have overlapping active assignments.
6. An aircraft must be at the flight's origin before assignment.
7. An inactive or maintenance aircraft cannot be assigned.
8. Only approved pilots can receive assignments.
9. Only authorized reviewers can approve PIREPs.
10. Approved PIREPs cannot be silently edited.

## 12. Flight lifecycle

### 12.1 Flight states

```text
SCHEDULED -> AVAILABLE -> BOOKED -> DISPATCHED -> ACTIVE
                                                   |
                                                   v
                                             PIREP_SUBMITTED
                                                   |
                             +---------------------+-------------------+
                             v                     v                   v
                         COMPLETED              DIVERTED            RETURNED
```

A flight may also become `CANCELLED` before completion.

### 12.2 Booking process

1. The pilot selects a flight.
2. The platform checks pilot status and qualifications.
3. The platform lists aircraft that are active, at the origin, and unassigned.
4. The pilot selects one aircraft.
5. A transaction creates the assignment and locks the aircraft.
6. The platform presents the matching livery download.
7. The booking expires if the pilot does not start within the configured window.

### 12.3 PIREP process

```text
DRAFT -> SUBMITTED -> APPROVED
                   -> RETURNED
                   -> REJECTED
```

On approval, one transaction must:

1. Add the block time to the pilot.
2. Increment the pilot's completed-flight count.
3. Add block time and one cycle to the aircraft.
4. Move the aircraft to the reported destination.
5. Close the assignment.
6. Mark the flight complete.
7. Create an audit event.

A rejected PIREP must not move the aircraft or increment statistics.

## 13. PIREP form design

### 13.1 Required fields

- Assigned flight
- Flight date
- Assigned aircraft
- Actual Out time
- Actual In time
- Completion status
- Flown on VATSIM, yes or no
- Evidence URL when required by policy

### 13.2 Optional initial fields

- Off time
- On time
- Planned and actual fuel
- Cruise level
- Delay code
- Landing rate
- Remarks

### 13.3 Derived values

```text
Block time = In - Out
Airborne time = On - Off
Fuel used = Departure fuel - Arrival fuel
Departure variance = Actual Out - Scheduled Out
Arrival variance = Actual In - Scheduled In
```

All authoritative timestamps are stored in UTC. The interface may display local airport time alongside UTC.

### 13.4 Validation

- In must be later than Out.
- On must be later than Off when both are supplied.
- Off and On must fall between Out and In.
- Fuel used cannot be negative unless an explanatory correction is recorded.
- The pilot and aircraft must match the assignment.
- Origin and destination default from the assigned flight and cannot be changed silently.
- A diversion requires the actual destination and a remark.
- Duplicate PIREPs for the same assignment are prohibited.

## 14. Livery distribution

### 14.1 Public paths

```text
/downloads/liveries/bcs3/catalog.json
/downloads/liveries/bcs3/n572ad/airdash-bcs3-n572ad-v1.0.0.zip
/downloads/liveries/bcs3/n572ad/manifest.json
/downloads/liveries/bcs3/n572ad/preview.webp
/downloads/liveries/bcs3/n572ad/SHA256SUMS.txt
```

Use the same structure when another aircraft record and its matching livery are created.

### 14.2 Catalog fields

- Fleet number
- Registration
- Aircraft type
- Aircraft status
- Package version
- Simulator
- Add-on name and minimum compatible version
- Download URL
- Manifest URL
- Preview URL
- SHA-256 checksum
- File size
- Publication date

### 14.3 Publication requirements

- Use immutable versioned ZIP names.
- Publish a checksum for every ZIP.
- Keep the old package available when a new version is published unless a legal or security issue requires removal.
- Do not redistribute proprietary aircraft files.
- Mark unsupported packages as withdrawn rather than silently replacing their contents.
- Keep a redirect or compatibility link for the current unversioned livery URL during migration.

## 15. API outline

### 15.1 Authentication

```text
GET  /auth/discord
GET  /auth/discord/callback
POST /auth/logout
GET  /api/v1/me
```

### 15.2 Pilot application and profile

```text
POST /api/v1/applications
GET  /api/v1/applications/me
GET  /api/v1/pilots/me
PATCH /api/v1/pilots/me
GET  /api/v1/pilots/{pilotNumber}
```

### 15.3 Routes, schedules, and flights

```text
GET  /api/v1/routes
GET  /api/v1/schedules
GET  /api/v1/flights
GET  /api/v1/flights/{id}
POST /api/v1/flights/{id}/assignments
POST /api/v1/assignments/{id}/start
DELETE /api/v1/assignments/{id}
```

### 15.4 PIREPs

```text
POST /api/v1/pireps
GET  /api/v1/pireps/me
GET  /api/v1/pireps/{id}
POST /api/v1/admin/pireps/{id}/approve
POST /api/v1/admin/pireps/{id}/return
POST /api/v1/admin/pireps/{id}/reject
```

### 15.5 Fleet and downloads

```text
GET /api/v1/aircraft
GET /api/v1/aircraft/{registration}
GET /api/v1/liveries
GET /downloads/liveries/bcs3/catalog.json
```

### 15.6 Administration

Administrative endpoints require role-based authorization and audit logging. They cover applications, pilots, roles, routes, schedules, flights, aircraft, livery packages, qualifications, occurrences, and configuration.

## 16. VATSIM integration

### 16.1 Identity

Discord remains the primary login. The pilot record stores a VATSIM CID. Initial verification may be manual. A later release should support VATSIM Connect as a secondary linked identity.

### 16.2 Live tracking

The VATSIM Data API provides real-time pilot and flight-plan information. The tracking worker will:

1. Find active airDash assignments.
2. Search the live feed for the expected pilot CID and `AIR` callsign.
3. Require both identity and callsign to match.
4. Archive position samples in airDash storage.
5. Infer probable takeoff and landing events.
6. Record feed gaps and disconnects.
7. Ask the pilot to confirm exact Out and In times.

The public feed does not provide exact parking-brake, fuel, or simulator-state data. Manual confirmation remains authoritative until a dedicated telemetry client exists.

### 16.3 Tracking identifiers

For an active assignment, the tracker uses identifiers such as the following:

```text
Expected VATSIM callsign: AIR plus the assigned flight number
Expected aircraft type: BCS3
Expected pilot: linked VATSIM CID
Expected registration: assigned aircraft, such as N572AD
```

The virtual commercial designator `D1` is not used to match VATSIM flights.

## 17. Security and privacy

### 17.1 Authentication security

- Use Discord authorization code flow.
- Validate OAuth state.
- Keep the Discord client secret server-side.
- Never log access tokens, refresh tokens, authorization codes, session cookies, or secrets.
- Use secure HTTP-only cookies.
- Rotate sessions after login and role changes.
- Rate-limit login callbacks and forms.
- Reauthenticate owner-level operations.

### 17.2 Authorization

- Deny by default.
- Enforce authorization in the API, not only in the interface.
- Keep platform roles authoritative.
- Record all role changes.
- Require a second confirmation for destructive administrative actions.

### 17.3 Privacy

Public by default:

- Pilot number
- Approved display name
- Base
- Join date
- Qualifications
- Aggregate flights and hours

Private by default:

- Discord user ID
- Discord username history
- VATSIM CID
- Email, if ever collected
- Application answers
- Staff notes
- IP and security logs

Allow pilots to disable public profile pages. Public flight boards should show pilot number or approved display name according to the pilot's privacy setting.

### 17.4 Data retention

- Retain approved operational records while the airline operates.
- Retain audit events according to a documented administrative retention period.
- Delete expired OAuth state and session records promptly.
- Remove unnecessary Discord profile snapshots.
- Allow account-deletion requests while preserving de-identified operational records where needed for fleet and airline totals.

## 18. Reliability and operational requirements

- Store all authoritative times in UTC.
- Display local time using the airport's configured time zone.
- Back up the relational database daily.
- Test restoration periodically.
- Use database transactions for PIREP approval and aircraft assignment.
- Use idempotency controls for PIREP submission and approval.
- Return stable error codes suitable for the web interface.
- Add request IDs to logs and audit events.
- Keep downloads available during application maintenance where practical.
- Design pages for desktop and mobile web browsers.

## 19. Notifications

When notifications are implemented, the platform should use in-application notifications by default. Optional Discord notifications may be added through a bot or controlled webhook for:

- Application approved or returned
- Flight booking nearing expiration
- PIREP approved or returned
- Aircraft removed from service
- Schedule or event announcement

Do not automatically send unsolicited direct messages. User-triggered or explicitly opted-in notifications are preferred.

## 20. Incremental implementation

Development proceeds through small implementation increments rather than a fixed phase plan. Each increment must produce a usable result, include its own verification, and avoid adding infrastructure that the increment does not require.

The current increment updates the existing static website and livery distribution. It does not require a database, application API, authentication system, or JavaScript framework.

The current increment is complete when the following conditions are met:

1. The public site identifies AIR as the operational designator and AIR DASH as the voice callsign.
2. The public site identifies D1 as a virtual commercial designator and does not claim an official IATA assignment.
3. The public site no longer presents AIR1227 as a valid airDash flight.
4. The fleet section presents N572AD and N573AD as the two created aircraft.
5. The downloadable liveries visibly use N572AD and N573AD.
6. The livery ZIP uses a versioned filename and has a published SHA-256 checksum.
7. The site remains usable on desktop and mobile browsers.

After this increment is complete, the next increment is selected from an observed need. Candidate increments include Discord login, pilot applications, a route list, flight booking, or manual PIREP submission. Selection of one candidate does not commit airDash to implementing the others immediately.

## 21. Initial seed data

### Airline

```text
Name: airDash
Operational designator: AIR
Virtual commercial designator: D1
Official IATA designator: null
Voice callsign: AIR DASH
Aircraft type: BCS3
```

### Airports

```text
KATL - Hartsfield-Jackson Atlanta International Airport
MDSD - Las Americas International Airport
```

### Aircraft

```text
Fleet 572 - N572AD - BCS3 - PLANNED
Fleet 573 - N573AD - BCS3 - PLANNED
```

## 22. Open decisions

The following decisions should be resolved before implementation:

1. Is membership in a specific Discord server required to apply?
2. Will the existing dashydoggo.com Discord application be reused, or will airDash have a separate Discord application?
3. Will pilot profiles be public by default or opt-in?
4. Will every PIREP require staff approval during initial operation?
5. How long may a pilot hold an aircraft booking before starting the flight?
6. May pilots fly unscheduled charters, or only published flights?
7. Will a submitted but unapproved PIREP temporarily block the aircraft?
8. Will the fleet use kilograms or pounds as its standard fuel unit?
9. Which aircraft beyond N572AD and N573AD should be created or activated later?
10. Will VATSIM Connect become mandatory before public recruitment?

## 23. Reference sources

- IATA Airline and Airport Code Search: https://www.iata.org/en/publications/directories/code-search/
- IATA Codes: https://www.iata.org/en/services/codes/
- Discord OAuth2: https://docs.discord.com/developers/topics/oauth2
- Discord User Resource: https://docs.discord.com/developers/resources/user
- VATSIM API overview: https://vatsim.dev/services/apis
- VATSIM Virtual Airline Partner Policy: https://vatsim.net/docs/policy/virtual-airline-partners/
