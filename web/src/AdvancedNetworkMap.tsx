import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react"
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet"
import { divIcon } from "leaflet"
import { FiActivity, FiArrowRight, FiClock, FiMap, FiMapPin, FiSearch, FiTruck, FiUser, FiUsers, FiX } from "react-icons/fi"
import { TbPlane } from "react-icons/tb"
import { api } from "./api"
import { AIRPORTS, airportCoordinate } from "./airportData"
import type { Aircraft, Base, PublicPilot, PublicResponse, Route } from "./types"

interface LiveFlight {
  id: number
  registration: string
  status: string
  source?: "BOARD" | "MISSION" | "SCHEDULE"
  mission_type?: "STANDARD" | "RECOVERY"
  recovery_of_assignment_id?: number | null
  flight_date?: string
  booked_at?: string
  started_at?: string | null
  expires_at?: string
  departure_gate?: string | null
  arrival_gate?: string | null
  flight_number: number
  origin: string
  destination: string
  block_minutes: number
  discord_id: string
  pilot_number: string
  pilot: string
  profile_image_url?: string | null
  avatar_url?: string | null
}

type Selection =
  | { kind: "airport"; code: string }
  | { kind: "route"; key: string }
  | { kind: "aircraft"; registration: string }
  | { kind: "flight"; id: number }
  | { kind: "pilot"; discordId: string }

interface Layers { routes: boolean; airports: boolean; fleet: boolean; pilots: boolean; live: boolean }

const formatMinutes = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`
const clamp = (value: number, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value))
const pairKey = (left: string, right: string) => [left, right].sort().join("-")
const FLEET_IMAGE = "/assets/airdash-a220-map.png"


function formatFlightDate(value?: string) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return "—"
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}
function textHash(value: string) {
  let result = 2166136261
  for (const character of value) { result ^= character.charCodeAt(0); result = Math.imul(result, 16777619) }
  return result >>> 0
}

function offsetCoordinate(center: [number, number], key: string, distance = 0.08): [number, number] {
  const hash = textHash(key)
  const angle = (hash % 360) * Math.PI / 180
  const ring = distance * (1 + ((hash >>> 9) % 3) * 0.45)
  return [center[0] + Math.sin(angle) * ring, center[1] + Math.cos(angle) * ring / Math.max(0.3, Math.cos(center[0] * Math.PI / 180))]
}

function flightProgress(flight: LiveFlight, now: number) {
  if (flight.status === "PIREP_SUBMITTED") return 1
  if (flight.status !== "ACTIVE") return 0
  const started = new Date(flight.started_at || flight.booked_at || now).getTime()
  return clamp((now - started) / Math.max(1, Number(flight.block_minutes) * 60_000), 0.03, 0.97)
}

function interpolate(from: [number, number], to: [number, number], progress: number): [number, number] {
  return [from[0] + (to[0] - from[0]) * progress, from[1] + (to[1] - from[1]) * progress]
}

function routeBearing(from: [number, number], to: [number, number]) {
  const averageLatitude = (from[0] + to[0]) * Math.PI / 360
  const east = (to[1] - from[1]) * Math.cos(averageLatitude)
  const north = to[0] - from[0]
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360
}

function flightArrowIcon(from: [number, number], to: [number, number], recovery: boolean, selected: boolean) {
  const bearing = routeBearing(from, to)
  return divIcon({
    className: `live-flight-arrow-icon${recovery ? " recovery" : ""}${selected ? " selected" : ""}`,
    html: `<span class="live-flight-arrow" style="transform:rotate(${bearing.toFixed(1)}deg)"><svg viewBox="0 0 36 36" aria-hidden="true"><path d="M18 2.5 22.2 14l10.8 4-10.8 4L18 33.5 13.8 22 3 18l10.8-4L18 2.5Z"/></svg></span>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  })
}

function MapFocus({ focus, reset }: { focus: [number, number] | null; reset: number }) {
  const map = useMap()
  useEffect(() => { if (focus) map.flyTo(focus, Math.max(map.getZoom(), 6), { duration: 0.65 }) }, [focus])
  useEffect(() => { map.flyTo([31, -86], 4, { duration: 0.65 }) }, [reset])
  return null
}

