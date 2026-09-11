import assert from "node:assert/strict"
import test from "node:test"
import {
  REVIEW_DELAYS_MS, buildReviewQueue, calculateResults, createEmptyProgress, deriveConceptEvidence,
  gradeAnswer, markConceptStudied, normalizeText, recordQuestionAttempt, seededShuffle, selectQuestions,
} from "../engine.mjs"

const choice = (id, text = id) => ({ id, text })
const base = { id: "q", moduleId: "m", skill: "recall", difficulty: 2, critical: false, concepts: ["c"], explanation: "Explanation long enough for the curriculum contract.", remediation: ["docs/README.md"], sourceRefs: ["README.md"] }

test("normalizes short answers without destroying project punctuation", () => {
  assert.equal(normalizeText("  Node.JS   24.x  "), "node.js 24.x")
  assert.equal(normalizeText("OWNER_DISCORD_ID"), "owner_discord_id")
  assert.equal(normalizeText("Pilot's"), "pilots")
})

test("grades every supported question type", () => {
  assert.equal(gradeAnswer({ ...base, type: "single", choices: [choice("a"), choice("b"), choice("c")], answer: ["b"] }, "b").correct, true)
  assert.equal(gradeAnswer({ ...base, type: "boolean", answer: ["true"] }, "TRUE").correct, true)
  assert.equal(gradeAnswer({ ...base, type: "short", answer: [], accepted: ["npm ci", "npm  ci"] }, " NPM CI ").correct, true)
  const multi = gradeAnswer({ ...base, type: "multi", choices: [choice("a"), choice("b"), choice("c"), choice("d")], answer: ["a", "c"] }, ["c", "a"])
  assert.equal(multi.correct, true)
  const partial = gradeAnswer({ ...base, type: "multi", choices: [choice("a"), choice("b"), choice("c"), choice("d")], answer: ["a", "c"] }, ["a"])
  assert.equal(partial.correct, false)
  assert.equal(partial.partial, 0.5)
  const order = gradeAnswer({ ...base, type: "order", choices: [choice("a"), choice("b"), choice("c")], answer: ["b", "a", "c"] }, ["b", "a", "c"])
  assert.equal(order.correct, true)
  assert.throws(() => gradeAnswer({ ...base, type: "unknown", answer: [] }, ""), /Unsupported question type/)
})

test("seeded shuffle is deterministic without mutating input", () => {
  const values = [1, 2, 3, 4, 5, 6]
  const first = seededShuffle(values, "session-one")
  const second = seededShuffle(values, "session-one")
  const third = seededShuffle(values, "session-two")
  assert.deepEqual(first, second)
  assert.notDeepEqual(first, third)
  assert.deepEqual(values, [1, 2, 3, 4, 5, 6])
})

test("question selection covers required modules, skills, and critical concepts", () => {
  const questions = [
    { ...base, id: "a", moduleId: "m1", skill: "recall", difficulty: 2, concepts: ["critical"], critical: true },
    { ...base, id: "b", moduleId: "m1", skill: "apply", difficulty: 3, concepts: ["c1"] },
    { ...base, id: "c", moduleId: "m2", skill: "diagnose", difficulty: 4, concepts: ["c2"] },
    { ...base, id: "d", moduleId: "m2", skill: "secure", difficulty: 5, concepts: ["critical"], critical: true },
    { ...base, id: "e", moduleId: "m2", skill: "operate", difficulty: 4, concepts: ["c3"] },
  ]
  const selected = selectQuestions(questions, { count: 5, moduleIds: ["m1", "m2"], skills: ["recall", "apply", "diagnose", "secure", "operate"], criticalConcepts: ["critical"], seed: "fixed" })
  assert.equal(selected.length, 5)
  assert.deepEqual(new Set(selected.map(item => item.moduleId)), new Set(["m1", "m2"]))
  assert.equal(selected.some(item => item.critical && item.concepts.includes("critical")), true)
})

test("weighted results report skill, module, and critical misses", () => {
  const questions = new Map([
    ["q1", { ...base, id: "q1", moduleId: "m1", skill: "recall", difficulty: 1, critical: false }],
    ["q2", { ...base, id: "q2", moduleId: "m2", skill: "diagnose", difficulty: 5, critical: true }],
  ])
  const result = calculateResults([{ questionId: "q1", correct: true }, { questionId: "q2", correct: false }], questions)
  assert.equal(result.correct, 1)
  assert.equal(result.total, 2)
  assert.equal(result.criticalMisses, 1)
  assert.equal(result.score, 28.6)
  assert.equal(result.bySkill.recall.percent, 100)
  assert.equal(result.bySkill.diagnose.percent, 0)
})

