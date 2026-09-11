# Foundations

This page teaches the concepts a reader must understand before the rest of the documentation makes sense. Each section defines its terms, explains the mechanism, and then shows where airDash uses it, with the real file and the real code. Read the sections in order the first time. Experienced readers can skip to the section they need; each one stands alone.

The examples on this page are copied from the repository at commit `5f2e27c` unless a note says otherwise. Where an example is simplified, the note says what was removed.

## Computer and operating system foundations

### Files, directories, and paths

A file is a named sequence of bytes stored on disk. A directory is a container that holds files and other directories. Together they form a tree whose top is called the root directory. On macOS and Linux the root is written `/`. On Windows each drive has its own root, written `C:\`.

A path is the address of a file or directory in that tree. An absolute path starts at the root and is unambiguous, such as `/opt/dashy-database/projects/airdash/api/src/server.js`. A relative path starts from the current working directory and is shorter but depends on where you are, such as `api/src/server.js`. Two relative path components have special meaning: `.` is the current directory and `..` is the parent directory. The Vite configuration in `web/vite.config.ts` uses `..` to place build output one level above `web/`:

```ts
outDir: path.resolve(__dirname, "../site"),
```

`__dirname` is the absolute path of the directory containing `vite.config.ts`, which is `web/`. `path.resolve` joins it with `../site` to produce the absolute path of `site/`. The result is that the frontend build writes to `site/`, which is a sibling of `web/`, not a child.

Your home directory is the directory assigned to your user account, written `~` in a shell. On Linux it is normally `/home/<user>`, on macOS `/Users/<user>`, and on Windows `C:\Users\<user>`. PM2, the process manager used in production, stores its state under the home directory of the `dashy` user at `/home/dashy/.pm2/`.

The working directory is the directory a program considers "here" when it resolves relative paths. Every command in this documentation states its working directory because the same command can succeed or fail depending on it. The API reads its configuration from a file named `.env` in the working directory, so it must be started from `api/`. The `ecosystem.config.js` file makes this explicit:

```js
cwd: "/opt/dashy-database/projects/airdash/api",
```

A file extension is the part of a file name after the last period. It is a convention that tells humans and tools what the file contains. In airDash, `.js` files are JavaScript, `.ts` files are TypeScript, `.tsx` files are TypeScript containing JSX markup, `.json` files are JavaScript Object Notation data, `.md` files are Markdown documentation, `.ps1` files are PowerShell scripts, `.py` files are Python, and `.env` files are environment variable definitions.

### File permissions and executable files

On macOS and Linux, every file records who may read it, write it, and execute it, for three categories: the owning user, the owning group, and everyone else. The `ls -l` command shows these as a string such as `-rw-r--r--`, which means the owner may read and write, and the group and others may only read. The numeric form `644` encodes the same thing.

Permissions matter to airDash in two places. First, the Nginx container reads `site/` as a different user than the one that wrote it, so the frontend build ends with a `postbuild` script that sets every directory to `755` and every file to `644`:

```json
"postbuild": "find ../site -type d -exec chmod 755 {} + && find ../site -type f -exec chmod 644 {} +"
```

Second, `api/.env` contains database credentials and must be readable only by the service user. The documented command is `chmod 600 api/.env`.

An executable file is one the operating system will run as a program. Scripts such as `api/src/server.js` are not executed directly; a runtime is executed and given the script as an argument, which is why commands read `node src/server.js`. Windows does not use the execute permission bit; it decides by extension and by the PowerShell execution policy.

### Processes, services, and signals

A process is a running program. Each process has a numeric process ID (PID), a working directory, a set of environment variables, and three standard streams. The airDash API is one process, started by `node src/server.js`. When you run the Vite development server, that is another process.

A service is a process that is expected to run continuously without a user watching it, and that is restarted automatically when it fails or when the machine reboots. In airDash, PM2 turns the API process into a service, and a systemd unit named `pm2-dashy.service` turns PM2 itself into a service that starts at boot. The [operations](operations.md) page explains both.

A signal is a message the operating system sends to a process. `SIGTERM` asks a process to stop; `SIGINT` is what pressing Ctrl+C sends. The API handles both at the bottom of `api/src/server.js`:

```js
const shutdown = async () => { stopPushWorker(); server.close(); await pool.end(); process.exit(0) }
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
```

Reading left to right: stop the Web Push polling timer, stop accepting new HTTP connections, close every database connection, and exit with status code zero. This is a graceful shutdown; in-flight database queries complete before the process ends.

### Standard input, output, and error, and exit codes

Every process has three standard streams. Standard input (stdin) is where it reads typed or piped data. Standard output (stdout) is where it writes normal results. Standard error (stderr) is where it writes diagnostics. Separating stdout from stderr lets you save results to a file while still seeing errors on screen.

An exit code is a number a process returns when it ends. By convention `0` means success and any other value means failure. Shells and tools use exit codes to decide whether to continue. The `check` script in `api/package.json` chains eleven `node --check` commands with `&&`, which runs each only if the previous one exited `0`:

```json
"check": "node --check src/server.js && node --check src/database.js && ..."
```

If any file has a syntax error, `node --check` exits non-zero, the chain stops, and `npm run check` itself exits non-zero.

### Network ports and localhost

A network port is a number from 1 to 65535 that identifies one program among many on the same machine for network purposes. A program that waits for connections on a port is said to listen on it. Only one program can listen on a given port and address at a time.

`localhost` is the name for your own machine, and `127.0.0.1` is its numeric address. Traffic to `localhost` never leaves the computer. airDash uses these ports:

| Port | Listener | Purpose |
|---|---|---|
| 3006 | airDash API | Express HTTP server. Set by the `PORT` variable. |
| 3002 | dashydoggo.com authentication service | Resolves the Discord session cookie. The default `AUTH_URL` points here. |
| 5174 | Vite development server | Serves the frontend during development and proxies `/api` to 3006. |
| 5432 | PostgreSQL | Database. The Docker container publishes it on the host. |
| 80 and 443 | Caddy | Public HTTP and HTTPS. |

The API listens on `0.0.0.0`, which means "every address this machine has", so that Caddy running in a container can reach it through the Docker bridge address. The `app.listen` call at the bottom of `api/src/server.js` shows this.

### Environment variables

An environment variable is a named value that the operating system passes to a process when it starts. Programs read them to learn configuration without hard-coding it. They are the standard way to give a program a secret such as a database password, because they are not written into the source code.

The API reads its variables through `process.env`. The first line of `api/src/auth.js` shows the pattern with a default value:

```js
const AUTH_URL = process.env.AUTH_URL ?? "http://127.0.0.1:3002/auth/me"
```

`??` is the nullish coalescing operator: it returns the left side unless that value is `null` or `undefined`, in which case it returns the right side. So `AUTH_URL` is whatever the environment provides, or the default when nothing is provided.

Because typing variables by hand before every start is error-prone, the API loads them from a file. The first line of `api/src/server.js` is `import "dotenv/config"`, which reads `.env` in the working directory and copies each `NAME=value` line into `process.env` before any other code runs. Variables already present in the environment win over the file. The [configuration](configuration.md) page lists every variable.

### Shells, commands, quoting, pipes, and redirection

A shell is a program that reads commands you type and runs them. On macOS and Linux the default shell is `zsh` or `bash`, opened through the Terminal application. On Windows the shells are PowerShell and Command Prompt; this documentation uses PowerShell for Windows commands. The Bash examples in this documentation also work in Git Bash on Windows, which is installed with Git for Windows.

A command has a program name followed by arguments separated by spaces. Arguments that start with `-` or `--` are called flags or options. In `npm --prefix web run typecheck`, the program is `npm`, `--prefix web` is an option with a value meaning "operate inside the `web` directory", and `run typecheck` are positional arguments meaning "run the script named `typecheck`".

Quoting controls how the shell splits a command into arguments. Without quotes, spaces separate arguments. Single quotes preserve every character literally. Double quotes preserve spaces but still expand `$variables`. The release backup procedure in [backup and recovery](backup-and-recovery.md) uses double quotes so that a variable expands while spaces stay grouped:

```bash
backup="/opt/dashy-database/backups/airdash-release-$timestamp"
```

A pipe, written `|`, connects the stdout of one command to the stdin of the next. Redirection, written `>`, sends stdout to a file instead of the screen, and `2>&1` sends stderr to the same place as stdout. The smoke test in [testing](testing.md) uses both:

```bash
PORT=39150 node src/server.js > /tmp/airdash-smoke.log 2>&1 &
```

Reading left to right: set the `PORT` variable for this one command, run the API, send its stdout to a log file, send its stderr to the same file, and (`&`) run it in the background so the shell prompt returns.

A subshell, written with parentheses, runs commands in a copy of the shell so that a `cd` inside it does not change your directory afterward. The isolated build uses this: `( cd web && npm exec vite -- build --outDir "$out" --emptyOutDir )`.

### Verification

Open a terminal, run `pwd` (macOS and Linux) or `Get-Location` (PowerShell) to print the working directory, run `echo $HOME` or `$env:USERPROFILE` to print your home directory, and run `node --version`. If the last command prints a version, you have a working runtime and shell.

## Source control foundations

### What source control is and what Git is

Source control is the practice of recording every change to a set of files so that you can see what changed, when, by whom, and why, and so that you can return to any earlier state. Git is the source control program that airDash uses. Git stores the history inside a hidden directory named `.git` at the top of the repository.

GitHub is a hosting service that stores a copy of a Git repository on the internet and adds features Git alone does not have: a web interface, issues, pull requests with code review, and access control. airDash's GitHub copy is `https://github.com/dashydoggo/airdash`, and it is public.

