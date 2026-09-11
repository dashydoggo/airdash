# airDash documentation

This documentation explains what airDash is, how it is built, how to install and run it, how to change it safely, how to deploy and operate it, and how to recover it. The intended reader ranges from a complete beginner who has never opened a terminal to the operator responsible for production. Every page defines specialized terms where they first appear, and every procedure states where it runs, what it changes, and how to verify the result.

**Last verified:** September 10, 2026, against commit `5f2e27c` on branch `release/airdash-platform-20260910`.

## Where to begin

If you do not know where to start, read the [start-here guide](start-here.md). It provides an ordered reading path for beginners, contributors, experienced developers, API consumers, operators, and security reviewers, and it states what you should understand after each stage.

If you are a beginner, the [learning path](learning-path.md) is the curriculum. It orders every page below into lessons with objectives, exercises, and checkpoints, and it ends with a guided contribution exercise.

## Documentation map

Pages are classified as introductory (teaching material that assumes little), reference (authoritative facts about the current implementation), or procedure (step-by-step instructions that change or inspect a system).

| Page | Class | Purpose |
|---|---|---|
| [Start here](start-here.md) | Introductory | Reading paths by audience and the outcome of each stage. |
| [Learning path](learning-path.md) | Introductory | Ordered beginner curriculum with objectives, exercises, and checkpoints. |
| [Project overview](project-overview.md) | Introductory | Purpose, scope, supported and unsupported use, actors and roles, status. |
| [Foundations](foundations.md) | Introductory | Operating system, shell, Git, JavaScript and TypeScript, dependencies, HTTP and APIs, databases, testing, and build concepts, each tied to airDash code. |
| [Installation](installation.md) | Procedure | Tool installation on macOS, Linux, and Windows; obtaining the source; installing dependencies; creating `api/.env`; PostgreSQL setup. |
| [Local development](local-development.md) | Procedure | Running the API and frontend locally, the mock authentication service, the edit-validate loop, and the isolated build. |
| [Configuration](configuration.md) | Reference | Every environment variable, the `settings` table, build configuration, and configuration precedence. |
| [Architecture](architecture.md) | Reference | Components, request lifecycle, background work, startup and shutdown, trust boundaries, and tradeoffs. |
| [Repository guide](repository-guide.md) | Reference | Every directory and important file, whether it is handwritten or generated, and a traced execution path. |
| [Features](features.md) | Reference | Every page and workflow, the rules it enforces, and the code that implements it. |
| [API reference](api-reference.md) | Reference | All 57 Express routes with authorization, parameters, validation, responses, side effects, and handlers. |
| [Data model](data-model.md) | Reference | All 15 PostgreSQL tables, the sequence, indexes, constraints, lifecycles, and migration behavior. |
| [Testing](testing.md) | Reference and procedure | Test strategy, the two test scripts, the temporary-process smoke test, and expectations for new code. |
| [Debugging](debugging.md) | Procedure | Troubleshooting organized by observable symptom. |
| [Security](security.md) | Reference | Assets, trust boundaries, authentication, authorization, secrets, input validation, audit, and reporting. |
| [Deployment](deployment.md) | Procedure | Frontend, API, combined, static, and configuration deployments with verification and rollback. |
| [Operations](operations.md) | Procedure | Health, logs, background jobs, housekeeping, audit review, and incident diagnosis. |
| [Backup and recovery](backup-and-recovery.md) | Procedure | Release backups, database dumps, restore, and recovery of each runtime component. |
| [Contributing](contributing.md) | Procedure | Branching, commits, pull requests, review standards, and the guided contribution exercise. |
| [Releases](releases.md) | Procedure | How a change becomes a production release and how a release is recorded. |
| [Change recipes](change-recipes.md) | Procedure | Worked examples for common code changes. |
| [PowerPoint and MSFS video automation](powerpoint-automation.md) | Reference and procedure | The Windows exporter, launcher, template rules, and troubleshooting. |
| [Glossary](glossary.md) | Reference | Definitions of every project term and acronym. |
| [FAQ](faq.md) | Reference | Short answers to recurring questions with links to the authoritative page. |
| [Known limitations](known-limitations.md) | Reference | Constraints, technical debt, and unresolved contradictions. |
| [Coverage map](coverage-map.md) | Reference | Maps each concept to its source, configuration, tests, documentation, and validation method. |
| [Platform design](designdoc.md) | Historical | Product decisions and earlier plans. It is not the current operations manual. |
| [Documentation style standard](documentation-style.md) | Reference | The required writing style for durable documentation. |

