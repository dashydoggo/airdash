import { selectGate } from "./integrations.js"

async function occupiedGates(executor, airport, excludeRegistration = null) {
  const result = await executor.query(`SELECT current_gate FROM airdash.aircraft
    WHERE current_airport=$1 AND registration<>COALESCE($2,registration) AND current_gate IS NOT NULL
    UNION ALL
    SELECT a.departure_gate FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
    WHERE r.origin=$1 AND a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED') AND a.departure_gate IS NOT NULL
      AND a.registration<>COALESCE($2,a.registration)`, [airport, excludeRegistration])
  return result.rows.map(row => row.current_gate ?? row.departure_gate).filter(Boolean)
}

export async function selectAircraftGate(executor, airport, seed, preferred = null, excludeRegistration = null) {
  const occupied = await occupiedGates(executor, airport, excludeRegistration)
  if (preferred && !occupied.includes(preferred)) return preferred
  const gate = selectGate(airport, seed, occupied)
  if (!gate) throw Object.assign(new Error(`No parking gate is available at ${airport}`), { status: 409 })
  return gate
}

export async function repairAircraftParkingGates(executor, audit = async () => {}) {
  const aircraft = await executor.query(`SELECT ac.registration,ac.current_airport,ac.current_gate,active.departure_gate active_gate
    FROM airdash.aircraft ac
    LEFT JOIN LATERAL (
      SELECT a.departure_gate FROM airdash.assignments a
      WHERE a.registration=ac.registration AND a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED')
      ORDER BY a.booked_at DESC LIMIT 1
    ) active ON TRUE
    WHERE ac.status<>'RETIRED' ORDER BY ac.fleet_number`)
  let repaired = 0
  const reservedByAirport = new Map()
  for (const row of aircraft.rows) {
    const reserved = reservedByAirport.get(row.current_airport) ?? []
    let gate = row.active_gate || row.current_gate
    if (!gate) {
      const last = await executor.query(`SELECT a.arrival_gate FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
        WHERE a.registration=$1 AND a.status IN ('COMPLETED','DIVERTED') AND a.arrival_gate IS NOT NULL AND r.destination=$2
        ORDER BY a.id DESC LIMIT 1`, [row.registration, row.current_airport])
      gate = last.rows[0]?.arrival_gate ?? null
    }
    if (!gate || reserved.includes(gate)) gate = selectGate(row.current_airport, `fleet:${row.registration}:${row.current_airport}`, reserved)
    if (!gate) throw new Error(`Could not assign a parking gate to ${row.registration} at ${row.current_airport}`)
    reserved.push(gate); reservedByAirport.set(row.current_airport, reserved)
    if (row.current_gate !== gate) {
      await executor.query("UPDATE airdash.aircraft SET current_gate=$1 WHERE registration=$2", [gate, row.registration])
      repaired += 1
      await audit(null, "AIRCRAFT_PARKING_GATE_ASSIGNED", "aircraft", row.registration, { airport: row.current_airport, gate }).catch(() => {})
    }
  }
  return repaired
}
