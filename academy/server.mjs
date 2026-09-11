import http from "node:http"
import { createReadStream, existsSync } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { checkerCatalog, repositoryRoot, runChecker } from "./checks.mjs"

const HOST = "127.0.0.1"
const DEFAULT_PORT = 4174
const MAX_REQUEST_BODY = 1024
const academyDir = path.dirname(fileURLToPath(import.meta.url))
const runningChecks = new Set()

const contentTypes = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".ps1": "text/plain; charset=utf-8",
  ".vbs": "text/plain; charset=utf-8",
  ".conf": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
})

function commonHeaders(response) {
  response.setHeader("Cache-Control", "no-store")
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
  response.setHeader("Referrer-Policy", "no-referrer")
  response.setHeader("X-Content-Type-Options", "nosniff")
  response.setHeader("X-Frame-Options", "DENY")
}

function json(response, statusCode, value) {
  commonHeaders(response)
  response.statusCode = statusCode
  response.setHeader("Content-Type", "application/json; charset=utf-8")
  response.end(JSON.stringify(value))
}

function text(response, statusCode, value) {
  commonHeaders(response)
  response.statusCode = statusCode
  response.setHeader("Content-Type", "text/plain; charset=utf-8")
  response.end(value)
}

function safeStaticPath(pathname) {
  let decoded
  try { decoded = decodeURIComponent(pathname) } catch { return null }
  if (decoded.includes("\0") || decoded.includes("\\")) return null
  const normalized = path.posix.normalize(decoded)
  if (normalized.includes("..")) return null
  const blocked = ["/.git", "/node_modules", "/site", "/api/.env"]
  if (blocked.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
    if (normalized !== "/api/.env.example") return null
  }

  const safeFiles = new Set(["/README.md", "/nginx.conf", "/.gitignore", "/.gitattributes", "/api/package.json", "/api/package-lock.json", "/api/.env.example", "/api/ecosystem.config.js", "/web/package.json", "/web/package-lock.json", "/web/vite.config.ts", "/web/tsconfig.json", "/web/tsconfig.app.json"])
  const safePrefixes = ["/academy/", "/docs/", "/api/src/", "/api/scripts/", "/web/src/", "/web/public/", "/scripts/", "/gsx/", "/livery-templates/"]
  if (!safeFiles.has(normalized) && !safePrefixes.some(prefix => normalized.startsWith(prefix))) return null
  const absolute = path.resolve(repositoryRoot, `.${normalized}`)
  return absolute.startsWith(`${repositoryRoot}${path.sep}`) ? absolute : null
}

async function serveStatic(pathname, response, headOnly = false) {
  let effective = pathname
  if (effective === "/academy" || effective === "/academy/") effective = "/academy/index.html"
  const absolute = safeStaticPath(effective)
  if (!absolute || !existsSync(absolute)) return text(response, 404, "Not found")
  const metadata = await stat(absolute).catch(() => null)
  if (!metadata?.isFile()) return text(response, 404, "Not found")
  const type = contentTypes[path.extname(absolute).toLowerCase()] ?? "application/octet-stream"
  commonHeaders(response)
  response.statusCode = 200
  response.setHeader("Content-Type", type)
  response.setHeader("Content-Length", metadata.size)
  if (headOnly) return response.end()
  createReadStream(absolute).pipe(response)
}

function validOrigin(request, port) {
  const origin = request.headers.origin
  return !origin || origin === `http://${HOST}:${port}`
}

async function consumeSmallBody(request) {
  const declared = Number(request.headers["content-length"] ?? 0)
  if (declared > MAX_REQUEST_BODY) throw Object.assign(new Error("Request body is too large"), { status: 413 })
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_REQUEST_BODY) throw Object.assign(new Error("Request body is too large"), { status: 413 })
  }
}

function parsePort(args) {
  const index = args.indexOf("--port")
  if (index < 0) return DEFAULT_PORT
  const port = Number(args[index + 1])
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port must be an integer from 1024 through 65535")
  return port
}

export function createAcademyServer(options = {}) {
  const port = options.port ?? DEFAULT_PORT
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid server port")
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${port}`}`)
    try {
      if (url.pathname === "/") {
        commonHeaders(response)
        response.statusCode = 302
        response.setHeader("Location", "/academy/")
        return response.end()
      }
      if (url.pathname === "/api/academy/status" && request.method === "GET") {
        return json(response, 200, {
          ok: true,
          name: "airDash Academy",
          host: HOST,
          curriculumVersion: "2026.09.1",
          checkerCount: checkerCatalog().length,
          node: process.version,
        })
      }
      if (url.pathname === "/api/academy/checkers" && request.method === "GET") return json(response, 200, { checkers: checkerCatalog() })
      const checkMatch = url.pathname.match(/^\/api\/academy\/checks\/([a-z0-9-]+)$/)
      if (checkMatch) {
        if (request.method !== "POST") return json(response, 405, { error: "Use POST for checker execution" })
        if (!validOrigin(request, server.address()?.port ?? port)) return json(response, 403, { error: "Invalid request origin" })
        await consumeSmallBody(request)
        const checkerId = checkMatch[1]
        if (!checkerCatalog().some(item => item.id === checkerId)) return json(response, 404, { error: "Unknown checker ID" })
        if (runningChecks.size > 0) return json(response, 409, { error: "Another checker is running" })
        runningChecks.add(checkerId)
        try {
          const result = await runChecker(checkerId)
          return json(response, result.status === "not-found" ? 404 : 200, result)
        } finally {
          runningChecks.delete(checkerId)
        }
      }
      if (url.pathname.startsWith("/api/academy/")) return json(response, 404, { error: "Unknown academy API route" })
      if (!["GET", "HEAD"].includes(request.method ?? "")) return text(response, 405, "Method not allowed")
      return await serveStatic(url.pathname, response, request.method === "HEAD")
    } catch (error) {
      return json(response, error.status ?? 500, { error: error.status ? error.message : "Academy server error" })
    }
  })
  return server
}

export async function startAcademyServer(options = {}) {
  const port = options.port ?? DEFAULT_PORT
  const server = createAcademyServer({ port })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, HOST, resolve)
  })
  return server
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ""
if (invokedPath === fileURLToPath(import.meta.url)) {
  const port = parsePort(process.argv.slice(2))
  const server = await startAcademyServer({ port })
  console.log(`airDash Academy listening on http://${HOST}:${server.address().port}/academy/`)
  const shutdown = () => server.close(() => process.exit(0))
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}