## How the pages relate

The [architecture](architecture.md) page is the canonical description of components and flows. The [API reference](api-reference.md) and [data model](data-model.md) are the canonical descriptions of the two public contracts: the HTTP routes and the schema. The [configuration](configuration.md) page is the canonical list of settings. Other pages link to these three rather than restating them. When you find a fact stated in two places, the reference page wins, and the other page should be corrected to link to it.

## Change classification

Use this table to determine which validation and deployment procedure applies to a change.

| Changed area | Examples | Frontend build | API restart | Database backup |
|---|---|---|---|---|
| Frontend source under `web/src/` | JSX, CSS, icons, browser state | Required | Not required | Not required |
| API source under `api/src/` | Route, validation, response field | Only if the UI also changed | Required | Recommended when data changes |
| Migration statement in `api/src/database.js` | Table, column, index, seed | Only if the UI also changed | Required | Required |
| Static site file under `site/assets/` or `site/downloads/` | Image, download, manifest | Not required | Not required | Not required |
| `nginx.conf` | Cache headers, SPA fallback | Not required | Not required, but Nginx reload is required | Not required |
| Caddyfile | Domain, TLS, reverse proxy | Not required | Not required, but a shared Caddy reload is required | Not required |
| Windows automation under `scripts/` | PowerShell exporter or launcher | Not required | Only if the API payload also changes | Not required |
| Documentation under `docs/` | Any page | Not required | Not required | Not required |

## Maintenance triggers

Documentation is correct only while it matches the implementation. The following changes require the listed documentation update in the same pull request.

| Change | Update |
|---|---|
| Add, rename, or remove an environment variable | [Configuration](configuration.md), `api/.env.example`, and the [coverage map](coverage-map.md). |
| Add, change, or remove an Express route | [API reference](api-reference.md), the route count in [architecture](architecture.md), and [features](features.md) if user-visible. |
| Add a table, column, index, or constraint | [Data model](data-model.md) and the table count in [architecture](architecture.md). |
| Change a background job interval or behavior | [Architecture](architecture.md#background-work) and [operations](operations.md). |
| Change how authentication or authorization works | [Security](security.md) and [architecture](architecture.md#trust-boundaries). |
| Change a deployment step, container, mount, or port | [Deployment](deployment.md), [operations](operations.md), and [backup and recovery](backup-and-recovery.md). |
| Change a user-visible page or workflow | [Features](features.md) and the [glossary](glossary.md) if a term changed. |
| Add a dependency or change a version | [Installation](installation.md), [foundations](foundations.md#dependency-foundations), and [known limitations](known-limitations.md) if the change constrains anything. |
| Add or change a test script | [Testing](testing.md) and `package.json`. |
| Discover a constraint or tradeoff | [Known limitations](known-limitations.md). |

## Documentation conventions

- Commands run from the repository root unless a `cd` is shown. The repository root is the directory that contains `README.md`, `api/`, and `web/`.
- Production paths refer to `/opt/dashy-database/projects/airdash` on the production host. Local paths are written relative to wherever you cloned the repository.
- Placeholders are written in angle brackets, such as `<timestamp>` or `<your-discord-id>`, and must be replaced before running the command.
- Bold `Note`, `Important`, and `Warning` labels mark caveats in ascending order of severity.
- Every page follows the [documentation style standard](documentation-style.md).
