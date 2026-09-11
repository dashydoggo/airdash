import { execFile } from "node:child_process"
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const academyDir = path.dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = path.resolve(academyDir, "..")
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm"
const gitExecutable = process.platform === "win32" ? "git.exe" : "git"
const nodeExecutable = process.execPath
const MAX_OUTPUT = 12_000

function safeEnvironment() {
  return Object.fromEntries(Object.entries({
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    SYSTEMROOT: process.env.SYSTEMROOT,
    COMSPEC: process.env.COMSPEC,
    NO_COLOR: "1",
  }).filter(([, value]) => typeof value === "string"))
}

function redact(value) {
  return String(value ?? "")
    .replace(/postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/gi, "postgresql://<redacted>:<redacted>@")
    .replace(/(VAPID_PRIVATE_KEY|DATABASE_URL|AUTH_TOKEN|GITHUB_TOKEN|GH_TOKEN)=\S+/gi, "$1=<redacted>")
    .replace(/github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+/g, "<redacted-token>")
    .slice(0, MAX_OUTPUT)
}

async function runFixed(executable, args, options = {}) {
  const started = Date.now()
  try {
    const result = await execFileAsync(executable, args, {
      cwd: options.cwd ?? repositoryRoot,
      timeout: options.timeout ?? 45_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      shell: false,
      env: safeEnvironment(),
    })
    return {
      passed: true,
      status: "passed",
      exitCode: 0,
      durationMs: Date.now() - started,
      stdout: redact(result.stdout),
      stderr: redact(result.stderr),
    }
  } catch (error) {
    const missing = error.code === "ENOENT"
    return {
      passed: false,
      status: missing ? "blocked" : "failed",
      exitCode: Number.isInteger(error.code) ? error.code : null,
      durationMs: Date.now() - started,
      stdout: redact(error.stdout),
      stderr: redact(error.stderr || error.message),
    }
  }
}

async function read(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8")
}

async function inspectWorkspace() {
  const required = ["README.md", "api/package.json", "web/package.json", "docs/README.md", "academy/README.md"]
  const missing = required.filter(relative => !existsSync(path.join(repositoryRoot, relative)))
  return {
    passed: missing.length === 0,
    status: missing.length ? "failed" : "passed",
    observations: { repositoryRoot, required, missing },
    message: missing.length ? `Missing required paths: ${missing.join(", ")}` : "Repository root and required directories are present.",
  }
}

async function inspectToolchain() {
  const [node, git] = await Promise.all([
    runFixed(nodeExecutable, ["--version"]),
    runFixed(gitExecutable, ["--version"]),
  ])
  const nodeVersion = Number(node.stdout.match(/v(\d+)/)?.[1] ?? 0)
  const passed = node.passed && git.passed && nodeVersion >= 22
  return {
    passed,
    status: passed ? "passed" : "failed",
    observations: { node: node.stdout.trim(), git: git.stdout.trim(), minimumNodeMajor: 22 },
    message: passed ? "Node.js and Git satisfy the academy prerequisites." : "Node.js 22.12 or later and Git are required.",
  }
}

async function inspectGitRepository() {
  const [inside, branch, remote, status] = await Promise.all([
    runFixed(gitExecutable, ["rev-parse", "--is-inside-work-tree"]),
    runFixed(gitExecutable, ["branch", "--show-current"]),
    runFixed(gitExecutable, ["remote", "get-url", "origin"]),
    runFixed(gitExecutable, ["status", "--short"]),
  ])
  const passed = inside.stdout.trim() === "true" && /dashydoggo\/airdash(?:\.git)?$/.test(remote.stdout.trim())
  return {
    passed,
    status: passed ? "passed" : "failed",
    observations: {
      insideWorkTree: inside.stdout.trim(),
      branch: branch.stdout.trim() || "detached HEAD",
      origin: remote.stdout.trim().replace(/https:\/\/[^@]+@/, "https://<redacted>@"),
      worktreeChanges: status.stdout.trim().split("\n").filter(Boolean).length,
    },
    message: passed ? "This is the airDash Git repository with an origin remote." : "Run this checker from an airDash clone with origin configured.",
  }
}

