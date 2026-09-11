import assert from "node:assert/strict"
import test from "node:test"
import { checkerRegistry } from "../checks.mjs"
import { loadCurriculum, validateCurriculum } from "../validate.mjs"

const source = await loadCurriculum()
const fresh = () => structuredClone(source)

test("the complete curriculum satisfies every production invariant", async () => {
  const result = await validateCurriculum(fresh())
  assert.equal(result.valid, true, result.errors.join("\n"))
  assert.deepEqual(result.stats, {
    curriculumVersion: "2026.09.1",
    modules: 21,
    concepts: 105,
    criticalConcepts: 28,
    questions: 252,
    criticalQuestions: 53,
    labs: 24,
    automatedLabs: 21,
    exams: 6,
    capstones: 1,
    checkerAllowList: 18,
  })
})

test("duplicate IDs and broken prerequisites fail validation", async () => {
  const data = fresh()
  data.modules[1].id = data.modules[0].id
  data.modules[2].prerequisites = ["does-not-exist"]
  const result = await validateCurriculum(data)
  assert.equal(result.valid, false)
  assert.match(result.errors.join("\n"), /duplicate ID/)
  assert.match(result.errors.join("\n"), /unknown prerequisite/)
})

test("a concept cannot lose either recall or higher-order coverage", async () => {
  const data = fresh()
  const target = data.concepts[0].id
  for (const question of data.questions) question.concepts = question.concepts.filter(id => id !== target)
  const result = await validateCurriculum(data)
  assert.equal(result.valid, false)
  assert.match(result.errors.join("\n"), new RegExp(`${target}: insufficient question evidence`))
})

test("question-quality rules reject trick wording and invalid answers", async () => {
  const data = fresh()
  const question = data.questions[0]
  question.prompt = "Obviously choose all of the above"
  question.answer = ["missing"]
  const result = await validateCurriculum(data)
  assert.equal(result.valid, false)
  assert.match(result.errors.join("\n"), /prohibited question wording/)
  assert.match(result.errors.join("\n"), /unknown choice/)
})

test("automated labs cannot name arbitrary commands", async () => {
  const data = fresh()
  data.labs[0].checkerId = "rm-everything"
  const result = await validateCurriculum(data)
  assert.equal(result.valid, false)
  assert.match(result.errors.join("\n"), /unknown checker rm-everything/)
})

test("every fixed checker is represented by an automated lab", () => {
  const documented = new Set(source.labs.filter(lab => lab.class === "automated").map(lab => lab.checkerId))
  assert.deepEqual([...Object.keys(checkerRegistry)].filter(id => !documented.has(id)), [])
})

test("the final examination sample covers all modules, skills, critical concepts, and diagnosis depth", async () => {
  const result = await validateCurriculum(fresh())
  assert.equal(result.errors.some(error => error.startsWith("exam-final-integrated:")), false, result.errors.join("\n"))
  const final = source.exams.find(exam => exam.id === "exam-final-integrated")
  assert.equal(final.questionCount >= 60, true)
  assert.equal(final.requiredCriticalConcepts.length, 28)
})
