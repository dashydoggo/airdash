# Testing

This page describes how the production airDash application and local academy are tested, how to run each check, how to read a failure, and what a contributor must run before proposing a change. It remains honest about coverage: production automated tests cover pure API calculation modules, while route handlers and the production frontend still rely on smoke, type, build, and manual checks. The academy adds automated engine, progress, curriculum, checker, and server-boundary tests; those tests do not increase production route or browser coverage.

## Test strategy

The API separates pure logic from input and output. Modules that compute something from their arguments (`streaks.js`, `flightOutcome.js`, `recoveryMissions.js`, and the parsing and gate functions in `integrations.js`) have no database or network dependency and are covered by assertion scripts that run in well under a second. Modules that talk to the database or to remote services (`server.js`, `database.js`, `notifications.js`, `push.js`, `gates.js`, `aircraftGates.js`) are verified by starting a real API process against a real database and calling routes, which this page calls the smoke test. The frontend is verified by the TypeScript compiler and an isolated production build, plus a visual check in a browser.

The production API calculation tests use `node:assert/strict` as plain scripts. The academy uses Node.js's built-in `node:test` runner with the same zero-dependency approach, which provides discovery, isolated named cases, duration, and aggregate reporting. Neither package has a third-party test framework or a coverage tool, and the repository still has no continuous integration service.

## Test categories