### Repository, working tree, staging area, and commit

A repository is the `.git` directory plus the files it tracks. The working tree is the set of files you can see and edit. The staging area, also called the index, is a list of changes you have marked for inclusion in the next commit. A commit is a permanent snapshot of the staged changes with a message, an author, and a timestamp, identified by a hash such as `5f2e27c`.

The typical cycle is: edit files in the working tree, stage the ones you want with `git add <path>`, and record them with `git commit -m "<message>"`. Staging specific paths rather than everything with `git add .` avoids committing files by accident. `git status` shows which files are modified, staged, or untracked at any moment.

The `.gitignore` file lists patterns Git should never track. airDash ignores `node_modules/`, `.env` files, `site/`, and generated ZIP archives, because they are either restorable from other sources or contain secrets.

### Branches, remotes, fetch, pull, and push

A branch is a movable name that points to a commit. Creating a branch lets you make commits without affecting the branch you started from. airDash's integration branch is `release/airdash-platform-20260910`. Documentation changes for this release were made on `docs/technical-reference-and-curriculum`.

A remote is a named reference to another copy of the repository. The default remote is called `origin`; in airDash it is `git@github.com:dashydoggo/airdash.git`. `git fetch` downloads new commits from a remote without changing your files. `git pull` fetches and then merges the remote branch into your current branch. `git push` uploads your commits to the remote. The first push of a new branch uses `git push -u origin <branch>` so that Git remembers the pairing.

