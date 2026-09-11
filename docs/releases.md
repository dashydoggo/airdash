# Releases

This page defines what a release is in airDash, how a merged change becomes one, how releases are identified and recorded, and how they are reversed. airDash has no release automation, no artifact registry, and no version tags; a release is a deliberate, documented act by the owner on the production host.

## Definition

A release is the moment production begins running a specific commit of the release branch. For the frontend, that moment is when `vite build` rewrites `site/index.html`. For the API, it is when PM2 restarts `airdash-api`. A change that touches both has two such moments, API first.

## Versioning

The repository does not use Git tags or semantic version numbers for the platform. `api/package.json` and `web/package.json` both declare `"version": "0.1.0"` and have not been incremented; the field is nominal. Releases are identified by:

| Identifier | Where | Example |
|---|---|---|
| Release branch name | Git | `release/airdash-platform-20260910` |
| Commit hash | `git log --oneline -1` on the host | `5f2e27c` |
| Frontend bundle hashes | `site/index.html` | `index-Dg7CDhf-.js`, `index-BFsZchn3.css` |
| Release backup timestamp | `/opt/dashy-database/backups/airdash-release-<timestamp>/MANIFEST.txt`, which records the commit and the bundle names | `20260910T235900Z` |

The branch name encodes the date the branch was cut. A new release branch is created when the owner decides a set of changes constitutes a new platform release; day-to-day changes merge into the current release branch.

Simulator packages are versioned separately: the livery catalog records `version` per package (currently `1.0.1`), and the GSX package manifest records `package_version` `1.0.0`.

## Release procedure

Prerequisite: one or more pull requests merged into the release branch, each with its validation recorded.

1. On the production host, bring the working tree to the merged commit with the ["Get the code onto the host"](deployment.md#get-the-code-onto-the-host) procedure. `git status --porcelain` must be empty first; uncommitted host edits must be resolved, not overwritten.
2. If `package-lock.json` changed in either directory, run `npm --prefix api ci` and `npm --prefix web ci --include=dev`.
3. Run the validation on the host: `npm --prefix api run check`, both test scripts, `npm --prefix web run typecheck`, and the isolated build. The host's Node.js is the one production uses, so this is the final confirmation.
4. Create the [release backup](backup-and-recovery.md#release-backup) and, if any merged change contains a migration or a data statement, the [database backup](backup-and-recovery.md#database-backup).
5. Deploy each class of change with its [deployment procedure](deployment.md): API first, then frontend, then static files, then configuration.
6. Complete the [post-deployment verification](deployment.md#post-deployment-verification).
7. Record the release (below).

## Recording a release

There is no changelog file. The record of a release consists of the merged pull requests on GitHub, the commit on the release branch, and the release backup's `MANIFEST.txt`, which ties the commit to the deployed bundle names and the time. After each release, the owner should add a short comment to the merged pull request stating the deployment time and the health check result, so that the GitHub history shows when each change reached production. Announcements to pilots, when a release changes something they see, are published from the Administration Updates tab.

## Rollback

A rollback returns production to the previous release. Use the [frontend rollback](deployment.md#roll-back-the-frontend) or [API rollback](deployment.md#roll-back-the-api) procedure, then open a revert pull request so that the release branch matches what production runs. A migration is not reversed by a rollback; see the warning in the API rollback procedure.

## Release cadence and windows

There is no fixed cadence. Releases happen when the owner has validated changes and time to watch the result. Prefer times when no pilot has an `ACTIVE` assignment, because an API restart interrupts requests for a few seconds; check with `curl -fsS https://air.dashydoggo.com/api/live | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["flights"]))'`. A frontend-only release has no interruption and can happen at any time.

## Environments in the release path

Development on a contributor's machine, review on GitHub, and production on the host. There is no staging step; the host validation in step 3 and the isolated build are the last checks before production. See [known limitations](known-limitations.md#no-staging-environment-and-no-continuous-integration).