function StatusPill({ value }: { value: string }) {
  return <span className={`network-status network-status-${String(value).toLowerCase()}`}>{String(value).replaceAll("_", " ")}</span>
}

export default function AdvancedNetworkMap({ data }: { data: PublicResponse }) {
  const [flights, setFlights] = useState<LiveFlight[]>([])
  const [selection, setSelection] = useState<Selection | null>(null)
  const [layers, setLayers] = useState<Layers>({ routes: true, airports: true, fleet: true, pilots: false, live: true })
  const [query, setQuery] = useState("")
  const [now, setNow] = useState(Date.now())
  const [reset, setReset] = useState(0)

  useEffect(() => {
    const load = () => api<{ flights: LiveFlight[] }>("/live").then(value => setFlights(value.flights)).catch(() => {})
    load(); const timer = window.setInterval(load, 30_000); return () => window.clearInterval(timer)
  }, [])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(timer) }, [])

  const bases = data.bases ?? []
  const routes = data.routes ?? []
  const aircraft = data.aircraft ?? []
  const pilots = data.pilots ?? []
  const baseByCode = useMemo(() => new Map(bases.map(base => [base.code, base])), [bases])
  const coord = (code: string): [number, number] | null => {
    const base = baseByCode.get(code)
    return base ? [base.lat, base.lon] : airportCoordinate(code)
  }

  const airportCodes = useMemo(() => Array.from(new Set([
    ...bases.map(base => base.code),
    ...routes.flatMap(route => [route.origin, route.destination]),
    ...aircraft.map(item => item.current_airport),
    ...flights.flatMap(flight => [flight.origin, flight.destination]),
  ])).filter(code => coord(code)).sort(), [bases, routes, aircraft, flights])

  const routePairs = useMemo(() => {
    const result = new Map<string, Route[]>()
    for (const route of routes) {
      if (!coord(route.origin) || !coord(route.destination)) continue
      const key = pairKey(route.origin, route.destination)
      result.set(key, [...(result.get(key) ?? []), route])
    }
    return result
  }, [routes, bases])

  const livePositions = useMemo(() => flights.map(flight => {
    const origin = coord(flight.origin); const destination = coord(flight.destination)
    if (!origin || !destination) return null
    const progress = flightProgress(flight, now)
    return { flight, origin, destination, progress, position: interpolate(origin, destination, progress) }
  }).filter(Boolean) as Array<{ flight: LiveFlight; origin: [number, number]; destination: [number, number]; progress: number; position: [number, number] }>, [flights, now, bases])

  const airportStats = (code: string) => {
    const departures = routes.filter(route => route.origin === code)
    const arrivals = routes.filter(route => route.destination === code)
    const fleet = aircraft.filter(item => item.current_airport === code)
    const traffic = flights.filter(flight => flight.origin === code || flight.destination === code)
    return { departures, arrivals, fleet, traffic, destinations: Array.from(new Set(departures.map(route => route.destination))).sort() }
  }

  const selectedAirport = selection?.kind === "airport" ? selection.code : null
  const selectedRoute = selection?.kind === "route" ? routePairs.get(selection.key) ?? [] : []
  const selectedAircraft = selection?.kind === "aircraft" ? aircraft.find(item => item.registration === selection.registration) ?? null : null
  const selectedFlight = selection?.kind === "flight" ? flights.find(item => item.id === selection.id) ?? null : null
  const selectedPilot = selection?.kind === "pilot" ? pilots.find(item => item.discord_id === selection.discordId) ?? null : null

  const focus = useMemo<[number, number] | null>(() => {
    if (selectedAirport) return coord(selectedAirport)
    if (selectedAircraft) return coord(selectedAircraft.current_airport)
    if (selectedFlight) return livePositions.find(item => item.flight.id === selectedFlight.id)?.position ?? coord(selectedFlight.origin)
    if (selectedPilot) return coord(selectedPilot.base_code)
    if (selectedRoute.length) {
      const left = coord(selectedRoute[0].origin); const right = coord(selectedRoute[0].destination)
      return left && right ? [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2] : null
    }
    return null
  }, [selection, flights, now, bases])

  const searchResults = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    const results: Array<{ key: string; title: string; subtitle: string; selection: Selection }> = []
    for (const code of airportCodes) {
      const info = AIRPORTS[code]
      if ([code, info?.name, info?.city, info?.country].filter(Boolean).join(" ").toLowerCase().includes(needle)) results.push({ key: `a-${code}`, title: code, subtitle: info ? `${info.name} · ${info.city}` : "Network airport", selection: { kind: "airport", code } })
    }
    for (const item of aircraft) if (`${item.registration} ${item.current_airport} ${item.status}`.toLowerCase().includes(needle)) results.push({ key: `f-${item.registration}`, title: item.registration, subtitle: `${item.status} · ${item.current_airport}`, selection: { kind: "aircraft", registration: item.registration } })
    for (const pilot of pilots) if (`${pilot.display_name} ${pilot.pilot_number} ${pilot.base_code}`.toLowerCase().includes(needle)) results.push({ key: `p-${pilot.discord_id}`, title: pilot.display_name, subtitle: `${pilot.pilot_number} · ${pilot.base_code}`, selection: { kind: "pilot", discordId: pilot.discord_id } })
    for (const flight of flights) if (`air${flight.flight_number} ${flight.registration} ${flight.pilot} ${flight.origin} ${flight.destination}`.toLowerCase().includes(needle)) results.push({ key: `l-${flight.id}`, title: `AIR${String(flight.flight_number).padStart(3, "0")}`, subtitle: `${flight.pilot} · ${flight.registration}`, selection: { kind: "flight", id: flight.id } })
    return results.slice(0, 24)
  }, [query, airportCodes, aircraft, pilots, flights])

  const choose = (next: Selection) => { setSelection(next); setQuery("") }
  const toggleLayer = (key: keyof Layers) => setLayers(current => ({ ...current, [key]: !current[key] }))

  return <div className="advanced-map-shell">
    <header className="advanced-map-header">
      <div><span className="eyebrow"><FiMap /> operations map</span><h1>airDash network control</h1><p>Explore every published route, airport, aircraft, pilot, and live assignment from one operational map.</p></div>
      <div className="advanced-map-metrics"><span><strong>{airportCodes.length}</strong> airports</span><span><strong>{routes.length}</strong> routes</span><span><strong>{aircraft.length}</strong> aircraft</span><span><strong>{flights.length}</strong> live records</span></div>
    </header>

    <div className="advanced-map-toolbar">
      <div className="advanced-map-search"><FiSearch /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search airport, flight, aircraft, or pilot" />{query && <button onClick={() => setQuery("")} aria-label="Clear map search"><FiX /></button>}</div>
      <div className="advanced-map-layers" role="group" aria-label="Map layers">
        {([['routes', 'Routes'], ['airports', 'Airports'], ['fleet', 'Fleet'], ['pilots', 'Pilots'], ['live', 'Live flights']] as Array<[keyof Layers, string]>).map(([key, label]) => <button key={key} className={layers[key] ? "on" : ""} onClick={() => toggleLayer(key)}>{label}</button>)}
        <button onClick={() => { setSelection(null); setReset(value => value + 1) }}>Reset view</button>
      </div>
      {searchResults.length > 0 && <div className="advanced-map-results">{searchResults.map(result => <button key={result.key} onClick={() => choose(result.selection)}><strong>{result.title}</strong><span>{result.subtitle}</span></button>)}</div>}
    </div>

    <div className="advanced-map-workspace">
      <div className="advanced-map-canvas">
        <MapContainer center={[31, -86]} zoom={4} minZoom={3} maxZoom={11} scrollWheelZoom worldCopyJump attributionControl={false} style={{ height: "720px", width: "100%", background: "#0b1010" }}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png?key=cb1_345o_1_c816449b5def2990f5054a04" subdomains="abcd" maxZoom={11} crossOrigin />
          <MapFocus focus={focus} reset={reset} />

          {layers.routes && Array.from(routePairs.entries()).map(([key, pairRoutes]) => {
            const route = pairRoutes[0]; const from = coord(route.origin)!; const to = coord(route.destination)!
            const selected = selection?.kind === "route" && selection.key === key
            return <Polyline key={key} positions={[from, to]} eventHandlers={{ click: () => choose({ kind: "route", key }) }} pathOptions={{ color: selected ? "#f0c86a" : "#28767c", weight: selected ? 4 : 1.5, opacity: selected ? 0.95 : 0.5, dashArray: selected ? undefined : "5 7" }}><Tooltip sticky className="lm-tip"><strong>{route.origin} <FiArrowRight className="inline-arrow" /> {route.destination}</strong>{pairRoutes.length} published service{pairRoutes.length === 1 ? "" : "s"}</Tooltip></Polyline>
          })}

          {layers.airports && airportCodes.map(code => {
            const base = baseByCode.get(code); const point = coord(code)!; const stats = airportStats(code); const selected = selection?.kind === "airport" && selection.code === code
            return <CircleMarker key={code} center={point} radius={base ? 9 : selected ? 8 : 5} eventHandlers={{ click: () => choose({ kind: "airport", code }) }} pathOptions={{ color: selected ? "#f0c86a" : "#051010", weight: 3, fillColor: base ? "#48e0f8" : "#2c8f95", fillOpacity: 1 }}><Tooltip permanent={Boolean(base)} direction="right" className={`lm-tip ${base ? "lm-base-tip" : ""}`}><strong>{code}</strong>{AIRPORTS[code]?.city ?? "Network airport"}{!base && <><br />{stats.departures.length} departures</>}</Tooltip></CircleMarker>
          })}

          {layers.fleet && aircraft.map((item, index) => {
            const center = coord(item.current_airport); if (!center) return null
            const point = offsetCoordinate(center, `${item.registration}:${index}`, 0.075); const selected = selection?.kind === "aircraft" && selection.registration === item.registration
            return <CircleMarker key={item.registration} center={point} radius={selected ? 8 : 5} eventHandlers={{ click: () => choose({ kind: "aircraft", registration: item.registration }) }} pathOptions={{ color: selected ? "#f0c86a" : "#071010", weight: 2, fillColor: item.status === "AVAILABLE" ? "#7ce3a1" : item.status === "ASSIGNED" ? "#48e0f8" : "#f0c86a", fillOpacity: 0.95 }}><Tooltip className="lm-tip network-fleet-tooltip"><span className="network-fleet-tip"><img src={FLEET_IMAGE} alt="" /><span><strong>{item.registration}</strong>{item.status} · {item.current_airport}</span></span></Tooltip></CircleMarker>
          })}

          {layers.pilots && pilots.map((pilot, index) => {
            const center = coord(pilot.base_code); if (!center) return null
            const point = offsetCoordinate(center, `pilot:${pilot.discord_id}:${index}`, 0.13); const selected = selection?.kind === "pilot" && selection.discordId === pilot.discord_id
            return <CircleMarker key={pilot.discord_id} center={point} radius={selected ? 7 : 4} eventHandlers={{ click: () => choose({ kind: "pilot", discordId: pilot.discord_id }) }} pathOptions={{ color: selected ? "#f0c86a" : "#071010", weight: 2, fillColor: "#b993ff", fillOpacity: 0.95 }}><Tooltip className="lm-tip"><strong>{pilot.display_name}</strong>{pilot.pilot_number} · based {pilot.base_code}</Tooltip></CircleMarker>
          })}

          {layers.live && livePositions.map(({ flight, origin, destination, position, progress }) => <Fragment key={`live-${flight.id}`}>
            <Polyline positions={[origin, destination]} eventHandlers={{ click: () => choose({ kind: "flight", id: flight.id }) }} pathOptions={{ color: flight.mission_type === "RECOVERY" ? "#f0c86a" : "#48e0f8", weight: 4, opacity: 0.9 }} />
            <Marker position={position} icon={flightArrowIcon(origin, destination, flight.mission_type === "RECOVERY", selection?.kind === "flight" && selection.id === flight.id)} eventHandlers={{ click: () => choose({ kind: "flight", id: flight.id }) }}><Tooltip direction="top" className="lm-tip"><span className="network-live-tip"><strong>AIR{String(flight.flight_number).padStart(3, "0")}</strong><span>{flight.origin} <FiArrowRight className="inline-arrow" /> {flight.destination}</span><small>{flight.registration} · {flight.pilot} · {Math.round(progress * 100)}% estimated</small></span></Tooltip></Marker>
          </Fragment>)}
        </MapContainer>
      </div>

      <aside className="advanced-map-inspector">
        {!selection && <NetworkOverview flights={flights} aircraft={aircraft} airportCodes={airportCodes} airportStats={airportStats} choose={choose} />}
        {selectedAirport && <AirportDetail code={selectedAirport} info={AIRPORTS[selectedAirport]} base={baseByCode.get(selectedAirport)} stats={airportStats(selectedAirport)} choose={choose} />}
        {selection?.kind === "route" && <RouteDetail routes={selectedRoute} flights={flights} aircraft={aircraft} choose={choose} />}
        {selectedAircraft && <AircraftDetail aircraft={selectedAircraft} flight={flights.find(item => item.registration === selectedAircraft.registration)} choose={choose} />}
        {selectedFlight && <FlightDetail flight={selectedFlight} progress={flightProgress(selectedFlight, now)} choose={choose} />}
        {selectedPilot && <PilotDetail pilot={selectedPilot} flight={flights.find(item => item.discord_id === selectedPilot.discord_id)} choose={choose} />}
      </aside>
    </div>
  </div>
}

