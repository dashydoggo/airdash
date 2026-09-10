import { selectGate } from "./integrations.js"

export async function repairMissingActiveGates(executor, audit = async () => {}) {
  const missing = await executor.query(`SELECT a.id,a.registration,a.departure_gate,a.arrival_gate,r.origin,r.destination
    FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
    WHERE a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED') AND (a.departure_gate IS NULL OR a.arrival_gate IS NULL)
    ORDER BY a.id`)
  let repaired = 0
  for (const row of missing.rows) {
    const [occupiedDepartures, occupiedArrivals] = await Promise.all([
      executor.query(`SELECT a.departure_gate FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
        WHERE a.id<>$1 AND r.origin=$2 AND a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED') AND a.departure_gate IS NOT NULL`, [row.id, row.origin]),
      executor.query(`SELECT a.arrival_gate FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
        WHERE a.id<>$1 AND r.destination=$2 AND a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED') AND a.arrival_gate IS NOT NULL`, [row.id, row.destination]),
    ])
    const departureGate = row.departure_gate ?? selectGate(row.origin, `repair:${row.id}:${row.registration}:departure`, occupiedDepartures.rows.map(item => item.departure_gate))
    const arrivalGate = row.arrival_gate ?? selectGate(row.destination, `repair:${row.id}:${row.registration}:arrival`, occupiedArrivals.rows.map(item => item.arrival_gate))
    if (!departureGate || !arrivalGate) throw new Error(`Could not repair gates for assignment ${row.id}`)
    await executor.query(`UPDATE airdash.assignments SET departure_gate=COALESCE(departure_gate,$1),arrival_gate=COALESCE(arrival_gate,$2)
      WHERE id=$3`, [departureGate, arrivalGate, row.id])
    repaired += 1
    await audit(null, "ASSIGNMENT_GATES_REPAIRED", "assignment", row.id, { origin: row.origin, destination: row.destination, departureGate, arrivalGate }).catch(() => {})
  }
  return repaired
}