| Category | What it verifies | Where | Command | Duration |
|---|---|---|---|---|
| Syntax check | Every API source file parses | `api/package.json` `check` | `npm --prefix api run check` | 1 s |
| Unit tests | Pure functions produce expected values | `api/scripts/test-streaks.js`, `api/scripts/test-flight-outcomes.js` | `npm --prefix api run test:streaks`, `npm --prefix api run test:flight-outcomes` | under 1 s each |
| Type check | Frontend types are consistent | `web/tsconfig.app.json` | `npm --prefix web run typecheck` | 4 s |
| Isolated build | Frontend compiles and bundles | `web/vite.config.ts` | see [local development](local-development.md#frontend-validation-sequence) | 1 s |
| Smoke test | API starts, migrates, and answers real requests | manual procedure below | manual | 1 to 2 min |
| Visual check | Pages render and behave | browser | manual | varies |
| Academy curriculum validation | IDs, DAG, references, coverage, critical evidence, question quality, exam feasibility, checker mapping, capstone | `academy/validate.mjs` | `npm --prefix academy run validate` | under 1 s |
| Academy automated tests | Grading, sampling, scoring, retention, progress import, gates, fixed checkers, validator failures, server boundaries | `academy/test/*.test.mjs` | `npm --prefix academy test` | about 1 s without frontend build checkers |
| Academy local smoke | Browser shell, all JSON banks, CSP, status API, checker execution, blocked secret/generated paths | `academy/server.mjs` | included in academy server tests; fixed-port curl smoke during release validation | under 1 min |
| Windows parse check and dry run | PowerShell scripts parse and plan correctly | `scripts/*.ps1` | see [powerpoint-automation.md](powerpoint-automation.md#updating-a-script) | 10 s |

## Directory layout and naming

Production API test scripts live in `api/scripts/` and are named `test-<subject>.js`; each is registered as `test:<subject>`, and there is no production `test` script that runs everything. The production frontend has no test directory. Academy tests live in `academy/test/`, use the `*.test.mjs` convention, and run together through `npm --prefix academy test` or by focused engine and server scripts in `academy/package.json`.

## Running the unit tests

From the repository root:

```bash
npm --prefix api run test:streaks
npm --prefix api run test:flight-outcomes
```

Expected output, after the `> airdash-api@0.1.0 test:...` banner lines:

```text
streak calculations verified
```

```text
flight outcomes, SimBrief metadata, landing rates, recovery ferries, and gate assignment verified
```

Each script runs its assertions top to bottom and prints its final line only if every assertion passed. The exit code is `0` on success and `1` on the first failure. Both scripts were run while writing this page and passed.

There is no way to run one assertion in isolation other than editing the script. To focus on one function, copy the relevant assertions into a scratch file and run it with `node`.

### What the streak test asserts

`api/scripts/test-streaks.js` (71 lines) builds fixture flights with a `flight(id, day, origin, destination, hour)` helper and asserts:

- `streakBonusPercent` returns 0 below three days, 5 at three, 10 at four, 15 at five, and stays at 15 (the cap) at twenty.
- `applyStreakBonus` rounds the bonus and sums correctly, including the rounding of 84 at 10 percent to 8 and at 15 percent to 13.
- `computeStreaks` on no flights returns zeros and nulls.
- Three flights on consecutive UTC days with matching origin and destination give a day streak of 3, continuity of 3, and per-report awards.
- Two flights on the same day count as one day but two continuity steps.
- A gap of three days resets the current day streak to 1 while `best` remains 3, and a route that does not continue resets continuity to 1.
- A last flight four days before `now` yields a current day streak of 0 while continuity persists, because continuity has no time limit.

### What the flight outcome test asserts

`api/scripts/test-flight-outcomes.js` (153 lines) covers five modules:

- `extractLandingRate` ignores `rate` fields, zero, and empty strings; rounds root and event `landingRate` values; takes the minimum event rate.
- `selectGate` is deterministic for a seed, avoids occupied gates, returns `null` for a malformed airport code, and overflows to `R<100..999>` remote stands when every gate at KDEN is occupied.
- `generateGates` returns both gates for a recovery seed.
- `analyzeFlightOutcome` classifies an unverified arrival near the destination as `INCOMPLETE` repositioned to the filed alternate with multiplier 0.9 and progress 0.981; an unverified arrival near the origin as `INCOMPLETE` repositioned to the origin; explicit diversion fields with `hasDiverted=false` as `DIVERTED` to the diversion airport; a verified arrival with no diversion evidence as `COMPLETED` with multiplier 1; and a flight still in state `Flying` as not reportable.
- `normalizeDiversionReasonCode` upper-cases valid codes and rejects unknown ones.
- `parseSimBriefXml` extracts airline, flight number, callsign, the `D1` commercial designator, alternate, passengers, and cargo from a fixture OFP.
- `recoveryPayloadIsValid` accepts zero passengers and cargo and rejects nulls.
- `buildRecoveryMission` proposes flight `9015` for source assignment 15, from `KPUB` to `KDEN`, 45 minutes, zero payload, and returns `null` when the aircraft is not at the recovery airport.
- `buildSimBriefDispatchParams` adds `pax=0` and `cargo=0` and the ferry remark for recovery ferries and omits them for standard flights.
- `assignmentExperienceMultiplier` returns 1 for recovery ferries and 1.75 for a 120-minute standard mission.

## Running academy validation and tests

From the repository root:

```bash
npm --prefix academy run validate
npm --prefix academy test
```

The validator prints `airDash Academy curriculum verified` and counts the modules, concepts, questions, critical questions, labs, examinations, capstones, and checker allow-list. The test command currently runs 47 cases across:

- Answer normalization and all five question types.
- Seeded deterministic shuffling and balanced examination sampling.
- Difficulty weighting, skill and module scores, and critical misses.
- The fixed review schedule and high-confidence misconception remediation.
- Progress import schema, timestamp, score, ID, settings, and inspected-evidence validation.
- Complete module prerequisite and gate behavior.
- All fixed static checkers, API syntax, API unit scripts, and blocked dependency behavior.
- Curriculum negative fixtures for duplicate IDs, missing coverage, weak wording, invalid answers, arbitrary checker IDs, and final-exam distribution.
- Loopback server redirect, static assets, all 21 question banks, CSP and security headers, blocked secret and generated paths, Origin enforcement, request-size limit, unknown IDs, and fixed checker execution.

A curriculum validator pass proves internal consistency and inspectable reference existence. It does not prove every explanation is semantically correct; reviewers must compare changed content with implementation evidence.

## Reading a failure

A failing assertion throws `AssertionError`, Node.js prints it, and the script exits with code `1`. The following is the real output produced while writing this page by changing the expectation `streakBonusPercent(3)` from `5` to `6` in a temporary copy of the streak test:

```text
node:internal/modules/run_main:107
    triggerUncaughtException(
    ^

AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

5 !== 6

    at file:///tmp/airdash-docs-test/scripts/test-streaks.js:13:8
    at ModuleJob.run (node:internal/modules/esm/module_job:439:25)
    ...
  generatedMessage: true,
  code: 'ERR_ASSERTION',
  actual: 5,
  expected: 6,
  operator: 'strictEqual',
  diff: 'simple'
}
```

How to read it: `5 !== 6` shows the actual value first and the expected value second. The first `at file://...:13:8` line names the test file, line 13, column 8, which is the failing `assert.equal`. `actual` and `expected` repeat the two values. For `assert.deepEqual` failures the output shows a line-by-line diff of the two objects with `+` for actual and `-` for expected.

Decide which side is wrong. If the code changed deliberately, update the expectation and explain why in the commit message. If the code did not change deliberately, the test has found a regression; fix the code.

## Smoke test

The smoke test starts a second API process on an unused port, against a database of your choice, and calls routes with `curl`. It is the only verification for route handlers, the migration, notifications, and push.

### Preconditions

- A database whose `DATABASE_URL` you are willing to migrate. Locally, the database from [installation](installation.md#install-postgresql). On the production host, the production database, which is why the [warning](#warning-about-the-production-host) below applies.
- Ports 39150 and 39151 free. Check with `ss -ltn | grep -E ':3915[01]'` (Linux), `lsof -i :39150 -i :39151` (macOS), or `Get-NetTCPConnection -LocalPort 39150,39151` (Windows).

### Procedure

Run from `api/`. The `working directory` matters because `dotenv` reads `.env` from it.

Step 1, start the mock authentication service in the background:

```bash
cd api
AUTH_PORT=39151 node --input-type=module -e '
import http from "node:http"
const user = { id: "100000000000000001", username: "localdev", displayName: "Local Dev", avatar: null }
http.createServer((_q, r) => { r.setHeader("content-type","application/json"); r.end(JSON.stringify({ user })) }).listen(Number(process.env.AUTH_PORT), "127.0.0.1")
' > /tmp/airdash-mock-auth.log 2>&1 &
auth_pid=$!
```

Step 2, start the API on the test port with overrides for the auth URL and owner, and with push disabled so the test never contacts a push service:

```bash
PORT=39150 AUTH_URL=http://127.0.0.1:39151/auth/me OWNER_DISCORD_ID=100000000000000001 \
  VAPID_PUBLIC_KEY= VAPID_PRIVATE_KEY= \
  node src/server.js > /tmp/airdash-smoke.log 2>&1 &
smoke_pid=$!
sleep 4
```

To point at a different database than `.env` names, add `DATABASE_URL="postgresql://..."` before `node`.

Step 3, call routes:

```bash
curl -fsS http://127.0.0.1:39150/health
curl -fsS http://127.0.0.1:39150/public | head -c 300; echo
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:39150/me
curl -fsS -H 'Cookie: session=anything' http://127.0.0.1:39150/me | head -c 300; echo
curl -fsS -X POST -H 'Origin: http://localhost:5174' -H 'Cookie: session=anything' -H 'Content-Type: application/json' -d '{"ids":[]}' http://127.0.0.1:39150/notifications/read
```

Expected: `{"ok":true,"database":true}`; the start of the public payload; `401`; the start of the account payload with `"isOwner":true`; and `{"ok":true,"count":0}` on a database with no notifications. Then request the route you changed.

Step 4, read the log and stop both processes:

```bash
grep -vE 'NO_COLOR|trace-warnings' /tmp/airdash-smoke.log
kill "$smoke_pid" "$auth_pid"
cd ..
```

Expected log: `[airdash-push] VAPID keys are not configured; background push is disabled` and `[airdash-api] listening on 0.0.0.0:39150`, with `assigned parking gates` or `repaired gates` lines on a fresh database. Any `error` line or a missing `listening` line is a failure; the log contains the stack trace.

This exact procedure was run while writing this page against a fresh local database and produced the expected results.

### Common smoke test failures

| Symptom | Cause | Action |
|---|---|---|
| `EADDRINUSE` in either log | A previous run is still alive | Find the process with `ss -ltnp`, kill it, rerun. |
| `curl: (7) Failed to connect` | The API had not finished starting, or exited | Increase the sleep; read the log. |
| `Cannot find module '/…/src/server.js'` | Wrong working directory | `cd api` first. Note that `cd api && node … &` runs the `cd` inside the background job only. |
| `401` with a cookie | Mock service not running, or `AUTH_URL` not overridden | Check `/tmp/airdash-mock-auth.log`; confirm the `AUTH_URL=` prefix on the `node` command. |
| Migration error in the log | Your schema change is wrong or conflicts with data | Fix `database.js`; on production, this means the change must not be deployed. |

### Warning about the production host

**Warning:** On `dashydatabase-1`, `api/.env` names the production database. A smoke test process runs `migrate()` against production at startup and shares its data with the live API. Additive `IF NOT EXISTS` statements are applied for real, which is the intended way to validate them, but a constraint or data change is applied for real too. Take the [database backup](backup-and-recovery.md#database-backup) first, send only read requests, and never test `POST /pireps`, `POST /assignments`, or owner mutations against production.

## Frontend verification

The frontend has no unit tests. Its verification is the three-step sequence in [local development](local-development.md#frontend-validation-sequence): `npm --prefix web run typecheck`, the isolated build into a temporary directory, and a marker check that the built bundle contains your change. TypeScript catches missing imports, wrong prop types, and fields the API type does not declare; the build catches everything Vite refuses to bundle; the marker check catches editing the wrong file. Visual behavior is checked in a browser against the Vite development server or against production after deployment.

## From production behavior to its test: the streak bonus

This example shows how one production behavior maps to the code and the assertions that verify it, so that you can follow the same path for another behavior.

Behavior: a pilot who flies on three consecutive UTC days receives a 5 percent experience bonus on the third day's report; the bonus rises 5 points per day and stops at 15 percent.

1. Where it is applied. `applyPirepReview` in `api/src/server.js` computes `baseExperience`, calls `calculatePilotStreaks(client, discordId)` to obtain `awards[reportId].flightDays`, and passes that to `applyStreakBonus(baseExperience, flightDays)`. The returned `totalExperience` is written to `pireps.credited_minutes` and added to `pilots.experience`.
2. Where it is computed. `api/src/streaks.js`: `streakBonusPercent(dayStreak)` returns `0` below 3, else `min(15, (dayStreak - 2) * 5)`. `computeStreaks(rows, now)` derives `flightDays` per report from consecutive distinct UTC days.
3. Where it is asserted. `api/scripts/test-streaks.js` lines 11 to 21 assert the percent table and the rounding of `applyStreakBonus`; the `chain` case asserts that three consecutive days yield `awards["3"].flightDays === 3` and `bonusPercent === 5`.
4. What is not asserted. The integration in `applyPirepReview` (that the bonus actually reaches the database) is verified only by the smoke test or by approving a report on a local database and reading `pireps.streak_bonus_percent`.

To verify a change to the threshold, edit `streakBonusPercent`, update the assertions, run `npm --prefix api run test:streaks`, then approve a report locally and inspect the row.

## Adding a test

For a new pure function in an existing module, add assertions to the matching script. Import the function at the top, add `assert.equal` or `assert.deepEqual` lines in the section for that module, and keep the final `console.log` as the last line. Run the script.

For a new module, create `api/scripts/test-<subject>.js` following the existing shape:

```js
import assert from "node:assert/strict"
import { yourFunction } from "../src/yourModule.js"

assert.equal(yourFunction("input"), "expected")

console.log("your subject verified")
```

Register it in `api/package.json`:

```json
"test:your-subject": "node scripts/test-your-subject.js"
```

Then add it to the [quick start](../README.md#quick-start), to this page, and to [contributing](contributing.md#validation-checklist).

Guidelines: pass `now` or other time values explicitly so the test is deterministic; build fixtures with small helper functions as `test-streaks.js` does; assert exact values rather than ranges; give each assertion a distinct expected value so a failure line is unambiguous.

## Expectations for new code

- A change to a pure module must update or add assertions in its test script.
- A change to a route must be exercised by the smoke test, and the request and response must be pasted into the pull request.
- A migration must be smoke-tested against a fresh local database (idempotency: start twice) and, on the production host, backed up first.
- A frontend change must pass the type check, the isolated build, and the marker check.
- Do not commit a failing test with a plan to fix it later.

## Continuous integration

There is none. GitHub Actions is not configured, and the repository has no `.github/` directory. Every check on this page is run by the contributor locally, and the pull request description records the results. Adding CI would be a reasonable improvement; it is recorded in [known limitations](known-limitations.md).

## Flaky tests

Both unit test scripts are deterministic: they pass fixed `now` values and fixed fixtures, and they touch neither the network nor the filesystem. There are no known flaky tests. If a test passes and fails without a code change, treat that as a bug in the test and fix its determinism rather than rerunning it.