### Merge conflicts

A merge conflict happens when two branches changed the same lines and Git cannot decide which version to keep. Git marks the conflicting region in the file with `<<<<<<<`, `=======`, and `>>>>>>>` lines. You resolve it by editing the file to the correct final content, removing the markers, staging the file, and committing. Because `web/src/App.tsx` is one large file, it is the most likely place for a conflict in airDash; keeping changes small reduces the risk.

### Pull requests, code review, and branch protection

A pull request is a GitHub request to merge one branch into another. It shows the complete difference, lets reviewers comment, and records the discussion. Code review is the practice of a second person reading the change before it merges. Branch protection is a GitHub setting that blocks direct pushes or requires review on a branch. As of this writing the airDash integration branch has no protection rules, so the [contributing](contributing.md) page describes the expected practice rather than an enforced one: never push directly to `release/*`; open a pull request.

### Safe recovery from common mistakes

| Mistake | Safe recovery |
|---|---|
| Edited the wrong file, not yet staged | `git restore <path>` discards the working tree change. |
| Staged a file by accident | `git restore --staged <path>` unstages it and keeps the edit. |
| Committed with a wrong message, not yet pushed | `git commit --amend` rewrites only the last commit. Do not amend after pushing. |
| Committed to the wrong branch, not yet pushed | `git branch <new-name>` to save the work, `git reset --hard origin/<branch>` to move the wrong branch back, then check out the new branch. |
| Need to see what a command would do | `git diff` before staging, `git diff --staged` after staging, `git log --oneline -10` to see recent commits. |

**Warning:** `git reset --hard`, `git push --force`, `git clean -f`, and `git branch -D` destroy work that is not saved elsewhere. Do not run them without understanding exactly what they will discard.

### Verification

In the repository root, run `git status`, `git branch --show-current`, and `git log --oneline -5`. You should see a clean tree, your branch name, and the recent commits.

## Language and runtime foundations

airDash uses JavaScript for the API and TypeScript for the frontend. TypeScript is JavaScript plus a type system; it is converted to JavaScript before it runs. This section teaches enough of both to read the project's source, using the project's own files.

### Values, types, variables, and constants

A value is a piece of data. JavaScript's basic types are strings (text in quotes), numbers, booleans (`true` or `false`), `null` (deliberately empty), `undefined` (never set), objects (collections of named values), and arrays (ordered lists). A variable is a named container for a value. `const` declares a name that cannot be reassigned; `let` declares one that can. airDash uses `const` almost everywhere.

The second line of `api/src/auth.js` declares a constant and exports it so other files can import it:

```js
export const OWNER_ID = process.env.OWNER_DISCORD_ID ?? "860900952097030184"
```

The value is a string. The default is the owner's Discord user identifier, which is public information used to identify an account and is not a secret.

### Functions, parameters, and return values

A function is a named block of code that accepts inputs, called parameters, and produces an output, called the return value. The `clean` helper near the top of `api/src/server.js` is an arrow function, which is a compact way to write a function:

```js
const clean = (value, maximum = 500) => typeof value === "string" ? value.trim().slice(0, maximum) : ""
```

Reading this line: `clean` takes two parameters, `value` and `maximum`, and `maximum` defaults to `500` when not supplied. The arrow `=>` separates parameters from the body. The body is a conditional expression: if `value` is a string, return it with surrounding whitespace removed and cut to at most `maximum` characters; otherwise return an empty string. This one function is how every text field from a request is sanitized before use. The `.trim()` and `.slice()` calls are methods, which are functions attached to a value; the period selects them.

### Objects, arrays, and destructuring

An object groups values under names. In `api/src/server.js`, the route handler for `/health` builds one:

```js
res.json({ ok: true, database: true })
```

The braces create an object with two properties, `ok` and `database`. This object becomes the JSON body of the response.

An array is an ordered list written with square brackets. `notificationGroups` in `api/src/notifications.js` is an array of strings. Destructuring unpacks an object or array into variables in one statement. The `/me` handler's helper `loadAccount` uses array destructuring to receive three query results at once:

```js
const [application, pilot, assignment] = await Promise.all([ ... ])
```

### Control flow

