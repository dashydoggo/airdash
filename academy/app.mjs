import {
  CURRICULUM_VERSION, STORAGE_KEY, buildReviewQueue, calculateResults, createEmptyProgress,
  deriveConceptEvidence, gradeAnswer, importProgress, markConceptStudied, moduleGate, progressSummary,
  recordQuestionAttempt, recordSessionAttempt, seededShuffle, selectQuestions, validateProgress,
} from "./engine.mjs"

const main = document.querySelector("#academy-main")
const announcer = document.querySelector("#announcer")
const headerStatus = document.querySelector("#header-status")
const dataFiles = ["modules", "concepts", "labs", "exams", "capstones"]
let data = null
let progress = null
let view = "dashboard"
let activeModuleId = null
let session = null
let lastLabResult = null
let dialog = null

const escapeHtml = value => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;")
const label = value => String(value ?? "").replaceAll("-", " ").replace(/\b\w/g, character => character.toUpperCase())
const formatDate = value => value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Not scheduled"
const percent = (value, maximum) => maximum ? Math.round(100 * value / maximum) : 0
const phaseOrder = ["orientation", "development-foundations", "application-development", "system-engineering", "production-engineering", "professional-practice"]

function announce(message) {
  announcer.textContent = ""
  window.setTimeout(() => { announcer.textContent = message }, 20)
}

function saveProgress(next = progress) {
  progress = next
  progress.updatedAt = new Date().toISOString()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
  applySettings()
  updateHeader()
}

function loadProgress() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return createEmptyProgress()
  try {
    const parsed = JSON.parse(raw)
    const result = validateProgress(parsed, data)
    if (!result.valid) throw new Error(result.errors.join("; "))
    return parsed
  } catch (error) {
    console.warn("Academy progress could not be loaded", error)
    return createEmptyProgress()
  }
}

function applySettings() {
  document.documentElement.style.setProperty("--text-scale", progress.settings.textScale)
  document.body.classList.toggle("high-contrast", progress.settings.highContrast)
  document.body.classList.toggle("reduce-motion", progress.settings.reducedMotion)
}

function updateHeader() {
  if (!data || !progress) return
  const summary = progressSummary(progress, data)
  headerStatus.innerHTML = `<strong>${summary.demonstratedModules}/${summary.totalModules}</strong> modules demonstrated · <strong>${summary.dueReviews}</strong> reviews due`
}

function updateNav() {
  document.querySelectorAll("[data-view]").forEach(button => {
    const selected = button.dataset.view === view
    button.toggleAttribute("aria-current", selected)
  })
}

function setView(nextView, options = {}) {
  view = nextView
  if (options.moduleId) activeModuleId = options.moduleId
  if (!options.keepSession && nextView !== "session") session = null
  updateNav()
  render()
  main.focus({ preventScroll: true })
  history.replaceState(null, "", `#${nextView}${activeModuleId && nextView === "module" ? `/${activeModuleId}` : ""}`)
}

function moduleProgress(module) {
  const concepts = data.concepts.filter(item => item.moduleId === module.id)
  const levels = concepts.map(concept => deriveConceptEvidence(progress, concept, data).level)
  return { concepts, levels, applied: levels.filter(level => level >= 3).length, retained: levels.filter(level => level >= 5).length }
}

function moduleUnlocked(module) {
  return module.prerequisites.every(id => {
    const prerequisite = data.modules.find(item => item.id === id)
    return prerequisite ? moduleGate(progress, prerequisite, data).passed : false
  })
}

function gateItems(gate) {
  const names = {
    prerequisites: "Prerequisite module examinations passed",
    referencesOpened: "Every concept reference opened",
    score: "Latest module examination at or above the pass score",
    skillMinimums: "Every required skill at or above its minimum",
    conceptsApplied: "Every concept at Applied evidence or higher",
    labs: "Every required practical lab passed",
    misconceptions: "No unresolved high-confidence misconception",
  }
  return Object.entries(gate.conditions).map(([key, passed]) => `<li class="${passed ? "pass" : ""}"><span class="gate-icon" aria-hidden="true">${passed ? "✓" : "×"}</span><span>${escapeHtml(names[key])}</span></li>`).join("")
}

function renderPageHeading(eyebrow, title, description, actions = "") {
  return `<header class="page-heading"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</header>`
}

function renderDashboard() {
  const summary = progressSummary(progress, data)
  const due = buildReviewQueue(progress, data.questions, new Date(), 5)
  const phaseGroups = phaseOrder.map(phase => {
    const modules = data.modules.filter(module => module.phase === phase)
    if (!modules.length) return ""
    return `<section class="phase-group"><div class="phase-label">${escapeHtml(label(phase))}</div><div class="module-list">${modules.map(renderModuleCard).join("")}</div></section>`
  }).join("")
  return `${renderPageHeading("Evidence dashboard", `Welcome${progress.learner.displayName ? `, ${progress.learner.displayName}` : ""}`, "Work from prerequisites through delayed retention. The dashboard reports recorded evidence, not a professional credential.", `<button class="button primary" data-action="smart-next">Start the next required activity</button>`)}
    <div class="callout warning"><strong>Mastery cannot be completed in one sitting.</strong><p>Retained evidence requires correct delayed reviews through the 30-day stage. Integrated evidence also requires a human-reviewed capstone.</p></div>
    <section class="metric-grid" aria-label="Academy progress summary">
      <article class="metric" data-tone="accent"><strong>${summary.demonstratedModules}/${summary.totalModules}</strong><span>Modules demonstrated</span></article>
      <article class="metric"><strong>${summary.levels[0]}</strong><span>Concepts unseen</span></article>
      <article class="metric"><strong>${summary.levels[3] + summary.levels[4] + summary.levels[5] + summary.levels[6]}</strong><span>Concepts applied+</span></article>
      <article class="metric" data-tone="success"><strong>${summary.retainedConcepts}</strong><span>Concepts retained</span></article>
      <article class="metric" data-tone="danger"><strong>${summary.misconceptions}</strong><span>Misconceptions</span></article>
      <article class="metric" data-tone="${summary.dueReviews ? "danger" : "success"}"><strong>${summary.dueReviews}</strong><span>Reviews due</span></article>
    </section>
    ${due.length ? `<section class="panel"><div class="section-heading"><div><h2>Highest-priority reviews</h2><p>Critical, overconfident, and oldest overdue items appear first.</p></div><button class="button" data-action="start-review">Review now</button></div><ol>${due.map(question => `<li><strong>${escapeHtml(question.prompt)}</strong> <span class="tag">${escapeHtml(label(question.skill))}</span></li>`).join("")}</ol></section>` : ""}
    <div class="section-heading"><div><h2>Curriculum</h2><p>Modules unlock after prerequisite examination evidence.</p></div></div>
    ${phaseGroups}`
}

