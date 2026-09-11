# Start here

This guide tells you which pages to read, in which order, based on what you need to do. Each path lists its stages, the page for each stage, and what you should be able to do when the stage is complete. The paths are deterministic: follow the listed order, and do not skip a stage unless its outcome already describes something you can do.

## Choose a path

| You are | Path |
|---|---|
| New to software development and want to understand and eventually change airDash | [Complete beginner](#complete-beginner) |
| A developer who wants to make a change and submit it | [Contributor](#contributor) |
| A developer who needs facts quickly | [Experienced developer](#experienced-developer) |
| Writing a program or script that calls the airDash API | [API consumer](#api-consumer) |
| Responsible for keeping production running | [Operator](#operator) |
| Reviewing the security posture | [Security reviewer](#security-reviewer) |

## Complete beginner

This path assumes no prior experience with terminals, source code, Git, servers, or databases. It is long by design. The [learning path](learning-path.md) expands this same order into lessons with exercises.

| Stage | Read | Outcome |
|---|---|---|
| 1 | [Project overview](project-overview.md) | You can explain what airDash does, who uses it, and what it does not do. |
| 2 | [Foundations: computer and operating system](foundations.md#computer-and-operating-system-foundations) | You can open a terminal, move between directories, and explain a file path, a process, a port, and an environment variable. |
| 3 | [Foundations: source control](foundations.md#source-control-foundations) | You can explain a repository, a commit, a branch, and a pull request, and you know the airDash branch names. |
| 4 | [Installation](installation.md) | You have Node.js, npm, and Git installed, the repository cloned, dependencies installed, and the quick-start validation passing. |
| 5 | [Foundations: language and runtime](foundations.md#language-and-runtime-foundations) | You can read `api/src/auth.js` and `web/src/api.ts` and explain each line. |
| 6 | [Foundations: dependencies](foundations.md#dependency-foundations) | You can explain `package.json`, `package-lock.json`, and why the project uses `npm ci`. |
| 7 | [Foundations: web and API](foundations.md#web-and-api-foundations) | You can explain what happens between the browser and the API when `/api/health` is requested. |
| 8 | [Foundations: databases](foundations.md#database-foundations) | You can explain a table, a primary key, a foreign key, and a migration, using airDash tables as examples. |
| 9 | [Local development](local-development.md) | You have the API running locally against a local PostgreSQL database with a mock login, and the frontend running in the Vite development server. |
| 10 | [Architecture](architecture.md) | You can trace a request from the browser through Caddy, Nginx, Express, and PostgreSQL. |
| 11 | [Repository guide](repository-guide.md) | You can find the file that implements any feature without guessing. |
| 12 | [Features](features.md) | You can describe each page and the rules the API enforces behind it. |
| 13 | [Foundations: testing](foundations.md#testing-foundations) and [Testing](testing.md) | You can run the tests, read a failure, and add an assertion. |
| 14 | [Change recipes](change-recipes.md) | You have made a frontend-only change and validated it with an isolated build. |
| 15 | [Debugging](debugging.md) | You can diagnose the ten most common failures by their symptoms. |
| 16 | [Security](security.md) | You can explain the trust boundaries and the rules that protect them. |
| 17 | [Foundations: build and deployment](foundations.md#build-and-deployment-foundations), [Deployment](deployment.md) | You can explain the difference between source and build output and follow a deployment procedure. |
| 18 | [Operations](operations.md) and [Backup and recovery](backup-and-recovery.md) | You can check health, read logs, create a backup, and restore a component. |
| 19 | [Contributing](contributing.md) | You have completed the guided contribution exercise and opened a pull request. |

## Contributor

This path assumes you can use a terminal, Git, and a code editor, and that you have written JavaScript before.

| Stage | Read | Outcome |
|---|---|---|
| 1 | [Project overview](project-overview.md) | You know the actors, the roles, and the scope. |
| 2 | [Installation](installation.md) | Dependencies installed and the quick-start validation passing. |
| 3 | [Local development](local-development.md) | Local API with a local database and mock login, and the Vite development server. |
| 4 | [Repository guide](repository-guide.md) | You know which directory owns each concern and which files are generated. |
| 5 | [Architecture](architecture.md) | You know the request lifecycle, background jobs, and trust boundaries. |
| 6 | [Testing](testing.md) | You can run and extend the tests and the smoke test. |
| 7 | [Change recipes](change-recipes.md) | You have a pattern for the kind of change you plan to make. |
| 8 | [Contributing](contributing.md) | You know the branch, commit, validation, and pull request expectations. |
| 9 | [Deployment](deployment.md) | You know what happens after merge and who performs it. |

## Experienced developer

Read the reference pages directly. Each is self-contained and cross-linked.

| Need | Page |
|---|---|
| Component map and flows | [Architecture](architecture.md) |
| Routes | [API reference](api-reference.md) |
| Schema | [Data model](data-model.md) |
| Settings | [Configuration](configuration.md) |
| Files | [Repository guide](repository-guide.md) |
| Commands | [Local development](local-development.md#command-reference) and [Testing](testing.md) |
| Constraints | [Known limitations](known-limitations.md) |

## API consumer

The public API requires no credentials for read-only public routes. Authenticated routes require the dashydoggo.com Discord session cookie and a browser origin, which means they are not intended for scripts.

| Stage | Read | Outcome |
|---|---|---|
| 1 | [Architecture: request lifecycle](architecture.md#request-lifecycle) | You know that the browser path is `/api/<route>` and the Express path is `/<route>`. |
| 2 | [API reference: public routes](api-reference.md#public-routes) | You can call `/api/health`, `/api/public`, `/api/live`, `/api/schedule`, `/api/hub-health`, `/api/news`, and the livery download routes. |
| 3 | [API reference: authorization](api-reference.md#authorization-classes) | You know why authenticated routes reject non-browser clients. |
| 4 | [PowerPoint automation](powerpoint-automation.md) | You have a complete example of an external consumer of `/api/live`. |
| 5 | [Security](security.md) | You know the rate, size, and origin controls that apply. |

## Operator

| Stage | Read | Outcome |
|---|---|---|
| 1 | [Architecture: production runtime topology](architecture.md#production-runtime-topology) | You know every process, container, port, mount, and volume. |
| 2 | [Configuration](configuration.md) | You know every variable in `api/.env` and what each controls. |
| 3 | [Operations](operations.md) | You can check health, read logs, review the audit log, and diagnose an unhealthy API. |
| 4 | [Backup and recovery](backup-and-recovery.md) | You can create release and database backups and recover each component. |
| 5 | [Deployment](deployment.md) | You can deploy and roll back each class of change. |
| 6 | [Debugging](debugging.md) | You can match a symptom to a cause. |
| 7 | [Known limitations](known-limitations.md) | You know which constraints affect operations. |

## Security reviewer

| Stage | Read | Outcome |
|---|---|---|
| 1 | [Security](security.md) | You know the assets, boundaries, controls, and assumptions. |
| 2 | [Architecture: trust boundaries](architecture.md#trust-boundaries) | You know where each boundary is enforced in code. |
| 3 | [API reference](api-reference.md) | You can verify authorization on every route. |
| 4 | [Data model: sensitive data](data-model.md#sensitive-data-classification) | You know which columns hold personal data. |
| 5 | [Configuration](configuration.md) | You know which values are secrets and where they live. |
| 6 | [Known limitations](known-limitations.md) | You know the accepted risks. |