async function inspectContributionBranch() {
  const [branch, staged] = await Promise.all([
    runFixed(gitExecutable, ["branch", "--show-current"]),
    runFixed(gitExecutable, ["diff", "--cached", "--name-only"]),
  ])
  const name = branch.stdout.trim()
  const protectedName = !name || name === "main" || name === "master" || name.startsWith("release/")
  const stagedPaths = staged.stdout.trim().split("\n").filter(Boolean)
  const unsafe = stagedPaths.filter(value => value === "api/.env" || value.startsWith("site/") || value.includes("node_modules"))
  const passed = branch.passed && staged.passed && !protectedName && unsafe.length === 0
  return {
    passed,
    status: passed ? "passed" : "failed",
    observations: { branch: name || "detached HEAD", stagedPaths, unsafeStagedPaths: unsafe },
    message: protectedName ? "Create a feature, fix, or docs branch before preparing a contribution." : unsafe.length ? "Remove secrets or generated artifacts from the staging area." : "The branch and staging area satisfy the contribution safety rules.",
  }
}

function exactVersion(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(value))
}

async function inspectPackageLocks() {
  const results = []
  for (const area of ["api", "web"]) {
    const manifest = JSON.parse(await read(`${area}/package.json`))
    const lock = JSON.parse(await read(`${area}/package-lock.json`))
    const dependencies = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) }
    const openVersions = Object.entries(dependencies).filter(([, version]) => !exactVersion(version))
    results.push({ area, lockfileVersion: lock.lockfileVersion, directDependencies: Object.keys(dependencies).length, nonExactVersions: openVersions })
  }
  const passed = results.every(item => item.lockfileVersion === 3 && item.nonExactVersions.length === 0)
  return {
    passed,
    status: passed ? "passed" : "failed",
    observations: results,
    message: passed ? "Both manifests use exact versions and lockfile version 3." : "A manifest uses an open range or an unexpected lockfile version.",
  }
}

