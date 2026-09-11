# Installation

This page installs every tool needed to work on airDash, obtains the source code, installs dependencies, creates the environment file, and prepares a local PostgreSQL database. It covers macOS, Linux, and Windows. When you finish, the quick-start validation passes and the API can start against your local database. Running the application is covered in [local development](local-development.md).

Each procedure states its purpose, prerequisites, where each command runs, what the command does, what success looks like, and how to undo it. If a step fails, consult the "Common failures" section at the end of this page before continuing.

## Supported operating systems

| Operating system | Verified | Notes |
|---|---|---|
| Linux (Rocky Linux 10.1) | Yes, this is the production host | Commands were run on this system while writing this page. Debian and Ubuntu commands are given where they differ but were not run. |
| macOS | Not run while writing this page | Commands follow the official installer documentation for each tool. |
| Windows 10 and 11 | Not run while writing this page | Use PowerShell for Windows-specific commands. Bash examples in this documentation also work in Git Bash, which Git for Windows installs. |

Hardware requirements are modest. Any computer that can run a current web browser can run the API, the tests, and the frontend build. The frontend build needs about 500 MB of free disk for `node_modules/` across both directories and completes in under a minute on production hardware.

## Required software

| Tool | Verified version | Minimum | Required for |
|---|---|---|---|
| Node.js | 24.16.0 | 22.12.0 (or 20.19.0) | Everything. The frontend toolchain declares `^20.19.0 \|\| >=22.12.0` in `web/node_modules/vite/package.json`. |
| npm | 11.13.0 | The version bundled with your Node.js | Dependency installation and scripts. |
| Git | 2.52.0 | 2.x | Obtaining the source and contributing. |
| PostgreSQL | 16.14 | 16 | Running the API locally. Not required for the quick-start validation. |
| Docker | 29.3.0 | 24 | Optional. The simplest way to run PostgreSQL locally, and how production runs PostgreSQL, Nginx, and Caddy. |
| Python | 3.12.11 | 3.10 | Optional. Only for building simulator packages with `scripts/build-msfs2020-liveries.py`, which also needs the Pillow library. |
| PowerShell | 5.1 | 5.1 | Optional. Only for the Windows video automation in `scripts/`. |
| curl | Any | Any | Health checks and smoke tests. Preinstalled on macOS, most Linux distributions, and Windows 10 1803 and later. |

**Note:** The verified versions are the ones installed on the production host on September 10, 2026. Newer patch and minor versions within the same major version are expected to work. A different major version of Node.js has not been tested.

## Install Node.js and npm

Node.js is the JavaScript runtime that runs the API and the build tools. npm is its package manager and is installed with it.

### macOS

Prerequisite: administrator access to install software.

Option A, official installer: open `https://nodejs.org/`, download the installer labeled "24 LTS", open the `.pkg` file, and follow the prompts. The installer writes `node` and `npm` to `/usr/local/bin/`.

Option B, Homebrew, if you already use it:

```bash
brew install node@24
brew link --overwrite node@24
```

`brew install` downloads and installs the versioned formula. `brew link` places `node` and `npm` on your `PATH`; the `--overwrite` flag replaces any earlier links.

### Linux

On Rocky Linux, RHEL, Fedora, and other RPM-based systems, the production host uses the NodeSource repository:

```bash
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs
```

The first command downloads a script that registers the NodeSource package repository and runs it with administrator rights. Read the script before running it if your security policy requires that: download it with `curl -fsSL https://rpm.nodesource.com/setup_24.x -o setup_24.sh`, inspect it, then run `sudo bash setup_24.sh`. The second command installs the `nodejs` package, which includes npm.

On Debian and Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt-get install -y nodejs
```

### Windows

Open `https://nodejs.org/`, download the installer labeled "24 LTS" for Windows, run the `.msi` file, accept the defaults, and let it add Node.js to `PATH`. Do not enable the optional "Tools for Native Modules" checkbox; airDash has no native dependencies. Close and reopen PowerShell so the new `PATH` takes effect.

### Verify

Run from any directory:

```bash
node --version
npm --version
```

Expected: `v24.x.y` and `11.x.y` (or `10.x.y` with older Node.js 24 builds). A "command not found" error means the installer did not update `PATH`; sign out and back in, or reopen the terminal.

### Undo

macOS installer: run `sudo rm -rf /usr/local/bin/node /usr/local/bin/npm /usr/local/lib/node_modules`. Homebrew: `brew uninstall node@24`. Linux: `sudo dnf remove nodejs` or `sudo apt-get remove nodejs`. Windows: use "Add or remove programs".

## Install Git

Git is the source control tool.

### macOS

