export const PROGRESS_SCHEMA_VERSION = 1
export const CURRICULUM_VERSION = "2026.09.1"
export const STORAGE_KEY = "airdash-academy-progress-v1"
export const SKILLS = Object.freeze(["recall", "explain", "apply", "diagnose", "secure", "operate"])
export const HIGHER_ORDER_SKILLS = Object.freeze(["apply", "diagnose", "secure", "operate"])
export const REVIEW_DELAYS_MS = Object.freeze([
  10 * 60 * 1000,
  24 * 60 * 60 * 1000,
  3 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  14 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000,
  60 * 24 * 60 * 60 * 1000,
  120 * 24 * 60 * 60 * 1000,
])

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000
const asArray = value => Array.isArray(value) ? value : []
const unique = values => [...new Set(values)]
const clone = value => globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value))

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9.#+/_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

export function difficultyWeight(difficulty) {
  return ({ 1: 1, 2: 1.25, 3: 1.5, 4: 2, 5: 2.5 })[Number(difficulty)] ?? 1
}

function sameSet(left, right) {
  const a = [...new Set(asArray(left).map(String))].sort()
  const b = [...new Set(asArray(right).map(String))].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameOrder(left, right) {
  const a = asArray(left).map(String)
  const b = asArray(right).map(String)
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function gradeAnswer(question, response) {
  const answer = asArray(question.answer).map(String)
  let normalizedResponse
  let correct = false
  let partial = 0

  if (question.type === "short") {
    normalizedResponse = normalizeText(response)
    const accepted = asArray(question.accepted).map(normalizeText)
    correct = accepted.includes(normalizedResponse)
    partial = correct ? 1 : 0
  } else if (question.type === "boolean") {
    normalizedResponse = normalizeText(response)
    correct = normalizedResponse === normalizeText(answer[0])
    partial = correct ? 1 : 0
  } else if (question.type === "single") {
    normalizedResponse = String(response ?? "")
    correct = normalizedResponse === answer[0]
    partial = correct ? 1 : 0
  } else if (question.type === "multi") {
    normalizedResponse = asArray(response).map(String)
    correct = sameSet(normalizedResponse, answer)
    const selected = new Set(normalizedResponse)
    const expected = new Set(answer)
    const correctSelections = [...selected].filter(value => expected.has(value)).length
    const wrongSelections = [...selected].filter(value => !expected.has(value)).length
    partial = Math.max(0, (correctSelections - wrongSelections) / Math.max(1, expected.size))
  } else if (question.type === "order") {
    normalizedResponse = asArray(response).map(String)
    correct = sameOrder(normalizedResponse, answer)
    const correctPositions = normalizedResponse.filter((value, index) => value === answer[index]).length
    partial = correctPositions / Math.max(1, answer.length)
  } else {
    throw new Error(`Unsupported question type: ${question.type}`)
  }

  return { correct, partial, response: normalizedResponse }
}

export function hashSeed(value) {
  let result = 2166136261
  for (const character of String(value)) {
    result ^= character.charCodeAt(0)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

function randomFromSeed(seed) {
  let value = seed >>> 0
  return () => {
    value += 0x6D2B79F5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededShuffle(values, seed) {
  const output = [...values]
  const random = randomFromSeed(typeof seed === "number" ? seed : hashSeed(seed))
  for (let index = output.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[output[index], output[target]] = [output[target], output[index]]
  }
  return output
}

export function createEmptyProgress(now = new Date()) {
  const timestamp = new Date(now).toISOString()
  return {
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    curriculumVersion: CURRICULUM_VERSION,
    learner: { displayName: "", startedAt: timestamp },
    concepts: {},
    questions: {},
    moduleAttempts: [],
    examAttempts: [],
    labs: {},
    capstones: {},
    studyEvents: [],
    settings: { textScale: 1, highContrast: false, reducedMotion: false },
    updatedAt: timestamp,
  }
}

function validTimestamp(value, now) {
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time <= now.getTime() + MAX_FUTURE_SKEW_MS
}

export function validateProgress(progress, data, now = new Date()) {
  const errors = []
  const questionIds = new Set(data.questions.map(item => item.id))
  const conceptIds = new Set(data.concepts.map(item => item.id))
  const moduleIds = new Set(data.modules.map(item => item.id))
  const labIds = new Set(data.labs.map(item => item.id))
  const examIds = new Set(data.exams.map(item => item.id))
  const capstoneIds = new Set(data.capstones.map(item => item.id))

  if (!progress || typeof progress !== "object" || Array.isArray(progress)) errors.push("Progress must be an object")
  if (progress?.schemaVersion !== PROGRESS_SCHEMA_VERSION) errors.push(`schemaVersion must be ${PROGRESS_SCHEMA_VERSION}`)
  if (progress?.curriculumVersion !== CURRICULUM_VERSION) errors.push(`curriculumVersion must be ${CURRICULUM_VERSION}`)
  for (const key of ["questions", "concepts", "labs", "capstones"]) {
    if (!progress?.[key] || typeof progress[key] !== "object" || Array.isArray(progress[key])) errors.push(`${key} must be an object`)
  }
  for (const key of ["moduleAttempts", "examAttempts", "studyEvents"]) {
    if (!Array.isArray(progress?.[key])) errors.push(`${key} must be an array`)
  }
  if ((progress?.moduleAttempts?.length ?? 0) > 2000) errors.push("moduleAttempts exceeds 2000 records")
  if ((progress?.examAttempts?.length ?? 0) > 1000) errors.push("examAttempts exceeds 1000 records")
  if ((progress?.studyEvents?.length ?? 0) > 5000) errors.push("studyEvents exceeds 5000 records")
  if (!validTimestamp(progress?.learner?.startedAt, now)) errors.push("learner.startedAt is invalid or in the future")
  if (!validTimestamp(progress?.updatedAt, now)) errors.push("updatedAt is invalid or in the future")

  for (const [id, state] of Object.entries(progress?.questions ?? {})) {
    if (!questionIds.has(id)) errors.push(`Unknown question ID in progress: ${id}`)
    if (!Number.isInteger(state.reviewStage) || state.reviewStage < 0 || state.reviewStage >= REVIEW_DELAYS_MS.length) errors.push(`Invalid reviewStage for ${id}`)
    if (state.dueAt && !validTimestamp(state.dueAt, new Date(now.getTime() + REVIEW_DELAYS_MS.at(-1) + MAX_FUTURE_SKEW_MS))) errors.push(`Invalid dueAt for ${id}`)
    if (!Array.isArray(state.attempts)) errors.push(`Attempts for ${id} must be an array`)
    if ((state.attempts?.length ?? 0) > 100) errors.push(`Attempts for ${id} exceed 100 records`)
    for (const attempt of state.attempts ?? []) {
      if (!validTimestamp(attempt.at, now)) errors.push(`Invalid attempt timestamp for ${id}`)
      if (![1, 2, 3, 4, 5].includes(attempt.confidence)) errors.push(`Invalid confidence for ${id}`)
      if (typeof attempt.correct !== "boolean") errors.push(`Invalid correctness for ${id}`)
    }
  }
  for (const [id, state] of Object.entries(progress?.concepts ?? {})) {
    if (!conceptIds.has(id)) errors.push(`Unknown concept ID in progress: ${id}`)
    if (state.highConfidenceMisses !== undefined && (!Number.isInteger(state.highConfidenceMisses) || state.highConfidenceMisses < 0)) errors.push(`Invalid misconception count for ${id}`)
    if (state.correctSinceMisconception !== undefined && (!Number.isInteger(state.correctSinceMisconception) || state.correctSinceMisconception < 0)) errors.push(`Invalid remediation count for ${id}`)
  }
  for (const [id, state] of Object.entries(progress?.labs ?? {})) {
    if (!labIds.has(id)) errors.push(`Unknown lab ID in progress: ${id}`)
    if (typeof state.passed !== "boolean") errors.push(`Invalid lab pass state for ${id}`)
    const lab = data.labs.find(item => item.id === id)
    if (state.passed && lab?.class === "inspected" && (!state.humanReviewed || typeof state.reviewer !== "string" || !state.reviewer.trim())) errors.push(`Inspected lab ${id} lacks human review`)
    if (state.completedAt && !validTimestamp(state.completedAt, now)) errors.push(`Invalid lab timestamp for ${id}`)
    if (state.evidence !== undefined && (typeof state.evidence !== "string" || state.evidence.length > 2000)) errors.push(`Invalid lab evidence for ${id}`)
  }
  for (const [id, state] of Object.entries(progress?.capstones ?? {})) {
    const capstone = data.capstones.find(item => item.id === id)
    if (!capstone) { errors.push(`Unknown capstone ID in progress: ${id}`); continue }
    if (state.updatedAt && !validTimestamp(state.updatedAt, now)) errors.push(`Invalid capstone timestamp for ${id}`)
    if (state.humanReviewed !== undefined && typeof state.humanReviewed !== "boolean") errors.push(`Invalid human-review state for ${id}`)
    for (const [artifactId, artifactEvidence] of Object.entries(state.artifacts ?? {})) {
      if (!capstone.artifacts.some(item => item.id === artifactId)) errors.push(`Unknown capstone artifact ${id}/${artifactId}`)
      if (typeof artifactEvidence !== "string" || artifactEvidence.length > 5000) errors.push(`Invalid capstone artifact evidence ${id}/${artifactId}`)
    }
    for (const [criterionId, criterionState] of Object.entries(state.criteria ?? {})) {
      const criterion = capstone.rubric.find(item => item.id === criterionId)
      if (!criterion) { errors.push(`Unknown capstone criterion ${id}/${criterionId}`); continue }
      if (!(Number.isFinite(criterionState.earned) && criterionState.earned >= 0 && criterionState.earned <= criterion.points)) errors.push(`Invalid capstone score ${id}/${criterionId}`)
      if (criterionState.evidence !== undefined && (typeof criterionState.evidence !== "string" || criterionState.evidence.length > 5000)) errors.push(`Invalid capstone evidence ${id}/${criterionId}`)
    }
  }
  if (progress?.settings && (!(Number(progress.settings.textScale) > 0) || typeof progress.settings.highContrast !== "boolean" || typeof progress.settings.reducedMotion !== "boolean")) errors.push("Invalid accessibility settings")
  for (const attempt of progress?.moduleAttempts ?? []) {
    if (!moduleIds.has(attempt.moduleId)) errors.push(`Unknown module attempt: ${attempt.moduleId}`)
    if (!validTimestamp(attempt.completedAt, now)) errors.push(`Invalid module attempt timestamp: ${attempt.moduleId}`)
    if (!(attempt.score >= 0 && attempt.score <= 100)) errors.push(`Invalid module score: ${attempt.moduleId}`)
  }
  for (const attempt of progress?.examAttempts ?? []) {
    if (!examIds.has(attempt.examId)) errors.push(`Unknown examination attempt: ${attempt.examId}`)
    if (!validTimestamp(attempt.completedAt, now)) errors.push(`Invalid examination timestamp: ${attempt.examId}`)
    if (!(attempt.score >= 0 && attempt.score <= 100)) errors.push(`Invalid examination score: ${attempt.examId}`)
  }
  for (const [id, state] of Object.entries(progress?.capstones ?? {})) {
    if (!state.passed) continue
    const capstone = data.capstones.find(item => item.id === id)
    if (!capstone) continue
    const total = capstone.rubric.reduce((sum, criterion) => sum + Number(state.criteria?.[criterion.id]?.earned ?? 0), 0)
    const criticalMet = capstone.rubric.filter(item => item.critical).every(item => Number(state.criteria?.[item.id]?.earned ?? 0) > 0 && String(state.criteria?.[item.id]?.evidence ?? "").trim())
    const finalPassed = progress.examAttempts.some(attempt => attempt.examId === capstone.prerequisiteExamId && attempt.passed)
    const modulesReady = capstone.requiredModules.every(moduleId => {
      const module = data.modules.find(item => item.id === moduleId)
      return Boolean(module && moduleGate(progress, module, data).passed)
    })
    if (total < capstone.passPoints || !criticalMet || !state.humanReviewed || !String(state.reviewer ?? "").trim() || !finalPassed || !modulesReady) errors.push(`Capstone ${id} is marked passed without satisfying all gates`)
  }
  for (const event of progress?.studyEvents ?? []) {
    if (!conceptIds.has(event.conceptId)) errors.push(`Unknown study concept: ${event.conceptId}`)
    if (!validTimestamp(event.at, now)) errors.push(`Invalid study timestamp: ${event.conceptId}`)
  }

  return { valid: errors.length === 0, errors }
}

export function importProgress(value, data, now = new Date()) {
  const parsed = typeof value === "string" ? JSON.parse(value) : clone(value)
  const result = validateProgress(parsed, data, now)
  if (!result.valid) throw new Error(`Progress import rejected:\n${result.errors.join("\n")}`)
  parsed.learner.displayName = String(parsed.learner.displayName ?? "").slice(0, 80)
  parsed.settings = {
    textScale: Math.min(1.4, Math.max(0.9, Number(parsed.settings?.textScale) || 1)),
    highContrast: Boolean(parsed.settings?.highContrast),
    reducedMotion: Boolean(parsed.settings?.reducedMotion),
  }
  return parsed
}

export function markConceptStudied(progress, conceptId, now = new Date()) {
  const next = clone(progress)
  const timestamp = new Date(now).toISOString()
  next.studyEvents.push({ conceptId, at: timestamp })
  next.studyEvents = next.studyEvents.slice(-5000)
  const current = next.concepts[conceptId] ?? { highConfidenceMisses: 0, remediationsOpened: 0, correctSinceMisconception: 0, unresolvedMisconception: false }
  const remediationsOpened = (current.remediationsOpened ?? 0) + 1
  const remediationRequired = false
  next.concepts[conceptId] = {
    ...current,
    remediationsOpened,
    remediationRequired,
    unresolvedMisconception: Boolean(current.unresolvedMisconception && (current.correctSinceMisconception ?? 0) < 2),
  }
  next.updatedAt = timestamp
  return next
}

function nextReviewStage(previous, correct) {
  if (!correct) return 0
  return Math.min(REVIEW_DELAYS_MS.length - 1, Math.max(0, previous) + 1)
}

export function recordQuestionAttempt(progress, question, response, confidence, now = new Date()) {
  const numericConfidence = Number(confidence)
  if (![1, 2, 3, 4, 5].includes(numericConfidence)) throw new Error("Choose confidence from 1 through 5 before submitting")
  const result = gradeAnswer(question, response)
  const next = clone(progress)
  const timestamp = new Date(now).toISOString()
  const previous = next.questions[question.id] ?? {
    attempts: [], reviewStage: 0, dueAt: null, correctStreak: 0,
    incorrectHighConfidence: false, correctSinceMisconception: 0,
  }
  const reviewStage = nextReviewStage(previous.reviewStage, result.correct)
  const delay = REVIEW_DELAYS_MS[reviewStage]
  const dueAt = new Date(new Date(now).getTime() + delay).toISOString()
  const highConfidenceMiss = !result.correct && numericConfidence >= 4
  const correctSinceMisconception = result.correct && previous.incorrectHighConfidence
    ? (previous.correctSinceMisconception ?? 0) + 1
    : result.correct ? previous.correctSinceMisconception ?? 0 : 0
  const incorrectHighConfidence = highConfidenceMiss
    ? true
    : previous.incorrectHighConfidence && correctSinceMisconception < 2
  const attempt = {
    at: timestamp,
    correct: result.correct,
    partial: Number(result.partial.toFixed(3)),
    confidence: numericConfidence,
    skill: question.skill,
    difficulty: question.difficulty,
    response: result.response,
  }
  next.questions[question.id] = {
    attempts: [...previous.attempts, attempt].slice(-100),
    reviewStage,
    dueAt,
    lastAnsweredAt: timestamp,
    lastCorrect: result.correct,
    lastConfidence: numericConfidence,
    correctStreak: result.correct ? (previous.correctStreak ?? 0) + 1 : 0,
    incorrectHighConfidence,
    correctSinceMisconception,
  }
  for (const conceptId of question.concepts) {
    const current = next.concepts[conceptId] ?? { highConfidenceMisses: 0, remediationsOpened: 0, correctSinceMisconception: 0, unresolvedMisconception: false, remediationRequired: false }
    const correctSince = highConfidenceMiss
      ? 0
      : result.correct && current.unresolvedMisconception ? (current.correctSinceMisconception ?? 0) + 1 : current.correctSinceMisconception ?? 0
    const remediationRequired = highConfidenceMiss ? true : Boolean(current.remediationRequired)
    next.concepts[conceptId] = {
      ...current,
      highConfidenceMisses: current.highConfidenceMisses + (highConfidenceMiss ? 1 : 0),
      correctSinceMisconception: correctSince,
      remediationRequired,
      unresolvedMisconception: highConfidenceMiss || Boolean(current.unresolvedMisconception && (correctSince < 2 || remediationRequired)),
      lastAttemptAt: timestamp,
    }
  }
  next.updatedAt = timestamp
  return { progress: next, result }
}

export function calculateResults(responses, questionsById) {
  let earned = 0
  let available = 0
  const bySkill = {}
  const byModule = {}
  let criticalMisses = 0
  for (const response of responses) {
    const question = questionsById.get(response.questionId)
    if (!question) continue
    const weight = difficultyWeight(question.difficulty)
    const correct = Boolean(response.correct)
    available += weight
    if (correct) earned += weight
    const groups = [[bySkill, question.skill], [byModule, question.moduleId]]
    for (const [target, key] of groups) {
      const value = target[key] ?? { earned: 0, available: 0, correct: 0, total: 0 }
      value.available += weight
      value.earned += correct ? weight : 0
      value.correct += correct ? 1 : 0
      value.total += 1
      target[key] = value
    }
    if (question.critical && !correct) criticalMisses += 1
  }
  const finish = groups => Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, {
    ...value,
    percent: value.available ? Number((100 * value.earned / value.available).toFixed(1)) : 0,
  }]))
  return {
    score: available ? Number((100 * earned / available).toFixed(1)) : 0,
    correct: responses.filter(item => item.correct).length,
    total: responses.length,
    criticalMisses,
    bySkill: finish(bySkill),
    byModule: finish(byModule),
  }
}

function questionPriority(question, progress, now) {
  const state = progress.questions[question.id]
  if (!state) return 50 + question.difficulty
  const due = state.dueAt ? new Date(state.dueAt).getTime() : Infinity
  const overdueHours = Number.isFinite(due) ? Math.max(0, (now.getTime() - due) / 3_600_000) : 0
  if (state.incorrectHighConfidence) return 10000 + overdueHours + (question.critical ? 1000 : 0)
  if (due <= now.getTime()) return 5000 + overdueHours + (question.critical ? 1000 : 0)
  if (state.lastCorrect && state.lastConfidence <= 2) return 500 + question.difficulty
  return 10 - state.reviewStage + question.difficulty
}

export function buildReviewQueue(progress, questions, now = new Date(), limit = 30) {
  const dueOrWeak = questions.filter(question => {
    const state = progress.questions[question.id]
    if (!state) return false
    return state.incorrectHighConfidence || (state.dueAt && new Date(state.dueAt) <= now) || (state.lastCorrect && state.lastConfidence <= 2)
  })
  return dueOrWeak
    .map(question => ({ question, priority: questionPriority(question, progress, now) }))
    .sort((left, right) => right.priority - left.priority || left.question.id.localeCompare(right.question.id))
    .slice(0, limit)
    .map(item => item.question)
}

function addIfAvailable(selected, pool, predicate = () => true) {
  const item = pool.find(question => !selected.some(existing => existing.id === question.id) && predicate(question))
  if (item) selected.push(item)
}

export function selectQuestions(questions, options = {}) {
  const {
    count = 10,
    moduleIds = [],
    skills = [],
    criticalConcepts = [],
    minimumDifficulty = 1,
    seed = "airdash-academy",
    excludeIds = [],
  } = options
  const excluded = new Set(excludeIds)
  const modules = new Set(moduleIds)
  const eligible = seededShuffle(questions.filter(question =>
    !excluded.has(question.id)
    && question.difficulty >= minimumDifficulty
    && (modules.size === 0 || modules.has(question.moduleId)),
  ), seed)
  const selected = []

  for (const conceptId of criticalConcepts) addIfAvailable(selected, eligible, question => question.critical && question.concepts.includes(conceptId))
  for (const moduleId of moduleIds) addIfAvailable(selected, eligible, question => question.moduleId === moduleId)
  for (const skill of skills) addIfAvailable(selected, eligible, question => question.skill === skill)

  const conceptCounts = new Map()
  while (selected.length < Math.min(count, eligible.length)) {
    const remaining = eligible.filter(question => !selected.some(item => item.id === question.id))
    if (!remaining.length) break
    remaining.sort((left, right) => {
      const leftCoverage = Math.min(...left.concepts.map(id => conceptCounts.get(id) ?? 0))
      const rightCoverage = Math.min(...right.concepts.map(id => conceptCounts.get(id) ?? 0))
      return leftCoverage - rightCoverage || right.difficulty - left.difficulty || left.id.localeCompare(right.id)
    })
    const chosen = remaining[0]
    selected.push(chosen)
    for (const conceptId of chosen.concepts) conceptCounts.set(conceptId, (conceptCounts.get(conceptId) ?? 0) + 1)
  }
  return selected.slice(0, count)
}

function correctQuestionIds(progress, questions, skills) {
  return new Set(questions
    .filter(question => skills.includes(question.skill) && progress.questions[question.id]?.attempts?.some(attempt => attempt.correct))
    .map(question => question.id))
}

export function deriveConceptEvidence(progress, concept, data) {
  const mappedQuestions = data.questions.filter(question => question.concepts.includes(concept.id))
  const studied = progress.studyEvents.some(event => event.conceptId === concept.id)
  const recallCorrect = correctQuestionIds(progress, mappedQuestions, ["recall", "explain"]).size
  const higherCorrect = correctQuestionIds(progress, mappedQuestions, HIGHER_ORDER_SKILLS).size
  const unresolved = Boolean(progress.concepts[concept.id]?.unresolvedMisconception)
  const practical = data.labs.some(lab => lab.concepts.includes(concept.id) && progress.labs[lab.id]?.passed)
  const retainedQuestions = mappedQuestions.filter(question => (progress.questions[question.id]?.reviewStage ?? 0) >= 6)
  const retainedRecall = retainedQuestions.some(question => ["recall", "explain"].includes(question.skill))
  const retainedHigher = retainedQuestions.some(question => HIGHER_ORDER_SKILLS.includes(question.skill))
  const modulePass = progress.moduleAttempts
    .filter(attempt => attempt.moduleId === concept.moduleId && attempt.passed)
    .at(-1)
  const integrated = data.capstones.some(capstone => {
    const state = progress.capstones[capstone.id]
    return state?.humanReviewed && state?.passed && capstone.rubric.some(item => item.concepts.includes(concept.id) && state.criteria?.[item.id]?.earned > 0)
  })

  let level = 0
  if (studied) level = 1
  if (recallCorrect >= 2) level = 2
  if (level >= 2 && higherCorrect >= 2) level = 3
  if (level >= 3 && practical && modulePass) level = 4
  if (level >= 4 && retainedRecall && retainedHigher && !unresolved) level = 5
  if (level >= 5 && integrated) level = 6
  return {
    level,
    name: ["Unseen", "Introduced", "Recalled", "Applied", "Demonstrated", "Retained", "Integrated"][level],
    studied,
    recallCorrect,
    higherCorrect,
    practical,
    modulePass: Boolean(modulePass),
    retainedRecall,
    retainedHigher,
    unresolvedMisconception: unresolved,
    integrated,
  }
}

function latestModuleAttempt(progress, moduleId) {
  return progress.moduleAttempts.filter(item => item.moduleId === moduleId).at(-1) ?? null
}

export function moduleGate(progress, module, data, visited = new Set()) {
  if (visited.has(module.id)) return { passed: false, conditions: { prerequisites: false }, prerequisites: [], concepts: [], labs: [], attempt: null }
  const nextVisited = new Set(visited).add(module.id)
  const prerequisites = module.prerequisites.map(id => {
    const prerequisite = data.modules.find(item => item.id === id)
    return { id, passed: Boolean(prerequisite && moduleGate(progress, prerequisite, data, nextVisited).passed) }
  })
  const concepts = data.concepts.filter(concept => concept.moduleId === module.id)
  const evidence = concepts.map(concept => ({ id: concept.id, ...deriveConceptEvidence(progress, concept, data) }))
  const attempt = latestModuleAttempt(progress, module.id)
  const labs = module.requiredLabs.map(id => ({ id, passed: Boolean(progress.labs[id]?.passed) }))
  const referencesOpened = concepts.every(concept => evidence.find(item => item.id === concept.id)?.studied)
  const skillScores = attempt?.bySkill ?? {}
  const skillMinimumsMet = module.requiredSkills.every(skill => (skillScores[skill]?.percent ?? 0) >= module.minimumSkillPercent)
  const conditions = {
    prerequisites: prerequisites.every(item => item.passed),
    referencesOpened,
    score: Boolean(attempt && attempt.score >= module.passPercent),
    skillMinimums: skillMinimumsMet,
    conceptsApplied: evidence.every(item => item.level >= 3),
    labs: labs.every(item => item.passed),
    misconceptions: evidence.every(item => !item.unresolvedMisconception),
  }
  return {
    passed: Object.values(conditions).every(Boolean),
    conditions,
    prerequisites,
    concepts: evidence,
    labs,
    attempt,
  }
}

export function recordSessionAttempt(progress, session, results, now = new Date()) {
  const next = clone(progress)
  const completedAt = new Date(now).toISOString()
  const record = {
    id: `${session.kind}-${new Date(now).getTime()}`,
    questionIds: session.questionIds,
    responses: session.responses,
    completedAt,
    ...results,
  }
  if (session.kind === "module") {
    record.moduleId = session.moduleId
    const module = session.module
    record.passed = results.score >= module.passPercent
      && module.requiredSkills.every(skill => (results.bySkill[skill]?.percent ?? 0) >= module.minimumSkillPercent)
      && results.criticalMisses === 0
    next.moduleAttempts.push(record)
  } else if (session.kind === "exam") {
    record.examId = session.examId
    const exam = session.exam
    record.passed = results.score >= exam.passPercent
      && Object.values(results.byModule).every(item => item.percent >= exam.minimumModulePercent)
      && Object.values(results.bySkill).every(item => item.percent >= exam.minimumSkillPercent)
      && results.criticalMisses === 0
    next.examAttempts.push(record)
  }
  next.updatedAt = completedAt
  return { progress: next, record }
}

export function progressSummary(progress, data, now = new Date()) {
  const conceptEvidence = data.concepts.map(concept => deriveConceptEvidence(progress, concept, data))
  const moduleGates = data.modules.map(module => ({ module, gate: moduleGate(progress, module, data) }))
  const reviews = buildReviewQueue(progress, data.questions, now, 1000)
  const levels = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(level => [level, conceptEvidence.filter(item => item.level === level).length]))
  return {
    levels,
    demonstratedModules: moduleGates.filter(item => item.gate.passed).length,
    totalModules: data.modules.length,
    dueReviews: reviews.length,
    misconceptions: conceptEvidence.filter(item => item.unresolvedMisconception).length,
    retainedConcepts: conceptEvidence.filter(item => item.level >= 5).length,
    integratedConcepts: conceptEvidence.filter(item => item.level >= 6).length,
  }
}
