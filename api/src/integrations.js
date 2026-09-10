const SIMBRIEF_HOST = "www.simbrief.com"
export const AIRDASH_COMMERCIAL_DESIGNATOR = "D1"
const VOLANTA_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const gatePools = {
  KATL: ["A10", "A11", "A12", "A15", "A16", "A17", "A18", "A19", "A20", "A21", "A24", "A25", "A26", "A27", "A28", "A30", "A31", "A32", "A33", "A34"],
  KDEN: ["A26", "A28", "A30", "A32", "A34", "A36", "A38", "A40", "A42", "A44", "A46", "A48", "A50", "A52"],
  MDSD: ["A1", "A2", "A3", "A4", "A5", "A6", "B1", "B2", "B3", "B4"],
  KJFK: ["T5-1", "T5-2", "T5-3", "T5-4", "T5-5", "T5-6", "T5-7", "T5-8"],
  KMCO: ["70", "71", "72", "73", "74", "75", "76", "77"],
  KLAX: ["52A", "52B", "53A", "53B", "54A", "54B", "55A", "55B"],
  KSEA: ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"],
  KMIA: ["D20", "D21", "D22", "D23", "D24", "D25", "D26", "D27"],
  KDFW: ["E20", "E21", "E22", "E23", "E24", "E25", "E26", "E27", "E28", "E29", "E30", "E31"],
}

