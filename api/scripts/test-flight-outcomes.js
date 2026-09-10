import assert from "node:assert/strict"
import { analyzeFlightOutcome, normalizeDiversionReasonCode, PIREP_OUTCOME_TYPES } from "../src/flightOutcome.js"
import { assignmentExperienceMultiplier, buildRecoveryMission, buildSimBriefDispatchParams, recoveryPayloadIsValid } from "../src/recoveryMissions.js"
import { extractLandingRate, generateGates, parseSimBriefXml, selectGate } from "../src/integrations.js"

const assignment = {
  origin: "KATL",
  destination: "KDEN",
  flight_plan: { alternate: "KPUB" },
}

assert.equal(extractLandingRate({ landingRate: null, events: [{ rate: 0 }, { rate: 1 }] }), null)
assert.equal(extractLandingRate({ landingRate: 0, events: [] }), null)
assert.equal(extractLandingRate({ landingRate: "", events: [{ rate: -500 }] }), null)

const kpubGate = selectGate("KPUB", "repair:16:N574AD:departure", [])
assert.match(kpubGate, /^(?:G(?:[1-9]|1\d|2[0-4])|R(?:[1-9]|1[0-2]))$/)
assert.equal(selectGate("KPUB", "repair:16:N574AD:departure", []), kpubGate)
assert.notEqual(selectGate("KPUB", "repair:16:N574AD:departure", [kpubGate]), kpubGate)
assert.equal(selectGate("BAD", "seed", []), null)
const allKdenGates = ["A26", "A28", "A30", "A32", "A34", "A36", "A38", "A40", "A42", "A44", "A46", "A48", "A50", "A52"]
assert.match(selectGate("KDEN", "overflow", allKdenGates), /^R\d{3}$/)
const recoveryGates = generateGates("KPUB", "KDEN", "recovery:15:2026-09-10")
assert.ok(recoveryGates.departureGate)
assert.ok(recoveryGates.arrivalGate)
assert.equal(extractLandingRate({ landingRate: -302.4, events: [] }), -302)
assert.equal(extractLandingRate({ landingRate: null, events: [{ landingRate: -114.515 }, { landingRate: 0 }] }), -115)

const incompleteNearDestination = analyzeFlightOutcome({
  state: "Completed",
  actualOutAt: "2026-09-10T16:23:23.182Z",
  reportEndAt: "2026-09-10T19:23:34.391Z",
  arrivalVerified: false,
  distanceNm: 1077.465,
  plannedDistance: 1098,
  hasDiverted: false,
}, assignment)
assert.equal(incompleteNearDestination.reportable, true)
assert.equal(incompleteNearDestination.outcome, PIREP_OUTCOME_TYPES.INCOMPLETE)
assert.equal(incompleteNearDestination.repositionAirport, "KPUB")
assert.equal(incompleteNearDestination.repositionMethod, "FILED_ALTERNATE_AFTER_MIDPOINT")
assert.equal(incompleteNearDestination.creditMultiplier, 0.9)
assert.equal(incompleteNearDestination.progressRatio, 0.981)

const incompleteNearOrigin = analyzeFlightOutcome({
  state: "Completed",
  actualOutAt: "2026-09-10T16:23:23.182Z",
  reportEndAt: "2026-09-10T16:50:00.000Z",
  arrivalVerified: false,
  distanceNm: 200,
  plannedDistance: 1098,
}, assignment)
assert.equal(incompleteNearOrigin.outcome, PIREP_OUTCOME_TYPES.INCOMPLETE)
assert.equal(incompleteNearOrigin.repositionAirport, "KATL")
assert.equal(incompleteNearOrigin.repositionMethod, "ORIGIN_BEFORE_MIDPOINT")

const explicitDiversion = analyzeFlightOutcome({
  state: "Completed",
  actualOutAt: "2026-05-18T19:47:21.283Z",
  reportEndAt: "2026-05-18T21:15:06.219Z",
  arrivalVerified: true,
  hasDiverted: false,
  diversionAirportIcao: "KATL",
  diversionReason: "Cabin Pressure",
  distanceNm: 233.719,
  plannedDistance: 347,
}, { origin: "KATL", destination: "KDAB", flight_plan: { alternate: "KMCO" } })
assert.equal(explicitDiversion.outcome, PIREP_OUTCOME_TYPES.DIVERTED)
assert.equal(explicitDiversion.repositionAirport, "KATL")
assert.equal(explicitDiversion.repositionMethod, "VOLANTA_DIVERSION_AIRPORT")
assert.equal(explicitDiversion.suggestedReason, "Cabin Pressure")
assert.equal(explicitDiversion.creditMultiplier, 0.9)

