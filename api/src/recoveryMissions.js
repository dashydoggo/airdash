export const RECOVERY_MISSION_TYPE = "RECOVERY"
export const STANDARD_MISSION_TYPE = "STANDARD"

const normalizeIcao = value => String(value ?? "").trim().toUpperCase()
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value))
const roundFive = value => Math.max(5, Math.round(value / 5) * 5)

export function suggestedRecoveryFlightNumber(sourceAssignmentId) {
  const id = Math.max(0, Math.trunc(Number(sourceAssignmentId) || 0))
  return 9000 + (id % 1000)
}

export function estimateRecoveryBlockMinutes(originalBlockMinutes, progressRatio) {
  const original = clamp(finite(originalBlockMinutes) ?? 90, 30, 720)
  const progress = finite(progressRatio)
  if (progress === null) return roundFive(original)
  const remaining = (Math.max(30, original - 30) * (1 - clamp(progress, 0, 1))) + 30
  return roundFive(clamp(remaining, 45, original))
}

export function buildRecoveryMission(lastFlight, aircraft, existingRoute = null) {
  if (!lastFlight || !aircraft) return null
  const outcome = String(lastFlight.outcome_type ?? "COMPLETED").toUpperCase()
  const origin = normalizeIcao(lastFlight.destination)
  const destination = normalizeIcao(lastFlight.planned_destination)
  if (!["DIVERTED", "INCOMPLETE"].includes(outcome) || !origin || !destination || origin === destination) return null
  if (normalizeIcao(aircraft.registration) !== normalizeIcao(lastFlight.registration)) return null
  if (String(aircraft.status).toUpperCase() !== "AVAILABLE" || normalizeIcao(aircraft.current_airport) !== origin) return null
  if (lastFlight.recovery_status && !["CANCELLED", "EXPIRED"].includes(String(lastFlight.recovery_status).toUpperCase())) return null
  return {
    id: `recovery-${lastFlight.assignment_id}`,
    sourceAssignmentId: Number(lastFlight.assignment_id),
    mission_type: RECOVERY_MISSION_TYPE,
    flight_number: Number(existingRoute?.flight_number) || suggestedRecoveryFlightNumber(lastFlight.assignment_id),
    route_id: existingRoute?.id ? Number(existingRoute.id) : null,
    origin,
    destination,
    block_minutes: estimateRecoveryBlockMinutes(lastFlight.block_minutes, lastFlight.progress_ratio),
    days: "Operations recovery ferry",
    passengers: 0,
    cargo: 0,
    expires: false,
  }
}

export function buildSimBriefDispatchParams(assignment, airframe = "BCS3") {
  const recovery = String(assignment?.mission_type ?? STANDARD_MISSION_TYPE).toUpperCase() === RECOVERY_MISSION_TYPE
  const flightNumber = String(assignment.flight_number)
  const params = {
    airline: "D1",
    fltnum: flightNumber,
    orig: normalizeIcao(assignment.origin),
    dest: normalizeIcao(assignment.destination),
    reg: normalizeIcao(assignment.registration),
    fin: normalizeIcao(assignment.registration).slice(1, 4),
    type: airframe,
    callsign: `AIR${flightNumber}`,
    manualrmk: recovery
      ? "FERRY FLIGHT ZERO PAX ZERO CARGO RECOVERY POSITIONING - CALLSIGN AIR DASH OPR AIRDASH VIRTUAL AIR.DASHYDOGGO.COM"
      : "CALLSIGN AIR DASH OPR AIRDASH VIRTUAL AIR.DASHYDOGGO.COM",
    planformat: "LIDO",
    units: "LBS",
    navlog: "1",
  }
  if (recovery) Object.assign(params, { pax: "0", cargo: "0" })
  return params
}

export function assignmentExperienceMultiplier({ source, missionType, completedOutcome, creditedBlockMinutes }) {
  if (!completedOutcome || String(source).toUpperCase() !== "MISSION") return 1
  if (String(missionType).toUpperCase() === RECOVERY_MISSION_TYPE) return 1
  const minutes = Math.max(1, finite(creditedBlockMinutes) ?? 1)
  return Math.min(2.5, 1 + (minutes / 240) * 1.5)
}

export function recoveryPayloadIsValid(plan) {
  const passengers = plan?.passengers
  const cargo = plan?.cargo
  return passengers !== null && passengers !== undefined && cargo !== null && cargo !== undefined
    && Number(passengers) === 0 && Number(cargo) === 0
}

export async function ensureRecoveryRoute(client, { sourceAssignmentId, origin, destination, blockMinutes }) {
  if (!/^[A-Z0-9]{4}$/.test(origin) || !/^[A-Z0-9]{4}$/.test(destination) || origin === destination) {
    throw Object.assign(new Error("The recovery route is not valid"), { status: 409 })
  }
  const existing = await client.query(`SELECT * FROM airdash.routes
    WHERE origin=$1 AND destination=$2 AND status='INACTIVE' AND days='Recovery ferry' LIMIT 1`, [origin, destination])
  if (existing.rows[0]) {
    const updated = await client.query("UPDATE airdash.routes SET block_minutes=$1 WHERE id=$2 RETURNING *", [blockMinutes, existing.rows[0].id])
    return updated.rows[0]
  }
  const first = suggestedRecoveryFlightNumber(sourceAssignmentId)
  for (let offset = 0; offset < 1000; offset += 1) {
    const flightNumber = 9000 + ((first - 9000 + offset) % 1000)
    const inserted = await client.query(`INSERT INTO airdash.routes (flight_number,origin,destination,block_minutes,days,status)
      VALUES ($1,$2,$3,$4,'Recovery ferry','INACTIVE') ON CONFLICT DO NOTHING RETURNING *`,
      [flightNumber, origin, destination, blockMinutes])
    if (inserted.rows[0]) return inserted.rows[0]
    const concurrent = await client.query(`SELECT * FROM airdash.routes
      WHERE origin=$1 AND destination=$2 AND status='INACTIVE' AND days='Recovery ferry' LIMIT 1`, [origin, destination])
    if (concurrent.rows[0]) return concurrent.rows[0]
  }
  throw Object.assign(new Error("No recovery flight number is available"), { status: 409 })
}