function InspectorHead({ icon, eyebrow, title, onClose }: { icon: ReactNode; eyebrow: string; title: ReactNode; onClose?: () => void }) {
  return <header className="inspector-head"><span>{icon}</span><div><small>{eyebrow}</small><h2>{title}</h2></div>{onClose && <button onClick={onClose} aria-label="Close detail"><FiX /></button>}</header>
}

function NetworkOverview({ flights, aircraft, airportCodes, airportStats, choose }: { flights: LiveFlight[]; aircraft: Aircraft[]; airportCodes: string[]; airportStats: (code: string) => ReturnType<any>; choose: (selection: Selection) => void }) {
  const busiest = [...airportCodes].sort((left, right) => airportStats(right).departures.length - airportStats(left).departures.length).slice(0, 6)
  return <><InspectorHead icon={<FiActivity />} eyebrow="Network overview" title="Live operations" /><p className="inspector-intro">Select any route, airport, aircraft, live flight, or pilot marker for a detailed operational view.</p>
    <div className="inspector-metrics"><div><strong>{aircraft.filter(item => item.status === "AVAILABLE").length}</strong><span>available</span></div><div><strong>{aircraft.filter(item => item.status === "ASSIGNED").length}</strong><span>assigned</span></div><div><strong>{flights.filter(item => item.status === "ACTIVE").length}</strong><span>flying</span></div></div>
    <section><h3>Active records</h3>{flights.length ? <div className="inspector-list">{flights.map(flight => <button key={flight.id} onClick={() => choose({ kind: "flight", id: flight.id })}><TbPlane /><span><strong>AIR{String(flight.flight_number).padStart(3, "0")}</strong><small>{flight.origin} <FiArrowRight className="inline-arrow" /> {flight.destination} · {flight.pilot}</small></span><StatusPill value={flight.status} /></button>)}</div> : <p className="inspector-empty">No active assignments.</p>}</section>
    <section><h3>Most connected airports</h3><div className="inspector-chip-list">{busiest.map(code => <button key={code} onClick={() => choose({ kind: "airport", code })}>{code}<span>{airportStats(code).departures.length}</span></button>)}</div></section>
  </>
}