const completed = analyzeFlightOutcome({
  state: "Completed",
  actualOutAt: "2026-05-18T19:47:21.283Z",
  reportEndAt: "2026-05-18T21:15:06.219Z",
  arrivalVerified: true,
  distanceNm: 347,
  plannedDistance: 347,
}, { origin: "KATL", destination: "KDAB", flight_plan: { alternate: "KMCO" } })
assert.equal(completed.outcome, PIREP_OUTCOME_TYPES.COMPLETED)
assert.equal(completed.repositionAirport, "KDAB")
assert.equal(completed.creditMultiplier, 1)

const unfinished = analyzeFlightOutcome({
  state: "Flying",
  actualOutAt: "2026-09-10T16:23:23.182Z",
  reportEndAt: null,
  arrivalVerified: false,
}, assignment)
assert.equal(unfinished.reportable, false)
assert.equal(normalizeDiversionReasonCode("cabin_pressure"), "CABIN_PRESSURE")
assert.equal(normalizeDiversionReasonCode("not-a-code"), null)

const simbriefXml = `
<OFP>
  <params><ofp_layout>DAL</ofp_layout><units>LBS</units></params>
  <origin><icao_code>KATL</icao_code></origin>
  <destination><icao_code>KLEX</icao_code></destination>
  <alternate><icao_code>KIND</icao_code></alternate>
  <general><icao_airline>DAL</icao_airline><flight_number>3096</flight_number><route>PADGT2 RAFTN DCT HYK DCT</route><initial_altitude>35000</initial_altitude><costindex>30</costindex></general>
  <aircraft><icaocode>BCS3</icaocode><reg>N574AD</reg><fin>574</fin></aircraft>
  <times><sched_out>1788816600</sched_out><sched_in>1788821220</sched_in><endurance>8800</endurance></times>
  <fuel><plan_ramp>14009</plan_ramp><enroute_burn>5307</enroute_burn></fuel>
  <weights><pax_count>138</pax_count><cargo>4564</cargo></weights>
  <atc><callsign>DAL3096</callsign><flightplan_text>(FPL-DAL3096)</flightplan_text></atc>
</OFP>`
const plan = parseSimBriefXml(simbriefXml, "https://example.test/ofp.xml")
assert.equal(plan.airlineIcao, "DAL")
assert.equal(plan.flightNumber, "3096")
assert.equal(plan.callsign, "DAL3096")
assert.equal(plan.commercialDesignator, "D1")
assert.equal(plan.commercialFlightNumber, "D13096")
assert.equal(plan.alternate, "KIND")

const zeroPayloadPlan = parseSimBriefXml(simbriefXml.replace("<pax_count>138</pax_count><cargo>4564</cargo>", "<pax_count>0</pax_count><cargo>0</cargo>"), "https://example.test/ferry.xml")
assert.equal(zeroPayloadPlan.passengers, 0)
assert.equal(zeroPayloadPlan.cargo, 0)
assert.equal(recoveryPayloadIsValid(zeroPayloadPlan), true)
assert.equal(recoveryPayloadIsValid({ passengers: null, cargo: null }), false)

const recovery = buildRecoveryMission({
  assignment_id: 15,
  registration: "N574AD",
  outcome_type: "INCOMPLETE",
  origin: "KATL",
  destination: "KPUB",
  planned_destination: "KDEN",
  block_minutes: 205,
  progress_ratio: 0.981,
}, { registration: "N574AD", status: "AVAILABLE", current_airport: "KPUB" })
assert.ok(recovery)
assert.equal(recovery.flight_number, 9015)
assert.equal(recovery.origin, "KPUB")
assert.equal(recovery.destination, "KDEN")
assert.equal(recovery.block_minutes, 45)
assert.equal(recovery.passengers, 0)
assert.equal(recovery.cargo, 0)
assert.equal(recovery.expires, false)
assert.equal(buildRecoveryMission({ ...recovery, assignment_id: 15, outcome_type: "INCOMPLETE", planned_destination: "KDEN" }, { registration: "N574AD", status: "AVAILABLE", current_airport: "KATL" }), null)

const ferryParams = buildSimBriefDispatchParams({ ...recovery, registration: "N574AD" })
assert.equal(ferryParams.pax, "0")
assert.equal(ferryParams.cargo, "0")
assert.equal(ferryParams.callsign, "AIR9015")
assert.match(ferryParams.manualrmk, /FERRY FLIGHT ZERO PAX ZERO CARGO/)
const standardParams = buildSimBriefDispatchParams({ mission_type: "STANDARD", flight_number: 101, origin: "KATL", destination: "KDEN", registration: "N574AD" })
assert.equal("pax" in standardParams, false)
assert.equal(assignmentExperienceMultiplier({ source: "MISSION", missionType: "RECOVERY", completedOutcome: true, creditedBlockMinutes: 120 }), 1)
assert.equal(assignmentExperienceMultiplier({ source: "MISSION", missionType: "STANDARD", completedOutcome: true, creditedBlockMinutes: 120 }), 1.75)

console.log("flight outcomes, SimBrief metadata, landing rates, recovery ferries, and gate assignment verified")