Control flow is the order in which statements run. `if` runs a block when a condition is true. `for ... of` repeats a block for each element of a collection. `return` ends a function and supplies its value. The `expireAssignments` function in `api/src/server.js` uses a loop to release each aircraft whose assignment expired:

```js
for (const row of expired) {
  await client.query("UPDATE airdash.aircraft SET status='AVAILABLE' WHERE registration=$1 AND status='ASSIGNED'", [row.registration])
}
```

Early returns are common in route handlers. This pattern from `/profile` validates and exits before doing work:

```js
if (!displayName) return res.status(400).json({ error: "Enter a pilot display name" })
```

The `!` operator means "not". An empty string is treated as false, so `!displayName` is true when the name is missing.

### Modules, imports, and exports

A module is one file whose top-level names are private unless exported. `export` makes a name available; `import` brings it in from another file. The API uses ECMAScript modules, enabled by `"type": "module"` in `api/package.json`. The top of `api/src/server.js` imports from the project's own modules and from installed packages:

```js
import express from "express"
import { audit, migrate, pool, publishOrgUpdate } from "./database.js"
```

A path starting with `./` is a relative import of a project file, and the `.js` extension is required in Node.js ECMAScript modules. A bare name such as `express` is resolved from `node_modules/`. In the TypeScript frontend, extensions are omitted: `import { api, post, remove } from "./api"`.

### Asynchronous behavior: promises and async/await

Some operations take time: querying a database, calling another server, reading a file. JavaScript does not stop the whole program while waiting. Instead the operation returns a promise, an object that will hold the result later. `await` pauses only the current function until the promise settles, and a function that uses `await` must be marked `async`.

The `authenticatedUser` function in `api/src/auth.js` shows the full pattern including error handling:

```js
export async function authenticatedUser(cookie) {
  if (!cookie) return null
  try {
    const response = await fetch(AUTH_URL, {
      headers: { cookie },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null
    const body = await response.json()
    return body.user?.id ? body.user : null
  } catch {
    return null
  }
}
```

Line by line: if no cookie was sent, the caller is anonymous. Otherwise send an HTTP request to the authentication service, forwarding the cookie, and give up after five seconds. If the service responds with a non-success status, treat the user as anonymous. Parse the JSON body. If it contains a user with an `id`, return that user; otherwise return `null`. If anything throws, including a timeout or a network failure, also return `null`. The `?.` operator is optional chaining: `body.user?.id` is `undefined` rather than an error when `body.user` is missing. This function fails closed, which means every failure results in "not authenticated" rather than accidental access.

`Promise.all` runs several promises at once and waits for all of them. The API uses it to issue independent database queries in parallel, as in the `/public` handler.

### Error handling

`try` runs a block; `catch` runs when the block throws an error; `finally` runs afterward either way. Route handlers that perform multi-step database changes use this to guarantee cleanup. The `/assignments/:id/cancel` handler ends with:

```js
} catch (error) {
  await client.query("ROLLBACK")
  res.status(error.status ?? 500).json({ error: error.status ? error.message : "Flight could not be cancelled" })
} finally { client.release() }
```

The API attaches an HTTP status to errors it creates deliberately, using `Object.assign(new Error("..."), { status: 404 })`. When the error has a status, its message is safe to show the user. When it does not, the error was unexpected, and a generic message is returned so that internal details are not leaked.

### Template strings and string formatting

A template string uses backticks and embeds expressions with `${}`. The pilot number is formatted in the application approval handler:

```js
const pilotNumber = `AD${String(number.rows[0].number).padStart(4, "0")}`
```

`padStart(4, "0")` pads the sequence value to four digits, so sequence value `7` becomes `AD0007`.

### TypeScript: types, interfaces, and generics

TypeScript adds type annotations that describe what kind of value a variable, parameter, or return holds. The compiler checks them and reports mismatches before the code runs. Annotations are written after a colon. The frontend API client in `web/src/api.ts` demonstrates the essentials:

```ts
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(body.error ?? "Request failed", response.status)
  return body as T
}
```

Line by line: `ApiError` is a class, a template for objects, that extends the built-in `Error` and adds a numeric `status`. The `public` keyword in the constructor both declares the property and assigns it. `api<T>` is a generic function: `T` is a placeholder for whatever response type the caller expects, so `api<MeResponse>("/me")` returns a promise of `MeResponse`. `path: string` says the argument must be a string. `options: RequestInit = {}` types the second parameter and defaults it to an empty object. `Promise<T>` is the return type. Inside, `fetch` sends the request to `/api` plus the path. `credentials: "include"` sends the browser's cookies, which is how the Discord session reaches the API. The `...` spread operator copies properties from one object into another; here it merges caller options over defaults. A `Content-Type` header is added only when a body is present. If the response status is not success, an `ApiError` is thrown with the server's message. Otherwise the body is returned, and `as T` tells the compiler to trust that it matches the expected type.

An interface names the shape of an object. `web/src/types.ts` defines one for every API response the frontend reads, such as:

```ts
export interface Base { code: string; name: string; lat: number; lon: number; role: string; is_active?: boolean; sort_order?: number; pilot_count?: number }
```