function AirportDetail({ code, info, base, stats, choose }: { code: string; info?: typeof AIRPORTS[string]; base?: Base; stats: any; choose: (selection: Selection) => void }) {
  return <><InspectorHead icon={<FiMapPin />} eyebrow={base ? base.role : "Network airport"} title={code} /><p className="inspector-intro"><strong>{info?.name ?? code}</strong><br />{info ? `${info.city}, ${info.country}` : "Published airDash airport"}</p>
    <div className="inspector-metrics"><div><strong>{stats.departures.length}</strong><span>departures</span></div><div><strong>{stats.destinations.length}</strong><span>destinations</span></div><div><strong>{stats.fleet.length}</strong><span>aircraft</span></div></div>
    <section><h3>Direct destinations</h3><div className="inspector-chip-list">{stats.destinations.map((destination: string) => <button key={destination} onClick={() => choose({ kind: "route", key: pairKey(code, destination) })}>{destination}</button>)}</div></section>
    <section><h3>Aircraft on field</h3>{stats.fleet.length ? <div className="inspector-list">{stats.fleet.map((item: Aircraft) => <button key={item.registration} onClick={() => choose({ kind: "aircraft", registration: item.registration })}><FiTruck /><span><strong>{item.registration}</strong><small>{formatMinutes(item.total_block_minutes)} · {item.total_cycles} cycles</small></span><StatusPill value={item.status} /></button>)}</div> : <p className="inspector-empty">No fleet aircraft currently parked here.</p>}</section>
    <section><h3>Current traffic</h3>{stats.traffic.length ? <div className="inspector-list">{stats.traffic.map((flight: LiveFlight) => <button key={flight.id} onClick={() => choose({ kind: "flight", id: flight.id })}><TbPlane /><span><strong>AIR{String(flight.flight_number).padStart(3, "0")}</strong><small>{flight.origin} <FiArrowRight className="inline-arrow" /> {flight.destination}</small></span><StatusPill value={flight.status} /></button>)}</div> : <p className="inspector-empty">No current traffic involving this airport.</p>}</section>
  </>
}