function renderModuleCard(module) {
  const details = moduleProgress(module)
  const gate = moduleGate(progress, module, data)
  const unlocked = moduleUnlocked(module)
  const width = percent(details.applied, details.concepts.length)
  return `<article class="module-card">
    <span class="module-number" aria-hidden="true">${module.order}</span>
    <div><h3>${escapeHtml(module.title)}</h3><p>${escapeHtml(module.summary)}</p><div class="module-meta"><span class="tag ${gate.passed ? "success" : unlocked ? "accent" : "warning"}">${gate.passed ? "Demonstrated" : unlocked ? "Available" : "Locked"}</span><span class="tag">${details.applied}/${details.concepts.length} applied</span><span class="tag">${details.retained} retained</span></div><div class="progress-track" aria-label="${width} percent of concepts applied"><span style="width:${width}%"></span></div></div>
    <div class="module-lock">${unlocked ? `<button class="button small" data-action="open-module" data-module-id="${module.id}">Open module</button>` : `Requires ${module.prerequisites.map(id => escapeHtml(data.modules.find(item => item.id === id)?.title ?? id)).join(", ")}`}</div>
  </article>`
}

function renderLearn() {
  return `${renderPageHeading("Canonical curriculum", "Learn", "Open modules in order. Studying records introduction only; questions and labs create stronger evidence.")}
    ${phaseOrder.map(phase => {
      const modules = data.modules.filter(module => module.phase === phase)
      return modules.length ? `<section class="phase-group"><div class="phase-label">${escapeHtml(label(phase))}</div><div class="module-list">${modules.map(renderModuleCard).join("")}</div></section>` : ""
    }).join("")}`
}

function renderModule() {
  const module = data.modules.find(item => item.id === activeModuleId) ?? data.modules[0]
  activeModuleId = module.id
  const gate = moduleGate(progress, module, data)
  const concepts = data.concepts.filter(item => item.moduleId === module.id)
  const unlocked = moduleUnlocked(module)
  return `${renderPageHeading(`Module ${module.order} · ${label(module.phase)}`, module.title, module.summary, `<button class="button" data-view="learn">All modules</button><button class="button" data-action="start-diagnostic" data-module-id="${module.id}">Diagnostic</button><button class="button" data-action="start-practice" data-module-id="${module.id}" ${unlocked ? "" : "disabled"}>Practice</button><button class="button primary" data-action="start-module-exam" data-module-id="${module.id}" ${unlocked ? "" : "disabled"}>Module examination</button>`)}
    ${unlocked ? "" : `<div class="callout warning"><strong>This module is locked.</strong><p>Pass the prerequisite module examinations first. You may read the material now, but examination evidence will not unlock the next module.</p></div>`}
    <div class="two-column">
      <section><div class="section-heading"><div><h2>Atomic concepts</h2><p>Each concept needs recall and higher-order evidence.</p></div></div><div class="concept-list">${concepts.map(concept => renderConcept(concept)).join("")}</div></section>
      <aside><section class="panel"><h2>Module gate</h2><ul class="gate-list">${gateItems(gate)}</ul>${gate.attempt ? `<p class="subtle">Latest examination: ${gate.attempt.score}% on ${formatDate(gate.attempt.completedAt)}.</p>` : `<p class="subtle">No module examination attempt yet.</p>`}</section>
      <section class="panel" style="margin-top:16px"><h2>Required skills</h2><p>${module.requiredSkills.map(skill => `<span class="tag">${escapeHtml(label(skill))}</span>`).join(" ")}</p><h3>Canonical references</h3><ul>${module.references.map(reference => `<li><a href="/${escapeHtml(reference)}" target="_blank" rel="noopener">${escapeHtml(reference)}</a></li>`).join("")}</ul></section></aside>
    </div>`
}

