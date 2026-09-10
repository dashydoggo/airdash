export const PIREP_OUTCOME_TYPES = Object.freeze({
  COMPLETED: "COMPLETED",
  DIVERTED: "DIVERTED",
  INCOMPLETE: "INCOMPLETE",
})

export const NON_COMPLETE_OUTCOMES = new Set([
  PIREP_OUTCOME_TYPES.DIVERTED,
  PIREP_OUTCOME_TYPES.INCOMPLETE,
])

export const DIVERSION_REASON_CODES = new Set([
  "EMERGENCY",
  "CABIN_PRESSURE",
  "TECHNICAL_DIFFICULTY",
  "WEATHER",
  "ATC_OR_AIRSPACE",
  "FUEL_OR_PERFORMANCE",
  "SIMULATOR_OR_NETWORK",
  "PERSONAL_INTERRUPTION",
  "OTHER",
])

const normalizeIcao = value => {
  const code = String(value ?? "").trim().toUpperCase()
  return /^[A-Z]{3,4}$/.test(code) ? code : null
}

const positiveNumber = value => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

const validDate = value => {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.valueOf()) ? date : null
}

export function isNonCompleteOutcome(outcome) {
  return NON_COMPLETE_OUTCOMES.has(String(outcome ?? "").toUpperCase())
}

export function normalizeDiversionReasonCode(value) {
  const code = String(value ?? "").trim().toUpperCase()
  return DIVERSION_REASON_CODES.has(code) ? code : null
}

export function analyzeFlightOutcome(flight, assignment) {
  const origin = normalizeIcao(assignment?.origin)
  const destination = normalizeIcao(assignment?.destination)
  const alternate = normalizeIcao(assignment?.flight_plan?.alternate)
  const state = String(flight?.state ?? "").trim().toUpperCase()
  const actualOutAt = validDate(flight?.actualOutAt)
  const reportEndAt = validDate(flight?.reportEndAt)
  const arrivalVerified = Boolean(flight?.arrivalVerified)
  const diversionAirport = normalizeIcao(flight?.diversionAirportIcao)
  const diversionReason = String(flight?.diversionReason ?? "").trim() || null
  const hasDiversionEvidence = Boolean(flight?.hasDiverted || diversionAirport || diversionReason)
  const plannedDistance = positiveNumber(flight?.plannedDistance)
  const distanceFlown = positiveNumber(flight?.distanceNm)
  const progressRatio = plannedDistance && distanceFlown
    ? Math.min(1, Number((distanceFlown / plannedDistance).toFixed(3)))
    : null
  const decisionPointReached = progressRatio !== null && progressRatio >= 0.5
  const reportable = Boolean(
    actualOutAt && reportEndAt && reportEndAt > actualOutAt &&
    (state === "COMPLETED" || arrivalVerified),
  )

  let outcome = PIREP_OUTCOME_TYPES.COMPLETED
  if (!arrivalVerified) outcome = PIREP_OUTCOME_TYPES.INCOMPLETE
  else if (hasDiversionEvidence) outcome = PIREP_OUTCOME_TYPES.DIVERTED

  let repositionAirport = destination
  let repositionMethod = "SCHEDULED_DESTINATION"
  let actualDestination = destination
  if (outcome === PIREP_OUTCOME_TYPES.DIVERTED && diversionAirport) {
    repositionAirport = diversionAirport
    repositionMethod = "VOLANTA_DIVERSION_AIRPORT"
    actualDestination = diversionAirport
  } else if (outcome !== PIREP_OUTCOME_TYPES.COMPLETED && decisionPointReached && alternate) {
    repositionAirport = alternate
    repositionMethod = "FILED_ALTERNATE_AFTER_MIDPOINT"
    actualDestination = null
  } else if (outcome !== PIREP_OUTCOME_TYPES.COMPLETED) {
    repositionAirport = origin
    repositionMethod = "ORIGIN_BEFORE_MIDPOINT"
    actualDestination = diversionAirport
  }

  return {
    reportable,
    reportEndAt: reportEndAt?.toISOString() ?? null,
    outcome,
    requiresReason: isNonCompleteOutcome(outcome),
    creditMultiplier: outcome === PIREP_OUTCOME_TYPES.COMPLETED ? 1 : 0.9,
    origin,
    destination,
    alternate,
    actualDestination,
    repositionAirport,
    repositionMethod,
    progressRatio,
    decisionPointReached,
    hasDiversionEvidence,
    diversionAirport,
    suggestedReason: diversionReason,
    arrivalVerified,
    providerState: state || null,
  }
}
