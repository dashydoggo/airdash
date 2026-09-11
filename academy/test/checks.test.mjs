import assert from "node:assert/strict"
import test from "node:test"
import { checkerCatalog, checkerRegistry, runChecker } from "../checks.mjs"

const staticChecks = [
  "workspace-structure", "toolchain", "git-repository", "package-locks", "route-inventory",
  "schema-inventory", "configuration-contract", "security-boundaries", "source-generated-boundary",
  "documentation-links", "secret-scan", "academy-validation",
]

for (const id of staticChecks) {
  test(`${id} passes against the documented repository`, async () => {
    const result = await runChecker(id)
    assert.equal(result.passed, true, `${result.message}\n${result.stderr ?? ""}\n${JSON.stringify(result.observations)}`)
    assert.equal(result.status, "passed")
    assert.equal(result.checkerId, id)
    assert.equal(typeof result.finishedAt, "string")
  })
}

test("catalog exposes metadata but never implementation functions", () => {
  const catalog = checkerCatalog()
  assert.equal(catalog.length, Object.keys(checkerRegistry).length)
  assert.equal(catalog.every(item => typeof item.id === "string" && typeof item.title === "string" && ["inspect", "validate", "build"].includes(item.risk)), true)
  assert.equal(catalog.some(item => "run" in item), false)
})

test("unknown checker IDs never execute", async () => {
  const result = await runChecker("echo-user-input")
  assert.equal(result.passed, false)
  assert.equal(result.status, "not-found")
  assert.equal(result.message, "Unknown checker ID")
})

test("API syntax and pure unit tests execute through fixed scripts", async () => {
  const syntax = await runChecker("api-syntax")
  assert.equal(syntax.passed, true, syntax.stderr)
  const units = await runChecker("api-unit-tests")
  assert.equal(units.passed, true, units.stderr)
  assert.match(units.stdout, /streak calculations verified/)
  assert.match(units.stdout, /flight outcomes, SimBrief metadata, landing rates, recovery ferries, and gate assignment verified/)
})

test("frontend checks report blocked rather than inventing success when dependencies are absent", async () => {
  const typecheck = await runChecker("web-typecheck")
  if (typecheck.status === "blocked") {
    assert.equal(typecheck.passed, false)
    assert.match(typecheck.message, /npm --prefix web ci/)
  } else {
    assert.equal(typecheck.passed, true, typecheck.stderr)
  }
})