function renderConcept(concept) {
  const evidence = deriveConceptEvidence(progress, concept, data)
  return `<article class="concept-card"><header><div><h3>${escapeHtml(concept.title)}</h3>${concept.critical ? `<span class="critical-label">Critical concept</span>` : ""}</div><span class="evidence-level" data-level="${evidence.level}">L${evidence.level} ${escapeHtml(evidence.name)}</span></header><p>${escapeHtml(concept.definition)}</p><p><strong>Why:</strong> ${escapeHtml(concept.why)}</p><ul class="concept-outcomes">${concept.outcomes.map(outcome => `<li>${escapeHtml(outcome)}</li>`).join("")}</ul><details><summary>Inspect source evidence</summary><ul>${concept.sourceEvidence.map(reference => { const file = reference.split(":")[0]; const served = !file.startsWith("site/") && file !== "api/.env"; return `<li>${served ? `<a href="/${escapeHtml(file)}" target="_blank" rel="noopener"><code>${escapeHtml(reference)}</code></a>` : `<code>${escapeHtml(reference)}</code>`}</li>` }).join("")}</ul></details><div class="concept-actions"><button class="button small" data-action="study-concept" data-concept-id="${concept.id}">${evidence.studied ? "Review reference" : "Study reference"}</button>${concept.references.slice(0, 2).map(reference => `<a class="button small" href="/${escapeHtml(reference)}" target="_blank" rel="noopener">Open documentation</a>`).join("")}</div>${evidence.unresolvedMisconception ? `<div class="callout danger"><strong>Unresolved high-confidence misconception</strong><p>Study the remediation material and answer two related questions correctly on later attempts.</p></div>` : ""}</article>`
}

function renderPracticePicker() {
  return `${renderPageHeading("Active recall and application", "Practice", "Choose an available module. Practice shows feedback after each answer and records confidence calibration.")}
    <div class="card-grid">${data.modules.map(module => { const unlocked = moduleUnlocked(module); const count = data.questions.filter(question => question.moduleId === module.id).length; return `<article class="action-card"><span class="eyebrow">Module ${module.order}</span><h2>${escapeHtml(module.title)}</h2><p>${count} questions across ${module.requiredSkills.length} required skills.</p><div class="button-row"><button class="button primary" data-action="start-practice" data-module-id="${module.id}" ${unlocked ? "" : "disabled"}>Start practice</button><button class="button" data-action="open-module" data-module-id="${module.id}">Study</button></div></article>` }).join("")}</div>`
}

function startQuestionSession(kind, sourceId) {
  let questions = []
  let title = "Practice"
  const seed = `${sourceId}:${kind}:${Date.now()}:${progress.moduleAttempts.length}:${progress.examAttempts.length}`
  if (["practice", "diagnostic", "module"].includes(kind)) {
    const module = data.modules.find(item => item.id === sourceId)
    const count = kind === "module" ? module.examQuestionCount : kind === "diagnostic" ? 8 : 12
    questions = selectQuestions(data.questions, { count, moduleIds: [module.id], skills: module.requiredSkills, seed })
    title = `${module.title} ${kind === "module" ? "examination" : kind}`
    session = { kind, title, moduleId: module.id, module, questions, index: 0, responses: [], feedback: null, startedAt: new Date().toISOString(), recordEvidence: kind !== "diagnostic" }
  } else if (kind === "review") {
    questions = buildReviewQueue(progress, data.questions, new Date(), 20)
    title = "Adaptive review"
    session = { kind, title, questions, index: 0, responses: [], feedback: null, startedAt: new Date().toISOString(), recordEvidence: true }
  } else if (kind === "exam") {
    const exam = data.exams.find(item => item.id === sourceId)
    questions = selectQuestions(data.questions, { count: exam.questionCount, moduleIds: exam.modules, skills: ["recall", "explain", "apply", "diagnose", "secure", "operate"], criticalConcepts: exam.requiredCriticalConcepts, minimumDifficulty: exam.minimumDifficulty, seed })
    session = { kind, title: exam.title, examId: exam.id, exam, questions, index: 0, responses: [], feedback: null, startedAt: new Date().toISOString(), recordEvidence: true }
  }
  if (!questions.length) { announce("No eligible questions are available for this session."); return }
  view = "session"
  updateNav()
  render()
  main.focus({ preventScroll: true })
}

function questionControl(question) {
  const choices = seededShuffle(question.choices ?? [], `${question.id}:${session.startedAt}`)
  if (question.type === "single") return `<div class="choices">${choices.map(choice => `<label class="choice"><input type="radio" name="response" value="${choice.id}" required><span>${escapeHtml(choice.text)}</span></label>`).join("")}</div>`
  if (question.type === "multi") return `<p class="subtle">Select every correct answer. Partial selections do not receive mastery credit.</p><div class="choices">${choices.map(choice => `<label class="choice"><input type="checkbox" name="response" value="${choice.id}"><span>${escapeHtml(choice.text)}</span></label>`).join("")}</div>`
  if (question.type === "boolean") return `<div class="choices"><label class="choice"><input type="radio" name="response" value="true" required><span>True</span></label><label class="choice"><input type="radio" name="response" value="false" required><span>False</span></label></div>`
  if (question.type === "short") return `<label class="field"><span>Your answer</span><input class="short-answer" type="text" name="response" autocomplete="off" required></label>`
  if (question.type === "order") return `<p class="subtle">Choose one item for each position. Each item is used once.</p><div class="order-grid">${question.answer.map((_, index) => `<label class="order-row"><strong>${index + 1}</strong><select name="order-${index}" required><option value="">Choose step</option>${choices.map(choice => `<option value="${choice.id}">${escapeHtml(choice.text)}</option>`).join("")}</select></label>`).join("")}</div>`
  return ""
}

