# airDash platform

airDash is a privately operated virtual airline for Microsoft Flight Simulator, published at `https://air.dashydoggo.com`. The platform combines a public website, an authenticated pilot portal, an owner administration interface, a Node.js API, a PostgreSQL schema, downloadable simulator packages, and Windows automation that renders a PowerPoint video for the simulator start screen.

A virtual airline is a hobby organization whose members fly simulated airline routes and record the results. airDash exists so that its pilots can book a flight from a published route network, fly it in the simulator with a matching aircraft livery, submit a verified report, and accumulate hours, experience, and streaks that the whole airline can see.

## Capabilities

- Public pages for the airline identity, News Hub, fleet and liveries, schedule, network map, and network health.
- Pilot application and review workflow tied to an existing Discord login.
- Flight booking from a flight board or from generated missions, with gate assignment and a filing deadline, plus a deterministic public timetable.
- SimBrief dispatch generation and import, Volanta flight verification, and VATSIM pre-file links.
- Pilot report review with automatic outcome detection for completed, diverted, and incomplete flights.
- Experience, levels, flight-day streaks, route continuity, and aircraft maintenance state.
- In-app and Web Push notifications backed by a server-side notification history.
- Owner administration for applications, reports, pilots, bases, aircraft, settings, and an append-only audit log.
- MSFS 2020 and MSFS 2024 livery packages and a GSX ground handling package.

## Audience

The documentation is written for four readers at once: a complete beginner who has not yet used a shell, Git, or a database; a new contributor who needs a reliable path from clone to pull request; an experienced developer who needs searchable reference material; and the operator who runs production. Start with the [documentation index](docs/README.md) and then the [start-here guide](docs/start-here.md), which gives a reading order for each reader.

## Project status

The platform is in production for a single airline with one operator. It has no staging environment, no continuous integration service, and no automated end-to-end tests. The API is a single Node.js process, and the frontend is a single-page application built with Vite. The [known limitations](docs/known-limitations.md) page lists every constraint that changes how you should work.

## Prerequisites

| Tool | Verified version | Minimum | Purpose |
|---|---|---|---|
| Node.js | 24.16.0 | 22.12.0, or 20.19.0 | Runs the API, the tests, and the frontend build. |
| npm | 11.13.0 | Bundled with Node.js | Installs dependencies from the lock files and runs scripts. |
| Git | 2.52.0 | Any 2.x | Obtains the source and submits changes. |
| PostgreSQL | 16.14 | 16 | Stores all operational data. Only required to run the API locally. |

Docker, PM2, Caddy, Nginx, and Python are used in production or for optional tooling and are documented in [installation](docs/installation.md).

## Quick start

The shortest verified path from a clone to a passing validation run does not require a database. It confirms that the toolchain works before you set up PostgreSQL.

```bash
git clone git@github.com:dashydoggo/airdash.git
cd airdash
npm --prefix api ci
npm --prefix web ci
npm --prefix api run check
npm --prefix api run test:streaks
npm --prefix api run test:flight-outcomes
npm --prefix web run typecheck
```

Expected results: `npm ci` prints an `added N packages` summary for each directory, `check` prints nothing after the script banner, the two tests print `streak calculations verified` and `flight outcomes, SimBrief metadata, landing rates, recovery ferries, and gate assignment verified`, and `typecheck` prints nothing after the script banner. Any line containing `error` is a failure.

To run the application locally, continue with [installation](docs/installation.md) and then [local development](docs/local-development.md), which explain PostgreSQL setup, the `api/.env` file, the mock authentication service, and the Vite development server.

## Documentation

| Subject | Page |
|---|---|
| Index and maintenance triggers | [docs/README.md](docs/README.md) |
| Reading paths by audience | [docs/start-here.md](docs/start-here.md) |
| Beginner curriculum | [docs/learning-path.md](docs/learning-path.md) and [docs/foundations.md](docs/foundations.md) |
| What the project is and who uses it | [docs/project-overview.md](docs/project-overview.md) |
| Install tools and obtain the source | [docs/installation.md](docs/installation.md) |
| Run and edit locally | [docs/local-development.md](docs/local-development.md) |
| Every environment variable and setting | [docs/configuration.md](docs/configuration.md) |
| Components, request flow, trust boundaries | [docs/architecture.md](docs/architecture.md) |
| Every directory and an execution walkthrough | [docs/repository-guide.md](docs/repository-guide.md) |
| Pages and workflows | [docs/features.md](docs/features.md) |
| All 57 API routes | [docs/api-reference.md](docs/api-reference.md) |
| All 15 database tables | [docs/data-model.md](docs/data-model.md) |
| Tests | [docs/testing.md](docs/testing.md) |
| Troubleshooting by symptom | [docs/debugging.md](docs/debugging.md) |
| Security model | [docs/security.md](docs/security.md) |
| Deploying to production | [docs/deployment.md](docs/deployment.md) |
| Monitoring, logs, housekeeping, incidents | [docs/operations.md](docs/operations.md) |
| Backup, restore, disaster recovery | [docs/backup-and-recovery.md](docs/backup-and-recovery.md) |
| Contributing and the guided exercise | [docs/contributing.md](docs/contributing.md) |
| Release procedure | [docs/releases.md](docs/releases.md) |
| Terms | [docs/glossary.md](docs/glossary.md) |

## Production health check

Run the following command from any machine with internet access:

```bash
curl -fsS https://air.dashydoggo.com/api/health
```

The expected response is `{"ok":true,"database":true}`. See [operations](docs/operations.md) for what to do when it is not.

## Source control

This directory is an independent Git repository with `origin` set to `git@github.com:dashydoggo/airdash.git`. The current integration branch is `release/airdash-platform-20260910`. Generated production output and runtime downloads are excluded from Git: `site/` is produced by the frontend build and also holds production-only downloads, `node_modules/` is restored from the lock files, `api/.env` holds credentials, and GSX ZIP archives are rebuilt from `gsx/`. The [repository guide](docs/repository-guide.md) explains every directory, and [contributing](docs/contributing.md) explains the branch and pull request workflow.

## License

No license file is present in the repository. All rights are reserved by the owner, and the code is not offered for reuse. Contact the owner before copying any part of it.

## Support and issue reporting

The project has one owner. Report problems by opening an issue at `https://github.com/dashydoggo/airdash/issues` or by contacting the owner through the dashydoggo.com Discord server. Security concerns follow the process in [security](docs/security.md#vulnerability-reporting) and must not be filed as public issues.

## Documentation standard

All durable project documentation follows the [documentation style standard](docs/documentation-style.md). The [index](docs/README.md#maintenance-triggers) lists the changes that require a documentation update.
