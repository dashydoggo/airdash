import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { startAcademyServer } from "../server.mjs"

let server
let origin

before(async () => {
  server = await startAcademyServer({ port: 0 })
  origin = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve))
})

test("root redirects to the academy application", async () => {
  const response = await fetch(`${origin}/`, { redirect: "manual" })
  assert.equal(response.status, 302)
  assert.equal(response.headers.get("location"), "/academy/")
})

test("application shell and modules are served with restrictive headers", async () => {
  const response = await fetch(`${origin}/academy/`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get("content-type"), /text\/html/)
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/)
  assert.equal(response.headers.get("x-frame-options"), "DENY")
  assert.match(await response.text(), /airDash Academy/)
  const module = await fetch(`${origin}/academy/engine.mjs`)
  assert.equal(module.status, 200)
  assert.match(module.headers.get("content-type"), /javascript/)
  const head = await fetch(`${origin}/academy/index.html`, { method: "HEAD" })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), "")
  assert.equal(Number(head.headers.get("content-length")) > 0, true)
})

test("all curriculum data is reachable through the safe static boundary", async () => {
  const modulesResponse = await fetch(`${origin}/academy/data/modules.json`)
  const modules = await modulesResponse.json()
  assert.equal(modules.length, 21)
  const questionResponses = await Promise.all(modules.map(module => fetch(`${origin}/academy/data/${module.questionFile}`)))
  assert.equal(questionResponses.every(response => response.status === 200), true)
  const questionBanks = await Promise.all(questionResponses.map(response => response.json()))
  assert.equal(questionBanks.flat().length, 252)
})

test("status endpoint reports local academy metadata", async () => {
  const response = await fetch(`${origin}/api/academy/status`)
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.host, "127.0.0.1")
  assert.equal(body.checkerCount, 18)
})

test("secrets, generated files, and traversal are never served", async () => {
  for (const target of ["/api/.env", "/site/index.html", "/.git/config", "/node_modules/package.json", "/%2e%2e/api/.env"]) {
    const response = await fetch(`${origin}${target}`)
    assert.equal(response.status, 404, target)
  }
  const example = await fetch(`${origin}/api/.env.example`)
  assert.equal(example.status, 200)
})

test("checker execution requires POST and an approved local origin", async () => {
  const get = await fetch(`${origin}/api/academy/checks/workspace-structure`)
  assert.equal(get.status, 405)
  const wrongOrigin = await fetch(`${origin}/api/academy/checks/workspace-structure`, { method: "POST", headers: { Origin: "https://example.test", "Content-Type": "application/json" }, body: "{}" })
  assert.equal(wrongOrigin.status, 403)
  const allowed = await fetch(`${origin}/api/academy/checks/workspace-structure`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" })
  const body = await allowed.json()
  assert.equal(allowed.status, 200)
  assert.equal(body.passed, true)
  assert.equal(body.checkerId, "workspace-structure")
})

test("unknown checkers and oversized bodies are rejected before execution", async () => {
  const unknown = await fetch(`${origin}/api/academy/checks/not-registered`, { method: "POST", headers: { Origin: origin }, body: "{}" })
  assert.equal(unknown.status, 404)
  const large = await fetch(`${origin}/api/academy/checks/workspace-structure`, { method: "POST", headers: { Origin: origin, "Content-Type": "text/plain" }, body: "x".repeat(2048) })
  assert.equal(large.status, 413)
})

test("unknown API routes do not fall through to static files", async () => {
  const response = await fetch(`${origin}/api/academy/nope`)
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: "Unknown academy API route" })
})