function RouteDetail({ routes, flights, aircraft, choose }: { routes: Route[]; flights: LiveFlight[]; aircraft: Aircraft[]; choose: (selection: Selection) => void }) {
  if (!routes.length) return <p className="inspector-empty">Route data is unavailable.</p>
  const first = routes[0]; const relevantFlights = flights.filter(flight => pairKey(flight.origin, flight.destination) === pairKey(first.origin, first.destination)); const ready = aircraft.filter(item => routes.some(route => route.origin === item.current_airport) && item.status === "AVAILABLE")
  return <><InspectorHead icon={<FiArrowRight />} eyebrow="Published city pair" title={<>{first.origin} <FiArrowRight className="inline-arrow" /> {first.destination}</>} />
    <div className="inspector-metrics"><div><strong>{routes.length}</strong><span>services</span></div><div><strong>{Math.min(...routes.map(route => route.block_minutes))}m</strong><span>shortest block</span></div><div><strong>{ready.length}</strong><span>ready aircraft</span></div></div>
    <section><h3>Scheduled services</h3><div className="inspector-list">{routes.map(route => <button key={route.id} onClick={() => choose({ kind: "airport", code: route.origin })}><FiArrowRight /><span><strong>AIR{String(route.flight_number).padStart(3, "0")}</strong><small>{route.origin} <FiArrowRight className="inline-arrow" /> {route.destination} · {formatMinutes(route.block_minutes)} · {route.days}</small></span></button>)}</div></section>
    <section><h3>Live activity</h3>{relevantFlights.length ? <div className="inspector-list">{relevantFlights.map(flight => <button key={flight.id} onClick={() => choose({ kind: "flight", id: flight.id })}><TbPlane /><span><strong>{flight.registration}</strong><small>{flight.pilot}</small></span><StatusPill value={flight.status} /></button>)}</div> : <p className="inspector-empty">No active flight on this city pair.</p>}</section>
  </>
}