Run `git --version` in Terminal. If Git is missing, macOS offers to install the Xcode Command Line Tools, which include Git; accept. Alternatively `brew install git`.

### Linux

```bash
sudo dnf install -y git        # Rocky Linux, RHEL, Fedora
sudo apt-get install -y git    # Debian, Ubuntu
```

### Windows

Download Git for Windows from `https://git-scm.com/download/win` and run the installer. Accept the defaults, which install Git Bash and set line endings to "checkout Windows-style, commit Unix-style". The repository's `.gitattributes` file forces Unix line endings on commit for all text files regardless of this setting, so either choice is safe.

### Configure your identity

Git records an author on every commit. Run once, replacing the placeholders:

```bash
git config --global user.name "<your name>"
git config --global user.email "<your email>"
```

This writes to `~/.gitconfig`. Use the email associated with your GitHub account so that GitHub attributes commits to you.

### Verify

`git --version` prints `git version 2.x.y`.

## Obtain the source

Purpose: get a local copy of the repository with its full history.

Prerequisite: Git installed. For the SSH form of the clone URL, an SSH key registered with your GitHub account. For the HTTPS form, no key is required for a public repository.

Run from the directory where you keep projects, such as `~/projects`:

```bash
git clone git@github.com:dashydoggo/airdash.git
cd airdash
```

If you have no SSH key, use the HTTPS form instead: `git clone https://github.com/dashydoggo/airdash.git`. Either form creates a directory named `airdash` containing the working tree and the `.git` history directory, and sets the remote `origin`.

The clone checks out the repository's default branch, `release/airdash-platform-20260910`. Confirm with:

```bash
git branch --show-current
git log --oneline -3
```

**Note:** On the production host, the repository already exists at `/opt/dashy-database/projects/airdash` and must not be cloned again. All other paths in this documentation are relative to the repository root, whichever directory that is on your machine.

### Undo

Delete the `airdash` directory. Nothing outside it was changed.

## Install dependencies

Purpose: populate `api/node_modules/` and `web/node_modules/` with the exact packages recorded in the lock files.

Prerequisite: Node.js and npm installed; internet access to `registry.npmjs.org`.

Run from the repository root:

```bash
npm --prefix api ci
npm --prefix web ci
```

`--prefix <dir>` makes npm operate inside that directory. `ci` means "clean install": it deletes any existing `node_modules/`, reads `package-lock.json`, downloads each package over HTTPS, verifies its integrity hash, and writes `node_modules/`. It fails rather than silently changing the lock file if `package.json` and `package-lock.json` disagree.

