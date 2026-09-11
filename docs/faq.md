# Frequently asked questions

Short answers to recurring questions, each linking to the page that explains the subject fully. If an answer here disagrees with the linked page, the linked page is correct and this page should be fixed.

## Getting oriented

**Where do I start?** Complete beginners start with the [interactive airDash Academy](../academy/README.md) and use the [learning path](learning-path.md) for longer exercises. Other audiences use the [start-here guide](start-here.md).

**What does airDash actually do?** It is the website, rules engine, and data store for one virtual airline. Pilots book routes, fly them in Microsoft Flight Simulator with Volanta tracking, and file verified reports; the owner reviews and manages. See [project overview](project-overview.md).

**Which pages are authoritative?** [Architecture](architecture.md), [API reference](api-reference.md), [data model](data-model.md), and [configuration](configuration.md). Other pages link to them rather than restating them.

**Is this documentation accredited?** No. It follows the structure of a software engineering curriculum, but no accrediting body has reviewed it.

**Is there an interactive curriculum with quizzes and practical work?** Yes. [airDash Academy](../academy/README.md) provides 21 prerequisite modules, 105 concepts, 252 authored questions, 24 labs, 6 cumulative examinations, adaptive review, confidence calibration, persistent progress, and a 100-point capstone. Run `npm --prefix academy start` and open `http://127.0.0.1:4174/academy/`.

**What does an academy mastery label prove?** Only the evidence defined in the [mastery model](../academy/MASTERY_MODEL.md): recorded retrieval, application, practical, examination, delayed-review, and human-reviewed capstone results under academy conditions. It does not prove authorship, accreditation, employment readiness, or error-free performance in every real environment.

**Why can I not finish retained mastery today?** Durable evidence requires successful delayed reviews at 1, 3, 7, 14, and 30 days. Compressing those intervals would measure short-term repetition rather than retention.

**Where is my progress stored?** In this browser's `localStorage` under `airdash-academy-progress-v1`. It is never sent to the server. Use Settings to export a JSON backup before clearing browser data or moving computers; imports reject unknown IDs, malformed scores, and future timestamps.

## Installing and running

**Which Node.js version do I need?** 24.x is verified. The frontend toolchain requires at least 20.19 or 22.12. See [installation](installation.md#required-software).

**Do I need PostgreSQL to run the tests?** No. The quick-start validation (syntax check, two test scripts, type check) needs no database. Running the API does. See [installation](installation.md#run-the-quick-start-validation).

**Do I need Docker?** Only if you choose it for local PostgreSQL. Production uses Docker for PostgreSQL, Nginx, and Caddy; the API itself runs directly under PM2.

**How do I sign in locally without Discord?** Run the mock authentication service and set any cookie in the browser. See [local development](local-development.md#mock-authentication-service).

**The Vite dev server shows no data and the network tab is full of 404s.** The committed proxy configuration does not remove the `/api` prefix. Apply the documented local workaround. See [local development](local-development.md#the-proxy-does-not-remove-the-api-prefix) and [known limitations](known-limitations.md#vite-development-proxy-does-not-strip-the-api-prefix).

**`localhost:5174` works but `127.0.0.1:5174` refuses the connection.** Vite bound to IPv6. Use `localhost`. See [debugging](debugging.md#development-server-not-reachable).

**Why does the API log `VAPID keys are not configured`?** The `VAPID_*` variables are empty, so Web Push is disabled. Everything else works. See [configuration](configuration.md#vapid_public_key-and-vapid_private_key).

## Making changes

**I changed a file under `site/` and the change disappeared.** `site/` is build output. Edit `web/src/` and rebuild. See [repository guide](repository-guide.md#site-untracked).

**I changed `api/src/server.js` and nothing happened.** The running process holds the old code. Locally, restart `node src/server.js`; in production, `pm2 restart airdash-api` after validation and a backup. See [deployment](deployment.md#deploy-an-api-only-change).

**How do I add an environment variable?** Read it with `process.env.NAME ?? default`, add it to `api/.env.example`, document it in [configuration](configuration.md), and add a row to the [coverage map](coverage-map.md).

**How do I add a route?** Follow [change recipes](change-recipes.md#add-a-new-api-endpoint), then update the [API reference](api-reference.md) and the route count in [architecture](architecture.md).

**How do I add a database column?** Append an `ADD COLUMN IF NOT EXISTS` statement in `database.js`, back up, smoke test, and update the [data model](data-model.md). See [change recipes](change-recipes.md#add-a-database-column).

**Where is the test for X?** Pure calculation modules have assertions in `api/scripts/test-*.js`. Routes have none; use the smoke test. See [testing](testing.md).

**Why are there no CI checks on my pull request?** The repository has no CI. Run the validation checklist locally and paste the results. See [contributing](contributing.md#validation-checklist).

## Understanding behavior

**Why does the display say FLYING but the database says ACTIVE?** The frontend relabels `ACTIVE`. Code and requests must use `ACTIVE`. See [project overview](project-overview.md#naming-notes).

**Why is the flight number `AIR101` in one place and `D1101` in another?** `AIR` is the display and callsign prefix; `D1` is the commercial designator on SimBrief paperwork. Both are the integer `101` in the database. See [glossary](glossary.md).

**Why did my booking expire?** The filing deadline is block minutes plus 150 minutes from booking or start. The expiry job runs every five minutes. See [features](features.md#hangar-portal).

**Why was my report marked DIVERTED or INCOMPLETE?** The outcome is derived from the Volanta record: verified arrival and diversion evidence decide it. See [features](features.md#pilot-report-report).

**Why is my landing rate blank?** Volanta reported none or zero; zero is stored as `NULL` so averages stay honest. See [data model](data-model.md#pireps).

**Why did the same notification appear twice?** The underlying record changed, producing a new event key. This is by design. See [features](features.md#notifications).

**Why does `GET /assignments/:id/gates` not avoid occupied gates?** It regenerates both gates from a time-based seed without consulting occupancy; the single-gate reassignment routes do consult it. This inconsistency is recorded in [known limitations](known-limitations.md).

**Can a pilot resubmit a returned report?** No. `pireps.assignment_id` is unique and the assignment stays `PIREP_SUBMITTED`. The owner approves, rejects, or deletes the assignment. See [data model](data-model.md#assignments).

## Operating

**Is the site up?** `curl -fsS https://air.dashydoggo.com/api/health` should return `{"ok":true,"database":true}`. See [operations](operations.md#health-checks).

**PM2 says the API is errored after the database restarted.** A database restart crashes the API process, and repeated fast failures exhaust PM2's restart limit. Start the database, then `pm2 restart airdash-api`. See [debugging](debugging.md#database-unavailable).

**How do I back up before a change?** Release backup for code, database backup for data. See [backup and recovery](backup-and-recovery.md).

**Can I roll back a migration?** Not automatically. Source rollback leaves schema changes in place; plan a reverse statement from the database backup. See [deployment](deployment.md#roll-back-the-api).

**Is there monitoring?** No. The health endpoint is the only signal and nobody polls it automatically. See [operations](operations.md#metrics-traces-and-alerts).

**Who can I ask?** The owner, through the dashydoggo.com Discord server. For security problems, do not open a public issue. See [security](security.md#vulnerability-reporting).