async function inspectRouteInventory() {
  const source = await read("api/src/server.js")
  const matches = [...source.matchAll(/^app\.(get|post|put|patch|delete)\("([^"]+)"/gm)].map(match => ({ method: match[1].toUpperCase(), path: match[2] }))
  const unique = new Set(matches.map(item => `${item.method} ${item.path}`))
  const passed = matches.length === 57 && unique.size === 57
  return {
    passed,
    status: passed ? "passed" : "failed",
    observations: { routeCount: matches.length, uniqueRouteCount: unique.size, expectedAtDocumentedCommit: 57 },
    message: passed ? "The Express route inventory matches the documented 57 routes." : "The route count changed; update the API reference, architecture, coverage map, and academy data.",
  }
}

async function inspectSchemaInventory() {
  const source = await read("api/src/database.js")
  const tables = [...source.matchAll(/CREATE TABLE IF NOT EXISTS airdash\.([a-z_]+)/g)].map(match => match[1])
  const uniqueTables = [...new Set(tables)].sort()
  const passed = uniqueTables.length === 15
  return {
    passed,
    status: passed ? "passed" : "failed",
    observations: { tableCount: uniqueTables.length, tables: uniqueTables, expectedAtDocumentedCommit: 15 },
    message: passed ? "The migration declares the documented 15 tables." : "The table inventory changed; update the data model, architecture, coverage map, and academy data.",
  }
}

async function inspectConfigurationContract() {
  const files = await Promise.all((await readdir(path.join(repositoryRoot, "api/src")))
    .filter(name => name.endsWith(".js"))
    .map(name => read(`api/src/${name}`)))
  const references = [...files.join("\n").matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(match => match[1])
  const variables = [...new Set(references)].sort()
  const example = await read("api/.env.example")
  const exampleKeys = example.split("\n").map(line => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1]).filter(Boolean).sort()
  const expected = ["AUTH_URL", "DATABASE_URL", "OWNER_DISCORD_ID", "PORT", "PROFILE_IMAGE_DIR", "SIMBRIEF_AIRFRAME", "VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY", "VAPID_SUBJECT"]
  const passed = expected.every(value => variables.includes(value)) && variables.every(value => expected.includes(value))
  return {
    passed,
    status: passed ? "passed" : "failed",
    observations: { variables, exampleKeys, intentionallyDefaultOnly: ["PROFILE_IMAGE_DIR"] },
    message: passed ? "The source reads the nine documented environment variables." : "The environment-variable inventory changed; update configuration documentation and academy data.",
  }
}

async function inspectSecurityBoundaries() {
  const [server, auth, apiClient, app] = await Promise.all([
    read("api/src/server.js"), read("api/src/auth.js"), read("web/src/api.ts"), read("web/src/App.tsx"),
  ])
  const controls = {
    jsonLimit: /express\.json\(\{ limit: "2mb" \}\)/.test(server),
    originMiddlewareGlobal: /app\.use\(requireAirDashOrigin\)/.test(server),
    ownerMiddleware: /export async function requireOwner/.test(auth),
    allowedProductionOrigin: auth.includes("https://air.dashydoggo.com"),
    parameterizedSql: /\$1/.test(server),
    browserSendsCredentials: apiClient.includes('credentials: "include"'),
    noDangerousHtml: !app.includes("dangerouslySetInnerHTML"),
    securityHeaders: ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"].every(value => server.includes(value)),
  }
  const passed = Object.values(controls).every(Boolean)
  return { passed, status: passed ? "passed" : "failed", observations: controls, message: passed ? "The documented request, authorization, SQL, and output boundaries are present." : "A documented security boundary is missing or changed." }
}

async function inspectSourceGeneratedBoundary() {
  const [ignore, vite, nginx] = await Promise.all([read(".gitignore"), read("web/vite.config.ts"), read("nginx.conf")])
  const controls = {
    siteIgnored: /^site\/$/m.test(ignore),
    nodeModulesIgnored: /^node_modules\/$/m.test(ignore),
    envIgnored: /^\.env$/m.test(ignore),
    buildTargetsSite: vite.includes('"../site"'),
    buildPreservesSite: vite.includes("emptyOutDir: false"),
    spaFallback: nginx.includes("try_files $uri $uri/ /index.html"),
  }
  const passed = Object.values(controls).every(Boolean)
  return { passed, status: passed ? "passed" : "failed", observations: controls, message: passed ? "Source, generated output, secrets, and SPA fallback boundaries match the documentation." : "A source/generated-file boundary changed." }
}

function githubAnchor(value) {
  return value
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim().toLowerCase()
    .replace(/[^\p{L}\p{N}_\- ]/gu, "")
    .replace(/ /g, "-")
}

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const output = []
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory() && !["node_modules", ".git", "site"].includes(entry.name)) output.push(...await markdownFiles(absolute))
    if (entry.isFile() && entry.name.endsWith(".md")) output.push(absolute)
  }
  return output
}

async function inspectDocumentationLinks() {
  const files = await markdownFiles(repositoryRoot)
  const headingCache = new Map()
  for (const file of files) {
    const text = await readFile(file, "utf8")
    const counts = new Map()
    const anchors = new Set()
    let fenced = false
    for (const line of text.split("\n")) {
      if (line.startsWith("```")) { fenced = !fenced; continue }
      if (fenced) continue
      const match = line.match(/^#{1,6}\s+(.+?)\s*#*$/)
      if (!match) continue
      const base = githubAnchor(match[1])
      const count = counts.get(base) ?? 0
      anchors.add(count ? `${base}-${count}` : base)
      counts.set(base, count + 1)
    }
    headingCache.set(file, anchors)
  }
  const problems = []
  let checked = 0
  for (const file of files) {
    const text = await readFile(file, "utf8")
    let fenced = false
    let lineNumber = 0
    for (const line of text.split("\n")) {
      lineNumber += 1
      if (line.startsWith("```")) { fenced = !fenced; continue }
      if (fenced) continue
      for (const match of line.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = match[1]

        if (/^(https?:|mailto:)/.test(target)) continue
        checked += 1
        const [filePart, anchor] = target.split("#", 2)
        const destination = filePart ? path.resolve(path.dirname(file), decodeURIComponent(filePart)) : file
        if (!existsSync(destination)) { problems.push(`${path.relative(repositoryRoot, file)}:${lineNumber}: missing ${target}`); continue }
        if (anchor && destination.endsWith(".md") && !headingCache.get(destination)?.has(anchor)) problems.push(`${path.relative(repositoryRoot, file)}:${lineNumber}: missing anchor ${target}`)
      }
    }
  }
  const passed = problems.length === 0
  return { passed, status: passed ? "passed" : "failed", observations: { files: files.length, linksChecked: checked, problems: problems.slice(0, 100) }, message: passed ? `All ${checked} internal Markdown links resolve.` : `${problems.length} internal link problems found.` }
}

async function regularFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const output = []
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory() && entry.name !== "node_modules") output.push(...await regularFiles(absolute))
    if (entry.isFile()) output.push(absolute)
  }
  return output
}