function renderSession() {
  if (!session) return renderPracticePicker()
  if (session.finished) return renderSessionResults()
  const question = session.questions[session.index]
  const position = session.index + 1
  const examination = ["module", "exam"].includes(session.kind)
  return `<div class="question-shell">${renderPageHeading(examination ? "Independent assessment" : session.kind === "diagnostic" ? "Unscored diagnostic" : "Active retrieval", session.title, examination ? "Feedback is withheld until the examination ends." : "Answer before opening any reference, then report your confidence.", `<button class="button" data-action="abandon-session">Exit session</button>`)}
    <div class="session-progress"><div class="progress-track" aria-label="Question ${position} of ${session.questions.length}"><span style="width:${percent(position - 1, session.questions.length)}%"></span></div><span>${position} / ${session.questions.length}</span></div>
    <article class="question-card"><div class="question-top"><span class="tag">${escapeHtml(label(question.skill))}</span><span class="tag">Difficulty ${question.difficulty}</span>${question.critical ? `<span class="tag danger">Critical</span>` : ""}</div><h2>${escapeHtml(question.prompt)}</h2>
      <form id="question-form" data-question-id="${question.id}">${questionControl(question)}<fieldset class="confidence"><legend>Confidence before feedback</legend><div class="confidence-options">${[1,2,3,4,5].map(value => `<label><input type="radio" name="confidence" value="${value}" required><span>${value}</span></label>`).join("")}</div></fieldset>
      ${session.feedback ? renderFeedback(question, examination) : `<button class="button primary" type="submit">Submit answer</button>`}</form>
    </article></div>`
}

function renderFeedback(question, examination) {
  const feedback = session.feedback
  if (examination) return `<div class="feedback"><h3>Response recorded</h3><p>Correctness and explanation are withheld until this examination ends.</p></div><button class="button primary" type="button" data-action="next-question">${session.index + 1 === session.questions.length ? "Finish examination" : "Next question"}</button>`
  const resultText = feedback.correct ? "Correct" : feedback.partial > 0 ? `Not fully correct (${Math.round(feedback.partial * 100)}% of the expected selection)` : "Incorrect"
  return `<div class="feedback ${feedback.correct ? "correct" : ""}" role="status"><h3>${resultText}</h3><p>${escapeHtml(question.explanation)}</p><div class="feedback-links">${question.remediation.map(reference => `<a class="button small" href="/${escapeHtml(reference)}" target="_blank" rel="noopener">Review remediation</a>`).join("")}</div></div><button class="button primary" type="button" data-action="next-question">${session.index + 1 === session.questions.length ? "Finish session" : "Next question"}</button>`
}

function readResponse(form, question) {
  const formData = new FormData(form)
  if (question.type === "multi") return formData.getAll("response")
  if (question.type === "order") return question.answer.map((_, index) => formData.get(`order-${index}`))
  return formData.get("response")
}

function submitQuestion(form) {
  const question = session.questions[session.index]
  const response = readResponse(form, question)
  const confidence = Number(new FormData(form).get("confidence"))
  let result
  if (session.recordEvidence) {
    const recorded = recordQuestionAttempt(progress, question, response, confidence)
    result = recorded.result
    saveProgress(recorded.progress)
  } else {
    result = gradeAnswer(question, response)
  }
  session.responses.push({ questionId: question.id, correct: result.correct, partial: result.partial, confidence, response: result.response })
  session.feedback = result
  render()
  document.querySelector(".feedback")?.focus?.()
  announce(result.correct ? "Correct." : "Response recorded. Review the feedback.")
}

function nextQuestion() {
  session.feedback = null
  if (session.index + 1 < session.questions.length) {
    session.index += 1
    render()
    document.querySelector(".question-card h2")?.focus?.()
    return
  }
  const byId = new Map(data.questions.map(question => [question.id, question]))
  const results = calculateResults(session.responses, byId)
  if (["module", "exam"].includes(session.kind)) {
    const recorded = recordSessionAttempt(progress, { ...session, questionIds: session.questions.map(item => item.id) }, results)
    saveProgress(recorded.progress)
    session.record = recorded.record
  }
  session.results = results
  session.finished = true
  render()
  announce(`Session finished with ${results.score} percent.`)
}

function renderSessionResults() {
  const result = session.results
  const missed = session.responses.filter(item => !item.correct).map(response => data.questions.find(item => item.id === response.questionId)).filter(Boolean)
  const passed = session.record?.passed
  return `${renderPageHeading("Assessment result", session.title, "Review every gap before another attempt.", `<button class="button primary" data-action="finish-session">Return to dashboard</button>`)}
    <div class="two-column"><section class="panel result-score"><strong>${result.score}%</strong><p>${result.correct} of ${result.total} questions correct${session.record ? ` · ${passed ? "assessment threshold passed" : "assessment threshold not met"}` : ""}</p>${result.criticalMisses ? `<div class="callout danger"><strong>${result.criticalMisses} critical question${result.criticalMisses === 1 ? "" : "s"} missed</strong><p>A cumulative examination cannot pass with any critical miss.</p></div>` : ""}</section>
    <section class="panel"><h2>Skill scores</h2><table class="result-table"><thead><tr><th>Skill</th><th>Score</th></tr></thead><tbody>${Object.entries(result.bySkill).map(([skill, value]) => `<tr><td>${escapeHtml(label(skill))}</td><td>${value.percent}%</td></tr>`).join("")}</tbody></table></section></div>
    ${missed.length ? `<section class="panel" style="margin-top:20px"><h2>Required remediation</h2>${missed.map(question => `<article class="concept-card"><h3>${escapeHtml(question.prompt)}</h3><p>${escapeHtml(question.explanation)}</p><div class="concept-actions">${question.remediation.map(reference => `<a class="button small" href="/${escapeHtml(reference)}" target="_blank" rel="noopener">${escapeHtml(reference)}</a>`).join("")}</div></article>`).join("")}</section>` : `<div class="callout success"><strong>No missed questions</strong><p>Continue with practical evidence and delayed review; a perfect immediate score is not retained mastery.</p></div>`}`
}

