import { readFile, readdir, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { checkerRegistry, repositoryRoot } from "./checks.mjs"
import { CURRICULUM_VERSION, HIGHER_ORDER_SKILLS, SKILLS, selectQuestions } from "./engine.mjs"

const academyDir = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(academyDir, "data")
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const phases = new Set(["orientation", "development-foundations", "application-development", "system-engineering", "production-engineering", "professional-practice"])
const questionTypes = new Set(["single", "multi", "boolean", "short", "order"])
const labClasses = new Set(["automated", "inspected", "self-attested"])
const labTiers = new Set(["guided", "independent"])
const bannedQuestionText = [/all of the above/i, /none of the above/i, /obviously/i, /\btrivial\b/i, /\bsimply\b/i, /\bjust\b/i, /\bnot\s+not\b/i]

async function loadJson(relative) {
  return JSON.parse(await readFile(path.join(dataDir, relative), "utf8"))
}

export async function loadCurriculum() {
  const [modules, concepts, labs, exams, capstones] = await Promise.all([
    loadJson("modules.json"), loadJson("concepts.json"), loadJson("labs.json"), loadJson("exams.json"), loadJson("capstones.json"),
  ])
  const questionBanks = await Promise.all(modules.map(async module => ({ module, questions: await loadJson(module.questionFile) })))
  return { modules, concepts, labs, exams, capstones, questions: questionBanks.flatMap(item => item.questions), questionBanks }
}

function githubAnchor(value) {
  return value
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim().toLowerCase()
    .replace(/[^\p{L}\p{N}_\- ]/gu, "")
    .replace(/ /g, "-")
}

const headingCache = new Map()
async function markdownAnchors(file) {
  if (headingCache.has(file)) return headingCache.get(file)
  const text = await readFile(file, "utf8")
  const counts = new Map()
  const result = new Set()
  let fenced = false
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) { fenced = !fenced; continue }
    if (fenced) continue
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*$/)
    if (!match) continue
    const base = githubAnchor(match[1])
    const count = counts.get(base) ?? 0
    result.add(count ? `${base}-${count}` : base)
    counts.set(base, count + 1)
  }
  headingCache.set(file, result)
  return result
}

async function checkReference(reference, errors, context) {
  if (typeof reference !== "string" || !reference) return errors.push(`${context}: empty reference`)
  if (/^https?:/.test(reference)) return
  const [filePart, anchor] = reference.split("#", 2)
  const absolute = path.resolve(repositoryRoot, filePart)
  if (!absolute.startsWith(`${repositoryRoot}${path.sep}`) || !existsSync(absolute)) return errors.push(`${context}: missing reference ${reference}`)
  if (anchor && filePart.endsWith(".md") && !(await markdownAnchors(absolute)).has(anchor)) errors.push(`${context}: missing heading anchor ${reference}`)
}

async function checkSourceEvidence(reference, errors, context) {
  if ((reference.startsWith("docs/") || reference.startsWith("academy/")) && reference.includes("#")) return checkReference(reference, errors, context)
  const separator = reference.indexOf(":")
  const filePart = separator > 1 ? reference.slice(0, separator) : reference
  const symbol = separator > 1 ? reference.slice(separator + 1) : ""
  if (filePart.startsWith("site/") || filePart === "api/.env") return
  const absolute = path.resolve(repositoryRoot, filePart)
  if (!absolute.startsWith(`${repositoryRoot}${path.sep}`) || !existsSync(absolute)) return errors.push(`${context}: missing source evidence ${reference}`)
  if (symbol) {
    const metadata = await stat(absolute)
    if (metadata.isFile()) {
      const text = await readFile(absolute, "utf8")
      if (filePart.endsWith(".json") && symbol.includes(".")) {
        let value = JSON.parse(text)
        for (const part of symbol.split(".")) value = value?.[part]
        if (value === undefined) errors.push(`${context}: JSON source path not found ${reference}`)
      } else {
        const normalizedSymbol = /^app\.(?:get|post|put|patch|delete)\(/.test(symbol) ? symbol.replace(/\)$/, "") : symbol
        if (!text.includes(normalizedSymbol)) errors.push(`${context}: source symbol not found ${reference}`)
      }
    }
  }
}