async function inspectSecrets() {
  const tracked = await runFixed(gitExecutable, ["ls-files", "-z"])
  const trackedFiles = tracked.stdout.split("\0").filter(Boolean)
  const academyFiles = (await regularFiles(academyDir)).map(absolute => path.relative(repositoryRoot, absolute))
  const files = [...new Set([...trackedFiles, ...academyFiles])]
  const textExtensions = new Set([".js", ".mjs", ".ts", ".tsx", ".json", ".md", ".html", ".css", ".yml", ".yaml", ".conf", ".example", ".ps1", ".py", ".vbs"])
  const findings = []
  if (files.includes("api/.env")) findings.push("api/.env is tracked")
  for (const relative of files) {
    const extension = path.extname(relative)
    if (!textExtensions.has(extension) && ![".gitignore", ".gitattributes"].includes(path.basename(relative))) continue
    let content
    try { content = await read(relative) } catch { continue }
    const patterns = [
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
      /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/,
      /postgres(?:ql)?:\/\/[^\s:@/]+:[^<\s@/][^\s@/]*@/i,
      /VAPID_PRIVATE_KEY=(?!$|replace-|<)[A-Za-z0-9_-]{20,}/,
    ]
    if (patterns.some(pattern => pattern.test(content))) findings.push(`${relative}: secret-like content`)
  }
  const passed = findings.length === 0
  return { passed, status: passed ? "passed" : "failed", observations: { filesScanned: files.length, findings }, message: passed ? "No tracked private key, GitHub token, credential-bearing database URL, or VAPID private key was detected." : "Secret-like tracked content requires review." }
}

async function apiSyntax() {
  return runFixed(npmExecutable, ["--prefix", "api", "run", "check"], { timeout: 60_000 })
}

async function apiUnitTests() {
  const streaks = await runFixed(npmExecutable, ["--prefix", "api", "run", "test:streaks"], { timeout: 60_000 })
  if (!streaks.passed) return { ...streaks, message: "The streak test failed." }
  const outcomes = await runFixed(npmExecutable, ["--prefix", "api", "run", "test:flight-outcomes"], { timeout: 60_000 })
  return { ...outcomes, stdout: `${streaks.stdout}\n${outcomes.stdout}`.trim(), message: outcomes.passed ? "Both API unit-test scripts passed." : "The flight-outcome test failed." }
}

async function webTypecheck() {
  if (!existsSync(path.join(repositoryRoot, "web/node_modules"))) return { passed: false, status: "blocked", message: "Install frontend dependencies with npm --prefix web ci --include=dev first.", observations: {} }
  const result = await runFixed(npmExecutable, ["--prefix", "web", "run", "typecheck"], { timeout: 120_000 })
  return { ...result, message: result.passed ? "The TypeScript project passes strict type checking." : "The frontend type check failed." }
}

async function isolatedWebBuild() {
  if (!existsSync(path.join(repositoryRoot, "web/node_modules"))) return { passed: false, status: "blocked", message: "Install frontend dependencies with npm --prefix web ci --include=dev first.", observations: {} }
  const output = await mkdtemp(path.join(tmpdir(), "airdash-academy-build-"))
  try {
    const result = await runFixed(npmExecutable, ["exec", "vite", "--", "build", "--outDir", output, "--emptyOutDir"], { cwd: path.join(repositoryRoot, "web"), timeout: 180_000 })
    let assets = []
    if (result.passed && existsSync(path.join(output, "app-assets"))) assets = await readdir(path.join(output, "app-assets"))
    return { ...result, observations: { temporaryOutputRemoved: true, assets }, message: result.passed ? "The isolated Vite build passed and its temporary output was removed." : "The isolated Vite build failed." }
  } finally {
    await rm(output, { recursive: true, force: true })
  }
}