test("incorrect high confidence creates a misconception and two later correct attempts clear it", () => {
  const question = { ...base, type: "single", choices: [choice("a"), choice("b"), choice("c")], answer: ["a"] }
  let progress = createEmptyProgress(new Date("2026-01-01T00:00:00Z"))
  let recorded = recordQuestionAttempt(progress, question, "b", 5, new Date("2026-01-01T00:00:00Z"))
  progress = recorded.progress
  assert.equal(progress.questions.q.reviewStage, 0)
  assert.equal(progress.questions.q.incorrectHighConfidence, true)
  assert.equal(progress.concepts.c.unresolvedMisconception, true)
  assert.equal(progress.concepts.c.remediationRequired, true)
  assert.equal(new Date(progress.questions.q.dueAt).getTime(), Date.parse("2026-01-01T00:10:00Z"))
  recorded = recordQuestionAttempt(progress, question, "a", 3, new Date("2026-01-01T00:10:00Z"))
  progress = recorded.progress
  assert.equal(progress.questions.q.reviewStage, 1)
  assert.equal(progress.questions.q.incorrectHighConfidence, true)
  recorded = recordQuestionAttempt(progress, question, "a", 4, new Date("2026-01-02T00:10:00Z"))
  progress = recorded.progress
  assert.equal(progress.questions.q.reviewStage, 2)
  assert.equal(progress.questions.q.incorrectHighConfidence, false)
  assert.equal(progress.concepts.c.unresolvedMisconception, true)
  progress = markConceptStudied(progress, "c", new Date("2026-01-02T00:11:00Z"))
  assert.equal(progress.concepts.c.unresolvedMisconception, false)
})

test("review stages advance through the fixed schedule", () => {
  const question = { ...base, type: "boolean", answer: ["true"] }
  let progress = createEmptyProgress(new Date("2026-01-01T00:00:00Z"))
  let now = new Date("2026-01-01T00:00:00Z")
  for (let stage = 1; stage <= 7; stage += 1) {
    const recorded = recordQuestionAttempt(progress, question, "true", 4, now)
    progress = recorded.progress
    assert.equal(progress.questions.q.reviewStage, stage)
    assert.equal(new Date(progress.questions.q.dueAt).getTime(), now.getTime() + REVIEW_DELAYS_MS[stage])
    now = new Date(progress.questions.q.dueAt)
  }
})

test("review queue prioritizes high-confidence misconception over ordinary overdue work", () => {
  const questions = [
    { ...base, id: "critical", type: "boolean", answer: ["true"], critical: true },
    { ...base, id: "due", type: "boolean", answer: ["true"] },
  ]
  const progress = createEmptyProgress(new Date("2026-01-01T00:00:00Z"))
  progress.questions.critical = { attempts: [], reviewStage: 0, dueAt: "2026-01-01T00:00:00Z", incorrectHighConfidence: true }
  progress.questions.due = { attempts: [], reviewStage: 2, dueAt: "2025-12-01T00:00:00Z", incorrectHighConfidence: false }
  const queue = buildReviewQueue(progress, questions, new Date("2026-01-02T00:00:00Z"))
  assert.equal(queue[0].id, "critical")
})

test("concept evidence progresses only with distinct recall and higher-order questions", () => {
  const concept = { id: "c", moduleId: "m" }
  const questions = [
    { ...base, id: "r1", skill: "recall", concepts: ["c"] },
    { ...base, id: "r2", skill: "explain", concepts: ["c"] },
    { ...base, id: "a1", skill: "apply", concepts: ["c"] },
    { ...base, id: "a2", skill: "diagnose", concepts: ["c"] },
  ]
  const progress = createEmptyProgress(new Date("2026-01-01T00:00:00Z"))
  progress.studyEvents.push({ conceptId: "c", at: "2026-01-01T00:00:00Z" })
  for (const question of questions) progress.questions[question.id] = { attempts: [{ correct: true }], reviewStage: 1, incorrectHighConfidence: false }
  progress.labs.lab = { passed: true }
  progress.moduleAttempts.push({ moduleId: "m", passed: true })
  const data = { questions, labs: [{ id: "lab", concepts: ["c"] }], capstones: [] }
  assert.equal(deriveConceptEvidence(progress, concept, data).level, 4)
  progress.questions.r1.reviewStage = 6
  progress.questions.a1.reviewStage = 6
  assert.equal(deriveConceptEvidence(progress, concept, data).level, 5)
})
