# Learning path

This page is the airDash curriculum. It orders the documentation into lessons, states what each lesson expects you to already know, tells you what to read and do, and gives exercises with expected outcomes so that you can check your own understanding. The structure follows the pattern of a structured software engineering course: concept, project example, guided practice, verification, common misconceptions, and recap. It is not accredited by any organization; it is the project's own teaching material.

Work through the lessons in order. Each lesson ends with a checkpoint. Do not proceed until you can complete the checkpoint without looking at the answer.

## How to use this page

- Budget roughly the time listed. The estimates assume no prior experience and include the exercises.
- Keep a notes file. Several exercises ask you to write an explanation in your own words; comparing your explanation to the documentation is the most reliable way to find gaps.
- Use a scratch branch for any exercise that edits files, and discard it afterward with `git checkout release/airdash-platform-20260910` followed by `git branch -D <scratch-branch>` once you have confirmed there is nothing on it you want to keep.
- When an exercise says "expected outcome", the outcome is what a correct solution produces. Hints are given before solutions; try the hint first.

## Lesson 1: What airDash is

**Time:** 45 minutes. **Prerequisites:** none.

**Objectives.** Explain the purpose of the platform, name the four actors and their roles, and describe the seven-step core workflow.

**Read.** [Project overview](project-overview.md).

**Exercise 1.1.** Without looking, write the seven steps of the core workflow, naming the page and the API route for each.

*Hint:* the steps alternate between a pilot action and a system or owner reaction.

*Expected outcome:* your list matches the "core workflow" section; every step names a route beginning with `/`.

**Exercise 1.2.** A visitor who is not signed in tries to open the Flight Board. Which role are they, and what do they see?

*Expected outcome:* Public role; the Flight Board page renders the "A pilot record is required" empty state with a link to `/join`, because `Flights` in `web/src/App.tsx` returns that state when `me?.pilot` is absent.

**Common misconception.** "The owner is a role you can be granted in the admin page." The owner is whichever Discord account matches `OWNER_DISCORD_ID`; there is no interface for changing it.

**Checkpoint.** Explain in two sentences why the platform enforces rules on the server rather than in the browser.

## Lesson 2: The computer and the shell

**Time:** 2 hours. **Prerequisites:** Lesson 1.

**Objectives.** Use a terminal to navigate directories, run commands, read exit codes, and set an environment variable for one command.