async function academyValidation() {
  const result = await runFixed(nodeExecutable, [path.join(academyDir, "validate.mjs")], { timeout: 120_000 })
  return { ...result, message: result.passed ? "The academy curriculum and coverage validator passed." : "The academy validator failed." }
}

async function fullValidation() {
  const ids = ["workspace-structure", "package-locks", "route-inventory", "schema-inventory", "configuration-contract", "security-boundaries", "source-generated-boundary", "documentation-links", "secret-scan", "api-syntax", "api-unit-tests", "web-typecheck", "isolated-web-build", "academy-validation"]
  const results = []
  for (const id of ids) {
    const result = await runChecker(id)
    results.push({ id, passed: result.passed, status: result.status, message: result.message })
    if (!result.passed && result.status !== "blocked") break
  }
  const passed = results.every(item => item.passed)
  return { passed, status: passed ? "passed" : results.some(item => item.status === "failed") ? "failed" : "blocked", observations: { results }, message: passed ? "Every whitelisted project validation passed." : "One or more validations failed or are blocked; inspect the results." }
}

export const checkerRegistry = Object.freeze({
  "workspace-structure": { title: "Repository structure", risk: "inspect", run: inspectWorkspace },
  "toolchain": { title: "Node.js and Git versions", risk: "inspect", run: inspectToolchain },
  "git-repository": { title: "Git repository and remote", risk: "inspect", run: inspectGitRepository },
  "contribution-branch": { title: "Contribution branch safety", risk: "inspect", run: inspectContributionBranch },
  "package-locks": { title: "Pinned dependency contracts", risk: "inspect", run: inspectPackageLocks },
  "route-inventory": { title: "Express route inventory", risk: "inspect", run: inspectRouteInventory },
  "schema-inventory": { title: "PostgreSQL table inventory", risk: "inspect", run: inspectSchemaInventory },
  "configuration-contract": { title: "Environment-variable contract", risk: "inspect", run: inspectConfigurationContract },
  "security-boundaries": { title: "Static security boundaries", risk: "inspect", run: inspectSecurityBoundaries },
  "source-generated-boundary": { title: "Source and generated-file boundary", risk: "inspect", run: inspectSourceGeneratedBoundary },
  "documentation-links": { title: "Internal documentation links", risk: "inspect", run: inspectDocumentationLinks },
  "secret-scan": { title: "Tracked secret scan", risk: "inspect", run: inspectSecrets },
  "api-syntax": { title: "API syntax check", risk: "validate", run: apiSyntax },
  "api-unit-tests": { title: "API unit tests", risk: "validate", run: apiUnitTests },
  "web-typecheck": { title: "Frontend type check", risk: "validate", run: webTypecheck },
  "isolated-web-build": { title: "Isolated frontend build", risk: "build", run: isolatedWebBuild },
  "academy-validation": { title: "Academy schema and coverage", risk: "validate", run: academyValidation },
  "full-validation": { title: "Complete safe validation", risk: "build", run: fullValidation },
})

export function checkerCatalog() {
  return Object.entries(checkerRegistry).map(([id, value]) => ({ id, title: value.title, risk: value.risk }))
}

export async function runChecker(id) {
  const checker = checkerRegistry[id]
  if (!checker) return { passed: false, status: "not-found", message: "Unknown checker ID", observations: {} }
  const startedAt = new Date().toISOString()
  try {
    const result = await checker.run()
    return { checkerId: id, title: checker.title, risk: checker.risk, startedAt, finishedAt: new Date().toISOString(), ...result }
  } catch (error) {
    return { checkerId: id, title: checker.title, risk: checker.risk, startedAt, finishedAt: new Date().toISOString(), passed: false, status: "failed", message: redact(error?.message ?? error), observations: {} }
  }
}