function renderReview() {
  const queue = buildReviewQueue(progress, data.questions, new Date(), 100)
  return `${renderPageHeading("Spaced retrieval", "Review", "Overdue critical items and high-confidence misconceptions appear first.", `<button class="button primary" data-action="start-review" ${queue.length ? "" : "disabled"}>Start review (${queue.length})</button>`)}
    ${queue.length ? `<div class="panel"><table class="result-table"><thead><tr><th>Due item</th><th>Skill</th><th>Due</th></tr></thead><tbody>${queue.map(question => { const state = progress.questions[question.id]; return `<tr><td>${escapeHtml(question.prompt)}</td><td>${escapeHtml(label(question.skill))}</td><td>${state.incorrectHighConfidence ? "Misconception" : formatDate(state.dueAt)}</td></tr>` }).join("")}</tbody></table></div>` : `<div class="empty-state"><h2>No review is due</h2><p>Practice a module or return when the next interval becomes due.</p></div>`}`
}

function renderLabs() {
  return `${renderPageHeading("Practical execution", "Labs", "Automated labs run a fixed checker. Inspected and self-attested labs record the evidence reference you provide.")}
    <div class="card-grid">${data.labs.map(lab => renderLab(lab)).join("")}</div>`
}

function renderLab(lab) {
  const state = progress.labs[lab.id]
  const module = data.modules.find(item => item.id === lab.moduleId)
  const automated = lab.class === "automated"
  const result = lastLabResult?.labId === lab.id ? lastLabResult.result : null
  return `<article class="action-card"><div><span class="eyebrow">Module ${module?.order} · ${escapeHtml(label(lab.class))}</span><h2>${escapeHtml(lab.title)}</h2><p>${escapeHtml(lab.summary ?? lab.evidence)}</p><div class="module-meta"><span class="tag">${lab.estimatedMinutes} min</span><span class="tag ${lab.critical ? "danger" : ""}">${lab.critical ? "Critical" : escapeHtml(label(lab.tier))}</span>${state?.passed ? `<span class="tag success">Passed ${formatDate(state.completedAt)}</span>` : ""}</div><ol>${lab.instructions.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ol><div class="callout"><strong>Safety boundary</strong><p>${escapeHtml(lab.safety)}</p></div></div>
    ${automated ? `<div class="button-row"><button class="button primary" data-action="run-lab" data-lab-id="${lab.id}">Run ${escapeHtml(lab.checkerId)}</button></div>` : `<label class="field"><span>Evidence reference</span><textarea data-lab-evidence="${lab.id}" placeholder="Path, commit hash, command output summary, or manual observation">${escapeHtml(state?.evidence ?? "")}</textarea></label>${lab.class === "inspected" ? `<label class="field"><span>Human reviewer name or handle</span><input type="text" data-lab-reviewer="${lab.id}" value="${escapeHtml(state?.reviewer ?? "")}"></label><label class="switch-row"><span>The reviewer inspected this evidence against the lab instructions</span><input type="checkbox" data-lab-reviewed="${lab.id}" ${state?.humanReviewed ? "checked" : ""}></label>` : ""}<div class="button-row"><button class="button" data-action="record-lab" data-lab-id="${lab.id}">Record ${escapeHtml(label(lab.class))} evidence</button></div>`}
    ${result ? `<div class="lab-result"><div class="status-line"><span class="status-dot ${result.passed ? "pass" : result.status === "blocked" ? "blocked" : "fail"}"></span>${escapeHtml(result.message)}</div>${result.observations ? `<pre>${escapeHtml(JSON.stringify(result.observations, null, 2))}</pre>` : ""}${result.stdout ? `<pre>${escapeHtml(result.stdout)}</pre>` : ""}${result.stderr ? `<pre>${escapeHtml(result.stderr)}</pre>` : ""}</div>` : ""}</article>`
}

