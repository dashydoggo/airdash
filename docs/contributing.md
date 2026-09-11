# Contributing

This page defines how a change moves from an idea to production-ready code in airDash: the branch and commit conventions, the validation that must pass, what a pull request must contain, how review works, and the coding and documentation standards. It ends with a guided exercise that takes a first-time contributor through a complete, small change on the real repository.

The repository is public at `https://github.com/dashydoggo/airdash`, has one maintainer (the owner), and has no branch protection rules or continuous integration at this commit. The expectations below are therefore practices the project follows rather than rules GitHub enforces.

## Before you start

- Complete [installation](installation.md) and [local development](local-development.md). You need a local database and the mock authentication service to test anything that touches the API.
- Read the [repository guide](repository-guide.md) to find the files your change involves, and [change recipes](change-recipes.md) for a pattern.
- For anything larger than a small fix, open a GitHub issue first describing the change and wait for the owner's agreement. This avoids work on features the airline does not want.
- Do not commit generated files (`site/`, `node_modules/`, `*.tsbuildinfo`), environment files, or archives. `.gitignore` excludes them; `git status` should never show them.

## Branches

| Branch | Purpose | Who pushes |
|---|---|---|
| `release/airdash-platform-<date>` | The integration branch that production runs. Currently `release/airdash-platform-20260910`. | The owner, by merging pull requests. |
| `feature/<short-description>` | One change or a small set of related changes. | The contributor. |
| `fix/<short-description>` | A bug fix. | The contributor. |
| `docs/<short-description>` | Documentation only. | The contributor. |

Create a branch from the current release branch:

```bash
git fetch origin
git checkout release/airdash-platform-20260910
git pull --ff-only origin release/airdash-platform-20260910
git checkout -b feature/<short-description>
```

Never commit directly to a `release/*` branch. Never force-push a branch that someone else may have fetched.

## Commits

- Stage only the files that belong to the change: `git add <path>`, not `git add .`.
- Write the subject in the imperative mood, under 70 characters, describing what the commit does: `Add departure gate reassignment audit details`, not `gate stuff`.
- Add a body when the reason is not obvious from the diff. Explain why, and reference the issue if one exists.
- One logical change per commit. A dependency version change is its own commit with both `package.json` and `package-lock.json`.
- Do not amend or rebase commits after pushing unless the owner asks.

## Coding standards

The code has no linter or formatter configuration; follow the conventions of the surrounding code.

API (`api/src/`):

- ECMAScript modules, no semicolons, double quotes, two-space indentation, one statement per line except for short guards.
- Every request value passes through `clean()`, an allow-list, a regular expression, or numeric coercion before use. Every SQL value is a `$n` parameter.
- Multi-row changes run in a transaction on a dedicated client with `BEGIN`, `COMMIT`, `ROLLBACK` in `catch`, and `client.release()` in `finally`.
- Deliberate errors are `Object.assign(new Error("<user-readable message>"), { status: <4xx> })`; unexpected errors return a generic message.
- Every state change writes an `audit()` row after commit, with a new `ACTION_NAME` in upper snake case.
- New pure logic goes in its own module and gets assertions in a test script.

Frontend (`web/src/`):

- TypeScript strict mode; no `any` in new code where a type exists in `types.ts`. Add fields to `types.ts` when the API adds them.
- New pages are functions in `App.tsx` or a new file imported by it; register the route in `App` and the title in `PAGE_TITLES`.
- Icons come from `react-icons/fi` or `react-icons/tb` and must be imported.
- Styles append to `styles.css` using the `:root` color variables; responsive rules use the existing breakpoints.
- Interactive elements are `<button>` or `<a>` with labels; images have `alt`.

Both:

- No secrets, personal data, or production hostnames in code or fixtures.
- No new dependencies without an issue explaining the need, and pinned to an exact version.

## Validation checklist

Run everything that applies, and paste the output summary into the pull request. Commands run from the repository root.

```text
[ ] npm --prefix api run check                (any API change)
[ ] npm --prefix api run test:streaks         (any API change)
[ ] npm --prefix api run test:flight-outcomes (any API change)
[ ] Smoke test of every changed route with request and response (any route or migration change)
[ ] Migration started twice against a fresh local database (any database.js change)
[ ] npm --prefix web run typecheck            (any frontend change)
[ ] Isolated build and marker check           (any frontend change)
[ ] Visual check in a browser                 (any user-visible change)
[ ] npm --prefix academy run validate         (any behavior, documentation, or academy change)
[ ] npm --prefix academy test                 (any academy engine, checker, schema, or data change)
[ ] Documentation and academy coverage updated per the maintenance triggers
[ ] git status shows only intended files; no .env, site/, or node_modules/
```

The procedures are in [testing](testing.md) and [local development](local-development.md).

## Documentation requirements