**Read.** [Foundations: computer and operating system](foundations.md#computer-and-operating-system-foundations).

**Exercise 2.1.** Open a terminal. Print the working directory, list its contents, change to your home directory, and print the working directory again.

*Expected outcome:* macOS and Linux: `pwd`, `ls -la`, `cd ~`, `pwd`. PowerShell: `Get-Location`, `Get-ChildItem -Force`, `Set-Location ~`, `Get-Location`.

**Exercise 2.2.** Run `node --version; echo "exit code: $?"` (Bash) or `node --version; "exit code: $LASTEXITCODE"` (PowerShell). Then run the same for a program that does not exist, such as `nodee --version`.

*Expected outcome:* the first prints a version and `0`; the second prints an error and a non-zero code (`127` in Bash, `1` in PowerShell).

**Exercise 2.3.** Explain why `PORT=39150 node src/server.js` sets the port only for that one process, and how you would set it for the rest of the shell session instead.

*Expected outcome:* a leading `NAME=value` applies to the single command that follows; `export PORT=39150` (Bash) or `$env:PORT = "39150"` (PowerShell) applies to the session.

**Common misconception.** "Relative paths are relative to where the script file is." They are relative to the working directory of the process, which is why the API must start from `api/`.

**Checkpoint.** Describe what `> /tmp/airdash-smoke.log 2>&1 &` does, token by token.

## Lesson 3: Source control

**Time:** 2 hours. **Prerequisites:** Lesson 2.

**Objectives.** Explain repository, working tree, staging, commit, branch, remote, and pull request; clone the repository; inspect its history.

**Read.** [Foundations: source control](foundations.md#source-control-foundations), then the "Obtain the source" section of [installation](installation.md#obtain-the-source).

**Exercise 3.1.** Clone the repository and run `git log --oneline`, `git branch -a`, and `git remote -v`.

*Expected outcome:* two or more commits, the branch `release/airdash-platform-20260910`, and `origin` pointing to `git@github.com:dashydoggo/airdash.git` or its HTTPS equivalent.

**Exercise 3.2.** Create a scratch branch, edit `README.md` by adding a line, run `git status`, `git diff`, stage the file, run `git status` again, commit, and then view the commit with `git show --stat`.

*Expected outcome:* `git status` first shows the file as modified and unstaged, then as staged; `git show --stat` shows one file changed.

**Exercise 3.3.** Undo the commit without losing the edit, then discard the edit.

*Hint:* `git reset --soft HEAD~1` moves the branch back one commit and keeps the change staged; `git restore --staged README.md` then `git restore README.md` discards it.

**Common misconception.** "`git pull` only downloads." It downloads and merges; if you have local commits, it creates a merge. Use `git fetch` to inspect first.

**Checkpoint.** Explain why `.env` files and `site/` are listed in `.gitignore`.

## Lesson 4: Installing the tools

**Time:** 1 to 3 hours depending on operating system. **Prerequisites:** Lesson 3.

**Objectives.** Install Node.js, npm, and Git; install dependencies; run the quick-start validation; optionally install PostgreSQL.

**Read and do.** [Installation](installation.md), all sections for your operating system.

**Exercise 4.1.** Run the quick-start validation from the [README](../README.md#quick-start).

*Expected outcome:* both tests print their verification lines; `check` and `typecheck` print nothing after the script banner.

**Exercise 4.2.** Delete `api/node_modules/` and restore it with `npm --prefix api ci`. Compare `ls api/node_modules | wc -l` before and after.

*Expected outcome:* the count is identical, because the lock file determines the tree exactly.

**Checkpoint.** State the minimum Node.js version the frontend toolchain accepts and where that requirement is declared.

*Answer:* `^20.19.0 || >=22.12.0`, declared in the `engines` field of `web/node_modules/vite/package.json`.

## Lesson 5: Reading JavaScript and TypeScript

**Time:** 4 hours. **Prerequisites:** Lesson 4.

**Objectives.** Read `api/src/auth.js` and `web/src/api.ts` line by line; explain `const`, arrow functions, `async`/`await`, `try`/`catch`, optional chaining, destructuring, template strings, interfaces, and generics.

**Read.** [Foundations: language and runtime](foundations.md#language-and-runtime-foundations).

**Exercise 5.1.** Write a one-line explanation for every line of `api/src/auth.js`. Compare your explanations to the annotated `authenticatedUser` walkthrough in foundations.

**Exercise 5.2.** In `api/src/streaks.js`, read `streakBonusPercent`. Without running it, predict its output for inputs `0`, `2`, `3`, `4`, `5`, and `20`. Then confirm by reading the assertions at the top of `api/scripts/test-streaks.js`.

*Expected outcome:* `0, 0, 5, 10, 15, 15`. The bonus starts on the third consecutive day and is capped at 15 percent.

**Exercise 5.3.** In `web/src/types.ts`, find the `Assignment` interface. List the properties that are optional and explain why `status` is a plain `string` while `source` is a union of three literals.

*Expected outcome:* optional properties end in `?`; `source` has exactly three legal values in the API, so the type documents them, while `status` has seven legal values that the type does not enumerate. Noting that the type could be tightened is a valid observation.

**Common misconception.** "`await` makes the whole server wait." It suspends only the function that contains it; other requests continue to be served.

**Checkpoint.** Explain why `authenticatedUser` returns `null` inside `catch` instead of throwing, and what security property that gives.

## Lesson 6: Dependencies

**Time:** 1 hour. **Prerequisites:** Lesson 5.

**Objectives.** Explain manifests, lock files, exact pinning, `npm ci` versus `npm install`, and supply-chain risk.

**Read.** [Foundations: dependencies](foundations.md#dependency-foundations).

**Exercise 6.1.** Open `api/package.json` and `web/package.json`. Count the direct runtime dependencies of each and the development dependencies of each.

*Expected outcome:* API: 4 runtime, 0 development. Web: 7 runtime, 6 development.

**Exercise 6.2.** Find the version of `react-router-dom` recorded in `web/package-lock.json` and confirm it matches `web/package.json`.

*Hint:* `grep -A2 '"node_modules/react-router-dom"' web/package-lock.json`.

*Expected outcome:* `7.18.3` in both.

**Checkpoint.** Explain what would go wrong if a contributor ran `npm install express@latest` in `api/` and committed only `package.json`.

## Lesson 7: HTTP and the API

**Time:** 3 hours. **Prerequisites:** Lesson 6.

**Objectives.** Describe the request lifecycle; use `curl` to call public routes; explain status codes, headers, cookies, origin, and JSON.

**Read.** [Foundations: web and API](foundations.md#web-and-api-foundations), then the public routes section of the [API reference](api-reference.md#public-routes).

**Exercise 7.1.** Call `/api/health`, `/api/public`, and `/api/live` on production with `curl -s` and pipe each through `python3 -m json.tool | head -30` to read the structure.

*Expected outcome:* `health` returns two booleans; `public` returns `aircraft`, `routes`, `bases`, `pilots`, and `topPilot`; `live` returns `flights`.

**Exercise 7.2.** Explain why `curl -X POST https://air.dashydoggo.com/api/applications` returns `403` with `Invalid request origin` rather than `401`.

*Expected outcome:* `requireAirDashOrigin` is global middleware that runs before any route's `requireUser`, and it rejects every non-read request without an approved `Origin` header.

**Exercise 7.3.** Read the `/news` handler in `api/src/server.js`. Explain how `limit` is bounded and what happens when a client sends `limit=abc`.

*Expected outcome:* `Number.parseInt` yields `NaN`, `|| 12` substitutes the default, and `Math.min(50, Math.max(1, ...))` clamps the value to the range 1 to 50.

**Checkpoint.** Draw the seven-step lifecycle of `GET /api/me` from memory.

## Lesson 8: The database

**Time:** 3 hours. **Prerequisites:** Lesson 7, and PostgreSQL installed per [installation](installation.md#install-postgresql).

**Objectives.** Explain tables, keys, constraints, indexes, transactions, parameters, and the migration function; run read-only queries.

**Read.** [Foundations: databases](foundations.md#database-foundations), then [data model](data-model.md).

**Exercise 8.1.** Start the API once against your local database (see [local development](local-development.md)). Then list the tables and count the routes:

```bash
psql "$DATABASE_URL" -Atc "SELECT COUNT(*) FROM airdash.routes;"
```

*Expected outcome:* fifteen tables; the route count equals the seeded routes (102 rows: 92 listed tuples plus 10 generated Spokane routes) unless you have added any.

**Exercise 8.2.** Read the two partial unique indexes on `airdash.assignments`. Explain in one sentence each what business rule they enforce.

*Expected outcome:* one active assignment per aircraft; one active assignment per pilot.

**Exercise 8.3.** Find the `CHECK` constraint on `pireps.landing_rate` and explain why zero is forbidden.

*Expected outcome:* Volanta reports zero when it did not measure a landing; storing `NULL` instead keeps averages honest because `AVG` ignores `NULL`.

**Common misconception.** "Running the migration twice will duplicate the seed data." Every seed uses `ON CONFLICT DO NOTHING` or an equivalent guard, so repeated runs converge.

**Checkpoint.** Explain the difference between `pool.query` and `pool.connect()` and when each is used.

## Lesson 9: Running airDash locally

**Time:** 2 hours. **Prerequisites:** Lesson 8.

**Objectives.** Run the API with a local database and the mock authentication service; run the Vite development server; sign in as a fake owner; exercise a page.

**Read and do.** [Local development](local-development.md).

**Exercise 9.1.** Start the mock authentication service, the API, and the Vite server. Open `http://localhost:5174`, and confirm that the top bar greets the mock user.

**Exercise 9.2.** Book a flight on your local instance and observe the new row with a read-only query on `airdash.assignments`.

*Expected outcome:* one row with `status='BOOKED'`, a `departure_gate`, an `arrival_gate`, and `expires_at` about `block_minutes + 150` minutes in the future.

**Checkpoint.** Explain why the Vite server needs a proxy for `/api`, and what would break without it.

## Lesson 10: Architecture

**Time:** 2 hours. **Prerequisites:** Lesson 9.

**Objectives.** Name every runtime component, trace a request end to end, describe the background jobs, and locate each trust boundary.

**Read.** [Architecture](architecture.md).

**Exercise 10.1.** From memory, draw the production topology with every process, container, port, and mount.

**Exercise 10.2.** The `expireAssignments` function runs on a timer and also inside several route handlers. List the routes that call it and explain why they do.

*Expected outcome:* `/pilots`, `/missions`, `/me`, and `/flights` call it so that a pilot never sees an assignment the timer has not yet expired.

**Checkpoint.** Explain why a frontend build is live immediately but an API edit is not.

## Lesson 11: The repository

**Time:** 1 hour. **Prerequisites:** Lesson 10.

**Objectives.** Locate the file that implements any given behavior; distinguish handwritten from generated files.

**Read.** [Repository guide](repository-guide.md).

**Exercise 11.1.** Using only `grep`, find where the text "Finish or cancel the current assignment before booking another." is produced, and where the API enforces the same rule.

*Expected outcome:* `web/src/App.tsx` in the `Flights` component, and the `activeAssignment` check in `POST /assignments` in `api/src/server.js`, backed by the `assignments_active_pilot` index.

**Checkpoint.** Name three files under `site/` that must never be edited by hand and one that may be.

## Lesson 12: Features and rules

**Time:** 2 hours. **Prerequisites:** Lesson 11.

**Objectives.** Describe every page and the server-side rules behind it.

**Read.** [Features](features.md).

**Exercise 12.1.** A pilot's SimBrief import is rejected with "SimBrief aircraft type must be BCS3". Find the check and explain how a pilot would fix the problem.

**Exercise 12.2.** Explain the three pilot report outcomes and how the API decides among them without trusting the browser.

**Checkpoint.** Describe what happens to the aircraft, the pilot's statistics, and the assignment when a report with a landing rate of `-500` feet per minute is approved.

## Lesson 13: Testing

**Time:** 2 hours. **Prerequisites:** Lesson 12.

**Objectives.** Run the tests, read a failure, add an assertion, and run the smoke test.

**Read.** [Foundations: testing](foundations.md#testing-foundations) and [Testing](testing.md).

**Exercise 13.1.** Add an assertion to `api/scripts/test-streaks.js` that `streakBonusPercent(6)` equals `15`. Run the test.

*Expected outcome:* still passes, because the cap is 15.

**Exercise 13.2.** Change the cap in `streaks.js` from `15` to `20`, rerun, and read the failure. Restore both files.

*Expected outcome:* `AssertionError` on the `streakBonusPercent(5)` or `(20)` assertion, showing expected `15` and actual `20` for the appropriate input.

**Checkpoint.** Explain why the smoke test is a real validation of a migration.

## Lesson 14: Your first change

**Time:** 2 hours. **Prerequisites:** Lesson 13.

**Objectives.** Make a frontend-only change, validate it with the type check, the isolated build, and the marker check.

**Read and do.** [Change recipes: change the Portal pilot and base line](change-recipes.md#change-the-portal-pilot-and-base-line), on a scratch branch.

**Checkpoint.** Explain why the marker check exists and what an absent marker means.

## Lesson 15: Diagnosing failures

**Time:** 2 hours. **Prerequisites:** Lesson 14.

**Read.** [Debugging](debugging.md).

**Exercise 15.1.** With your local API running, stop your local PostgreSQL container and watch the API's terminal. Then request `/health`. Start PostgreSQL again and start the API again.

*Expected outcome:* within about two seconds of stopping the database, the API prints `error: terminating connection due to administrator command` under an `Unhandled 'error' event` heading and exits; the `/health` request then fails to connect rather than returning `503`. After the database and the API are restarted, `/health` returns `200`. This is the behavior described in [debugging](debugging.md#database-unavailable): the connection pool has no error handler, so a database restart crashes the process and PM2 must restart it in production.

**Checkpoint.** For the symptom "PM2 shows rising unstable restarts", list the three most likely causes in order.

## Lesson 16: Security

**Time:** 2 hours. **Prerequisites:** Lesson 15.

**Read.** [Security](security.md).

**Exercise 16.1.** Find every route with `requireOwner` in `api/src/server.js` and confirm the count matches the [API reference](api-reference.md#owner-routes).

**Exercise 16.2.** Explain why the anonymous livery download uses a redirect to a `/downloads/liveries/` path rather than reading an arbitrary file path from the request.

**Checkpoint.** Name the two secrets in `api/.env` that must never appear in the frontend bundle, and describe how you would check the bundle.

## Lesson 17: Build and deploy

**Time:** 2 hours. **Prerequisites:** Lesson 16. Production access is not required to read this lesson; the exercises use the isolated build.

**Read.** [Foundations: build and deployment](foundations.md#build-and-deployment-foundations), [Deployment](deployment.md), [Releases](releases.md).

**Exercise 17.1.** Run the isolated build and compare the hashed file names with the ones referenced by the production site (`curl -s https://air.dashydoggo.com/ | grep -oE '/app-assets/index-[^" ]+'`).

*Expected outcome:* identical names if your checkout matches the deployed commit; different names if source has changed.

**Checkpoint.** State the order for deploying a change that touches both `api/src/` and `web/src/`, and why.

## Lesson 18: Operating and recovering

**Time:** 2 hours. **Prerequisites:** Lesson 17.

**Read.** [Operations](operations.md) and [Backup and recovery](backup-and-recovery.md).

**Exercise 18.1.** Using your local database, create a schema-only dump with `pg_dump -n airdash -Fc` and list its contents with `pg_restore --list`.

**Checkpoint.** Explain why rolling back API source does not roll back a migration, and what you would do about a changed constraint.

## Lesson 19: Contributing

**Time:** 3 hours. **Prerequisites:** all previous lessons.

**Read and do.** [Contributing](contributing.md), including the guided contribution exercise, which takes you from locating a feature through opening a pull request.

**Final checkpoint.** Your pull request description includes the change classification, the validation commands you ran with their output, and the documentation pages you updated.

## Recap of the whole path

By the end you can explain the platform's purpose and rules, operate a shell and Git, read the project's JavaScript and TypeScript, install and run it locally with a database and mock login, trace requests and background jobs, find any file, run and extend tests, diagnose common failures, describe the security model, follow deployment and recovery procedures, and submit a reviewed change. The [FAQ](faq.md) and [glossary](glossary.md) remain useful as quick references afterward.
