import assert from "node:assert/strict"
import test from "node:test"
import { createEmptyProgress, importProgress, markConceptStudied, moduleGate, validateProgress } from "../engine.mjs"
import { loadCurriculum } from "../validate.mjs"

const data = await loadCurriculum()

test("empty progress satisfies the import schema against the current curriculum", () => {
  const now = new Date("2026-09-11T00:00:00Z")
  const progress = createEmptyProgress(now)
  assert.deepEqual(validateProgress(progress, data, now), { valid: true, errors: [] })
})

test("progress validation rejects unknown IDs, impossible review stages, and future attempts", () => {
  const now = new Date("2026-09-11T00:00:00Z")
  const progress = createEmptyProgress(now)
  progress.questions.unknown = { reviewStage: 99, dueAt: null, attempts: [{ at: "2026-09-12T00:00:00Z", correct: true, confidence: 8 }] }
  const result = validateProgress(progress, data, now)
  assert.equal(result.valid, false)
  assert.match(result.errors.join("\n"), /Unknown question ID/)
  assert.match(result.errors.join("\n"), /Invalid reviewStage/)
  assert.match(result.errors.join("\n"), /Invalid attempt timestamp/)
  assert.match(result.errors.join("\n"), /Invalid confidence/)
})

test("import is all-or-nothing and clamps accessibility settings", () => {
  const now = new Date("2026-09-11T00:00:00Z")
  const source = createEmptyProgress(now)
  source.learner.displayName = "A".repeat(100)
  source.settings = { textScale: 9, highContrast: true, reducedMotion: false }
  const imported = importProgress(JSON.stringify(source), data, now)
  assert.equal(imported.learner.displayName.length, 80)
  assert.equal(imported.settings.textScale, 1.4)
  assert.equal(imported.settings.highContrast, true)
  assert.equal(imported.settings.reducedMotion, false)
  const invalid = { ...source, curriculumVersion: "old" }
  assert.throws(() => importProgress(invalid, data, now), /curriculumVersion/)
})

test("studying records introduction without mutating the original progress", () => {
  const now = new Date("2026-09-11T00:00:00Z")
  const original = createEmptyProgress(now)
  const next = markConceptStudied(original, data.concepts[0].id, now)
  assert.equal(original.studyEvents.length, 0)
  assert.equal(next.studyEvents.length, 1)
  assert.equal(next.studyEvents[0].conceptId, data.concepts[0].id)
})

test("a module gate requires every declared condition", () => {
  const now = new Date("2026-09-11T00:00:00Z")
  let progress = createEmptyProgress(now)
  const module = data.modules[0]
  let gate = moduleGate(progress, module, data)
  assert.equal(gate.passed, false)
  assert.equal(gate.conditions.referencesOpened, false)
  assert.equal(gate.conditions.score, false)
  assert.equal(gate.conditions.labs, false)

  for (const concept of data.concepts.filter(item => item.moduleId === module.id)) progress = markConceptStudied(progress, concept.id, now)
  for (const question of data.questions.filter(item => item.moduleId === module.id)) {
    progress.questions[question.id] = {
      attempts: [{ at: now.toISOString(), correct: true, confidence: 4, skill: question.skill, difficulty: question.difficulty, response: question.answer }],
      reviewStage: 1,
      dueAt: "2026-09-12T00:00:00Z",
      lastCorrect: true,
      lastConfidence: 4,
      incorrectHighConfidence: false,
    }
  }
  for (const labId of module.requiredLabs) progress.labs[labId] = { passed: true, completedAt: now.toISOString() }
  progress.moduleAttempts.push({
    id: "module-test", moduleId: module.id, completedAt: now.toISOString(), score: 100, passed: true,
    bySkill: Object.fromEntries(module.requiredSkills.map(skill => [skill, { percent: 100 }])),
  })
  gate = moduleGate(progress, module, data)
  assert.equal(gate.passed, true)
  assert.equal(Object.values(gate.conditions).every(Boolean), true)
})

test("a later module prerequisite requires the complete earlier gate, not only a quiz pass", () => {
  const now = new Date("2026-09-11T00:00:00Z")
  const progress = createEmptyProgress(now)
  progress.moduleAttempts.push({ id: "quiz-only", moduleId: data.modules[0].id, completedAt: now.toISOString(), score: 100, passed: true, bySkill: {} })
  const second = moduleGate(progress, data.modules[1], data)
  assert.equal(second.conditions.prerequisites, false)
})

test("progress validation rejects oversized histories and capstone evidence", () => {
  const now = new Date("2026-09-11T00:00:00Z")
  const progress = createEmptyProgress(now)
  const questionId = data.questions[0].id
  progress.questions[questionId] = { reviewStage: 0, dueAt: null, attempts: Array.from({ length: 101 }, () => ({ at: now.toISOString(), correct: true, confidence: 3 })) }
  const capstone = data.capstones[0]
  progress.capstones[capstone.id] = { artifacts: { [capstone.artifacts[0].id]: "x".repeat(5001) }, criteria: {}, humanReviewed: true, reviewer: "Reviewer", passed: true, updatedAt: now.toISOString() }
  const result = validateProgress(progress, data, now)
  assert.equal(result.valid, false)
  assert.match(result.errors.join("\n"), /exceed 100 records/)
  assert.match(result.errors.join("\n"), /Invalid capstone artifact evidence/)
  assert.match(result.errors.join("\n"), /marked passed without satisfying all gates/)
})