function AircraftDetail({ aircraft, flight, choose }: { aircraft: Aircraft; flight?: LiveFlight; choose: (selection: Selection) => void }) {
  return <><InspectorHead icon={<TbPlane />} eyebrow={`Fleet ${aircraft.fleet_number}`} title={aircraft.registration} /><img className="inspector-aircraft-image" src={FLEET_IMAGE} alt="airDash Airbus A220-300" /><div className="inspector-title-status"><StatusPill value={aircraft.status} /><button onClick={() => choose({ kind: "airport", code: aircraft.current_airport })}><FiMapPin /> {aircraft.current_airport}</button></div>
    <div className="inspector-metrics"><div><strong>{aircraft.total_cycles}</strong><span>cycles</span></div><div><strong>{formatMinutes(aircraft.total_block_minutes)}</strong><span>block</span></div><div><strong>{aircraft.livery_download_count ?? 0}</strong><span>downloads</span></div></div>
    {aircraft.status_reason && <section><h3>Operations status</h3><p className="inspector-note">{aircraft.status_reason}{aircraft.status_until ? ` · until ${new Date(aircraft.status_until).toLocaleString()}` : ""}</p></section>}
    <section><h3>Current assignment</h3>{flight ? <div className="inspector-list"><button onClick={() => choose({ kind: "flight", id: flight.id })}><FiActivity /><span><strong>AIR{String(flight.flight_number).padStart(3, "0")}</strong><small>{flight.origin} <FiArrowRight className="inline-arrow" /> {flight.destination} · {flight.pilot}</small></span><StatusPill value={flight.status} /></button></div> : <p className="inspector-empty">No active assignment.</p>}</section>
  </>
}