A question mark after a property name means the property is optional. When the API adds a field, the interface must gain it, or the compiler reports `Property 'x' does not exist on type 'Y'` where the frontend uses it. This is the intended safety net.

### JSX

JSX is the HTML-like syntax inside `.tsx` files. It is converted to function calls that build the page. Three rules cover most edits. Text between tags is literal. Braces switch to a JavaScript expression, so `<span>{me.pilot.pilot_number}</span>` renders the value. Attributes on components are called props. `web/src/main.tsx` mounts the application:

```tsx
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

`document.getElementById("root")` finds the `<div id="root">` in `web/index.html`. The `!` after it tells TypeScript the element is not null. `BrowserRouter` enables client-side routing. `App` is the component in `web/src/App.tsx` that contains everything else.

### Compilation, interpretation, and runtime execution

Node.js reads JavaScript source and runs it directly; no separate build step exists for the API. The frontend is different: browsers do not run TypeScript or JSX, so `npm run build` in `web/` first runs `tsc -b` to type-check and then `vite build` to convert every `.ts` and `.tsx` file into a small number of plain JavaScript and CSS files under `site/app-assets/`. The output file names include a hash of their contents, such as `index-Dg7CDhf-.js`, so that a changed build has a new name and browsers do not reuse a stale copy.

Memory in both environments is managed automatically by a garbage collector. The one resource airDash manages explicitly is database connections: the `pg` pool lends a connection with `pool.connect()` and the code must return it with `client.release()`, which is why every transaction ends in `finally { client.release() }`.

### Verification

Open `api/src/auth.js` and `web/src/api.ts` in an editor and explain each line aloud or in writing. Then run `npm --prefix web run typecheck`. Introduce a deliberate mistake, such as renaming `status` to `statuz` in `web/src/api.ts`, rerun the type check, read the error, and revert the change with `git restore web/src/api.ts`.

## Dependency foundations

### What a dependency is

A dependency is code written by someone else that your program needs. A direct dependency is one your code imports. A transitive dependency is one a direct dependency imports. airDash's API has four direct dependencies and 96 packages in total once transitive dependencies are counted. The frontend has seven direct runtime dependencies, six development dependencies, and 68 entries in its lock file, of which 32 are optional platform-specific packages that are installed only on the matching operating system and processor.

Development dependencies are needed to build or test but not to run. `typescript`, `vite`, and the `@types/*` packages are development dependencies of the frontend because the browser receives only the compiled output. The API has no development dependencies; its tests use only Node.js built-in modules.

### Package manifests and lock files

`package.json` is the package manifest. It names the project, lists direct dependencies with version constraints, and defines the `scripts` that `npm run` executes. airDash pins exact versions rather than ranges:

```json
"dependencies": {
  "dotenv": "17.4.2",
  "express": "5.2.1",
  "pg": "8.21.0",
  "web-push": "3.6.7"
}
```

`package-lock.json` is the lock file. It records the exact version and integrity hash of every package in the tree, including transitive ones, so that two installations produce identical `node_modules/` directories. Both directories use lock file version 3.

### Semantic versioning

Most JavaScript packages use semantic versioning, written `major.minor.patch`. A patch change fixes bugs, a minor change adds features without breaking existing ones, and a major change may break compatibility. A range such as `^8.21.0` would allow any `8.x.y` at or above `8.21.0`. airDash avoids ranges in its manifests so that the manifest and the lock file agree on the exact version, which makes reviews of version changes explicit.

### Installing dependencies

`npm ci` installs exactly what the lock file records and fails if the manifest and lock file disagree. `npm install` may update the lock file. airDash documentation always uses `npm ci` for installation so that every machine gets the same tree:

```bash
npm --prefix api ci
npm --prefix web ci
```

Each command reads `<prefix>/package-lock.json`, downloads the packages from the npm registry over HTTPS, verifies each package against its recorded hash, and writes `<prefix>/node_modules/`. Rerunning it is safe and idempotent.

### Updating a dependency

To update a package, change the version in `package.json`, run `npm install` in that directory so the lock file is regenerated, run the full validation described in [testing](testing.md), and commit both files together. Never edit `package-lock.json` by hand.

### Supply-chain risk

Installing a package runs code from the internet. Risks include a compromised package, a name that imitates a popular one (typosquatting), and a malicious update. airDash reduces exposure by having few dependencies, pinning exact versions, verifying integrity hashes through the lock file, and requiring review of any version change. Before adding a dependency, confirm its name exactly, check that it is actively maintained, and document why it is needed.

### Verification

Run `node -e "console.log(require('./api/node_modules/express/package.json').version)"` from the repository root. It prints `5.2.1`, the installed version, which should match `api/package.json`.

## Web and API foundations

### Clients, servers, addresses, and names

A client is a program that sends requests; a server is a program that answers them. Your browser is a client. The airDash API is a server. An Internet Protocol (IP) address such as `172.17.0.1` identifies a machine on a network. A domain name such as `air.dashydoggo.com` is a human-readable name that the Domain Name System (DNS) translates to an IP address.

Transmission Control Protocol (TCP) is the connection-oriented transport that delivers bytes reliably and in order between two ports. Transport Layer Security (TLS) encrypts a TCP connection so that no one between the client and server can read or alter it. HTTPS is HTTP carried over TLS. In airDash, Caddy terminates TLS: it holds the certificate for `air.dashydoggo.com`, decrypts incoming traffic, and forwards plain HTTP to Nginx or the API inside the private network.

### HTTP requests and responses

Hypertext Transfer Protocol (HTTP) is the language of the web. A request has a method, a path, headers, and optionally a body. A response has a status code, headers, and optionally a body.

The methods airDash uses are `GET` (read something, no side effects), `POST` (create or perform an action), and `DELETE` (remove something). Headers are name-value pairs carrying metadata. The ones that matter here are `Cookie` (the browser's stored credentials), `Origin` (the site the request came from), `Content-Type` (the format of the body), and `Cache-Control` (how long a response may be reused).

Status codes are three-digit numbers. airDash uses `200` (success), `201` (created), `302` (redirect, used by the anonymous livery download), `400` (the request was invalid), `401` (sign in required), `403` (signed in but not allowed), `404` (not found), `409` (conflict with current state, such as an aircraft that is no longer available), `413` (a remote response was too large), `500` (unexpected server error), `502` (a remote service failed), and `503` (a required service, such as the database or Web Push configuration, is unavailable).

### JSON

JavaScript Object Notation (JSON) is a text format for structured data. `{"ok":true,"database":true}` is a JSON object with two boolean properties. Every airDash API response body is JSON, and every request body is JSON. The line `app.use(express.json({ limit: "2mb" }))` in `api/src/server.js` tells Express to parse JSON bodies and to reject any larger than two megabytes.

### Cookies and sessions

A cookie is a small value the server asks the browser to store and send back on later requests to the same site. A session is server-side state, identified by a cookie, that remembers who is signed in. airDash does not create sessions. It reuses the session created by the dashydoggo.com login service: the browser sends the dashydoggo.com session cookie to `air.dashydoggo.com` because both are under the same parent domain, and the API forwards that cookie to the authentication service to learn who the user is. This is the mechanism in `authenticatedUser`, shown earlier.

### Cross-origin behavior

An origin is the combination of scheme, host, and port, such as `https://air.dashydoggo.com`. Browsers restrict how a page from one origin may interact with another origin, and they attach an `Origin` header to cross-origin requests and to all `POST` requests. airDash uses this header as a defense: the `requireAirDashOrigin` middleware in `api/src/auth.js` rejects any non-read request whose `Origin` is not `https://air.dashydoggo.com` or `http://localhost:5174`. This blocks cross-site request forgery, which is an attack where another website causes your browser to send an authenticated request without your intent. The check does not replace authentication; it is applied before it.

### The airDash request lifecycle

When a signed-in pilot opens the Hangar, the browser requests `/api/me`. The following happens in order:

1. The browser sends `GET https://air.dashydoggo.com/api/me` with the session cookie.
2. Caddy decrypts the connection, matches the `/api/*` handler, removes the `/api` prefix, and forwards `GET /me` to the API on port 3006.
3. Express applies the global middleware in `api/src/server.js`: it parses a JSON body if present, sets security headers, and runs `requireAirDashOrigin`, which allows `GET` through without an origin check.
4. Express matches the route `app.get("/me", requireUser, ...)` and runs `requireUser`, which calls the authentication service. On failure it responds `401`.
5. The handler runs `expireAssignments()`, upserts the user row, loads the account with several parallel queries, and responds with JSON.
6. Caddy re-encrypts the response and returns it to the browser.
7. `web/src/api.ts` parses the body and either returns it or throws `ApiError`.

The [architecture](architecture.md#request-lifecycle) page shows the same lifecycle in diagram form.

### Authentication and authorization

Authentication answers "who is this?"; authorization answers "what may they do?". In airDash, authentication is `authenticatedUser`, and authorization is the pair of middleware functions `requireUser` and `requireOwner` plus per-handler checks such as "an approved pilot account is required". The [security](security.md) page is the canonical description.

### Pagination, idempotency, and rate limiting

Pagination returns a large list in pages. airDash paginates `/news` and `/org-updates` with `limit` and `offset` query parameters and returns `total` so the client can compute remaining pages.

An operation is idempotent when repeating it has the same effect as doing it once. `GET` routes are idempotent by design. Several `POST` routes are made idempotent deliberately: `POST /assignments` returns the existing booking with `existing: true` instead of creating a duplicate, and the migration function can run any number of times.

Rate limiting restricts how many requests a client may make. The airDash API has no request rate limiting. It relies on Caddy, on the small user base, and on size and timeout limits for outbound calls. This is recorded in [known limitations](known-limitations.md).

### Verification

Run `curl -i https://air.dashydoggo.com/api/health`. The `-i` flag prints the response headers. You should see `HTTP/2 200`, the security headers set by the API, and the JSON body. Then run `curl -i -X POST https://air.dashydoggo.com/api/notifications/read` with no cookie or origin and observe `403` with `{"error":"Invalid request origin"}`, which is the origin check acting before authentication.

## Database foundations

### Persistent data and databases

Persistent data survives after the program that created it stops. A database is a program dedicated to storing persistent data reliably and answering questions about it. airDash uses PostgreSQL, a relational database, which organizes data into tables with rows and columns and enforces rules about them.

PostgreSQL groups tables into schemas, which are namespaces inside one database. All airDash tables live in the schema named `airdash` inside the database named `dashyden`, which is shared with other services on the same host. Every table name in the code is therefore written `airdash.<table>`.

### Tables, rows, columns, and types

A table is a named grid. Each column has a name and a data type; each row is one record. The `airdash.bases` table is a small example, created in `api/src/database.js`:

```sql
CREATE TABLE IF NOT EXISTS airdash.bases (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`TEXT` holds strings, `DOUBLE PRECISION` holds decimal numbers, `BOOLEAN` holds true or false, `INTEGER` holds whole numbers, and `TIMESTAMPTZ` holds a moment in time with its time zone. `NOT NULL` means the column must have a value. `DEFAULT` supplies one when an insert omits the column. `IF NOT EXISTS` makes the statement safe to run again.

### Primary keys, foreign keys, and relationships

A primary key uniquely identifies each row. In `bases` it is `code`, the airport identifier. Many tables use `id BIGSERIAL PRIMARY KEY`, an automatically increasing number. A foreign key is a column that must match a primary key in another table, which creates a relationship and prevents dangling references. In `airdash.assignments`:

```sql
route_id BIGINT NOT NULL REFERENCES airdash.routes(id),
discord_id TEXT NOT NULL REFERENCES airdash.pilots(discord_id),
registration TEXT NOT NULL REFERENCES airdash.aircraft(registration),
```

An assignment therefore cannot exist without a real route, a real pilot, and a real aircraft. The [data model](data-model.md) page draws the full relationship diagram.

### Constraints and indexes

A constraint is a rule the database enforces on every write. `CHECK` constraints restrict values, as in `status TEXT NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED','ACTIVE',...))`. `UNIQUE` constraints prevent duplicates. An index is a data structure that speeds up lookups on a column and can also enforce uniqueness. airDash's most important business rule is an index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS assignments_active_pilot
  ON airdash.assignments(discord_id)
  WHERE status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED');
```

This partial unique index means a pilot can have at most one active assignment, and the database guarantees it even if two requests arrive at the same moment. The code catches the resulting error code `23505` and responds `409`.

### Queries and parameters

A query is a request to the database written in Structured Query Language (SQL). `SELECT` reads, `INSERT` adds, `UPDATE` changes, and `DELETE` removes. The API sends queries through the `pg` library. Every value that comes from a user is passed as a parameter, written `$1`, `$2`, and so on, with the values in a separate array:

```js
pool.query("SELECT * FROM airdash.pilots WHERE discord_id=$1", [discordId])
```

The database receives the SQL text and the values separately and never interprets the values as SQL. This prevents SQL injection, an attack where crafted input changes the meaning of a query. Concatenating a request value into SQL text is never acceptable in airDash.

### Transactions and isolation

A transaction groups several statements so that either all of them take effect or none do. `BEGIN` starts one, `COMMIT` makes it permanent, and `ROLLBACK` discards it. Booking a flight changes the assignment, the aircraft, and possibly the schedule; if any step fails, the others must not remain. The `/assignments` handler wraps all of it in a transaction on a single connection obtained with `pool.connect()`.

Isolation describes how concurrent transactions see each other. airDash uses PostgreSQL's default, read committed, plus explicit row locks: `SELECT ... FOR UPDATE` locks the pilot and aircraft rows so that two bookings for the same aircraft cannot both proceed.

### Connection pools

Opening a database connection is slow. A pool keeps several open and lends them out. `api/src/database.js` creates the pool once: `export const pool = new Pool({ connectionString: process.env.DATABASE_URL })`. `pool.query` borrows a connection, runs one statement, and returns it automatically. `pool.connect()` borrows one for a transaction and the caller must release it.

### Migrations and seed data

A migration is a change to the schema, such as adding a column. airDash implements migrations as one function, `migrate()` in `api/src/database.js`, that runs at every API start. Each statement is written so that repeating it is harmless: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` followed by `ADD CONSTRAINT`, and `INSERT ... ON CONFLICT DO NOTHING`. Seed data is the initial content a fresh database needs to be usable; `migrate()` seeds the four bases, the fleet, the routes, and the `operations` settings row. A fresh database therefore becomes fully usable after one API start.

The tradeoff is that there is no numbered history of migrations and no automatic way to reverse one. The [data model](data-model.md#migration-behavior) page explains the consequences.

### Backups and restoration

A backup is a copy of the data that can be restored later. airDash uses `pg_dump` in custom format, limited to the `airdash` schema, and `pg_restore` to load it. The [backup and recovery](backup-and-recovery.md) page has the procedures and the warnings.

### Verification

With a local database running as described in [installation](installation.md), list the tables:

```bash
psql "$DATABASE_URL" -Atc "SELECT table_name FROM information_schema.tables WHERE table_schema='airdash' ORDER BY table_name;"
```

You should see fifteen names. `information_schema` is a built-in set of views that describe the database itself; querying it is always safe.

## Testing foundations

### Why tests exist

A test is code that runs other code with known inputs and checks the outputs against expected values. Tests exist to catch regressions, which are behaviors that used to work and stopped, and to document what the code is supposed to do in a form that cannot drift out of date without failing.

### Kinds of tests

A unit test checks one function in isolation. An integration test checks several components together, such as a route and the database. An end-to-end test drives the whole system the way a user would, typically through a browser. airDash has unit tests for its pure calculation modules and a manual integration check called the smoke test. It has no end-to-end tests.

### Assertions, fixtures, fakes, and determinism

An assertion is a statement that a condition must be true; when it is false, the test fails with a message. airDash uses Node.js's built-in `node:assert/strict`. `api/scripts/test-streaks.js` begins:

```js
import assert from "node:assert/strict"
import { applyStreakBonus, computeStreaks, publicStreaks, streakBonusPercent } from "../src/streaks.js"

const flight = (id, day, origin, destination, hour = 12) => ({
  id,
  actual_out_at: `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`,
  origin,
  destination,
})

assert.equal(streakBonusPercent(3), 5)
```

The `flight` helper is a fixture: a function that builds test data in the shape the real code expects. A fake or mock is a stand-in for a real dependency; airDash's smoke test uses a fake authentication service, which is a tiny HTTP server that returns a fixed user for any cookie. A deterministic test produces the same result every run; the streak tests pass an explicit `now` date to `computeStreaks` so that the result does not depend on the day the test runs.

### Test isolation and failure interpretation

Isolated tests do not depend on each other or on external state. The two airDash test scripts import pure functions and need no database or network. When an assertion fails, Node.js prints `AssertionError`, the expected and actual values, and a stack trace whose first project line names the failing assertion. The [testing](testing.md) page shows a complete failure and how to read it.

### Coverage and continuous integration

Code coverage measures which lines the tests executed. airDash does not collect coverage. Continuous integration (CI) runs tests automatically on every push; airDash has no CI service, so the [contributing](contributing.md) page requires contributors to run validation locally and paste the results into the pull request.

### Verification

Run `npm --prefix api run test:streaks`. Then open `api/scripts/test-streaks.js`, change `assert.equal(streakBonusPercent(3), 5)` to expect `6`, rerun, read the failure, and restore the file with `git restore api/scripts/test-streaks.js`.

## Build and deployment foundations

### Source versus build artifacts

Source is what humans edit. A build artifact is what a build tool produces from source and what the runtime actually uses. In airDash, `web/src/` is source and `site/index.html` plus `site/app-assets/` are artifacts. Editing an artifact is futile because the next build overwrites it. The API has no build step: `api/src/` is both source and what Node.js runs, but the running process holds a copy in memory, so an edit has no effect until the process restarts.

### Compilation and bundling

Compilation converts one language to another; `tsc` converts TypeScript to JavaScript and checks types. Bundling combines many modules into few files so the browser makes few requests; Vite does this and also minifies the code, removes unused parts, and adds content hashes to file names. The `build` script in `web/package.json` does both: `tsc -b && vite build`.

### Containers and images

A container is an isolated process with its own file system, network view, and process list, sharing the host's kernel. An image is the read-only template a container starts from. airDash runs PostgreSQL (`pgvector/pgvector:pg16`), Nginx (`nginx:alpine`), and Caddy (`caddy:alpine`) as containers. The API is not containerized; it runs directly on the host under PM2. A registry is a server that stores images; the three images come from Docker Hub. A volume is persistent storage attached to a container; PostgreSQL's data lives in the `docker_pgdata` volume so that it survives container replacement. A bind mount exposes a host directory inside a container; `site/` is bind-mounted read-only into Nginx, which is why a frontend build is visible immediately without restarting anything.

### Environments and releases

An environment is a complete copy of the system for a purpose, such as development, staging, or production. airDash has development environments on contributors' machines and one production environment. It has no staging environment.

A release is a specific version of the software deployed to production. In airDash a release is a build and, when the API changed, a restart, preceded by a release backup that is the rollback point. A rollback restores the previous release. The [deployment](deployment.md) and [releases](releases.md) pages define both.

### Continuous integration, delivery, and deployment

Continuous integration runs validation automatically on every change. Continuous delivery produces a deployable artifact automatically. Continuous deployment deploys it automatically. airDash does none of these; every step is manual and documented. This is a deliberate current state, not an oversight, and it is recorded in [known limitations](known-limitations.md).

### Verification

From the repository root, run the isolated build described in [local development](local-development.md#frontend-validation-sequence). Confirm that it produces `index.html` and two hashed files in a temporary directory and that `site/` is untouched by comparing `ls -l site/index.html` before and after.

## Recap

You have learned the vocabulary of files, processes, ports, and environment variables; the Git cycle of edit, stage, commit, push, and pull request; enough JavaScript and TypeScript to read airDash's authentication and API client code; how dependencies are pinned and installed; the HTTP lifecycle of an airDash request; how PostgreSQL enforces airDash's business rules; what the tests assert and how to read a failure; and the difference between source, artifact, container, and release. The [learning path](learning-path.md) turns these sections into lessons with exercises, and the [glossary](glossary.md) collects every definition.