function hash(value) {
  let result = 2166136261
  for (const character of value) {
    result ^= character.charCodeAt(0)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

const genericGatePools = new Map()

function poolFor(icao) {
  const code = String(icao ?? "").trim().toUpperCase()
  if (gatePools[code]) return gatePools[code]
  if (!/^[A-Z0-9]{4}$/.test(code)) return []
  if (!genericGatePools.has(code)) {
    genericGatePools.set(code, [
      ...Array.from({ length: 24 }, (_, index) => `G${index + 1}`),
      ...Array.from({ length: 12 }, (_, index) => `R${index + 1}`),
    ])
  }
  return genericGatePools.get(code)
}

export function selectGate(icao, seed, occupied = []) {
  const code = String(icao ?? "").trim().toUpperCase()
  const gates = poolFor(code)
  if (gates.length === 0) return null
  const reserved = new Set(occupied.filter(Boolean))
  const start = hash(seed) % gates.length
  for (let offset = 0; offset < gates.length; offset += 1) {
    const gate = gates[(start + offset) % gates.length]
    if (!reserved.has(gate)) return gate
  }
  const overflowStart = hash(`${code}:${seed}:overflow`) % 900
  for (let offset = 0; offset < 900; offset += 1) {
    const stand = `R${100 + ((overflowStart + offset) % 900)}`
    if (!reserved.has(stand)) return stand
  }
  return null
}

export function generateGates(origin, destination, seed, occupied = {}) {
  return {
    departureGate: selectGate(origin, `${seed}:departure`, occupied.departure),
    arrivalGate: selectGate(destination, `${seed}:arrival`, occupied.arrival),
  }
}

function decodeXml(value = "") {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim()
}

function section(xml, name) {
  return xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? ""
}

function tag(xml, name) {
  return decodeXml(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "")
}

async function boundedText(response, maximum) {
  if (!response.ok) throw Object.assign(new Error(`Remote service returned ${response.status}`), { status: 502 })
  const length = Number(response.headers.get("content-length") ?? 0)
  if (length > maximum) throw Object.assign(new Error("Remote response is too large"), { status: 413 })
  const text = await response.text()
  if (text.length > maximum) throw Object.assign(new Error("Remote response is too large"), { status: 413 })
  return text
}

export async function importSimBrief(sourceUrl) {
  let url
  try { url = new URL(sourceUrl) } catch { throw Object.assign(new Error("Enter a valid SimBrief XML URL"), { status: 400 }) }
  if (url.protocol !== "https:" || url.hostname !== SIMBRIEF_HOST || !/^\/ofp\/flightplans\/xml\/[A-Za-z0-9_-]+\.xml$/.test(url.pathname)) {
    throw Object.assign(new Error("Use a SimBrief flightplans XML URL"), { status: 400 })
  }
  return parseSimBrief(url)
}

export async function importSimBriefByUsername(username) {
  const name = String(username ?? "").trim()
  if (!/^[A-Za-z0-9_.-]{2,50}$/.test(name)) throw Object.assign(new Error("Set a valid SimBrief username in your profile first"), { status: 400 })
  const url = new URL(`https://${SIMBRIEF_HOST}/api/xml.fetcher.php`)
  url.searchParams.set("username", name)
  return parseSimBrief(url)
}

export function parseSimBriefXml(xml, sourceUrl = "") {
  if (!xml.includes("<OFP>") && !section(xml, "params")) throw Object.assign(new Error("SimBrief returned no flight plan"), { status: 400 })
  const params = section(xml, "params")
  const origin = section(xml, "origin")
  const destination = section(xml, "destination")
  const alternate = section(xml, "alternate")
  const general = section(xml, "general")
  const aircraft = section(xml, "aircraft")
  const times = section(xml, "times")
  const fuel = section(xml, "fuel")
  const weights = section(xml, "weights")
  const atc = section(xml, "atc")
  const format = tag(params, "ofp_layout").toUpperCase()
  if (!format) throw Object.assign(new Error("SimBrief OFP does not declare a flight-plan layout"), { status: 400 })
  const epoch = value => value && /^\d+$/.test(value) ? new Date(Number(value) * 1000).toISOString() : null
  const optionalNumber = value => value === "" || value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value)
  const flightNumber = tag(general, "flight_number") || tag(params, "fltnum") || null
  const airlineIcao = tag(general, "icao_airline") || tag(params, "airline") || null
  const callsign = tag(atc, "callsign") || (airlineIcao && flightNumber ? `${airlineIcao}${flightNumber}` : null)
  const commercialFlightNumber = flightNumber ? `${AIRDASH_COMMERCIAL_DESIGNATOR}${flightNumber}` : null
  return {
    sourceUrl, format,
    origin: tag(origin, "icao_code"), destination: tag(destination, "icao_code"), alternate: tag(alternate, "icao_code") || null,
    route: tag(general, "route"), cruiseAltitude: Number(tag(general, "initial_altitude")) || null,
    costIndex: Number(tag(general, "costindex")) || null,
    aircraftIcao: tag(aircraft, "icaocode"), simbriefRegistration: tag(aircraft, "reg"), simbriefFin: tag(aircraft, "fin"),
    airlineIcao, flightNumber, callsign, commercialDesignator: AIRDASH_COMMERCIAL_DESIGNATOR, commercialFlightNumber,
    scheduledOut: epoch(tag(times, "sched_out")), scheduledIn: epoch(tag(times, "sched_in")),
    blockFuel: Number(tag(fuel, "plan_ramp")) || null, tripFuel: Number(tag(fuel, "enroute_burn")) || null,
    endurance: Number(tag(times, "endurance")) || null,
    units: tag(params, "units"), passengers: optionalNumber(tag(weights, "pax_count")),
    cargo: optionalNumber(tag(weights, "cargo")), atcFlightPlan: tag(atc, "flightplan_text"),
  }
}

async function parseSimBrief(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/xml,text/xml", "User-Agent": "airDash/1.0" },
    signal: AbortSignal.timeout(15000),
  })
  const xml = await boundedText(response, 2_000_000)
  return parseSimBriefXml(xml, url.toString())
}

function volantaFlightId(value) {
  const match = String(value ?? "").match(VOLANTA_ID)
  if (!match) throw Object.assign(new Error("Enter a valid Volanta flight link"), { status: 400 })
  return match[0].toLowerCase()
}

export function extractLandingRate(flight = {}) {
  const normalize = value => {
    if (value === null || value === undefined || value === "") return null
    const number = Number(value)
    return Number.isFinite(number) && number !== 0 ? Math.round(number) : null
  }
  const rootRate = normalize(flight.landingRate)
  if (rootRate !== null) return rootRate
  const eventRates = (Array.isArray(flight.events) ? flight.events : [])
    .map(event => normalize(event?.landingRate))
    .filter(rate => rate !== null)
  return eventRates.length ? Math.min(...eventRates) : null
}

