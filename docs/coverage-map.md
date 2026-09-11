# Documentation coverage map

This map connects every project concept to its implementation evidence and its documentation, so that a maintainer can see what a change affects and where the documentation and academy assessments must follow. Each row names the concept, its responsibility, source, configuration, tests, documentation, validation, and coverage status. The technical-reference baseline describes source commit `5f2e27c`; the interactive academy was added from merged documentation commit `291860f`. The [maintenance triggers](README.md#maintenance-triggers) apply to both.

Status values: **Documented** means the page describes the concept at the depth the [index](README.md) promises and the validation method was performed; **Documented, not executed** means the procedure is written from source and configuration but was not run, with the reason in the validation record.

## Runtime components

| Concept | Responsibility | Source | Configuration | Tests | Documentation | Validation | Status |
|---|---|---|---|---|---|---|---|
| Express API process | All business rules | `api/src/server.js` | `api/.env`, `api/ecosystem.config.js` | `check`, smoke test | [architecture](architecture.md#backend-architecture), [api-reference](api-reference.md) | Started locally against a fresh database; routes exercised | Documented |
| Global middleware | Body parsing, security headers, origin check | `server.js` top, `auth.js` `requireAirDashOrigin` | none | smoke test | [architecture](architecture.md#middleware-order), [security](security.md#cross-site-request-forgery) | `curl` against production: 403 without origin; headers observed | Documented |
| Authentication delegation | Cookie to user | `auth.js` `authenticatedUser`, `requireUser`, `requireOwner` | `AUTH_URL`, `OWNER_DISCORD_ID` | smoke test with mock | [security](security.md#authentication-flow), [foundations](foundations.md#asynchronous-behavior-promises-and-asyncawait) | 401 without cookie, account with cookie, `isOwner` true with matching ID | Documented |
| Connection pool and migration | Schema, seeds, audit insert | `database.js` `pool`, `migrate`, `audit`, `publishOrgUpdate` | `DATABASE_URL` | `npm run migrate` twice | [data-model](data-model.md#migration-behavior) | Fresh database: 15 tables, 102 routes, 21 aircraft, 4 bases; second run idempotent | Documented |
| Assignment expiry job | Expire deadlines, release holds | `server.js` `expireAssignments` | interval constant | none | [architecture](architecture.md#background-work), [operations](operations.md#background-jobs) | Code reading; verification queries written | Documented |
| Schedule job | Deterministic departures | `server.js` `ensureSchedule`, `scheduleHash` | interval constant | none | same | Code reading | Documented |
| Push worker | Deliver pending notifications | `push.js` `startPushWorker`, `deliver` | `VAPID_*` | none | [architecture](architecture.md#background-work), [configuration](configuration.md#vapid_public_key-and-vapid_private_key) | Disabled-mode log line and 503 observed locally | Documented |
| Startup and shutdown | Order of operations, signals | `server.js` bottom | none | smoke test | [architecture](architecture.md#startup-sequence) | Startup log lines observed; shutdown by SIGINT observed | Documented |
| Static frontend serving | Cache headers, SPA fallback | `nginx.conf` | bind mounts | none | [configuration](configuration.md#nginxconf), [deployment](deployment.md#deploy-an-nginx-configuration-change) | `docker inspect` of mounts; production 200 | Documented |
| Edge routing and TLS | Path routing, prefix strip | Caddyfile (outside repo) | `/opt/dashy-database/configs/Caddyfile` | none | [configuration](configuration.md#caddyfile), [architecture](architecture.md#production-runtime-topology) | Caddyfile read; production headers show `via: 1.1 Caddy` | Documented |
| Process supervision | Restart and boot | PM2, `pm2-dashy.service` | `ecosystem.config.js` | none | [operations](operations.md#runtime-components), [backup-and-recovery](backup-and-recovery.md#recover-the-pm2-process) | `pm2 jlist`, `systemctl is-active` | Documented; recovery not executed |
| React application shell | Context, layout, routing | `web/src/App.tsx` `App`, `Layout`, `AppContext` | none | typecheck, isolated build | [architecture](architecture.md#frontend-architecture) | Typecheck and isolated build run; hashes matched production at the time of the check | Documented |
| Academy browser and evidence engine | Dashboard, study, five answer types, scoring, confidence, review scheduling, gates, progress, exams, capstone | `academy/app.mjs`, `academy/engine.mjs` | browser `localStorage` only | engine and progress tests | [academy guide](../academy/README.md), [mastery model](../academy/MASTERY_MODEL.md) | Syntax checked; engine and complete curriculum exercised by Node tests | Documented |
| Academy local server and checker boundary | Serve safe repository paths on loopback and execute named no-shell checks | `academy/server.mjs`, `academy/checks.mjs` | fixed host `127.0.0.1`, optional port | server and checker tests | [academy practical checks](../academy/README.md#practical-checks) | Static/API smoke, blocked paths, CSP, Origin, body, unknown checker, and fixed checker execution tested | Documented |
| Academy curriculum data | 21 modules, 105 concepts, 252 questions, 24 labs, 6 exams, 100-point capstone | `academy/data/` | curriculum version `2026.09.1` | validator tests | [academy schema](../academy/SCHEMA.md) | Complete schema, link, source, quality, coverage, critical-evidence, and exam feasibility validation | Documented |
| API client | Fetch wrapper | `web/src/api.ts` | none | typecheck | [foundations](foundations.md#typescript-types-interfaces-and-generics) | Line-by-line walkthrough against source | Documented |
| Service worker and push client | Subscribe, display, click | `web/public/airdash-sw.js`, `web/src/webPush.ts` | `VAPID_*` | none | [architecture](architecture.md#service-worker-and-push), [features](features.md#notifications) | Code reading | Documented |
| Windows automation | Video export and launcher | `scripts/*.ps1`, `.vbs` | script parameters | parse check, dry run | [powerpoint-automation](powerpoint-automation.md) | Not executable from the host | Documented, not executed |
| Livery and GSX builders | Simulator packages | `scripts/build-msfs2020-liveries.py`, `gsx/*/build.py` | arguments | none | [repository-guide](repository-guide.md#scripts) | Argument parsing read from source; Pillow version confirmed in host venv | Documented, not executed |

## Executable commands

| Command | Purpose | Defined in | Documentation | Validation | Status |
|---|---|---|---|---|---|
| `npm --prefix api ci`, `npm --prefix web ci --include=dev` | Install | lock files | [installation](installation.md#install-dependencies) | Present `node_modules` verified; package counts read from lock files | Documented |
| `npm --prefix academy run validate` | Validate curriculum schema, references, source evidence, coverage, critical evidence, exams, labs, capstone, and question quality | `academy/validate.mjs` | [academy schema](../academy/SCHEMA.md#coverage-invariants) | Run against complete data and negative regression fixtures | Documented |
| `npm --prefix academy test` | Run engine, progress, checker, validator, and server tests | `academy/test/` | [academy guide](../academy/README.md#maintainer-commands) | 47 tests pass | Documented |
| `npm --prefix academy start` | Start local academy on `127.0.0.1:4174` | `academy/server.mjs` | [academy guide](../academy/README.md#start-the-academy) | Started on an ephemeral loopback port in server tests; fixed-port smoke performed during final validation | Documented |
| `npm --prefix api run check` | Syntax check | `api/package.json` | [testing](testing.md) | Run, passed | Documented |
| `npm --prefix api run test:streaks` | Unit tests | `api/package.json` | [testing](testing.md#what-the-streak-test-asserts) | Run, passed; failure output captured | Documented |
| `npm --prefix api run test:flight-outcomes` | Unit tests | `api/package.json` | [testing](testing.md#what-the-flight-outcome-test-asserts) | Run, passed | Documented |
| `npm --prefix api run migrate` | Schema | `api/package.json` | [installation](installation.md#create-the-schema) | Run against fresh database | Documented |
| `npm --prefix api start` | Run API | `api/package.json` | [local-development](local-development.md#start-the-api) | Run on port 39150 | Documented |
| `npm --prefix web run typecheck` | Type check | `web/package.json` | [local-development](local-development.md#frontend-validation-sequence) | Run, passed | Documented |
| `npm --prefix web run dev` | Dev server | `web/package.json` | [local-development](local-development.md#start-the-vite-development-server) | Run; proxy defect found and recorded | Documented |
| `npm --prefix web run build` | Production build | `web/package.json` | [deployment](deployment.md#deploy-a-frontend-only-change) | Not run (writes to live `site/`); isolated build run instead | Documented, not executed |
| Isolated build | Validation build | documentation | [local-development](local-development.md#frontend-validation-sequence) | Run; output listed | Documented |
| `npm --prefix web run preview` | Serve build | `web/package.json` | [local-development](local-development.md#command-reference) | Not run | Documented, not executed |
| Smoke test | Route verification | documentation | [testing](testing.md#smoke-test) | Run with mock auth | Documented |
| Release backup script | Rollback point | documentation | [backup-and-recovery](backup-and-recovery.md#release-backup) | Reviewed against live `index.html`; not run | Documented, not executed |
| `pg_dump`, `pg_restore` | Database backup and restore | documentation | [backup-and-recovery](backup-and-recovery.md#database-backup) | Run against scratch database | Documented |
| `pm2 restart airdash-api` | Deploy API | documentation | [deployment](deployment.md#deploy-an-api-only-change) | Not run (production) | Documented, not executed |
| `docker run ... dashy-airdash` | Recreate static container | documentation | [backup-and-recovery](backup-and-recovery.md#recover-the-static-site-container) | Settings confirmed with `docker inspect`; not run | Documented, not executed |
| `python3 build-msfs2020-liveries.py` | Build MSFS 2020 packages | `scripts/` | [repository-guide](repository-guide.md#scripts) | Not run | Documented, not executed |

## Environment variables

| Variable | Read by | Default | Documentation | Validation | Status |
|---|---|---|---|---|---|
| `DATABASE_URL` | `database.js` | none | [configuration](configuration.md#database_url) | Used for scratch database | Documented |
| `AUTH_URL` | `auth.js` | `http://127.0.0.1:3002/auth/me` | [configuration](configuration.md#auth_url) | Overridden to mock; behavior observed | Documented |
| `OWNER_DISCORD_ID` | `auth.js` | production owner | [configuration](configuration.md#owner_discord_id) | Overridden; `isOwner` observed | Documented |
| `PORT` | `server.js` | `3006` | [configuration](configuration.md#port) | Overridden to 39150; invalid value error reproduced | Documented |
| `PROFILE_IMAGE_DIR` | `server.js` | `../site/downloads/profiles` | [configuration](configuration.md#profile_image_dir) | Code reading | Documented |
| `SIMBRIEF_AIRFRAME` | `server.js` | `BCS3` | [configuration](configuration.md#simbrief_airframe) | Code reading | Documented |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `push.js` | empty | [configuration](configuration.md#vapid_public_key-and-vapid_private_key) | Empty: disabled log and 503 observed; placeholder: error reproduced | Documented |
| `VAPID_SUBJECT` | `push.js` | `https://air.dashydoggo.com` | [configuration](configuration.md#vapid_subject) | Code reading | Documented |
| `NODE_ENV` | nobody | set by PM2 | [configuration](configuration.md#node_env) | Grep of source | Documented |

## Database-backed settings

| Setting | Read by | Documentation | Validation | Status |
|---|---|---|---|---|
| `operations.autoApprovePireps` | `POST /pireps` | [configuration](configuration.md#database-backed-settings), [api-reference](api-reference.md#post-adminsettings) | Seed row observed in fresh database | Documented |

## Public interfaces

| Group | Routes | Handlers | Tests | Documentation | Validation | Status |
|---|---|---|---|---|---|---|
| Public read | 9 | `server.js` | none | [api-reference](api-reference.md#public-routes) | `/health`, `/public`, `/live`, `/news` called on production or locally | Documented |
| Account and profile | `/me`, `/profile`, `/profile/image`, `/profile/liveries/reset`, authenticated downloads | `server.js` | none | [api-reference](api-reference.md#authenticated-routes) | `/me` exercised with mock | Documented |
| Directory and applications | `/pilots`, `/pilots/:id`, `/applications`, `/org-updates` | `server.js` | none | same | `/applications` validation error exercised | Documented |
| Booking and dispatch | `/flights`, `/assignments*`, `/missions*`, `/volanta/import` | `server.js`, `integrations.js`, `recoveryMissions.js`, `aircraftGates.js` | `test-flight-outcomes.js` (pure parts) | same, [repository-guide](repository-guide.md#traced-execution-path-booking-a-flight) | Tests run; handlers read line by line | Documented |
| Reports | `/pireps`, `/admin/pireps/:id/:decision` | `server.js` `applyPirepReview`, `flightOutcome.js`, `streaks.js` | both test scripts | same | Tests run | Documented |
| Notifications and push | `/notifications*`, `/push/*` | `notifications.js`, `push.js` | none | same, [features](features.md#notifications) | `/notifications/read` and `/push/public-key` exercised | Documented |
| Owner administration | 13 `/admin/*` | `server.js` | none | [api-reference](api-reference.md#owner-routes) | Handlers read; not exercised against data | Documented |
| Frontend routes | 16 paths | `App.tsx` | typecheck | [architecture](architecture.md#routing), [features](features.md) | Route table read from source | Documented |
| Local academy interface | `/academy/*`, `GET /api/academy/status`, `GET /api/academy/checkers`, `POST /api/academy/checks/:id` | `academy/server.mjs`, fixed registry in `academy/checks.mjs` | server tests | [academy guide](../academy/README.md) | Static data, safe source, blocked secret/generated paths, API methods, Origin, body limit, and checker execution tested | Documented |

## Persistent entities

| Table | Documentation | Validation | Status |
|---|---|---|---|
| `users`, `applications`, `pilots`, `bases`, `aircraft`, `routes`, `schedule`, `assignments`, `pireps`, `livery_downloads`, `org_updates`, `audit_events`, `settings`, `notification_history`, `push_subscriptions` | [data-model](data-model.md#tables) | Columns, constraints, and indexes extracted from `information_schema` and `pg_constraint` of a database created by `migrate()`; production table list matches | Documented |
| `pilot_number_seq` | [data-model](data-model.md#sequence-pilot_number_seq) | Present in fresh database | Documented |

## External integrations

| Integration | Source | Documentation | Validation | Status |
|---|---|---|---|---|
| dashydoggo.com auth service | `auth.js` | [security](security.md#authentication-flow) | Listener on 3002 confirmed; `/auth/me` source read in the Discord bot project | Documented |
| SimBrief | `integrations.js` | [api-reference](api-reference.md), [architecture](architecture.md#external-integrations) | Parser tested by `test-flight-outcomes.js`; network not exercised | Documented |
| Volanta | `integrations.js`, `flightOutcome.js` | same | Analysis tested; network not exercised | Documented |
| Browser push services | `push.js`, `airdash-sw.js` | same | Not exercised (no VAPID locally) | Documented |
| VATSIM pre-file | `flightPlan.ts` | [features](features.md#hangar-portal) | Code reading | Documented |
| CARTO, RainViewer, Google Fonts | `App.tsx`, `AdvancedNetworkMap.tsx`, `index.html` | [architecture](architecture.md#external-integrations), [known-limitations](known-limitations.md) | Code reading | Documented |
| PowerPoint COM | `scripts/` | [powerpoint-automation](powerpoint-automation.md) | Not executable from the host | Documented, not executed |

## Deployment mechanisms

| Mechanism | Documentation | Validation | Status |
|---|---|---|---|
| Frontend build into bind-mounted `site/` | [deployment](deployment.md#deploy-a-frontend-only-change) | Isolated build produced identical hashes to the live site at the time of the check; production was rebuilt from uncommitted changes later the same evening | Documented |
| PM2 restart | [deployment](deployment.md#deploy-an-api-only-change) | PM2 state read; not restarted | Documented, not executed |
| Migration at startup | [deployment](deployment.md#deploy-a-migration) | Fresh-database run | Documented |
| Static file placement | [deployment](deployment.md#deploy-a-static-file-change) | Not run | Documented, not executed |
| Nginx reload | [deployment](deployment.md#deploy-an-nginx-configuration-change) | Not run | Documented, not executed |
| Caddy reload | [deployment](deployment.md#deploy-a-caddy-configuration-change) | Not run (shared) | Documented, not executed |
| Rollback | [deployment](deployment.md#roll-back-the-frontend) | Not run | Documented, not executed |

## Test categories

| Category | Documentation | Validation | Status |
|---|---|---|---|
| Syntax check | [testing](testing.md#test-categories) | Run | Documented |
| Unit tests | [testing](testing.md#running-the-unit-tests) | Run; failure format captured | Documented |
| Type check and isolated build | [local-development](local-development.md#frontend-validation-sequence) | Run | Documented |
| Smoke test | [testing](testing.md#smoke-test) | Run | Documented |
| Guided exercise | [contributing](contributing.md#guided-contribution-exercise) | Implementation fragment applied in an isolated worktree; expanded academy-maintenance variant validated during academy delivery | Documented |
| Academy engine and progress | [mastery model](../academy/MASTERY_MODEL.md), `academy/test/engine.test.mjs`, `progress.test.mjs` | Five question types, seeded sampling, weighted scores, review stages, misconceptions, import validation, and module gates tested | Documented |
| Academy curriculum and question quality | [academy schema](../academy/SCHEMA.md), `validator.test.mjs` | Complete data passes; broken IDs, coverage, wording, answer, checker, and exam fixtures fail | Documented |
| Academy server and checker security | [academy practical checks](../academy/README.md#practical-checks), `server.test.mjs`, `checks.test.mjs` | Loopback server, CSP, static allow-list, secret/path blocking, Origin, body limits, no-shell registry, and fixed commands tested | Documented |
| Windows parse check and dry run | [powerpoint-automation](powerpoint-automation.md#updating-a-script) | Not run | Documented, not executed |

## Foundational concepts

| Concept area | Documentation | Anchored in | Status |
|---|---|---|---|
| Files, paths, permissions, processes, ports, environment variables, shells | [foundations](foundations.md#computer-and-operating-system-foundations) | `vite.config.ts`, `ecosystem.config.js`, `postbuild`, `server.js` shutdown | Documented |
| Git and GitHub | [foundations](foundations.md#source-control-foundations), [contributing](contributing.md) | Repository branches and remote | Documented |
| JavaScript and TypeScript | [foundations](foundations.md#language-and-runtime-foundations) | `auth.js`, `api.ts`, `streaks.js`, `main.tsx` | Documented |
| Dependencies | [foundations](foundations.md#dependency-foundations) | both `package.json` and lock files | Documented |
| HTTP and APIs | [foundations](foundations.md#web-and-api-foundations) | request lifecycle of `/me` | Documented |
| Databases | [foundations](foundations.md#database-foundations) | `bases` table, partial unique indexes | Documented |
| Testing | [foundations](foundations.md#testing-foundations) | `test-streaks.js` | Documented |
| Build and deployment | [foundations](foundations.md#build-and-deployment-foundations) | `site/`, containers, PM2 | Documented |

## Validation record

Performed on September 10 and 11, 2026 on the production host, isolated worktrees, a scratch PostgreSQL 16 container, temporary API processes, and the local academy server:

- Repository inspection of the 143 files tracked at merged documentation commit `291860f`; the academy adds 43 first-class files. Route and table counts were computed from source and confirmed against production.
- Academy curriculum validation: 21 modules, 105 concepts, 28 critical concepts, 252 questions, 53 critical questions, 24 labs, 6 cumulative examinations, one capstone, and all 18 checker allow-list entries covered.
- Academy tests: 47 engine, progress, checker, validator, and server tests pass; negative fixtures prove malformed progress and curriculum, unknown checker IDs, prohibited paths, invalid Origin, oversized bodies, weak question wording, and missing evidence are rejected.
- Academy browser and server smoke: application shell, all core and question-bank JSON, status API, fixed checker execution, progress schema, security headers, and blocked `.env`, `.git`, `node_modules`, and `site` paths verified.
- Host state: `docker ps`, `docker inspect dashy-airdash`, `pm2 jlist`, `systemctl`, `ss -ltnp`, Caddyfile, production health and headers.
- `npm run check`, both test scripts, `npm run typecheck`, isolated Vite build (hashes matched production at the time), `npm audit` for both directories, `npm ci` from a clean directory for both manifests.
- Fresh database migration (twice), API startup with mock authentication, public and authenticated route calls, origin rejection, push-disabled behavior, invalid `PORT` and placeholder VAPID errors, database stop crash behavior, `pg_dump`, `pg_restore --list`, `pg_restore` into the scratch database.
- Vite development server startup, IPv6 binding, proxy 404 defect, and the `rewrite` fix (then reverted).
- Guided exercise applied in an isolated worktree of `HEAD` and validated.
- A deliberate assertion failure captured for the testing page.
- All 631 internal Markdown links and heading anchors resolve; repository paths and academy source symbols exist. Thirty non-placeholder external documentation, integration, GitHub, installation, and production URLs were requested without transmitting project content; they responded below 500, including the expected unauthenticated 401 for `/api/me` and method-specific 404s for GET requests to logout or historical paths.
- Pinned markdownlint 0.45.0 reports no issue in changed or academy Markdown; all 9 Mermaid diagrams parse with Mermaid 11.12.0.

Not performed, with reasons:

- Production deployment, PM2 restart, Nginx reload, Caddy reload, database restore into production, and PM2 recovery: each interrupts service or changes production and was not necessary to write the documentation. Commands were taken from the previous operations guide, which recorded them as used, and checked against current container and process configuration.
- macOS and Windows installation commands: no such machine was available. Commands follow each tool's official installer documentation.
- Windows PowerShell automation: requires an interactive Windows desktop session.
- Livery and GSX package builds: require private source archives.
- Web Push delivery: requires VAPID keys and a subscribing browser; the disabled path was verified.
- Owner mutation routes against data: no owner session locally beyond the mock; handlers were read line by line instead.