function FlightDetail({ flight, progress, choose }: { flight: LiveFlight; progress: number; choose: (selection: Selection) => void }) {
  const eta = new Date(new Date(flight.started_at || flight.booked_at || Date.now()).getTime() + flight.block_minutes * 60_000)
  return <><InspectorHead icon={<FiActivity />} eyebrow={flight.mission_type === "RECOVERY" ? "Recovery ferry" : `${flight.source ?? "BOARD"} assignment`} title={`AIR${String(flight.flight_number).padStart(3, "0")}`} />
    <button className="inspector-pilot-card" onClick={() => choose({ kind: "pilot", discordId: flight.discord_id })}><img src={flight.profile_image_url || flight.avatar_url || "/assets/airdash-hyena.svg"} alt="" /><span><strong>{flight.pilot}</strong><small>{flight.pilot_number}</small></span></button>
    <div className="inspector-title-status"><StatusPill value={flight.status} /><button onClick={() => choose({ kind: "aircraft", registration: flight.registration })}><TbPlane /> {flight.registration}</button></div>
    <div className="flight-progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div><div className="flight-progress-label"><span>{Math.round(progress * 100)}% estimated</span><span>ETA {eta.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
    <div className="inspector-route"><button onClick={() => choose({ kind: "airport", code: flight.origin })}>{flight.origin}<small>Gate {flight.departure_gate ?? "pending"}</small></button><FiArrowRight /><button onClick={() => choose({ kind: "airport", code: flight.destination })}>{flight.destination}<small>Gate {flight.arrival_gate ?? "pending"}</small></button></div>
    <div className="inspector-metrics"><div><strong>{formatMinutes(flight.block_minutes)}</strong><span>scheduled block</span></div><div><strong>{flight.mission_type === "RECOVERY" ? "Ferry" : "Service"}</strong><span>operation</span></div><div><strong>{formatFlightDate(flight.flight_date)}</strong><span>flight date</span></div></div>
  </>
}

function PilotDetail({ pilot, flight, choose }: { pilot: PublicPilot; flight?: LiveFlight; choose: (selection: Selection) => void }) {
  return <><InspectorHead icon={<FiUser />} eyebrow={pilot.pilot_number} title={pilot.display_name} /><div className="inspector-pilot-profile"><img src={pilot.profile_image_url || pilot.avatar_url || "/assets/airdash-hyena.svg"} alt="" /><div><strong>{pilot.rank_name || "Captain"}</strong><button onClick={() => choose({ kind: "airport", code: pilot.base_code })}><FiMapPin /> Based {pilot.base_code}</button>{pilot.leadership_title && <small>{pilot.leadership_title}</small>}</div></div>
    <div className="inspector-metrics"><div><strong>{pilot.total_flights}</strong><span>flights</span></div><div><strong>{formatMinutes(pilot.total_block_minutes)}</strong><span>block</span></div><div><strong>{pilot.streaks?.flightDays.current ?? 0}</strong><span>day streak</span></div></div>
    <section><h3>Current activity</h3>{flight ? <div className="inspector-list"><button onClick={() => choose({ kind: "flight", id: flight.id })}><TbPlane /><span><strong>AIR{String(flight.flight_number).padStart(3, "0")}</strong><small>{flight.origin} <FiArrowRight className="inline-arrow" /> {flight.destination} · {flight.registration}</small></span><StatusPill value={flight.status} /></button></div> : <p className="inspector-empty">No active assignment.</p>}</section>
  </>
}