export async function importVolanta(sourceUrl) {
  const id = volantaFlightId(sourceUrl)
  const endpoint = `https://api.volanta.app/api/v1/Flights/${id}?includePositions=true`
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      Origin: "https://fly.volanta.app",
      Referer: "https://fly.volanta.app/",
      "User-Agent": "Mozilla/5.0 airDash/1.0",
    },
    signal: AbortSignal.timeout(20000),
  })
  const text = await boundedText(response, 16_000_000)
  let flight
  try { flight = JSON.parse(text) } catch { throw Object.assign(new Error("Volanta returned invalid flight data"), { status: 502 }) }
  const landingRate = extractLandingRate(flight)
  const realOutAt = flight.actualRealTimeOffBlocksTime ?? flight.offBlocksTime ?? null
  const verifiedActualInAt = flight.actualRealTimeOnBlocksTime ?? flight.actualSimOnBlocksTime ?? null
  const verifiedArrivalAt = flight.actualRealTimeArrivalTime ?? flight.actualSimArrivalTime ?? null
  const state = String(flight.state ?? "").trim().toUpperCase()
  const reportEndAt = verifiedActualInAt ?? verifiedArrivalAt ?? (state === "COMPLETED" ? flight.onBlocksTime ?? null : null)
  const simOutAt = flight.actualSimOffBlocksTime ?? null
  const simInAt = flight.actualSimOnBlocksTime ?? null
  const secondsBetween = (start, end) => {
    if (!start || !end) return null
    const seconds = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null
  }
  const realBlockSeconds = Number(flight.realBlockTime) > 0 ? Math.round(Number(flight.realBlockTime)) : secondsBetween(realOutAt, reportEndAt)
  const simBlockSeconds = Number(flight.effectiveBlockTime) > 0 ? Math.round(Number(flight.effectiveBlockTime)) : secondsBetween(simOutAt, simInAt)
  const timeCompressionRatio = realBlockSeconds && simBlockSeconds ? Number((simBlockSeconds / realBlockSeconds).toFixed(3)) : 1
  const timeCompressionDetected = Boolean(realBlockSeconds && simBlockSeconds && timeCompressionRatio >= 1.1 && simBlockSeconds - realBlockSeconds >= 300)
  const positions = Array.isArray(flight.positions) ? flight.positions : []
  const finalPosition = positions.reduce((latest, position) => {
    const timestamp = new Date(position?.time ?? 0).valueOf()
    return Number.isFinite(timestamp) && (!latest || timestamp > latest.timestamp) ? { timestamp, position } : latest
  }, null)?.position ?? null
  const diversionAirportIcao = flight.diversionAirportIcao ?? flight.diversionAirport?.icaoCode ?? null
  return {
    sourceUrl: `https://fly.volanta.app/flights/${id}/stats`, flightId: id, state: flight.state ?? null,
    origin: flight.originIcao ?? flight.origin?.icaoCode ?? null,
    destination: flight.destinationIcao ?? flight.destination?.icaoCode ?? null,
    alternate: flight.alternateIcao ?? flight.alternate?.icaoCode ?? null, aircraftIcao: flight.aircraftIcao ?? null,
    aircraftRegistration: flight.aircraftRegistration ?? null, aircraftTitle: flight.aircraftTitle ?? null,
    callsign: flight.callsign ?? flight.flightNumber ?? null, flightNumber: flight.flightNumber ?? null, network: flight.network ?? null,
    actualOutAt: realOutAt,
    actualOffAt: flight.actualRealTimeDepartureTime ?? flight.actualSimDepartureTime ?? null,
    actualOnAt: verifiedArrivalAt,
    actualInAt: verifiedActualInAt,
    reportEndAt,
    arrivalVerified: Boolean(verifiedActualInAt || verifiedArrivalAt),
    actualSimOutAt: simOutAt, actualSimInAt: simInAt,
    simBlockSeconds, realBlockSeconds, timeCompressionRatio, timeCompressionDetected,
    landingRate, distanceNm: Number(flight.distanceFlownInNauticalMiles) || null, plannedDistance: Number(flight.plannedDistance) || null,
    fuelBurn: Number(flight.fuelBurn) || null, units: flight.units ?? null,
    realFlightSeconds: Number(flight.realFlightTime) || null,
    positionCount: positions.length,
    finalPosition: finalPosition ? {
      latitude: Number(finalPosition.latitude) || null,
      longitude: Number(finalPosition.longitude) || null,
      altitude: Number(finalPosition.altitude) || null,
      onGround: Boolean(finalPosition.onGround),
      time: finalPosition.time ?? null,
    } : null,
    simulator: flight.simAbbreviation ?? null,
    hasDiverted: Boolean(flight.hasDiverted),
    diversionAirportIcao,
    diversionReason: flight.diversionReason ?? null,
  }
}