The [maintenance triggers](README.md#maintenance-triggers) table lists which page must change for which kind of code change. A pull request that adds a route without updating the [API reference](api-reference.md), or a column without updating the [data model](data-model.md), is incomplete. Documentation follows the [style standard](documentation-style.md).

The interactive academy is another maintained contract, not generated filler. A changed concept requires the matching object in `academy/data/concepts.json`, at least two recall or explanation and two higher-order mappings in `academy/data/questions/<module>.json`, practical evidence when the change affects execution, updated cumulative critical coverage when applicable, and current source references. A new automated lab may name only a checker implemented in `academy/checks.mjs`; browser or JSON input must never become a command. Run the academy validator and tests before review. The validator must be fixed by restoring coverage or correctness, not by weakening the mastery thresholds.

## Pull requests

Push the branch and open a pull request against the current `release/*` branch:

```bash
git push -u origin feature/<short-description>
```

Then open `https://github.com/dashydoggo/airdash/compare` in a browser, or use the GitHub CLI if installed: `gh pr create --base release/airdash-platform-20260910 --fill`.

Title: under 70 characters, imperative. Description, in this order:

1. Summary: what changes and why, in two to five sentences.
2. Change classification from the [table](README.md#change-classification), and the deployment procedure that will apply.
3. Validation: the checklist above with the commands you ran and their output.
4. Documentation: the pages you updated.
5. Risks and rollback: what could go wrong and how it would be reversed.
6. Not done: anything deliberately left out.

Keep pull requests small. A pull request that touches `App.tsx`, `server.js`, and `database.js` at once should be three pull requests unless the change is inseparable.

## Review

The owner reviews every pull request. Reviewers check that the change does what the description says, that the validation evidence is present and credible, that every request value is validated and every query parameterized, that authorization is correct for new routes, that the documentation was updated, and that the diff contains nothing unrelated. Address comments with new commits; do not force-push over reviewed history. When approved, the owner merges (squash or merge commit at their discretion) and deploys following [deployment](deployment.md) and [releases](releases.md).

## Safe recovery from Git mistakes

See [foundations](foundations.md#safe-recovery-from-common-mistakes). When in doubt, do not run a destructive command; ask.

## Guided contribution exercise

This exercise makes a small, real change end to end. It adds the pilot's continuity streak to the public `GET /live` payload so that the network map could show it, and documents it. It touches one API file, one test consideration, one frontend type, and two documentation pages. Work on a scratch branch and do not open a real pull request unless the owner has asked for this feature; the exercise ends with preparing the pull request description.

Estimated time: two hours. Prerequisites: [local development](local-development.md) working, with at least one pilot and one approved report in your local database, or willingness to read the code without live data.

### Step 1: Locate the feature

The goal mentions `/live` and streaks. Find both:

```bash
grep -n 'app.get("/live"' api/src/server.js
grep -n 'export function publicStreaks\|export async function calculatePilotStreaks' api/src/streaks.js
grep -n 'interface StreakSummary' web/src/types.ts
```

Expected: one line each. Open `server.js` at the `/live` handler and read it. It runs one query joining `assignments`, `routes`, `pilots`, and `users` and returns `{ flights: rows }`. It does not call `calculatePilotStreaks`.

### Step 2: Trace the execution path

Follow the request from the browser to the response using the [repository guide's traced path](repository-guide.md#traced-execution-path-booking-a-flight) as the model:

1. `LiveMap` and `AdvancedNetworkMap` call `api("/live")`, and the PowerShell exporter requests `/api/live`.
2. Caddy strips `/api`; global middleware runs; there is no `requireUser`, so the route is public.
3. The handler queries and responds.

Write down two consequences before changing anything. First, the route is public, so anything you add is visible to everyone; a streak is derived from approved flights that are already public in `/public` and the pilot directory, so it is acceptable. Second, the route is called by the Windows exporter, which ignores fields it does not know, so adding a field is backward compatible.

### Step 3: Make a small, controlled change

Streaks are computed per pilot by `calculatePilotStreaks(executor, discordId)`, which runs one query. Adding it per row is the pattern `GET /pilots` already uses. Edit the `/live` handler in `api/src/server.js` so that after the query it computes streaks for each row:

```js
app.get("/live", async (_req, res) => {
  const result = await pool.query(`SELECT ...unchanged...`)
  const flights = await Promise.all(result.rows.map(async row => ({
    ...row,
    continuity_streak: publicStreaks(await calculatePilotStreaks(pool, row.discord_id)).continuity.current,
  })))
  res.json({ flights })
})
```

Only the three lines that build `flights` and the `res.json` argument change; the SQL is untouched. `publicStreaks` and `calculatePilotStreaks` are already imported at the top of `server.js`. This example is newly proposed for the exercise and is not in the repository. The implementation fragment was validated in an isolated checkout of source commit `5f2e27c`: syntax, both API tests, type check, and a smoke request passed. The expanded seven-file exercise, including concept evidence, a new authored question, both count assertions, academy validation, and all 47 academy tests, was validated again during academy delivery.

Expected output: each object in `flights` gains an integer `continuity_streak`. Side effects: one additional query per active flight, at most 50. Error behavior: a database error rejects the promise and Express returns `500`, the same as today. Security: no new input is read from the request.

### Step 4: Update the frontend type

The frontend reads `/live` into untyped `any[]` in `LiveMap`, so the type check will pass without a change. To keep the contract explicit, add an optional field to a shared type anyway. In `web/src/types.ts`, the `Assignment` interface is the closest match for a live flight row; add:

```ts
continuity_streak?: number
```

inside `Assignment`, keeping the single-line style of that file. Optional, because other routes returning assignments do not include it.

### Step 5: Add or update a test

The new behavior is a route change, which the unit tests do not cover, and the streak calculation it relies on is already covered by `test-streaks.js`. Two actions are appropriate:

1. Confirm the existing tests still pass: `npm --prefix api run test:streaks` and `npm --prefix api run test:flight-outcomes`.
2. Write the smoke test evidence: start the API against your local database ([testing](testing.md#smoke-test)) and run:

   ```bash
   curl -fsS http://127.0.0.1:39150/live | python3 -c 'import sys,json; f=json.load(sys.stdin)["flights"]; print(len(f), [x.get("continuity_streak") for x in f])'
   ```

   Expected: the number of active flights and a list of integers (empty lists are fine if no flight is active; then book one locally and rerun).

If you had added a new pure function instead, you would add assertions per [testing](testing.md#adding-a-test).

### Step 6: Run validation

```bash
npm --prefix api run check
npm --prefix api run test:streaks
npm --prefix api run test:flight-outcomes
npm --prefix web run typecheck
npm --prefix academy run validate
npm --prefix academy test
```

All six must succeed. Then run the smoke test from step 5.

### Step 7: Update documentation and academy coverage

Per the [maintenance triggers](README.md#maintenance-triggers), a changed route updates the [API reference](api-reference.md): add `continuity_streak` to the `GET /live` success row. Because the field is user-visible if the map later shows it, add one sentence to [features](features.md#network-map-map) only when the frontend uses it; for now the API reference is sufficient. Follow the [style standard](documentation-style.md).

Update learning coverage as part of the same contract change:

1. Add `api/src/server.js:app.get(\"/live\")` to `sourceEvidence` for `map-external` in `academy/data/concepts.json`.
2. Add a unique higher-order question to `academy/data/questions/integrations-notifications.json` that asks the learner to classify `continuity_streak` as public derived data, identify the extra per-flight query cost, and distinguish backward-compatible addition from exposing a private identifier. Include remediation and source references according to [academy schema](../academy/SCHEMA.md#question-object).
3. Update the expected question count in both `academy/test/validator.test.mjs` and `academy/test/server.test.mjs` from 252 to 253. These explicit assertions make an intentional bank-size change reviewable.
4. Run the academy validator and tests. Do not reduce a coverage threshold to make an incomplete question pass.

### Step 8: Review the diff

```bash
git status
git diff
```

Confirm exactly seven files changed: `api/src/server.js`, `web/src/types.ts`, `docs/api-reference.md`, `academy/data/concepts.json`, `academy/data/questions/integrations-notifications.json`, `academy/test/validator.test.mjs`, and `academy/test/server.test.mjs`. Confirm no `.env`, no `site/`, no stray debugging output, and no unrelated formatting changes. Read the diff as a reviewer would: is every line necessary?

### Step 9: Commit and prepare the pull request

```bash
git add api/src/server.js web/src/types.ts docs/api-reference.md \
  academy/data/concepts.json academy/data/questions/integrations-notifications.json \
  academy/test/validator.test.mjs academy/test/server.test.mjs
git commit -m "Add continuity streak to the public live flights payload"
```

Draft the pull request description using the template in [pull requests](#pull-requests):

- Summary: adds `continuity_streak` to each `/live` row so maps and the exporter can show streaks; one extra query per active flight.
- Classification: API; restart required; no build (type-only frontend change); no migration.
- Validation: the six commands with their output lines and the smoke test output.
- Documentation and learning coverage: `docs/api-reference.md`, `academy/data/concepts.json`, and the integrations question bank.
- Risks and rollback: up to 50 additional queries per `/live` call; rollback is an API source revert and restart.
- Not done: the map does not yet display the value.

If the owner wants the feature, push with `git push -u origin feature/live-continuity-streak` and open the pull request. Otherwise, discard the scratch branch: `git checkout release/airdash-platform-20260910 && git branch -D feature/live-continuity-streak`.

### What you practiced

Locating a feature by searching for its route and its module; tracing a public route and reasoning about visibility and compatibility; making a change that reuses existing, tested functions; keeping the frontend contract explicit; distinguishing what unit tests cover from what the smoke test covers; running the full validation; updating the reference documentation the change affects; reviewing your own diff; and writing a pull request that a reviewer can verify.