async function runLab(labId) {
  const lab = data.labs.find(item => item.id === labId)
  lastLabResult = { labId, result: { passed: false, status: "running", message: "Checker is running.", observations: {} } }
  render()
  try {
    const response = await fetch(`/api/academy/checks/${encodeURIComponent(lab.checkerId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    const result = await response.json()
    lastLabResult = { labId, result }
    if (response.ok && result.passed) {
      progress.labs[labId] = { passed: true, class: lab.class, completedAt: new Date().toISOString(), checkerId: lab.checkerId, observations: result.observations }
      saveProgress()
      announce(`${lab.title} passed.`)
    } else announce(`${lab.title} did not pass: ${result.message ?? result.error}`)
  } catch (error) {
    lastLabResult = { labId, result: { passed: false, status: "failed", message: error.message, observations: {} } }
    announce(`Checker failed: ${error.message}`)
  }
  render()
}

function recordManualLab(labId) {
  const lab = data.labs.find(item => item.id === labId)
  const evidence = document.querySelector(`[data-lab-evidence="${CSS.escape(labId)}"]`)?.value.trim()
  if (!evidence) { announce("Enter an inspectable evidence reference first."); return }
  const reviewer = document.querySelector(`[data-lab-reviewer="${CSS.escape(labId)}"]`)?.value.trim().slice(0, 80) ?? ""
  const humanReviewed = Boolean(document.querySelector(`[data-lab-reviewed="${CSS.escape(labId)}"]`)?.checked)
  if (lab.class === "inspected" && (!reviewer || !humanReviewed)) { announce("An inspected lab requires an identified human reviewer and review confirmation."); return }
  progress.labs[labId] = { passed: true, class: lab.class, completedAt: new Date().toISOString(), evidence: evidence.slice(0, 2000), selfReported: lab.class === "self-attested", reviewer, humanReviewed }
  saveProgress()
  render()
  announce(`${lab.title} evidence recorded${humanReviewed ? ` with review by ${reviewer}` : ""}.`)
}

function renderExams() {
  return `${renderPageHeading("Cumulative assessment", "Examinations", "Phase examinations mix prior modules. A critical miss prevents a pass regardless of score.")}
    <div class="card-grid">${data.exams.map(exam => { const attempts = progress.examAttempts.filter(item => item.examId === exam.id); const last = attempts.at(-1); const modulesReady = exam.modules.every(moduleId => { const module = data.modules.find(item => item.id === moduleId); return module && moduleGate(progress, module, data).passed }); const cooldownEnd = last && !last.passed ? new Date(last.completedAt).getTime() + exam.attemptCooldownMinutes * 60_000 : 0; const cooldown = cooldownEnd > Date.now(); return `<article class="action-card"><span class="eyebrow">${escapeHtml(label(exam.kind))} examination</span><h2>${escapeHtml(exam.title)}</h2><p>${exam.questionCount} questions · ${exam.passPercent}% overall · ${exam.minimumModulePercent}% per module · ${exam.minimumSkillPercent}% per skill · zero critical misses.</p><div class="module-meta"><span class="tag">${exam.modules.length} modules</span>${last ? `<span class="tag ${last.passed ? "success" : "danger"}">Last: ${last.score}%</span>` : ""}</div><div class="button-row"><button class="button primary" data-action="start-exam" data-exam-id="${exam.id}" ${modulesReady && !cooldown ? "" : "disabled"}>Start examination</button></div>${!modulesReady ? `<p class="subtle">Pass every included module examination first.</p>` : cooldown ? `<p class="subtle">Retry available ${formatDate(cooldownEnd)}.</p>` : ""}</article>` }).join("")}</div>`
}

function renderCapstones() {
  return `${renderPageHeading("Integrated execution", "Capstone", "Complete every artifact, apply the rubric honestly, and obtain a human review. The academy cannot verify authorship or quality by itself.")}
    ${data.capstones.map(capstone => renderCapstone(capstone)).join("")}`
}

function renderCapstone(capstone) {
  const state = progress.capstones[capstone.id] ?? { criteria: {}, artifacts: {}, humanReviewed: false, reviewer: "" }
  const earned = capstone.rubric.reduce((sum, item) => sum + Number(state.criteria?.[item.id]?.earned ?? 0), 0)
  const criticalMet = capstone.rubric.filter(item => item.critical).every(item => Number(state.criteria?.[item.id]?.earned ?? 0) > 0)
  const prerequisitePassed = progress.examAttempts.some(attempt => attempt.examId === capstone.prerequisiteExamId && attempt.passed)
  const modulesReady = capstone.requiredModules.every(moduleId => { const module = data.modules.find(item => item.id === moduleId); return module && moduleGate(progress, module, data).passed })
  const passed = earned >= capstone.passPoints && criticalMet && state.humanReviewed && prerequisitePassed && modulesReady
  return `<section class="panel" style="margin-bottom:20px"><div class="page-heading"><div><span class="eyebrow">100-point rubric</span><h2>${escapeHtml(capstone.title)}</h2><p>${escapeHtml(capstone.summary)}</p></div><div class="metric" data-tone="${passed ? "success" : "accent"}"><strong>${earned}/100</strong><span>${passed ? "Human-reviewed pass" : "Evidence in progress"}</span></div></div>
  <h3>Required artifacts</h3><div class="settings-grid">${capstone.artifacts.map(artifact => `<label class="field"><span>${escapeHtml(artifact.title)}</span><textarea data-capstone-artifact="${capstone.id}:${artifact.id}" placeholder="${escapeHtml(artifact.evidence)}">${escapeHtml(state.artifacts?.[artifact.id] ?? "")}</textarea></label>`).join("")}</div>
  <h3>Rubric</h3><div class="rubric">${capstone.rubric.map(item => `<article class="rubric-item"><header><div><h3>${escapeHtml(item.description)}</h3>${item.critical ? `<span class="critical-label">Critical</span>` : ""}</div><label class="rubric-score"><span class="sr-only">Points earned for ${escapeHtml(item.description)}</span><input type="number" min="0" max="${item.points}" step="1" data-capstone-score="${capstone.id}:${item.id}" value="${Number(state.criteria?.[item.id]?.earned ?? 0)}"> / ${item.points}</label></header><textarea data-capstone-evidence="${capstone.id}:${item.id}" placeholder="Evidence: ${escapeHtml(item.evidence)}">${escapeHtml(state.criteria?.[item.id]?.evidence ?? "")}</textarea></article>`).join("")}</div>
  <div class="switch-row"><label for="reviewer-${capstone.id}">Human reviewer name or handle</label><input id="reviewer-${capstone.id}" type="text" data-capstone-reviewer="${capstone.id}" value="${escapeHtml(state.reviewer ?? "")}"></div><div class="switch-row"><label for="reviewed-${capstone.id}">A human reviewer examined the artifacts and rubric</label><input id="reviewed-${capstone.id}" type="checkbox" data-capstone-reviewed="${capstone.id}" ${state.humanReviewed ? "checked" : ""}></div><div class="button-row" style="margin-top:16px"><button class="button primary" data-action="save-capstone" data-capstone-id="${capstone.id}">Save capstone evidence</button></div><div class="callout ${passed ? "success" : "warning"}"><strong>${passed ? "Integrated evidence recorded" : "Pass conditions not yet met"}</strong><p>Requires ${capstone.passPoints}/100, nonzero evidence for every critical criterion, every module demonstrated, final examination passed, and a human review. Current prerequisites: modules ${modulesReady ? "met" : "not met"}; final exam ${prerequisitePassed ? "passed" : "not passed"}. This is project evidence, not professional accreditation.</p></div></section>`
}

function saveCapstone(capstoneId) {
  const capstone = data.capstones.find(item => item.id === capstoneId)
  const state = { criteria: {}, artifacts: {}, humanReviewed: false, reviewer: "", updatedAt: new Date().toISOString() }
  for (const artifact of capstone.artifacts) state.artifacts[artifact.id] = document.querySelector(`[data-capstone-artifact="${CSS.escape(`${capstoneId}:${artifact.id}`)}"]`)?.value.trim().slice(0, 5000) ?? ""
  for (const criterion of capstone.rubric) {
    const earned = Math.min(criterion.points, Math.max(0, Number(document.querySelector(`[data-capstone-score="${CSS.escape(`${capstoneId}:${criterion.id}`)}"]`)?.value) || 0))
    const evidence = document.querySelector(`[data-capstone-evidence="${CSS.escape(`${capstoneId}:${criterion.id}`)}"]`)?.value.trim().slice(0, 5000) ?? ""
    state.criteria[criterion.id] = { earned, evidence }
  }
  state.reviewer = document.querySelector(`[data-capstone-reviewer="${CSS.escape(capstoneId)}"]`)?.value.trim().slice(0, 80) ?? ""
  state.humanReviewed = Boolean(document.querySelector(`[data-capstone-reviewed="${CSS.escape(capstoneId)}"]`)?.checked && state.reviewer)
  const total = capstone.rubric.reduce((sum, item) => sum + state.criteria[item.id].earned, 0)
  const criticalMet = capstone.rubric.filter(item => item.critical).every(item => state.criteria[item.id].earned > 0 && state.criteria[item.id].evidence)
  const prerequisitePassed = progress.examAttempts.some(attempt => attempt.examId === capstone.prerequisiteExamId && attempt.passed)
  const modulesReady = capstone.requiredModules.every(moduleId => { const module = data.modules.find(item => item.id === moduleId); return module && moduleGate(progress, module, data).passed })
  state.passed = total >= capstone.passPoints && criticalMet && state.humanReviewed && prerequisitePassed && modulesReady
  progress.capstones[capstoneId] = state
  saveProgress()
  render()
  announce(`Capstone evidence saved with ${total} points recorded.`)
}

function renderSettings() {
  return `${renderPageHeading("Local controls", "Settings and progress", "Progress stays in this browser. Export it before clearing browser data or changing computers.")}
  <div class="settings-grid"><section class="panel"><h2>Learner</h2><label class="field"><span>Display name (optional)</span><input id="learner-name" type="text" maxlength="80" value="${escapeHtml(progress.learner.displayName)}"></label><button class="button" data-action="save-settings">Save settings</button></section>
  <section class="panel"><h2>Accessibility</h2><label class="field"><span>Text scale: <output id="text-scale-output">${Math.round(progress.settings.textScale * 100)}%</output></span><input id="text-scale" type="range" min="0.9" max="1.4" step="0.05" value="${progress.settings.textScale}"></label><div class="switch-row"><label for="high-contrast">High contrast</label><input id="high-contrast" type="checkbox" ${progress.settings.highContrast ? "checked" : ""}></div><div class="switch-row"><label for="reduced-motion">Reduce motion</label><input id="reduced-motion" type="checkbox" ${progress.settings.reducedMotion ? "checked" : ""}></div></section>
  <section class="panel"><h2>Backup and transfer</h2><p class="subtle">Exports contain assessment history and learner-entered notes, not credentials or repository files.</p><div class="button-row"><button class="button" data-action="export-progress">Export JSON</button><label class="button" for="import-progress">Import JSON</label><input id="import-progress" class="sr-only" type="file" accept="application/json,.json"></div></section>
  <section class="panel"><h2>Reset</h2><p class="subtle">Reset deletes only <code>${STORAGE_KEY}</code> from this browser. Repository files are not changed.</p><button class="button danger" data-action="reset-progress">Reset all academy progress</button></section></div>
  <div class="callout"><strong>Curriculum ${CURRICULUM_VERSION}</strong><p>Progress schema ${progress.schemaVersion}. Started ${formatDate(progress.learner.startedAt)}; last updated ${formatDate(progress.updatedAt)}.</p></div>`
}

function smartNext() {
  const reviews = buildReviewQueue(progress, data.questions, new Date(), 20)
  if (reviews.length) return startQuestionSession("review", "review")
  for (const module of data.modules) {
    if (!moduleUnlocked(module)) continue
    const gate = moduleGate(progress, module, data)
    if (!gate.conditions.referencesOpened) return setView("module", { moduleId: module.id })
    const missingLab = module.requiredLabs.find(id => !progress.labs[id]?.passed)
    if (missingLab) return setView("labs")
    if (!gate.conditions.score || !gate.conditions.skillMinimums) return startQuestionSession("module", module.id)
    if (!gate.passed) return startQuestionSession("practice", module.id)
  }
  return setView("exams")
}

function exportProgress() {
  const blob = new Blob([`${JSON.stringify(progress, null, 2)}\n`], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `airdash-academy-progress-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
  announce("Progress exported.")
}

async function handleImport(file) {
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("Progress import is limited to 5 MB")
    const value = await file.text()
    const imported = importProgress(value, data)
    saveProgress(imported)
    render()
    announce("Progress import completed.")
  } catch (error) {
    showDialog("Import rejected", `<p>${escapeHtml(error.message)}</p>`, `<button class="button" data-action="close-dialog">Close</button>`)
  }
}

function showDialog(title, body, actions) {
  dialog = { title, body, actions }
  renderDialog()
}

function renderDialog() {
  document.querySelector(".dialog-backdrop")?.remove()
  if (!dialog) return
  const wrapper = document.createElement("div")
  wrapper.className = "dialog-backdrop"
  wrapper.innerHTML = `<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">${escapeHtml(dialog.title)}</h2>${dialog.body}<div class="button-row">${dialog.actions}</div></section>`
  document.body.append(wrapper)
  wrapper.querySelector("button,input")?.focus()
}

function render() {
  if (!data || !progress) return
  updateNav()
  const renderers = { dashboard: renderDashboard, learn: renderLearn, module: renderModule, practice: renderPracticePicker, review: renderReview, labs: renderLabs, exams: renderExams, capstones: renderCapstones, settings: renderSettings, session: renderSession }
  main.innerHTML = (renderers[view] ?? renderDashboard)()
  if (dialog) renderDialog()
}

function saveSettings() {
  progress.learner.displayName = document.querySelector("#learner-name")?.value.trim().slice(0, 80) ?? ""
  progress.settings.textScale = Number(document.querySelector("#text-scale")?.value) || 1
  progress.settings.highContrast = Boolean(document.querySelector("#high-contrast")?.checked)
  progress.settings.reducedMotion = Boolean(document.querySelector("#reduced-motion")?.checked)
  saveProgress()
  render()
  announce("Settings saved.")
}

document.addEventListener("click", event => {
  const target = event.target.closest("button,[data-action],[data-view]")
  if (!target) return
  if (target.dataset.view) return setView(target.dataset.view)
  const action = target.dataset.action
  if (action === "open-module") return setView("module", { moduleId: target.dataset.moduleId })
  if (action === "study-concept") {
    const concept = data.concepts.find(item => item.id === target.dataset.conceptId)
    saveProgress(markConceptStudied(progress, concept.id))
    activeModuleId = concept.moduleId
    render()
    return announce(`${concept.title} marked introduced. Reading alone is not mastery.`)
  }
  if (action === "start-practice") return startQuestionSession("practice", target.dataset.moduleId)
  if (action === "start-diagnostic") return startQuestionSession("diagnostic", target.dataset.moduleId)
  if (action === "start-module-exam") return startQuestionSession("module", target.dataset.moduleId)
  if (action === "start-review") return startQuestionSession("review", "review")
  if (action === "start-exam") return startQuestionSession("exam", target.dataset.examId)
  if (action === "next-question") return nextQuestion()
  if (action === "abandon-session" || action === "finish-session") return setView("dashboard")
  if (action === "smart-next") return smartNext()
  if (action === "run-lab") return runLab(target.dataset.labId)
  if (action === "record-lab") return recordManualLab(target.dataset.labId)
  if (action === "save-capstone") return saveCapstone(target.dataset.capstoneId)
  if (action === "save-settings") return saveSettings()
  if (action === "export-progress") return exportProgress()
  if (action === "reset-progress") return showDialog("Reset all academy progress", `<p>Type <strong>RESET</strong> to delete this browser's academy evidence. Repository files are not changed.</p><label class="field"><span>Confirmation</span><input id="reset-confirmation" type="text" autocomplete="off"></label>`, `<button class="button danger" data-action="confirm-reset">Reset progress</button><button class="button" data-action="close-dialog">Cancel</button>`)
  if (action === "confirm-reset") {
    if (document.querySelector("#reset-confirmation")?.value !== "RESET") return announce("Type RESET exactly to confirm.")
    localStorage.removeItem(STORAGE_KEY)
    progress = createEmptyProgress()
    dialog = null
    saveProgress()
    setView("dashboard")
    return announce("Academy progress reset.")
  }
  if (action === "close-dialog") { dialog = null; document.querySelector(".dialog-backdrop")?.remove() }
})

document.addEventListener("submit", event => {
  if (event.target.id !== "question-form") return
  event.preventDefault()
  if (session.feedback) return
  submitQuestion(event.target)
})

document.addEventListener("input", event => {
  if (event.target.id === "text-scale") document.querySelector("#text-scale-output").textContent = `${Math.round(Number(event.target.value) * 100)}%`
})

document.addEventListener("change", event => {
  if (event.target.id === "import-progress" && event.target.files?.[0]) handleImport(event.target.files[0])
})

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && dialog) { dialog = null; document.querySelector(".dialog-backdrop")?.remove() }
})