function duplicateIds(items, kind, errors) {
  const seen = new Set()
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) { errors.push(`${kind}: item must be an object`); continue }
    if (!idPattern.test(item.id ?? "")) errors.push(`${kind}: invalid ID ${item.id}`)
    if (seen.has(item.id)) errors.push(`${kind}: duplicate ID ${item.id}`)
    seen.add(item.id)
  }
  return seen
}

function cycleCheck(modules, errors) {
  const graph = new Map(modules.map(module => [module.id, module.prerequisites]))
  const visiting = new Set(), visited = new Set()
  function visit(id) {
    if (visiting.has(id)) return errors.push(`modules: prerequisite cycle includes ${id}`)
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of graph.get(id) ?? []) visit(dependency)
    visiting.delete(id); visited.add(id)
  }
  for (const id of graph.keys()) visit(id)
}

export async function validateCurriculum(data) {
  const errors = []
  const warnings = []
  const moduleIds = duplicateIds(data.modules, "modules", errors)
  const conceptIds = duplicateIds(data.concepts, "concepts", errors)
  const questionIds = duplicateIds(data.questions, "questions", errors)
  const labIds = duplicateIds(data.labs, "labs", errors)
  const examIds = duplicateIds(data.exams, "exams", errors)
  const capstoneIds = duplicateIds(data.capstones, "capstones", errors)
  void questionIds; void examIds; void capstoneIds

  const orders = data.modules.map(module => module.order)
  const expectedOrders = Array.from({ length: data.modules.length }, (_, index) => index + 1)
  if (orders.join(",") !== expectedOrders.join(",")) errors.push("modules: order must be unique, sorted, and contiguous from 1")
  for (const module of data.modules) {
    if (!phases.has(module.phase)) errors.push(`${module.id}: invalid phase ${module.phase}`)
    if (!Array.isArray(module.prerequisites)) errors.push(`${module.id}: prerequisites must be an array`)
    for (const prerequisite of module.prerequisites ?? []) {
      const target = data.modules.find(item => item.id === prerequisite)
      if (!target) errors.push(`${module.id}: unknown prerequisite ${prerequisite}`)
      else if (target.order >= module.order) errors.push(`${module.id}: prerequisite ${prerequisite} is not earlier`)
    }
    if (!Array.isArray(module.requiredSkills) || !module.requiredSkills.length || module.requiredSkills.some(skill => !SKILLS.includes(skill))) errors.push(`${module.id}: invalid requiredSkills`)
    if (!Number.isInteger(module.examQuestionCount) || module.examQuestionCount < 10) errors.push(`${module.id}: examQuestionCount must be at least 10`)
    if (module.passPercent < 90 || module.minimumSkillPercent < 80) errors.push(`${module.id}: gate thresholds are below the mastery model`)
    if (module.questionFile !== `questions/${module.id}.json`) errors.push(`${module.id}: questionFile must match its stable module ID`)
    for (const reference of module.references ?? []) await checkReference(reference, errors, module.id)
  }
  cycleCheck(data.modules, errors)

  for (const bank of data.questionBanks) {
    if (!Array.isArray(bank.questions)) errors.push(`${bank.module.id}: question bank must be an array`)
    for (const question of bank.questions ?? []) if (question.moduleId !== bank.module.id) errors.push(`${question.id}: moduleId does not match ${bank.module.questionFile}`)
  }

  for (const concept of data.concepts) {
    if (!moduleIds.has(concept.moduleId)) errors.push(`${concept.id}: unknown module ${concept.moduleId}`)
    if (String(concept.definition ?? "").length < 25) errors.push(`${concept.id}: definition is too short`)
    if (String(concept.why ?? "").length < 25) errors.push(`${concept.id}: why is too short`)
    if (!Array.isArray(concept.outcomes) || concept.outcomes.length < 2 || new Set(concept.outcomes).size !== concept.outcomes.length) errors.push(`${concept.id}: requires at least two unique outcomes`)
    if (!Array.isArray(concept.references) || !concept.references.length) errors.push(`${concept.id}: missing canonical reference`)
    if (!Array.isArray(concept.sourceEvidence) || !concept.sourceEvidence.length) errors.push(`${concept.id}: missing source evidence`)
    for (const reference of concept.references ?? []) await checkReference(reference, errors, concept.id)
    for (const source of concept.sourceEvidence ?? []) await checkSourceEvidence(source, errors, concept.id)
  }

  const prompts = new Map()
  for (const question of data.questions) {
    if (!moduleIds.has(question.moduleId)) errors.push(`${question.id}: unknown module ${question.moduleId}`)
    if (!questionTypes.has(question.type)) errors.push(`${question.id}: invalid type ${question.type}`)
    if (!SKILLS.includes(question.skill)) errors.push(`${question.id}: invalid skill ${question.skill}`)
    if (!Number.isInteger(question.difficulty) || question.difficulty < 1 || question.difficulty > 5) errors.push(`${question.id}: difficulty must be 1 through 5`)
    if (String(question.prompt ?? "").length < 20) errors.push(`${question.id}: prompt is too short`)
    if (String(question.explanation ?? "").length < 30) errors.push(`${question.id}: explanation is too short`)
    if (bannedQuestionText.some(pattern => pattern.test(question.prompt)) || (question.choices ?? []).some(choice => bannedQuestionText.some(pattern => pattern.test(choice.text)))) errors.push(`${question.id}: prohibited question wording`)
    const normalizedPrompt = String(question.prompt).toLowerCase().replace(/\s+/g, " ")
    if (prompts.has(normalizedPrompt)) errors.push(`${question.id}: duplicate prompt with ${prompts.get(normalizedPrompt)}`)
    prompts.set(normalizedPrompt, question.id)
    if (!Array.isArray(question.concepts) || question.concepts.length < 1 || question.concepts.length > 3 || new Set(question.concepts).size !== question.concepts.length) errors.push(`${question.id}: must map one to three unique concepts`)
    for (const conceptId of question.concepts ?? []) {
      const concept = data.concepts.find(item => item.id === conceptId)
      if (!concept) errors.push(`${question.id}: unknown concept ${conceptId}`)
      else if (!question.integration && concept.moduleId !== question.moduleId) errors.push(`${question.id}: cross-module concept requires integration=true`)
    }
    if (["single", "multi", "order"].includes(question.type)) {
      if (!Array.isArray(question.choices) || question.choices.length < 3 || question.choices.length > 8) errors.push(`${question.id}: invalid choice count`)
      const choiceIds = (question.choices ?? []).map(choice => choice.id)
      const choiceText = (question.choices ?? []).map(choice => choice.text)
      if (new Set(choiceIds).size !== choiceIds.length || new Set(choiceText).size !== choiceText.length) errors.push(`${question.id}: duplicate choice ID or text`)
      if (!Array.isArray(question.answer) || question.answer.some(value => !choiceIds.includes(value))) errors.push(`${question.id}: answer refers to an unknown choice`)
      if (question.type === "single" && question.answer?.length !== 1) errors.push(`${question.id}: single question requires one answer`)
      if (question.type === "multi" && question.answer?.length < 2) errors.push(`${question.id}: multi question requires at least two answers`)
      if (question.type === "order" && (question.answer?.length !== choiceIds.length || new Set(question.answer).size !== choiceIds.length)) errors.push(`${question.id}: order answer must contain every choice exactly once`)
    }
    if (question.type === "boolean" && !(["true", "false"].includes(question.answer?.[0]) && question.answer.length === 1)) errors.push(`${question.id}: boolean answer must be true or false`)
    if (question.type === "short" && (!Array.isArray(question.accepted) || !question.accepted.length || question.accepted.some(value => typeof value !== "string" || !value.trim()))) errors.push(`${question.id}: short answer requires accepted strings`)
    if (question.critical && (question.difficulty < 4 || !["apply", "diagnose", "secure", "operate"].includes(question.skill))) errors.push(`${question.id}: critical question must be higher-order difficulty 4 or 5`)
    if (!Array.isArray(question.remediation) || !question.remediation.length) errors.push(`${question.id}: missing remediation`)
    if (!Array.isArray(question.sourceRefs) || !question.sourceRefs.length) errors.push(`${question.id}: missing sourceRefs`)
    for (const reference of question.remediation ?? []) await checkReference(reference, errors, question.id)
    for (const source of question.sourceRefs ?? []) await checkSourceEvidence(source, errors, question.id)
  }

  for (const concept of data.concepts) {
    const related = data.questions.filter(question => question.concepts.includes(concept.id))
    const recall = related.filter(question => ["recall", "explain"].includes(question.skill))
    const higher = related.filter(question => HIGHER_ORDER_SKILLS.includes(question.skill))
    if (related.length < 4 || recall.length < 2 || higher.length < 2) errors.push(`${concept.id}: insufficient question evidence (${recall.length} recall/explain, ${higher.length} higher-order)`)
    if (concept.critical && related.filter(question => question.critical).length < 2) errors.push(`${concept.id}: critical concept needs at least two critical questions`)
    const practical = data.labs.some(lab => lab.concepts.includes(concept.id)) || data.capstones.some(capstone => capstone.rubric.some(item => item.concepts.includes(concept.id)))
    if (!practical) errors.push(`${concept.id}: no practical or capstone evidence`)
  }

  for (const module of data.modules) {
    const questions = data.questions.filter(question => question.moduleId === module.id)
    const labs = data.labs.filter(lab => lab.moduleId === module.id)
    if (questions.length < 12) errors.push(`${module.id}: requires at least 12 questions`)
    if (module.examQuestionCount > questions.length) errors.push(`${module.id}: examQuestionCount exceeds question bank`)
    for (const skill of module.requiredSkills) if (!questions.some(question => question.skill === skill)) errors.push(`${module.id}: no question for required skill ${skill}`)
    if (!labs.length) errors.push(`${module.id}: requires at least one lab`)
    for (const id of module.requiredLabs) {
      const required = data.labs.find(lab => lab.id === id)
      if (!required) errors.push(`${module.id}: unknown required lab ${id}`)
      else if (required.moduleId !== module.id) errors.push(`${module.id}: required lab ${id} belongs to another module`)
    }
  }

  const usedCheckers = new Set()
  for (const lab of data.labs) {
    if (!moduleIds.has(lab.moduleId)) errors.push(`${lab.id}: unknown module ${lab.moduleId}`)
    if (!labClasses.has(lab.class)) errors.push(`${lab.id}: invalid class ${lab.class}`)
    if (!labTiers.has(lab.tier)) errors.push(`${lab.id}: invalid tier ${lab.tier}`)
    if (!Array.isArray(lab.concepts) || !lab.concepts.length || lab.concepts.some(id => !conceptIds.has(id))) errors.push(`${lab.id}: invalid concepts`)
    if (!Array.isArray(lab.instructions) || lab.instructions.length < 4) errors.push(`${lab.id}: requires at least four complete instructions`)
    if (String(lab.evidence ?? "").length < 20 || String(lab.safety ?? "").length < 20) errors.push(`${lab.id}: evidence or safety description is too short`)
    if (lab.class === "automated") {
      if (!checkerRegistry[lab.checkerId]) errors.push(`${lab.id}: unknown checker ${lab.checkerId}`)
      else usedCheckers.add(lab.checkerId)
    } else if (lab.checkerId !== null) errors.push(`${lab.id}: non-automated lab must use checkerId null`)
    if (lab.class === "self-attested" && lab.critical) errors.push(`${lab.id}: self-attested lab cannot be critical`)
    for (const reference of lab.references ?? []) await checkReference(reference, errors, lab.id)
  }
  for (const checkerId of Object.keys(checkerRegistry)) if (!usedCheckers.has(checkerId)) errors.push(`checker ${checkerId}: no automated lab documents this allow-list entry`)
  for (const concept of data.concepts.filter(item => item.critical)) {
    if (!data.labs.some(lab => lab.critical && lab.concepts.includes(concept.id)) && !data.capstones.some(capstone => capstone.rubric.some(item => item.critical && item.concepts.includes(concept.id)))) errors.push(`${concept.id}: critical concept lacks critical practical evidence`)
  }

  for (const exam of data.exams) {
    if (!Array.isArray(exam.modules) || !exam.modules.length || exam.modules.some(id => !moduleIds.has(id))) errors.push(`${exam.id}: invalid modules`)
    if (!Number.isInteger(exam.questionCount) || exam.questionCount < (exam.kind === "final" ? 60 : 30)) errors.push(`${exam.id}: question count below cumulative minimum`)
    if (exam.passPercent < 90 || exam.minimumModulePercent < 85 || exam.minimumSkillPercent < 80) errors.push(`${exam.id}: thresholds below mastery model`)
    const applicableCritical = data.concepts.filter(concept => concept.critical && exam.modules.includes(concept.moduleId)).map(concept => concept.id)
    if (applicableCritical.some(id => !exam.requiredCriticalConcepts.includes(id)) || exam.requiredCriticalConcepts.some(id => !applicableCritical.includes(id))) errors.push(`${exam.id}: requiredCriticalConcepts must equal all critical concepts in included modules`)
    const sample = selectQuestions(data.questions, { count: exam.questionCount, moduleIds: exam.modules, skills: SKILLS, criticalConcepts: exam.requiredCriticalConcepts, minimumDifficulty: exam.minimumDifficulty, seed: `validator:${exam.id}` })
    if (sample.length !== exam.questionCount) errors.push(`${exam.id}: bank cannot supply ${exam.questionCount} eligible questions`)
    for (const moduleId of exam.modules) if (!sample.some(question => question.moduleId === moduleId)) errors.push(`${exam.id}: sample lacks module ${moduleId}`)
    for (const skill of SKILLS) if (!sample.some(question => question.skill === skill)) errors.push(`${exam.id}: sample lacks skill ${skill}`)
    for (const conceptId of exam.requiredCriticalConcepts) if (!sample.some(question => question.critical && question.concepts.includes(conceptId))) errors.push(`${exam.id}: sample lacks critical concept ${conceptId}`)
    if (exam.kind === "final" && sample.filter(question => ["diagnose", "operate"].includes(question.skill)).length < 10) errors.push(`${exam.id}: final sample needs at least 10 diagnosis or operations questions`)
  }

  for (const capstone of data.capstones) {
    if (!examIds.has(capstone.prerequisiteExamId)) errors.push(`${capstone.id}: unknown prerequisite exam`)
    if (!Array.isArray(capstone.requiredModules) || capstone.requiredModules.some(id => !moduleIds.has(id))) errors.push(`${capstone.id}: invalid required modules`)
    if (!Array.isArray(capstone.artifacts) || capstone.artifacts.length < 5) errors.push(`${capstone.id}: insufficient artifacts`)
    if (!Array.isArray(capstone.rubric) || capstone.rubric.reduce((sum, item) => sum + item.points, 0) !== 100) errors.push(`${capstone.id}: rubric must total 100 points`)
    if (capstone.passPoints < 90) errors.push(`${capstone.id}: passPoints must be at least 90`)
    const mapped = new Set(capstone.rubric.flatMap(item => item.concepts))
    for (const conceptId of conceptIds) if (!mapped.has(conceptId)) errors.push(`${capstone.id}: rubric does not integrate ${conceptId}`)
    for (const item of capstone.rubric) if (!Array.isArray(item.concepts) || item.concepts.some(id => !conceptIds.has(id)) || !String(item.evidence ?? "").trim()) errors.push(`${capstone.id}/${item.id}: invalid rubric evidence or concepts`)
    for (const reference of capstone.references ?? []) await checkReference(reference, errors, capstone.id)
  }

  const stats = {
    curriculumVersion: CURRICULUM_VERSION,
    modules: data.modules.length,
    concepts: data.concepts.length,
    criticalConcepts: data.concepts.filter(item => item.critical).length,
    questions: data.questions.length,
    criticalQuestions: data.questions.filter(item => item.critical).length,
    labs: data.labs.length,
    automatedLabs: data.labs.filter(item => item.class === "automated").length,
    exams: data.exams.length,
    capstones: data.capstones.length,
    checkerAllowList: Object.keys(checkerRegistry).length,
  }
  if (data.questions.length < data.concepts.length * 2) warnings.push("Question bank is below two questions per concept overall")
  return { valid: errors.length === 0, errors, warnings, stats }
}

export async function runValidation() {
  let data
  try { data = await loadCurriculum() }
  catch (error) {
    return { valid: false, errors: [`Data load failed: ${error.message}`], warnings: [], stats: {} }
  }
  return validateCurriculum(data)
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const result = await runValidation()
  if (result.valid) {
    console.log("airDash Academy curriculum verified")
    console.log(JSON.stringify(result.stats, null, 2))
    for (const warning of result.warnings) console.warn(`warning: ${warning}`)
  } else {
    console.error(`airDash Academy validation failed with ${result.errors.length} error(s)`)
    for (const error of result.errors) console.error(`- ${error}`)
    process.exitCode = 1
  }
}