Expected output, observed on Linux x86-64 with npm 11.13.0, ends with `added 96 packages, and audited 97 packages` for `api` and `added 15 packages, and audited 16 packages` for `web`, each followed by `found 0 vulnerabilities`. The web count is far below the 68 entries in its lock file because 32 of those entries are optional, platform-specific binary packages (for example the Rolldown and Emnapi builds for other operating systems) that npm skips on a platform that does not need them; the count therefore varies by platform and npm version. A line reporting vulnerabilities is informational; see [security](security.md#dependency-security) for how the project handles it.

Files written: `api/node_modules/`, `web/node_modules/`. Nothing else. Rerunning is safe. Undo by deleting the two `node_modules/` directories.

## Run the quick-start validation

Purpose: prove that the toolchain works before setting up a database.

Run from the repository root:

```bash
npm --prefix api run check
npm --prefix api run test:streaks
npm --prefix api run test:flight-outcomes
npm --prefix web run typecheck
```

| Command | What it runs | Expected output after the `> airdash-...` banner lines |
|---|---|---|
| `check` | `node --check` on each of the eleven API source files | Nothing. Exit code 0. |
| `test:streaks` | `node scripts/test-streaks.js` | `streak calculations verified` |
| `test:flight-outcomes` | `node scripts/test-flight-outcomes.js` | `flight outcomes, SimBrief metadata, landing rates, recovery ferries, and gate assignment verified` |
| `typecheck` | `tsc -b --pretty false` | Nothing. Exit code 0. |

You may also see `Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.` on the production host. It comes from the host's shell environment, not from airDash, and can be ignored.

None of these commands contact a database or a network service. They write only TypeScript build-information files under `web/` ending in `.tsbuildinfo`, which are ignored by Git.

## Create the environment file

Purpose: give the API its configuration. The API reads `api/.env` at startup through the `dotenv` package.

Prerequisite: none. This step does not require the database to exist yet.

Run from the repository root:

```bash
cp api/.env.example api/.env
chmod 600 api/.env
```

On Windows PowerShell:

```powershell
Copy-Item api\.env.example api\.env
```

`chmod 600` makes the file readable and writable only by you. Windows uses a different permission model; the file inherits your user profile's protections.

Open `api/.env` in an editor. Every line has the form `NAME=value`. The [configuration](configuration.md) page documents each variable in full. For a local installation, set these values:

```text
DATABASE_URL=postgresql://airdash:<local-password>@127.0.0.1:5432/airdash
AUTH_URL=http://127.0.0.1:39151/auth/me
OWNER_DISCORD_ID=<your-discord-user-id>
PORT=3006
SIMBRIEF_AIRFRAME=BCS3
VAPID_SUBJECT=http://localhost:5174
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

- `DATABASE_URL` must match the database you create in the next section. Replace `<local-password>` with the password you choose there.
- `AUTH_URL` points at the mock authentication service described in [local development](local-development.md#mock-authentication-service). Port `39151` is the port that page uses.
- `OWNER_DISCORD_ID` is the Discord user ID that the mock service will return if you want to act as the owner. Any 17 to 19 digit string works locally; using your real Discord ID lets you read production audit data by name later. It is not a secret.
- Leave both `VAPID_*` key lines empty unless you want to test Web Push. When they are empty the API logs `[airdash-push] VAPID keys are not configured; background push is disabled` and every push route returns `503`. To generate a key pair, run `npx --yes web-push@3.6.7 generate-vapid-keys` and paste the two values.

**Important:** `api/.env` is listed in `.gitignore` and must never be committed. On production it contains the real database credentials and VAPID private key. Do not copy the production file to another machine.

## Install PostgreSQL

Purpose: provide the database the API needs. Choose one of the two methods. Docker is the same on every operating system and matches production. Native installation avoids Docker but differs per platform.

### Method A: PostgreSQL 16 in Docker

Prerequisite: Docker installed. On macOS and Windows install Docker Desktop from `https://www.docker.com/products/docker-desktop/`. On Linux follow `https://docs.docker.com/engine/install/` for your distribution and add your user to the `docker` group so that `docker` runs without `sudo`.

Run from any directory:

```bash
docker run -d \
  --name airdash-postgres \
  --restart unless-stopped \
  -e POSTGRES_USER=airdash \
  -e POSTGRES_PASSWORD=<local-password> \
  -e POSTGRES_DB=airdash \
  -p 127.0.0.1:5432:5432 \
  -v airdash-pgdata:/var/lib/postgresql/data \
  postgres:16
```

Flag by flag: `-d` runs in the background; `--name` names the container; `--restart unless-stopped` restarts it after reboot unless you stopped it; the three `-e` flags set the database superuser name, its password, and the initial database name, all read by the image on first start; `-p 127.0.0.1:5432:5432` publishes the container's port 5432 on your machine's loopback address only, so other machines cannot reach it; `-v airdash-pgdata:...` stores data in a named volume that survives container removal; `postgres:16` is the official image at major version 16. The first run downloads about 150 MB.

**Note:** On the production host port 5432 is already used by `dashy-postgres`. Use a different host port there, for example `-p 127.0.0.1:55432:5432`, and put `55432` in `DATABASE_URL`. This exact configuration was used to validate this page: a fresh `postgres:16` container on port 55432 accepted the migration and produced 15 tables.

Wait for readiness, then verify:

```bash
docker exec airdash-postgres pg_isready -U airdash -d airdash
```

Expected: `/var/run/postgresql:5432 - accepting connections`. On the first start this can take up to twenty seconds.

Undo: `docker rm -f airdash-postgres` removes the container; `docker volume rm airdash-pgdata` removes the data.

### Method B: native PostgreSQL 16

macOS with Homebrew:

```bash
brew install postgresql@16
brew services start postgresql@16
/opt/homebrew/opt/postgresql@16/bin/createuser --pwprompt airdash
/opt/homebrew/opt/postgresql@16/bin/createdb --owner airdash airdash
```

Linux, Rocky Linux and RHEL:

```bash
sudo dnf install -y postgresql16-server postgresql16
sudo /usr/pgsql-16/bin/postgresql-16-setup initdb
sudo systemctl enable --now postgresql-16
sudo -u postgres createuser --pwprompt airdash
sudo -u postgres createdb --owner airdash airdash
```

Linux, Debian and Ubuntu:

```bash
sudo apt-get install -y postgresql-16
sudo -u postgres createuser --pwprompt airdash
sudo -u postgres createdb --owner airdash airdash
```

Windows: download the PostgreSQL 16 installer from `https://www.enterprisedb.com/downloads/postgres-postgresql-downloads`, run it, and note the superuser password you choose. Then open "SQL Shell (psql)" from the Start menu and run:

```sql
CREATE USER airdash WITH PASSWORD '<local-password>';
CREATE DATABASE airdash OWNER airdash;
```

`createuser --pwprompt` asks for the new role's password interactively. `createdb --owner airdash airdash` creates a database named `airdash` owned by that role, which gives the role permission to create the `airdash` schema inside it.

### Verify the connection string

Whichever method you chose, confirm that the `DATABASE_URL` in `api/.env` works. The `psql` client is installed with native PostgreSQL; with Docker, run it inside the container:

```bash
psql "postgresql://airdash:<local-password>@127.0.0.1:5432/airdash" -Atc "SELECT version();"
```

or

```bash
docker exec airdash-postgres psql -U airdash -d airdash -Atc "SELECT version();"
```

Expected: a line beginning `PostgreSQL 16.`.

## Create the schema

Purpose: create the `airdash` schema, its fifteen tables, indexes, and seed data in the new database.

Prerequisite: `api/.env` complete, database reachable.

Run from the repository root:

```bash
npm --prefix api run migrate
```

This runs `node scripts/migrate.js`, which loads `api/.env`, calls the same `migrate()` function the API calls at startup, prints `airDash database migration complete`, and exits. It creates the schema and tables, adds every column and constraint introduced since the first release, seeds four bases, twenty-one aircraft, one hundred and two routes, and the `operations` settings row. Rerunning it is safe; every statement is guarded so that a second run changes nothing.

Verify:

```bash
psql "postgresql://airdash:<local-password>@127.0.0.1:5432/airdash" -Atc \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='airdash';"
```

Expected: `15`.

Undo: `DROP SCHEMA airdash CASCADE;` removes everything the migration created. On a local database this is safe. Never run it against production.

## Optional: Python and Pillow for livery packaging

Only needed to run `scripts/build-msfs2020-liveries.py`, which converts MSFS 2024 livery archives into MSFS 2020 packages. Python 3.12 is present on the production host. Install Pillow, the image library the script imports, into a virtual environment so that it does not affect system Python:

```bash
python3 -m venv .venv
source .venv/bin/activate      # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install "Pillow==11.3.0"
```

The `.venv/` directory is ignored by Git. The [repository guide](repository-guide.md#scripts) explains the script's arguments.

## Optional: production-only tools

PM2, Caddy, and the Nginx container are not needed for development. They are documented in [architecture](architecture.md#production-runtime-topology) and [operations](operations.md) for the production host.

## Final state

After this page:

- `node`, `npm`, and `git` are on your `PATH` at the verified or newer versions.
- The repository is cloned and on branch `release/airdash-platform-20260910`.
- `api/node_modules/` and `web/node_modules/` exist.
- The quick-start validation passes.
- `api/.env` exists, is not tracked by Git, and points at a local PostgreSQL 16 database that contains the `airdash` schema with fifteen tables.

Continue to [local development](local-development.md) to start the API and the frontend.

## Common failures

| Symptom | Cause | Action |
|---|---|---|
| `node: command not found` or `'node' is not recognized` | `PATH` not updated after install | Reopen the terminal; on Windows sign out and back in. |
| `npm ERR! code EBADENGINE` mentioning `vite` | Node.js older than 20.19 or 22.12 | Install Node.js 24. |
| `npm ci` reports `package.json and package-lock.json are not in sync` | The manifest was edited without regenerating the lock file | Do not run `npm install` to "fix" it unless you intend to change dependencies; check out the committed files with `git checkout -- api/package.json api/package-lock.json`. |
| `npm ci` fails with `ENOTFOUND registry.npmjs.org` | No internet access or a proxy | Check connectivity; configure `npm config set proxy` if your network requires it. |
| `Permission denied (publickey)` during `git clone` | No SSH key registered with GitHub | Use the HTTPS clone URL, or add a key following GitHub's documentation. |
| `docker: permission denied while trying to connect to the Docker daemon socket` | Your user is not in the `docker` group | `sudo usermod -aG docker $USER`, then sign out and back in. |
| `Bind for 127.0.0.1:5432 failed: port is already allocated` | Another PostgreSQL is listening on 5432 | Publish a different host port such as `55432` and update `DATABASE_URL`. |
| `migrate` prints `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL not running or wrong port | `docker ps` or `systemctl status postgresql-16`; check `DATABASE_URL`. |
| `migrate` prints `password authentication failed for user "airdash"` | Wrong password in `DATABASE_URL` | Correct `api/.env`; the password is the one given to `POSTGRES_PASSWORD` or `createuser`. |
| `migrate` prints `permission denied for database airdash` | The role does not own the database | Recreate the database with `--owner airdash`, or grant `CREATE` on it. |
| `Warning: The 'NO_COLOR' env is ignored` | Host shell sets both `NO_COLOR` and `FORCE_COLOR` | Harmless. Unset one of them in your shell profile if it bothers you. |