async function start() {
  try {
    const values = await Promise.all(dataFiles.map(async name => {
      const response = await fetch(`/academy/data/${name}.json`, { cache: "no-store" })
      if (!response.ok) throw new Error(`Could not load ${name}.json (${response.status})`)
      return response.json()
    }))
    const core = Object.fromEntries(dataFiles.map((name, index) => [name, values[index]]))
    const questionBanks = await Promise.all(core.modules.map(async module => {
      const response = await fetch(`/academy/data/${module.questionFile}`, { cache: "no-store" })
      if (!response.ok) throw new Error(`Could not load ${module.questionFile} (${response.status})`)
      return response.json()
    }))
    data = { ...core, questions: questionBanks.flat() }
    progress = loadProgress()
    applySettings()
    const hash = location.hash.slice(1)
    if (hash.startsWith("module/")) { view = "module"; activeModuleId = hash.split("/")[1] }
    else if (["dashboard", "learn", "practice", "review", "labs", "exams", "capstones", "settings"].includes(hash)) view = hash
    updateHeader()
    render()
    announce("Academy curriculum loaded.")
  } catch (error) {
    main.innerHTML = `<div class="empty-state"><h1>Academy could not start</h1><p>${escapeHtml(error.message)}</p><p>Run <code>npm --prefix academy run validate</code> and restart the local server.</p></div>`
    headerStatus.textContent = "Load failed"
  }
}

start()
