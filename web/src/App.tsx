import { FormEvent, ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import {
  FiActivity, FiAlertCircle, FiArrowRight, FiCalendar, FiCheck,
  FiCheckCircle, FiClipboard, FiClock, FiDownload, FiFileText, FiHome, FiLogIn,
  FiMap, FiMapPin, FiMenu, FiPackage, FiSend, FiSettings, FiShield,
  FiTruck, FiStar, FiUser, FiUserCheck, FiUsers, FiX, FiXCircle, FiBell, FiChevronDown, FiGlobe, FiEye, FiSearch,
} from "react-icons/fi"
import { TbPlane, TbCrown, TbFlame } from "react-icons/tb"
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from "react-leaflet"
import { api, post, remove } from "./api"
import { pickHangarQuip } from "./hangarQuips"
import { buildVatsimPrefileUrl } from "./flightPlan"
import { launchVolantaDesktop } from "./volanta"
import type { NotificationHistoryItem, NotificationPayload } from "./notificationState"
import { subscribeWebPush, testWebPush, unsubscribeWebPush, webPushState, webPushSupport, type WebPushSupport } from "./webPush"
import type { AdminOverview, Aircraft, Assignment, FlightOutcomeAnalysis, MeResponse, OrgUpdate, PirepOutcome, PublicResponse, Route as FlightRoute, SimBriefPlan, StreakSummary, VolantaFlight } from "./types"
import { AIRPORTS } from "./airportData"
import AdvancedNetworkMap from "./AdvancedNetworkMap"
import { LatestNews, NewsArticle, NewsHub } from "./News"

interface AppContextValue {
  publicData: PublicResponse | null
  me: MeResponse | null
  loading: boolean
  refresh: () => Promise<void>
  notify: (message: string, kind?: "ok" | "error", action?: { label: string; to: string }) => void
  notifications: NotificationPayload | null
  markNotificationsRead: (ids?: number[]) => Promise<void>
  refreshNotifications: () => void
  openBrief: () => void
}
const AppContext = createContext<AppContextValue | null>(null)
const useApp = () => useContext(AppContext)!

const PAGE_TITLES: Record<string, string> = {
  "/": "Home",
  "/join": "Join",
  "/portal": "Pilot Portal",
  "/announcements": "Announcements",
  "/news": "News Hub",
  "/flights": "Flight Board",
  "/schedule": "Schedule",
  "/missions": "Missions",
  "/map": "Network Map",
  "/report": "Pilot Report",
  "/profile": "Pilot Profile",
  "/pilots": "Pilot Directory",
  "/fleet": "Fleet & Liveries",
  "/health": "Network Health",
  "/admin": "Administration",
}

const iconMotion = { whileHover: { y: -2 }, whileTap: { scale: 0.97 } }
const fade = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] as const } }
const formatMinutes = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`
const sinceLastFlight = (value?: string | null) => {
  if (!value) return "—"
  const mins = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000))
  if (mins < 60) return `${mins}m`
  if (mins < 1440) return `${Math.floor(mins / 60)}h`
  return `${Math.floor(mins / 1440)}d`
}
const missionMultiplier = (minutes: number) => Math.min(2.5, 1 + (minutes / 240) * 1.5)
const strHash = (value: string) => { let r = 2166136261; for (const c of value) { r ^= c.charCodeAt(0); r = Math.imul(r, 16777619) } return r >>> 0 }
const missionExpiry = (routeId: number) => { const win = 7200000; let exp = Math.floor(Date.now() / win) * win + ((strHash(String(routeId)) % 105) + 12) * 60000; if (exp <= Date.now()) exp += win; return exp }
const XP_PER_LEVEL = 600
const xpOf = (pilot: { experience?: number; total_block_minutes: number }) => pilot.experience ?? pilot.total_block_minutes
const pilotLevel = (experience: number) => {
  const xp = Math.max(0, Math.round(experience))
  const level = Math.floor(xp / XP_PER_LEVEL) + 1
  const intoLevel = xp % XP_PER_LEVEL
  return { level, xp, progress: Math.min(1, intoLevel / XP_PER_LEVEL), xpToNext: Math.max(0, XP_PER_LEVEL - intoLevel) }
}
function LevelBar({ experience, compact }: { experience: number; compact?: boolean }) {
  const { level, progress, xpToNext } = pilotLevel(experience)
  return <div className={compact ? "level-bar compact" : "level-bar"}>
    <div className="level-bar-head"><span>Level {level}</span>{!compact && <small>{xpToNext} XP to level {level + 1}</small>}</div>
    <div className="level-track"><div className="level-fill" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
  </div>
}

const emptyStreaks: StreakSummary = {
  flightDays: { current: 0, best: 0, lastFlightDate: null, bonusPercent: 0 },
  continuity: { current: 0, best: 0, lastDestination: null },
}
const streakHeat = (days: number) => days >= 5 ? "streak-blazing" : days >= 3 ? "streak-hot" : days >= 1 ? "streak-warm" : "streak-cold"
function StreakCards({ streaks, compact = false }: { streaks?: StreakSummary; compact?: boolean }) {
  const value = streaks ?? emptyStreaks
  const days = value.flightDays
  const continuity = value.continuity
  return <div className={compact ? "streak-cards compact" : "streak-cards"}>
    <div className={`streak-card streak-days ${streakHeat(days.current)}`}>
      <span className="streak-icon streak-flame"><TbFlame /></span>
      <div><strong>{days.current}</strong><span>flight-day streak</span></div>
      <small>{compact ? `Best ${days.best}` : days.current >= 3 ? `Day ${days.current} tier · +${days.bonusPercent}% XP · best ${days.best}` : `Consecutive UTC days · bonus starts at day 3 · best ${days.best}`}</small>
    </div>
    <div className="streak-card streak-continuity">
      <span className="streak-icon"><FiArrowRight /></span>
      <div><strong>{continuity.current}</strong><span>route continuity</span></div>
      <small>{compact ? `Best ${continuity.best}` : continuity.lastDestination ? `Start the next flight at ${continuity.lastDestination} · best ${continuity.best}` : `Each origin must match the prior destination · best ${continuity.best}`}</small>
    </div>
  </div>
}
const landingColor = (fpm: number | null | undefined) => {
  if (fpm == null) return "var(--muted)"
  const v = Math.max(-600, Math.min(0, fpm))
  const t = (v + 600) / 600
  const hue = 0 + t * 130
  return `hsl(${Math.round(hue)}, 75%, 60%)`
}
const punctuality = (outAt?: string | null, inAt?: string | null, plannedMin?: number | null) => {
  if (!outAt || !inAt || !plannedMin) return null
  const actual = (new Date(inAt).getTime() - new Date(outAt).getTime()) / 60000
  const delta = Math.round(actual - plannedMin)
  if (delta <= -10) return { label: "AHEAD", cls: "punc-ahead", delta }
  if (delta <= 15) return { label: "ON TIME", cls: "punc-ontime", delta }
  if (delta <= 45) return { label: "DELAYED", cls: "punc-delayed", delta }
  return { label: "LATE", cls: "punc-late", delta }
}
const routeCode = (route: FlightRoute) => `AIR${String(route.flight_number).padStart(3, "0")}`
const DIVERSION_REASON_OPTIONS = [
  ["EMERGENCY", "Emergency"],
  ["CABIN_PRESSURE", "Cabin pressure"],
  ["TECHNICAL_DIFFICULTY", "Technical difficulty"],
  ["WEATHER", "Weather"],
  ["ATC_OR_AIRSPACE", "ATC or airspace"],
  ["FUEL_OR_PERFORMANCE", "Fuel or performance"],
  ["SIMULATOR_OR_NETWORK", "Simulator or network"],
  ["PERSONAL_INTERRUPTION", "Personal interruption"],
  ["OTHER", "Other"],
] as const
const outcomeLabel = (value?: string | null) => value === "DIVERTED" ? "Diverted" : value === "INCOMPLETE" ? "Incomplete" : "Completed"
const diversionReasonLabel = (value?: string | null) => DIVERSION_REASON_OPTIONS.find(([code]) => code === value)?.[1] ?? value?.replaceAll("_", " ") ?? "Not recorded"
const repositionMethodLabel = (value?: string | null) => value === "VOLANTA_DIVERSION_AIRPORT" ? "Recorded by Volanta" : value === "FILED_ALTERNATE_AFTER_MIDPOINT" ? "Filed alternate after midpoint" : value === "ORIGIN_BEFORE_MIDPOINT" ? "Returned to origin before midpoint" : value === "SCHEDULED_DESTINATION" ? "Scheduled destination" : "Operations positioning"
const suggestedDiversionReason = (value?: string | null) => {
  const normalized = String(value ?? "").toUpperCase()
  if (normalized.includes("CABIN") || normalized.includes("PRESSURE")) return "CABIN_PRESSURE"
  if (normalized.includes("TECH") || normalized.includes("MECHAN")) return "TECHNICAL_DIFFICULTY"
  if (normalized.includes("MEDICAL")) return "EMERGENCY"
  if (normalized.includes("WEATHER")) return "WEATHER"
  if (normalized.includes("FUEL")) return "FUEL_OR_PERFORMANCE"
  return ""
}
const isPublicVolantaFlightUrl = (value: string) => /^https:\/\/fly\.volanta\.app\/flights\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/stats)?\/?(?:[?#].*)?$/i.test(value.trim())

function Status({ value }: { value: string }) {
  const key = value.toLowerCase().replaceAll("_", "-")
  const label = value === "ASSIGNED" ? "IN USE" : value === "ACTIVE" ? "FLYING" : value.replaceAll("_", " ")
  return <span className={`status status-${key}`}>{label}</span>
}

interface OrgUpdatesResponse { updates: OrgUpdate[]; total: number; limit: number; offset: number; kinds: string[] }
function OrgUpdateCard({ update }: { update: OrgUpdate }) {
  const associations = [update.pilot_name && `${update.pilot_name}${update.pilot_number ? ` · ${update.pilot_number}` : ""}`, update.registration].filter(Boolean)
  return <article className={`org-update kind-${update.kind.toLowerCase().replaceAll("_", "-")}`}>
    <div className="org-update-icon"><FiActivity /></div>
    <div><small><time dateTime={update.created_at}>{new Date(update.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</time><span>{update.kind.replaceAll("_", " ")}</span>{associations.map(value => <span key={String(value)}>{value}</span>)}</small><h3>{update.title}</h3><p>{update.body}</p></div>
  </article>
}

function Button({ children, kind = "primary", type = "button", onClick, disabled }: { children: ReactNode; kind?: "primary" | "secondary" | "danger"; type?: "button" | "submit"; onClick?: () => void; disabled?: boolean }) {
  return <motion.button {...iconMotion} type={type} className={`button button-${kind}`} onClick={onClick} disabled={disabled}>{children}</motion.button>
}


function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel = "Keep booking", onConfirm, onCancel }: { open: boolean; title: string; body: string; confirmLabel: string; cancelLabel?: string; onConfirm: () => void; onCancel: () => void }) {
  if (!open) return null
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }}>
    <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <FiAlertCircle /><h2 id="confirm-title">{title}</h2><p>{body}</p>
      <div><Button kind="secondary" onClick={onCancel}>{cancelLabel}</Button><Button kind="danger" onClick={onConfirm}>{confirmLabel}</Button></div>
    </section>
  </div>
}
const ASSIGNMENT_CANCEL_OPTIONS = [
  ["FILED_IN_ERROR", "Filed in error"],
  ["UNABLE_TO_COMPLETE", "Unable to complete"],
  ["SIMULATOR_ISSUE", "Simulator or aircraft issue"],
  ["NETWORK_ISSUE", "Network or connectivity issue"],
  ["WEATHER_OR_OPERATIONS", "Weather or operational conditions"],
  ["PERSONAL_INTERRUPTION", "Personal interruption"],
  ["OTHER", "Other"],
] as const
function CancelFlightDialog({ open, status, registration, busy, onConfirm, onCancel }: { open: boolean; status: string; registration?: string; busy: boolean; onConfirm: (reasonCode: string, details: string) => void; onCancel: () => void }) {
  const [reasonCode, setReasonCode] = useState("")
  const [details, setDetails] = useState("")
  useEffect(() => { if (open) { setReasonCode(""); setDetails("") } }, [open])
  if (!open) return null
  const flying = status === "ACTIVE"
  const valid = Boolean(reasonCode) && (reasonCode !== "OTHER" || Boolean(details.trim()))
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel() }}>
    <section className="confirm-dialog cancel-flight-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-flight-title">
      <FiAlertCircle /><h2 id="cancel-flight-title">{flying ? "Cancel this flying assignment?" : "Cancel this booking?"}</h2>
      <p>{flying ? `${registration ?? "The aircraft"} will be released immediately. This flight earns no XP and cannot be resumed.` : `${registration ?? "The aircraft"} will return to the available fleet and this booking cannot be resumed.`}</p>
      <div className="cancel-flight-fields">
        <label>Reason<select value={reasonCode} onChange={event => setReasonCode(event.target.value)} required><option value="">Choose a reason</option>{ASSIGNMENT_CANCEL_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Additional details <small>{reasonCode === "OTHER" ? "Required for Other" : "Optional"}</small><textarea value={details} onChange={event => setDetails(event.target.value)} rows={3} maxLength={300} placeholder="Add context for operations history" /></label>
      </div>
      <div className="cancel-flight-actions"><Button kind="secondary" onClick={onCancel} disabled={busy}>Keep flight</Button><Button kind="danger" onClick={() => onConfirm(reasonCode, details.trim())} disabled={busy || !valid}>{busy ? "Cancelling…" : flying ? "Cancel flying assignment" : "Cancel booking"}</Button></div>
    </section>
  </div>
}

function notificationHistoryIcon(kind: NotificationHistoryItem["kind"]) {
  if (kind === "progress") return <FiActivity />
  if (kind === "aircraft") return <FiTruck />
  if (kind === "pireps") return <FiFileText />
  if (kind === "filingSoon") return <FiClock />
  if (kind === "gateChanges" || kind === "baseRequests") return <FiMapPin />
  if (kind === "applications") return <FiUserCheck />
  if (kind === "expired") return <FiAlertCircle />
  return <FiBell />
}

function NotificationPanel({ title, notifications, onClose, onRead }: { title: string; notifications: NotificationPayload | null; onClose: () => void; onRead: (ids?: number[]) => Promise<void> }) {
  const history = notifications?.history ?? []
  return <div className="notif-panel" role="menu">
    <header><span>{title}</span><div>{(notifications?.total ?? 0) > 0 && <button className="notif-clear" onClick={() => { void onRead() }}>Mark all read</button>}<button className="notif-close" onClick={onClose} aria-label="Close notifications"><FiX /></button></div></header>
    {!history.length && <p className="notif-empty">No notification history yet.</p>}
    {history.map(item => <div key={item.id} className={`notif-history-row${item.read_at ? " read" : " unread"}`}>
      <Link to={item.href} onClick={onClose}>{notificationHistoryIcon(item.kind)}<span><strong>{item.title}</strong><small>{item.body}</small><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</time></span></Link>
      {!item.read_at && <button className="notif-item-read" onClick={() => { void onRead([item.id]) }} aria-label={`Mark ${item.title} as read`} title="Mark as read"><FiCheck /></button>}
    </div>)}
  </div>
}

function Layout({ children }: { children: ReactNode }) {
  const { me, notifications: notif, markNotificationsRead } = useApp()
  const [menu, setMenu] = useState(false)
  const [navMore, setNavMore] = useState(false)
  const navMoreRef = useRef<HTMLDivElement>(null)
  const [profileMenu, setProfileMenu] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const [notifOpen, setNotifOpen] = useState(false)
  const notifOpenRef = useRef(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const dismissNotifications = () => {
    if (!notifOpenRef.current) return
    notifOpenRef.current = false
    setNotifOpen(false)
    const unreadIds = (notif?.history ?? []).filter(item => !item.read_at).map(item => item.id)
    if (unreadIds.length) void markNotificationsRead(unreadIds)
  }
  useEffect(() => { if (!notifOpen) return; const close = (event: MouseEvent) => { if (!notifRef.current?.contains(event.target as Node)) dismissNotifications() }; window.addEventListener("mousedown", close); return () => window.removeEventListener("mousedown", close) }, [notifOpen, notif?.history])
  useEffect(() => { if (!profileMenu) return; const close = (event: MouseEvent) => { if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenu(false) }; window.addEventListener("mousedown", close); return () => window.removeEventListener("mousedown", close) }, [profileMenu])
  useEffect(() => {
    if (!navMore) return
    const close = (event: MouseEvent) => { if (!navMoreRef.current?.contains(event.target as Node)) setNavMore(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setNavMore(false) }
    window.addEventListener("mousedown", close); window.addEventListener("keydown", escape)
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", escape) }
  }, [navMore])
  const location = useLocation()
  useEffect(() => { const label = location.pathname.startsWith("/news/") ? "Press Release" : PAGE_TITLES[location.pathname] ?? "airDash"; document.title = `${label} | airDash` }, [location.pathname])
  useEffect(() => { setMenu(false); setNavMore(false) }, [location.pathname])
  const login = () => { window.location.href = `https://dashydoggo.com/auth/login?from=${encodeURIComponent(window.location.href)}` }
  const toggleNotifications = () => {
    if (notifOpenRef.current) return dismissNotifications()
    notifOpenRef.current = true
    setNotifOpen(true)
  }
  const logout = async () => { await fetch("https://dashydoggo.com/auth/logout", { method: "POST", credentials: "include" }); window.location.href = "/" }
  const primaryLinks: Array<[string, string, ReactNode]> = me?.pilot ? [
    ["/portal", "hangar", <FiHome />], ["/flights", "flight board", <FiMap />], ["/schedule", "schedule", <FiCalendar />], ["/missions", "missions", <FiStar />],
  ] : [["/", "home", <FiHome />], ["/news", "news", <FiFileText />], ["/join", "join", <FiUserCheck />], ["/schedule", "schedule", <FiCalendar />], ["/fleet", "fleet", <TbPlane />], ["/health", "network", <FiActivity />]]
  const secondaryLinks: Array<[string, string, ReactNode]> = me?.pilot ? [
    ["/map", "network map", <FiMap />], ["/news", "news", <FiFileText />], ["/announcements", "announcements", <FiBell />], ["/report", "pilot report", <FiFileText />], ["/pilots", "pilots", <FiUsers />], ["/fleet", "fleet", <TbPlane />], ["/health", "network", <FiActivity />],
    ...(me.isOwner ? [["/admin", "admin", <FiShield />] as [string, string, ReactNode]] : []),
  ] : []
  const secondaryActive = secondaryLinks.some(([to]) => location.pathname === to || location.pathname.startsWith(`${to}/`))
  return <div className="app-shell">
    <header className="topbar">
      <Link to="/" className="wordmark"><img src="/assets/airdash.logo.png" alt="airDash" /></Link>
      <nav className={menu ? "main-nav open" : "main-nav"} aria-label="Primary navigation">
        {primaryLinks.map(([to, label, icon]) => <NavLink key={to} to={to}>{icon}<span>{label}</span></NavLink>)}
        {secondaryLinks.length > 0 && <div className="nav-more" ref={navMoreRef}>
          <button type="button" className={secondaryActive ? "nav-more-button active" : "nav-more-button"} onClick={() => { setNavMore(!navMore); setProfileMenu(false); dismissNotifications() }} aria-expanded={navMore} aria-haspopup="menu"><span>more</span><FiChevronDown className={navMore ? "open" : ""} /></button>
          {navMore && <div className="nav-more-menu" role="menu">{secondaryLinks.map(([to, label, icon]) => <NavLink key={to} to={to} role="menuitem" onClick={() => setNavMore(false)}>{icon}<span>{label}</span></NavLink>)}</div>}
        </div>}
      </nav>
      <div className="account-actions">
        {me?.pilot && !me.isOwner && <div className="notif-wrap" ref={notifRef}>
          <button className={`icon-button notif-button${notif && notif.total > 0 ? " has-new" : ""}`} onClick={toggleNotifications} aria-label="Notifications">{<FiBell />}{notif && notif.total > 0 && <span className="notif-badge">{notif.total}</span>}</button>
          {notifOpen && <NotificationPanel title="Your updates" notifications={notif} onClose={dismissNotifications} onRead={markNotificationsRead} />}
        </div>}
        {me?.isOwner && <div className="notif-wrap" ref={notifRef}>
          <button className={`icon-button notif-button${notif && notif.total > 0 ? " has-new" : ""}`} onClick={toggleNotifications} aria-label="Notifications">{<FiBell />}{notif && notif.total > 0 && <span className="notif-badge">{notif.total}</span>}</button>
          {notifOpen && <NotificationPanel title="Operations" notifications={notif} onClose={dismissNotifications} onRead={markNotificationsRead} />}
        </div>}
        {me ? <div className="profile-menu-wrap" ref={profileMenuRef}><button className="avatar-link" onClick={() => { setProfileMenu(!profileMenu); setNavMore(false); dismissNotifications() }} aria-expanded={profileMenu} aria-haspopup="menu"><img src={me.user.avatar} alt="" /><span>Hi, {me.pilot?.display_name ?? me.user.displayName}</span></button>{profileMenu && <div className="profile-menu" role="menu"><NavLink to="/portal" onClick={() => setProfileMenu(false)}>Hangar</NavLink><NavLink to="/announcements" onClick={() => setProfileMenu(false)}>Announcements</NavLink><NavLink to="/profile" onClick={() => setProfileMenu(false)}>Pilot profile</NavLink><NavLink to="/pilots" onClick={() => setProfileMenu(false)}>Pilot directory</NavLink><button onClick={logout}>Sign out</button></div>}</div> : <button className="signin" onClick={login}><FiLogIn /> sign in</button>}
        <button className="menu-button" onClick={() => setMenu(!menu)} aria-label="Toggle navigation">{menu ? <FiX /> : <FiMenu />}</button>
      </div>
    </header>
    <main>{children}</main>
    <footer className="footer">
      <img src="/assets/airdash.logo.png" alt="airDash" />
      <div><span>AIR</span><span>AIR DASH</span><span>D1 virtual code</span></div>
      <p>airDash is a privately operated virtual airline for Microsoft Flight Simulator. Owned and operated by @dashydoggo.</p>
    </footer>
  </div>
}


function LiveMap() {
  const { publicData } = useApp()
  const [flights, setFlights] = useState<any[]>([])
  useEffect(() => { const load = () => api<any>("/live").then(v => setFlights(v.flights)).catch(() => {}); load(); const t = window.setInterval(load, 45000); return () => window.clearInterval(t) }, [])
  const apiBases = publicData?.bases ?? []
  const routes = publicData?.routes ?? []
  const topId = publicData?.topPilot?.discord_id
  const baseCoords: Record<string, [number, number]> = Object.fromEntries(apiBases.map(b => [b.code, [b.lat, b.lon]]))
  const coord = (icao: string): [number, number] | null => baseCoords[icao] ?? (AIRPORTS[icao] ? [AIRPORTS[icao].lat, AIRPORTS[icao].lon] : null)
  const baseCodes = new Set(apiBases.map(base => base.code))
  const originCounts = routes.reduce<Record<string, number>>((counts, route) => { counts[route.origin] = (counts[route.origin] ?? 0) + 1; return counts }, {})
  const routeOrigins = Object.keys(originCounts).sort().filter(code => coord(code))
  const segmentKeys = new Set<string>()
  const networkSegments = routes.filter(route => {
    if (!coord(route.origin) || !coord(route.destination)) return false
    const key = [route.origin, route.destination].sort().join("-")
    if (segmentKeys.has(key)) return false
    segmentKeys.add(key)
    return true
  })
  return <section className="live-map-section">
    <div className="live-map-head"><span className="eyebrow"><FiMap /> route network</span><h2>Bases, route origins, and live flights</h2><small>{apiBases.length} operating bases · {routeOrigins.length} route origins · {flights.length} active {flights.length === 1 ? "flight" : "flights"}</small></div>
    <div className="live-map-legend" aria-label="Map legend"><span><i className="base" /> Operating base</span><span><i className="origin" /> Published route origin</span><span><i className="live" /> Live flight</span></div>
    <div className="live-map"><MapContainer center={[31, -86]} zoom={4} minZoom={3} maxZoom={9} scrollWheelZoom worldCopyJump attributionControl={false} style={{ height: "520px", width: "100%", background: "#0b1010" }}>
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png?key=cb1_345o_1_c816449b5def2990f5054a04" subdomains="abcd" maxZoom={9} crossOrigin />
      {networkSegments.map(route => <Polyline key={`network-${route.origin}-${route.destination}`} positions={[coord(route.origin)!, coord(route.destination)!]} interactive={false} pathOptions={{ color: "#28767c", weight: 1.25, opacity: 0.38, dashArray: "4 6" }} />)}
      {routeOrigins.filter(code => !baseCodes.has(code)).map(code => <CircleMarker key={`origin-${code}`} center={coord(code)!} radius={4} pathOptions={{ color: "#071010", weight: 2, fillColor: "#2c8f95", fillOpacity: 0.9 }}><Tooltip direction="top" className="lm-tip"><strong>{code}</strong>{AIRPORTS[code]?.name ?? code}<br />{originCounts[code]} published departure {originCounts[code] === 1 ? "route" : "routes"}</Tooltip></CircleMarker>)}
      {flights.filter(f => coord(f.origin) && coord(f.destination)).map(f => <Polyline key={`f${f.id}`} positions={[coord(f.origin)!, coord(f.destination)!]} pathOptions={{ color: "#48e0f8", weight: 3, opacity: 0.9 }}><Tooltip sticky className="lm-tip"><span className="lm-tip-body"><img src={f.profile_image_url || f.avatar_url} alt="" /><span><strong>AIR{String(f.flight_number).padStart(3, "0")}</strong>{f.origin} <FiArrowRight className="inline-arrow" /> {f.destination}<br />{f.discord_id === topId && <TbCrown className="pilot-crown" />}{f.pilot} · {f.registration}{f.block_minutes ? <><br />enroute ~ {Math.floor(f.block_minutes / 60)}h {f.block_minutes % 60}m</> : null}</span></span></Tooltip></Polyline>)}
      {flights.filter(f => coord(f.origin) && coord(f.destination)).map(f => <Polyline key={`h${f.id}`} positions={[coord(f.origin)!, coord(f.destination)!]} pathOptions={{ color: "#48e0f8", weight: 22, opacity: 0 }}><Tooltip sticky className="lm-tip"><span className="lm-tip-body"><img src={f.profile_image_url || f.avatar_url} alt="" /><span><strong>AIR{String(f.flight_number).padStart(3, "0")}</strong>{f.origin} <FiArrowRight className="inline-arrow" /> {f.destination}<br />{f.discord_id === topId && <TbCrown className="pilot-crown" />}{f.pilot} · {f.registration}{f.block_minutes ? <><br />enroute ~ {Math.floor(f.block_minutes / 60)}h {f.block_minutes % 60}m</> : null}</span></span></Tooltip></Polyline>)}
      {apiBases.map(base => <CircleMarker key={`base-${base.code}`} center={[base.lat, base.lon]} radius={8} pathOptions={{ color: "#040707", weight: 3, fillColor: "#48e0f8", fillOpacity: 1 }}><Tooltip permanent direction="right" className="lm-tip lm-base-tip">{base.code}</Tooltip></CircleMarker>)}
    </MapContainer></div>
  </section>
}

function NetworkMapPage() {
  const { me, publicData } = useApp()
  if (!me?.pilot) return <Page title="Network map" icon={<FiMap />}><Empty icon={<FiShield />} title="A pilot record is required" body="The operations network map is available to approved airDash pilots." /></Page>
  if (!publicData) return <Page title="Network map" icon={<FiMap />}><Spinner label="Loading network control" /></Page>
  return <AdvancedNetworkMap data={publicData} />
}

function Home() {
  const { publicData, me } = useApp()
  const navigate = useNavigate()
  const [tagline, setTagline] = useState(() => Math.random() < 0.5 ? 0 : 1)
  const [parallax, setParallax] = useState({ x: 0, y: 0 })
  const onHeroMove = (event: React.MouseEvent<HTMLElement>) => { const r = event.currentTarget.getBoundingClientRect(); setParallax({ x: ((event.clientX - r.left) / r.width - 0.5) * 2, y: ((event.clientY - r.top) / r.height - 0.5) * 2 }) }
  useEffect(() => { const timer = window.setInterval(() => setTagline(current => current === 0 ? 1 : 0), 3500); return () => window.clearInterval(timer) }, [])
  return <>
    <section className="home-hero" onMouseMove={onHeroMove} style={{ ["--px" as string]: `${parallax.x * 22}px`, ["--py" as string]: `${parallax.y * 18}px`, ["--lx" as string]: `${parallax.x * -26}px`, ["--ly" as string]: `${parallax.y * -20}px` }}>
      <motion.div {...fade} className="hero-copy hero-tagline-row">
        <div className="route-mark"><FiMapPin /> ATL · DEN · SDQ · GEG</div>
        <div className="rotating-tagline"><AnimatePresence mode="wait" initial={false}>{tagline === 0 ?
          <motion.h1 key="ontime" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.32 }}>dashing to be<br /><em>on time.</em></motion.h1> :
          <motion.h1 key="furriest" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.32 }}>the fastest and<br /><em>furriest airline.</em></motion.h1>}
        </AnimatePresence></div>
      </motion.div>
      <motion.div {...fade} className="hero-copy">
        <p>airDash operates Airbus A220-300 aircraft from Atlanta, Denver, Santo Domingo, and Spokane across a growing North American and Caribbean network. Pilots use this site to apply, select published flights, reserve available aircraft, submit flight reports, and download the current liveries.</p>
        <div className="hero-actions">
          <Button onClick={() => navigate(me ? "/portal" : "/join")}>{me ? <><FiArrowRight /> open pilot portal</> : <><FiUserCheck /> apply to join</>}</Button>
          <Button kind="secondary" onClick={() => navigate("/flights")}><FiMap /> view routes</Button>
        </div>
      </motion.div>
      <div className="hero-logo-side" aria-hidden="true"><img src="/assets/airdash-hyena.svg" alt="" /></div>
    </section>

    <LatestNews />
    <LiveMap />

    <section className="home-section home-pilots">
      <header><span className="eyebrow"><FiUsers /> meet the pilots</span><h2>The people flying airDash</h2>{me?.pilot && <Link to="/pilots">Open pilot directory <FiArrowRight /></Link>}</header>
      <div className="home-pilot-grid">{(publicData?.pilots ?? []).map((pilot, index) => <motion.article key={pilot.discord_id} {...fade} transition={{ delay: index * 0.07 }} className={pilot.leadership_title ? "home-pilot-card leadership" : "home-pilot-card"}>
        <img src={pilot.profile_image_url || pilot.avatar_url || "/assets/airdash-hyena.svg"} alt="" />
        <div>
          <span>{pilot.pilot_number} · {pilot.base_code}</span>
          <h3>{pilot.display_name}</h3>
          <div className="home-pilot-roles"><b>{pilot.rank_name || "Captain"}</b>{pilot.leadership_title && <em>{pilot.leadership_title}</em>}</div>
          <div className="home-pilot-stats"><span>{pilot.total_flights} flights</span><span>{formatMinutes(pilot.total_block_minutes)}</span></div>
        </div>
        {pilot.leadership_title && <TbCrown className="leadership-crown" title={pilot.leadership_title} />}
      </motion.article>)}</div>
    </section>

    <section className="home-section fleet-preview">
      <header><span className="eyebrow"><TbPlane /> fleet</span><h2>{publicData?.aircraft.length ?? 0} Airbus A220-300 aircraft</h2><Link to="/fleet">View fleet records and downloads <FiArrowRight /></Link></header>
      <div className="aircraft-pair">
        {(publicData?.aircraft ?? []).slice(0, 2).map((aircraft, index) => <motion.article key={aircraft.registration} {...fade} transition={{ delay: index * 0.08 }}>
          <div className="aircraft-profile-wrap"><img src="/assets/airdash-aircraft-front-cutout.png" alt="" /></div>
          <div className="home-aircraft-details"><span>fleet {aircraft.fleet_number}</span><div className="home-aircraft-registration"><h3>{aircraft.registration}</h3><Status value={aircraft.status} /></div><p>Airbus A220-300 · {aircraft.current_airport}</p></div>
        </motion.article>)}
      </div>

    </section>

    <section className="base-band">
      <div className="base-intro"><span className="eyebrow"><FiMap /> operating bases</span><h2>Four bases across two regions</h2><p>Atlanta, Denver, Santo Domingo, and Spokane anchor the published route network across North America and the Caribbean.</p></div>
      <div className="base-list">{(publicData?.bases ?? []).map(base => <div key={base.code}><FiMapPin /><strong>{base.code}</strong><span>{base.name}</span><small>{base.role}</small></div>)}</div>
    </section>

    <section className="home-section route-preview">
      <header><span className="eyebrow"><FiMap /> routes</span><h2>Route network</h2><Link to="/flights">Open the flight board <FiArrowRight /></Link></header>
      <div className="route-list">{(publicData?.routes ?? []).slice(0, 10).map(route => <div key={route.id}><b>{routeCode(route)}</b><span>{route.origin}</span><FiArrowRight className="inline-arrow" /><span>{route.destination}</span><small>{formatMinutes(route.block_minutes)}</small></div>)}</div>
    </section>
  </>
}

function Join() {
  const { me, refresh, notify, publicData } = useApp()
  const [sending, setSending] = useState(false)
  const login = () => { window.location.href = `https://dashydoggo.com/auth/login?from=${encodeURIComponent(window.location.href)}` }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSending(true)
    const form = new FormData(event.currentTarget)
    try {
      await post("/applications", Object.fromEntries(form))
      notify("Application submitted")
      await refresh()
    } catch (error) { notify(error instanceof Error ? error.message : "Application failed", "error") }
    finally { setSending(false) }
  }
  if (!me) return <Page title="Join airDash" icon={<FiUserCheck />}><Empty icon={<FiLogIn />} title="Sign in to begin an application" body="airDash uses your existing Discord account to identify your application and pilot record."><Button onClick={login}><FiLogIn /> sign in with Discord</Button></Empty></Page>
  if (me.pilot) return <Page title="Pilot account active" icon={<FiCheckCircle />}><Empty icon={<FiCheckCircle />} title={`${me.pilot.pilot_number} is cleared`} body="Your application is approved and the pilot portal is available."><Link className="button button-primary" to="/portal">open pilot portal</Link></Empty></Page>
  if (me.application && !["RETURNED", "REJECTED"].includes(me.application.status)) return <Page title="Application status" icon={<FiClipboard />}><div className="status-panel"><Status value={me.application.status} /><h2>{me.application.preferred_name}</h2><p>Base {me.application.base_code} · VATSIM {me.application.vatsim_cid}</p><small>Submitted {new Date(me.application.submitted_at).toLocaleString()}</small>{me.application.reviewer_notes && <div className="review-note">{me.application.reviewer_notes}</div>}</div></Page>
  return <Page title="Pilot application" icon={<FiClipboard />} intro="Staff review each application before creating a pilot record and issuing a pilot number.">
    <form className="form-grid" onSubmit={submit}>
      <label>Preferred name<input name="preferredName" required maxLength={60} defaultValue={me.user.displayName} /></label>
      <label>VATSIM CID<input name="vatsimCid" required inputMode="numeric" pattern="[0-9]{4,12}" /></label>
      <label>Preferred base<select name="baseCode" required>{(publicData?.bases ?? []).map(b => <option key={b.code} value={b.code}>{b.name}, {b.code}</option>)}</select></label>
      <label>Simulator<select name="simulator" required><option>Microsoft Flight Simulator 2024</option><option>Microsoft Flight Simulator 2020</option><option>X-Plane 12</option></select></label>
      <label className="full">VATSIM experience<select name="experience" required><option value="New">New to VATSIM</option><option value="Some flights">Some online flights</option><option value="Regular pilot">Regular online pilot</option><option value="Experienced">Experienced virtual pilot</option></select></label>
      <label className="full">Introduction<textarea name="introduction" rows={5} maxLength={1000} placeholder="What would you like to fly with airDash?" /></label>
      <div className="full form-submit"><Button type="submit" disabled={sending}><FiSend /> {sending ? "submitting" : "submit application"}</Button></div>
    </form>
  </Page>
}

function PortalSectionHeading({ id, icon, eyebrow, title, description }: { id?: string; icon: ReactNode; eyebrow: string; title: string; description: ReactNode }) {
  return <header id={id} className="portal-section-heading">
    <span className="portal-section-kicker">{icon}<small>{eyebrow}</small></span>
    <h2>{title}</h2>
    <p>{description}</p>
  </header>
}

function Portal() {
  const { me, refresh, notify, publicData, notifications, markNotificationsRead, refreshNotifications } = useApp()
  const portalLocation = useLocation()
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmGateChange, setConfirmGateChange] = useState(false)
  const [confirmDepartureGate, setConfirmDepartureGate] = useState(false)
  const [gateChanged, setGateChanged] = useState<{ kind: "departure" | "destination"; from: string | null; to: string } | null>(null)
  const [simbriefUrl, setSimbriefUrl] = useState("")
  const [dispatchPlan, setDispatchPlan] = useState<SimBriefPlan | null>(null)
  const [vatsimPrefileUrl, setVatsimPrefileUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [orgUpdates, setOrgUpdates] = useState<OrgUpdate[]>([])
  const [orgUpdateTotal, setOrgUpdateTotal] = useState(0)
  const [openHangarPanel, setOpenHangarPanel] = useState<"announcements" | "equipment" | "progress" | "history" | null>(null)
  const pilotStorageId = me?.pilot?.discord_id ?? "guest"
  const progressSeenKey = `airdash-progress-seen:${pilotStorageId}`
  const announcementSeenKey = `airdash-announcements-seen:${pilotStorageId}`
  const equipmentSeenKey = `airdash-equipment-seen:${pilotStorageId}`
  const updateCoachmarkKey = `airdash-updates-coachmark:${pilotStorageId}`
  const [seenExperience, setSeenExperience] = useState<number | null>(() => {
    const value = localStorage.getItem(progressSeenKey)
    return value !== null && Number.isFinite(Number(value)) ? Number(value) : null
  })
  const [seenUpdateId, setSeenUpdateId] = useState(() => Number(localStorage.getItem(announcementSeenKey) || 0))
  const [seenEquipmentFingerprint, setSeenEquipmentFingerprint] = useState(() => localStorage.getItem(equipmentSeenKey) ?? "")
  const [dismissedUpdateSignature, setDismissedUpdateSignature] = useState(() => localStorage.getItem(updateCoachmarkKey) ?? "")
  const currentExperience = me?.pilot ? xpOf(me.pilot) : 0
  const latestUpdateId = Number(orgUpdates[0]?.id ?? 0)
  const equipmentAlerts = useMemo(() => [...(publicData?.aircraft ?? [])]
    .filter(aircraft => ["MAINTENANCE", "INSPECTION"].includes(aircraft.status))
    .sort((left, right) => left.registration.localeCompare(right.registration)), [publicData?.aircraft])
  const equipmentFingerprint = useMemo(() => equipmentAlerts.map(aircraft => [aircraft.registration, aircraft.status, aircraft.status_reason ?? "", aircraft.status_until ?? ""].join(":" )).join("|"), [equipmentAlerts])
  const updateSignature = useMemo(() => [
    ...(notifications?.progress ?? []).map(item => `progress:${item.id}:${item.reviewed_at ?? ""}:${item.credited_minutes ?? ""}`),
    ...(notifications?.orgUpdates ?? []).map(item => `announcement:${item.id}:${item.created_at ?? ""}`),
    ...(notifications?.aircraft ?? []).map(item => `equipment:${item.registration}:${item.status}:${item.status_reason ?? ""}:${item.status_until ?? ""}`),
  ].sort().join("|"), [notifications])
  useEffect(() => { api<OrgUpdatesResponse>("/org-updates?limit=5").then(value => { setOrgUpdates(value.updates); setOrgUpdateTotal(value.total) }).catch(() => {}) }, [])
  useEffect(() => {
    setSeenEquipmentFingerprint(localStorage.getItem(equipmentSeenKey) ?? "")
    setDismissedUpdateSignature(localStorage.getItem(updateCoachmarkKey) ?? "")
  }, [equipmentSeenKey, updateCoachmarkKey])
  useEffect(() => { setDispatchPlan(me?.assignment?.flight_plan ?? null); setVatsimPrefileUrl(null) }, [me?.assignment?.id])
  useEffect(() => {
    if (!me?.pilot || seenExperience !== null) return
    localStorage.setItem(progressSeenKey, String(currentExperience))
    setSeenExperience(currentExperience)
  }, [me?.pilot, currentExperience, progressSeenKey, seenExperience])
  useEffect(() => {
    const panel = portalLocation.hash === "#hangar-announcements" ? "announcements" : portalLocation.hash === "#hangar-equipment" ? "equipment" : portalLocation.hash === "#hangar-progress" ? "progress" : portalLocation.hash === "#hangar-notification-history" ? "history" : null
    if (!panel) return
    setOpenHangarPanel(panel)
    const timer = window.setTimeout(() => document.getElementById(`hangar-${panel}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0)
    return () => window.clearTimeout(timer)
  }, [portalLocation.hash])
  useEffect(() => {
    if (openHangarPanel === "progress" && me?.pilot) {
      localStorage.setItem(progressSeenKey, String(currentExperience))
      setSeenExperience(currentExperience)
    }
    if (openHangarPanel === "announcements" && latestUpdateId > 0) {
      localStorage.setItem(announcementSeenKey, String(latestUpdateId))
      setSeenUpdateId(latestUpdateId)
    }
    if (openHangarPanel === "equipment") {
      localStorage.setItem(equipmentSeenKey, equipmentFingerprint)
      setSeenEquipmentFingerprint(equipmentFingerprint)
    }
  }, [openHangarPanel, currentExperience, latestUpdateId, equipmentFingerprint, me?.pilot, progressSeenKey, announcementSeenKey, equipmentSeenKey])
  const quip = useMemo(() => pickHangarQuip(me?.pilot?.display_name ?? "pilot"), [me?.pilot?.display_name])
  if (!me) return <Join />
  if (!me.pilot) return <Join />
  const cancel = async (reasonCode: string, details: string) => { if (!me.assignment) return; const wasFlying = me.assignment.status === "ACTIVE"; setBusy(true); try { await post(`/assignments/${me.assignment.id}/cancel`, { reasonCode, details }); notify(wasFlying ? "Flying assignment cancelled and aircraft released" : "Booking cancelled and aircraft released"); setConfirmCancel(false); await refresh() } catch (error) { notify(error instanceof Error ? error.message : "Cancellation failed", "error") } finally { setBusy(false) } }
  const startFlight = async () => { if (!me.assignment) return; setBusy(true); try { await post(`/assignments/${me.assignment.id}/start`, {}); notify("Flight marked as flying"); await refresh() } catch (error) { notify(error instanceof Error ? error.message : "Flight could not be started", "error") } finally { setBusy(false) } }
  const regenerateGates = async () => { if (!me.assignment) return; try { await post(`/assignments/${me.assignment.id}/gates`, {}); notify("Both gates regenerated"); await refresh() } catch (error) { notify(error instanceof Error ? error.message : "Gate generation failed", "error") } }
  const reassignArrivalGate = async () => { if (!me.assignment) return; try { const value = await post<{ previousGate: string | null; arrivalGate: string }>(`/assignments/${me.assignment.id}/arrival-gate`, {}); setGateChanged({ kind: "destination", from: value.previousGate, to: value.arrivalGate }); setConfirmGateChange(false); notify(`${value.previousGate ?? "Destination gate"} replaced with ${value.arrivalGate}`); refreshNotifications(); await refresh() } catch (error) { notify(error instanceof Error ? error.message : "Destination gate reassignment failed", "error") } }
  const reassignDepartureGate = async () => { if (!me.assignment) return; try { const value = await post<{ previousGate: string | null; departureGate: string }>(`/assignments/${me.assignment.id}/departure-gate`, {}); setGateChanged({ kind: "departure", from: value.previousGate, to: value.departureGate }); setConfirmDepartureGate(false); notify(`${value.previousGate ?? "Departure gate"} replaced with ${value.departureGate}`); refreshNotifications(); await refresh() } catch (error) { notify(error instanceof Error ? error.message : "Departure gate reassignment failed", "error") } }
  const importPlan = async () => { if (!me.assignment) return; setBusy(true); try { const value = await post<{ assignment: Assignment; plan: SimBriefPlan }>(`/assignments/${me.assignment.id}/simbrief`, { url: simbriefUrl, registration: me.assignment.registration, tailNumber: me.assignment.registration.slice(1,4) }); setDispatchPlan(value.plan); setVatsimPrefileUrl(null); notify("LIDO flight plan imported"); await refresh() } catch (error) { notify(error instanceof Error ? error.message : "SimBrief import failed", "error") } finally { setBusy(false) } }
  const generatePlan = async () => { if (!me.assignment) return; setPreparing(true); setDispatchPlan(null); setVatsimPrefileUrl(null); try { const value = await api<{ url: string }>(`/assignments/${me.assignment.id}/simbrief-generate`); window.open(value.url, "_blank", "noopener"); notify(me.assignment.mission_type === "RECOVERY" ? "Opening SimBrief with the recovery route, 0 passengers, and 0 cargo prefilled" : "Opening SimBrief with the route, registration, and fin prefilled") } catch (error) { notify(error instanceof Error ? error.message : "SimBrief generation failed", "error") } finally { setPreparing(false) } }
  const prefileVatsim = async () => {
    if (!me.assignment) return
    const prefileWindow = window.open("about:blank", "_blank")
    if (prefileWindow) {
      try { prefileWindow.document.title = "Preparing VATSIM prefile"; prefileWindow.document.body.textContent = "Fetching the latest SimBrief OFP…"; prefileWindow.blur(); window.focus() } catch {}
    }
    setBusy(true); setVatsimPrefileUrl(null)
    try {
      const value = await post<{ assignment: Assignment; plan: SimBriefPlan }>(`/assignments/${me.assignment.id}/simbrief-fetch`, {})
      if (!value.plan?.atcFlightPlan) throw new Error("The latest SimBrief OFP does not contain an ATC flight plan")
      const url = buildVatsimPrefileUrl(value.plan)
      setDispatchPlan(value.plan)
      let opened = false
      if (prefileWindow && !prefileWindow.closed) {
        try { prefileWindow.opener = null; prefileWindow.location.replace(url); opened = true } catch { prefileWindow.close() }
      }
      if (!opened) setVatsimPrefileUrl(url)
      notify(opened ? "Latest OFP fetched and VATSIM prefile opened" : "Latest OFP fetched; use the VATSIM prefile link below")
      await refresh()
    } catch (error) {
      if (prefileWindow && !prefileWindow.closed) prefileWindow.close()
      notify(error instanceof Error ? error.message : "VATSIM prefile failed", "error")
    } finally { setBusy(false) }
  }
  const level = pilotLevel(currentExperience)
  const progressChanged = seenExperience !== null && currentExperience !== seenExperience
  const announcementsChanged = latestUpdateId > seenUpdateId
  const equipmentChanged = publicData !== null && equipmentFingerprint !== seenEquipmentFingerprint
  const showUpdateCoachmark = Boolean(updateSignature) && (notifications?.total ?? 0) > 0 && dismissedUpdateSignature !== updateSignature
  const dismissUpdateCoachmark = () => {
    if (!updateSignature) return
    localStorage.setItem(updateCoachmarkKey, updateSignature)
    setDismissedUpdateSignature(updateSignature)
  }
  const viewUpdates = () => {
    dismissUpdateCoachmark()
    document.getElementById("portal-updates")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
  const toggleHangarPanel = (panel: "announcements" | "equipment" | "progress" | "history") => setOpenHangarPanel(current => current === panel ? null : panel)
  return <Page title={quip} icon={<FiHome />} intro={<span className="portal-pilot-base"><FiHome />{me.pilot.pilot_number}; {me.pilot.base_code}.</span>}>
    {showUpdateCoachmark && <aside className="portal-update-coachmark" aria-label="New Hangar updates">
      <span className="portal-update-coachmark-icon"><FiBell /></span>
      <div><strong>New updates are waiting</strong><p>Review announcements, equipment status, and pilot progress below.</p></div>
      <button type="button" className="portal-update-coachmark-action" onClick={viewUpdates}>View updates <FiArrowRight /></button>
      <button type="button" className="portal-update-coachmark-dismiss" onClick={dismissUpdateCoachmark} aria-label="Dismiss updates hint"><FiX /></button>
    </aside>}
    <nav className="portal-outline" aria-label="Hangar section outline">
      <strong><FiMap /> Hangar outline</strong>
      <div>
        <a href="#portal-current-assignment"><TbPlane /> Current assignment</a>
        {me.assignment && <a href="#portal-flight-planning"><FiClipboard /> Flight planning</a>}
        <a href="#portal-updates"><FiBell /> Updates</a>
        <a href="#portal-statistics"><FiActivity /> Statistics</a>
      </div>
    </nav>
    {me.assignment ? <>
      <PortalSectionHeading id="portal-current-assignment" icon={<TbPlane />} eyebrow="Current flight" title={routeCode(me.assignment as unknown as FlightRoute)} description={<>{me.assignment.origin} <FiArrowRight className="inline-arrow" /> {me.assignment.destination}</>} />
      <section className="active-assignment hangar-flight-primary">
        <div className="assignment-gate-summary"><span>Assigned gates</span><div className="assignment-gate-route" aria-label={`Departure gate ${me.assignment.departure_gate ?? "pending"}, arrival gate ${me.assignment.arrival_gate ?? "pending"}`}><span><small>Departure</small><strong>{me.assignment.departure_gate ?? "Pending"}</strong></span><FiArrowRight /><span><small>Arrival</small><strong>{me.assignment.arrival_gate ?? "Pending"}</strong></span></div></div>
        <div className="assignment-action-area">
          <div className="assignment-aircraft"><span>Aircraft</span><b>{me.assignment.registration}</b><Status value={me.assignment.status} /></div>
          <div className="assignment-actions">{me.assignment.status === "BOOKED" && <Button onClick={startFlight} disabled={busy}><FiSend /> {busy ? "starting…" : "start flight"}</Button>}<Link to="/report" className={me.assignment.status === "BOOKED" ? "button button-secondary" : "button button-primary"}><FiFileText /> submit pilot report</Link>{["BOOKED", "ACTIVE"].includes(me.assignment.status) && <Button kind="danger" onClick={() => setConfirmCancel(true)}>{me.assignment.status === "ACTIVE" ? "cancel flight" : "cancel booking"}</Button>}</div>
        </div>
      </section>
      {["BOOKED", "ACTIVE"].includes(me.assignment.status) && me.assignment.expires_at && me.assignment.booked_at && <ExpiryBar bookedAt={me.assignment.started_at ?? me.assignment.booked_at} expiresAt={me.assignment.expires_at} />}
      <section className="volanta-disclosure required"><FiActivity /><p><strong>Volanta required.</strong> It verifies flight data used for your report. <a href="https://volanta.app/" target="_blank" rel="noreferrer">Set up Volanta</a>.</p></section>
      {me.assignment.mission_type === "RECOVERY" && <section className="recovery-ferry-disclosure"><FiAlertCircle /><p><strong>Operations recovery ferry.</strong> Move {me.assignment.registration} from {me.assignment.origin} to its planned destination {me.assignment.destination}. SimBrief is prefilled with 0 passengers and 0 cargo. This flight earns normal experience with no mission multiplier.</p></section>}
      <PortalSectionHeading id="portal-flight-planning" icon={<FiClipboard />} eyebrow="Dispatch" title="Flight planning" description="Resolve gate conflicts, prepare the OFP, and pre-file the active route on VATSIM." />
      <section className="dispatch-tools">
        <div><h3>Gate assignment</h3><p>Departure {me.assignment.departure_gate ?? "TBD"} · destination {me.assignment.arrival_gate ?? "TBD"}. If a gate is occupied in the simulator, only that gate is reassigned.</p><Button kind="secondary" onClick={() => setConfirmDepartureGate(true)}><FiAlertCircle /> departure {me.assignment.departure_gate ?? "gate"} is taken</Button><Button onClick={() => setConfirmGateChange(true)}><FiAlertCircle /> destination {me.assignment.arrival_gate ?? "gate"} is taken</Button>{gateChanged && <div className="gate-change-state"><FiCheckCircle /> {gateChanged.kind === "departure" ? "Departure" : "Destination"} gate changed {gateChanged.from ?? "TBD"} <FiArrowRight /> {gateChanged.to}</div>}<Button kind="secondary" onClick={regenerateGates}>regenerate both gates</Button></div>
        <div><h3>SimBrief flight plan</h3>{!me.pilot.simbrief_username ? <><p>Connect your SimBrief username once and airDash can generate the route, fetch the completed OFP in the background, and pre-file it on VATSIM.</p><Link className="button button-secondary" to="/profile#dispatch-integrations"><FiSettings /> Set up SimBrief in profile</Link></> : <><ol className="dispatch-steps"><li>Generate opens SimBrief prefilled for {me.assignment.registration} (fin {me.assignment.registration.slice(1,4)}) with the LIDO layout.</li><li>Pre-file fetches the completed OFP from {me.pilot.simbrief_username} in the background, saves it, displays the route, and opens VATSIM.</li></ol><Button kind="secondary" onClick={generatePlan} disabled={preparing || busy}>{preparing ? "Preparing…" : "1. Generate in SimBrief"}</Button><Button onClick={prefileVatsim} disabled={busy || preparing}><FiSend /> {busy ? "Fetching OFP…" : "2. Pre-file on VATSIM"}</Button><details className="simbrief-manual"><summary>Paste an OFP URL instead</summary><input value={simbriefUrl} onChange={event => setSimbriefUrl(event.target.value)} placeholder="https://www.simbrief.com/ofp/flightplans/xml/....xml" /><Button kind="secondary" onClick={importPlan} disabled={busy || !simbriefUrl}>Import from URL</Button></details>{dispatchPlan && <small className="dispatch-route-string">{(dispatchPlan.commercialFlightNumber || dispatchPlan.callsign) && <strong>{dispatchPlan.commercialFlightNumber ? `OFP flight ${dispatchPlan.commercialFlightNumber}` : ""}{dispatchPlan.commercialFlightNumber && dispatchPlan.callsign ? " · " : ""}{dispatchPlan.callsign ? `ATC ${dispatchPlan.callsign}` : ""}</strong>}<span>{dispatchPlan.route} · FL{Math.round((dispatchPlan.cruiseAltitude ?? 0) / 100)}</span></small>}{vatsimPrefileUrl && <a className="button button-secondary" href={vatsimPrefileUrl} target="_blank" rel="noreferrer"><FiSend /> Open VATSIM prefile</a>}</>}</div>
      </section>
    </> : <>
      <PortalSectionHeading id="portal-current-assignment" icon={<TbPlane />} eyebrow="Current flight" title="No assignment" description="Choose a route and aircraft from the Flight Board to begin." />
      <Empty icon={<FiMap />} title="No active assignment" body="Choose a route and available aircraft from the flight board."><Link className="button button-primary" to="/flights">open flight board</Link></Empty>
      <section className="volanta-disclosure required"><FiActivity /><p><strong>Volanta required for every flight.</strong> <a href="https://volanta.app/" target="_blank" rel="noreferrer">Set up Volanta</a> before you fly.</p></section>
    </>}

    <PortalSectionHeading id="portal-updates" icon={<FiBell />} eyebrow="Hangar feed" title="Updates" description="Review organization announcements, fleet equipment status, pilot progress, and notification history." />
    <section className="hangar-panels" aria-label="Hangar information">
      <article id="hangar-announcements" className={`hangar-panel${openHangarPanel === "announcements" ? " open" : ""}${announcementsChanged ? " has-change" : ""}`}>
        <button id="hangar-announcements-toggle" className="hangar-panel-toggle" type="button" aria-expanded={openHangarPanel === "announcements"} aria-controls="hangar-announcements-content" onClick={() => toggleHangarPanel("announcements")}>
          {openHangarPanel === "announcements" ? <>
            <span className="hangar-panel-icon"><FiBell /></span><span className="hangar-open-title"><strong>Announcements</strong><small>Latest {orgUpdates.length} of {orgUpdateTotal}</small></span><FiChevronDown className="hangar-panel-caret" />
          </> : <>
            <span className="hangar-panel-icon"><FiBell /></span>{announcementsChanged && <span className="hangar-notification-dot" aria-label="New announcement" />}
            <strong className="hangar-panel-value">{orgUpdateTotal}</strong><span className="hangar-panel-label">Announcements</span><FiChevronDown className="hangar-panel-caret" />
          </>}
        </button>
        {openHangarPanel === "announcements" && <div id="hangar-announcements-content" className="hangar-panel-content" role="region" aria-labelledby="hangar-announcements-toggle"><div className="org-update-list">{orgUpdates.length ? orgUpdates.map(update => <OrgUpdateCard key={update.id} update={update} />) : <p className="org-empty">No organization announcements have been published.</p>}</div><div className="hangar-announcement-footer"><span>Announcements are retained permanently.</span><Link to="/announcements"><FiSearch /> Search full history <FiArrowRight /></Link></div></div>}
      </article>

      <article id="hangar-equipment" className={`hangar-panel${openHangarPanel === "equipment" ? " open" : ""}${equipmentChanged ? " has-change" : ""}`}>
        <button id="hangar-equipment-toggle" className="hangar-panel-toggle" type="button" aria-expanded={openHangarPanel === "equipment"} aria-controls="hangar-equipment-content" onClick={() => toggleHangarPanel("equipment")}>
          {openHangarPanel === "equipment" ? <>
            <span className="hangar-panel-icon"><TbPlane /></span><span className="hangar-open-title"><strong>Equipment</strong><small>{equipmentAlerts.length ? `${equipmentAlerts.length} aircraft require attention` : "No active equipment alerts"}</small></span><FiChevronDown className="hangar-panel-caret" />
          </> : <>
            <span className="hangar-panel-icon"><TbPlane /></span>{equipmentChanged && <span className="hangar-notification-dot" aria-label="Equipment status updated" />}
            <strong className="hangar-panel-value">{equipmentAlerts.length}</strong><span className="hangar-panel-label">Equipment</span><FiChevronDown className="hangar-panel-caret" />
          </>}
        </button>
        {openHangarPanel === "equipment" && <div id="hangar-equipment-content" className="hangar-panel-content hangar-equipment-detail" role="region" aria-labelledby="hangar-equipment-toggle">
          {equipmentAlerts.length ? <div className="hangar-equipment-list">{equipmentAlerts.map(aircraft => <article className="hangar-equipment-alert" key={aircraft.registration}>
            <header><strong>{aircraft.registration}</strong><Status value={aircraft.status} /></header>
            <p>{aircraft.status_reason || "Operations has temporarily removed this aircraft from service."}</p>
            {aircraft.status_until && <small>Expected available <time dateTime={aircraft.status_until}>{new Date(aircraft.status_until).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</time></small>}
          </article>)}</div> : <p className="hangar-equipment-empty">No aircraft are currently in maintenance or inspection.</p>}
          <div className="hangar-announcement-footer"><span>Equipment status is maintained by Operations.</span><Link to="/fleet">View full fleet <FiArrowRight /></Link></div>
        </div>}
      </article>

      <article id="hangar-progress" className={`hangar-panel${openHangarPanel === "progress" ? " open" : ""}${progressChanged ? " has-change" : ""}`}>
        <button id="hangar-progress-toggle" className="hangar-panel-toggle" type="button" aria-expanded={openHangarPanel === "progress"} aria-controls="hangar-progress-content" onClick={() => toggleHangarPanel("progress")}>
          {openHangarPanel === "progress" ? <>
            <span className="hangar-panel-icon"><FiActivity /></span><span className="hangar-open-title"><strong>Pilot progress</strong><small>Experience, level, and streaks</small></span><FiChevronDown className="hangar-panel-caret" />
          </> : <>
            <span className="hangar-panel-icon"><FiActivity /></span>{progressChanged && <span className="hangar-notification-dot" aria-label="Progress updated" />}
            <strong className="hangar-panel-value">Level {level.level}</strong><span className="hangar-panel-label">Progress</span><FiChevronDown className="hangar-panel-caret" />
          </>}
        </button>
        {openHangarPanel === "progress" && <div id="hangar-progress-content" className="hangar-panel-content hangar-progress-detail" role="region" aria-labelledby="hangar-progress-toggle">
          <div className="hangar-progress-summary"><div><strong>{currentExperience}</strong><span>Total XP</span></div><div><strong>{level.xpToNext}</strong><span>To level {level.level + 1}</span></div><div className="hangar-progress-meter"><span>Level {level.level} progress{publicData?.topPilot?.discord_id === me.pilot.discord_id && <TbCrown className="pilot-crown" title="Most hours in the airline" />}</span><div className="level-track"><div className="level-fill" style={{ width: `${Math.round(level.progress * 100)}%` }} /></div></div></div>
          <p className="hangar-progress-help">Experience is based on real-time minutes verified by Volanta. Mission and active flight-day streak bonuses are applied after time-compression adjustments.</p>
          <StreakCards streaks={me.streaks} />
        </div>}
      </article>

      <article id="hangar-notification-history" className={`hangar-panel${openHangarPanel === "history" ? " open" : ""}${(notifications?.total ?? 0) > 0 ? " has-change" : ""}`}>
        <button id="hangar-notification-history-toggle" className="hangar-panel-toggle" type="button" aria-expanded={openHangarPanel === "history"} aria-controls="hangar-notification-history-content" onClick={() => toggleHangarPanel("history")}>
          {openHangarPanel === "history" ? <>
            <span className="hangar-panel-icon"><FiBell /></span><span className="hangar-open-title"><strong>Notification history</strong><small>{notifications?.total ?? 0} unread · {notifications?.history?.length ?? 0} retained</small></span><FiChevronDown className="hangar-panel-caret" />
          </> : <>
            <span className="hangar-panel-icon"><FiBell /></span>{(notifications?.total ?? 0) > 0 && <span className="hangar-notification-dot" aria-label="Unread notifications" />}
            <strong className="hangar-panel-value">{notifications?.history?.length ?? 0}</strong><span className="hangar-panel-label">Notification history</span><FiChevronDown className="hangar-panel-caret" />
          </>}
        </button>
        {openHangarPanel === "history" && <div id="hangar-notification-history-content" className="hangar-panel-content notification-history-content" role="region" aria-labelledby="hangar-notification-history-toggle">
          <header><span>Recent alerts are retained across devices.</span>{(notifications?.total ?? 0) > 0 && <button onClick={() => { void markNotificationsRead() }}>Mark all read</button>}</header>
          {(notifications?.history?.length ?? 0) === 0 ? <p className="org-empty">No notification history yet.</p> : <div className="portal-notification-history">{notifications?.history?.map(item => <article key={item.id} className={item.read_at ? "read" : "unread"}>
            <Link to={item.href}>{notificationHistoryIcon(item.kind)}<span><strong>{item.title}</strong><small>{item.body}</small><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</time></span></Link>
            {!item.read_at && <button onClick={() => { void markNotificationsRead([item.id]) }} aria-label={`Mark ${item.title} as read`} title="Mark as read"><FiCheck /></button>}
          </article>)}</div>}
        </div>}
      </article>
    </section>

    <PortalSectionHeading id="portal-statistics" icon={<FiActivity />} eyebrow="Pilot record" title="Statistics" description="A compact summary of your approved flying activity." />
    <div className="metric-row"><Metric icon={<FiFileText />} value={String(me.pilot.total_flights)} label="approved flights" /><Metric icon={<FiClock />} value={formatMinutes(me.pilot.total_block_minutes)} label="block time" /><Metric icon={<FiStar />} value={String(me.pilot.missions_completed ?? 0)} label="missions" /><Metric icon={<FiActivity />} value={sinceLastFlight(me.lastFlightAt)} label="since last flight" /></div>
    <ConfirmDialog open={confirmDepartureGate} title={`Is departure gate ${me.assignment?.departure_gate ?? "TBD"} taken?`} body="Use this when the gate is occupied on VATSIM. Only the departure gate changes." confirmLabel="Assign another gate" cancelLabel="Nevermind" onConfirm={reassignDepartureGate} onCancel={() => setConfirmDepartureGate(false)} />
    <ConfirmDialog open={confirmGateChange} title={`Is destination gate ${me.assignment?.arrival_gate ?? "TBD"} taken?`} body="Only the destination gate will change. The departure gate and flight assignment stay the same." confirmLabel="Assign another gate" onConfirm={reassignArrivalGate} onCancel={() => setConfirmGateChange(false)} />
    <CancelFlightDialog open={confirmCancel} status={me.assignment?.status ?? ""} registration={me.assignment?.registration} busy={busy} onConfirm={cancel} onCancel={() => setConfirmCancel(false)} />
  </Page>
}

function Announcements() {
  const { me } = useApp()
  const [updates, setUpdates] = useState<OrgUpdate[]>([])
  const [total, setTotal] = useState(0)
  const [kinds, setKinds] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState("")
  const [sort, setSort] = useState<"newest" | "oldest">("newest")
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  const requestId = useRef(0)
  const pageSize = 25

  const loadPage = async (offset: number, append: boolean) => {
    const currentRequest = ++requestId.current
    setLoading(true); setError("")
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset), sort })
    if (query.trim()) params.set("q", query.trim())
    if (kind) params.set("kind", kind)
    try {
      const value = await api<OrgUpdatesResponse>(`/org-updates?${params}`)
      if (currentRequest !== requestId.current) return
      setUpdates(current => append ? [...current, ...value.updates] : value.updates)
      setTotal(value.total); setKinds(value.kinds); setLoaded(true)
    } catch (loadError) {
      if (currentRequest !== requestId.current) return
      setError(loadError instanceof Error ? loadError.message : "Announcement history could not be loaded")
      setLoaded(true)
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!me?.pilot) return
    const timer = window.setTimeout(() => { loadPage(0, false) }, query ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [me?.pilot?.discord_id, query, kind, sort])

  if (!me?.pilot) return <Page title="Announcements" icon={<FiBell />}><Empty icon={<FiShield />} title="A pilot record is required" body="Organization announcements are available to approved airDash pilots." /></Page>
  const filtered = Boolean(query || kind || sort !== "newest")
  return <Page title="Announcements" icon={<FiBell />} intro="The permanent airDash organization archive. Search every retained announcement, filter by category, or review the history from oldest to newest.">
    <div className="board-toolbar announcement-toolbar"><div className="search"><FiSearch /><input aria-label="Search announcements" placeholder="Search title, message, pilot, or aircraft" value={query} onChange={event => setQuery(event.target.value)} /></div><label>Category<select value={kind} onChange={event => setKind(event.target.value)}><option value="">All categories</option>{kinds.map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label>Sort<select value={sort} onChange={event => setSort(event.target.value as "newest" | "oldest")}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div>
    <div className="announcement-archive-summary"><span>{loading && !loaded ? "Loading archive" : `Showing ${updates.length} of ${total} announcement${total === 1 ? "" : "s"}`}</span>{filtered && <button onClick={() => { setQuery(""); setKind(""); setSort("newest") }}>Clear search and filters</button>}</div>
    {error ? <p className="archive-error"><FiAlertCircle /> {error}</p> : !loaded && loading ? <Spinner label="Loading announcement history" /> : updates.length === 0 ? <div className="archive-empty"><FiBell /><h2>No matching announcements</h2><p>{filtered ? "Change or clear the search filters to see more of the archive." : "Organization announcements will appear here when they are published."}</p></div> : <div className="announcement-archive-list">{updates.map(update => <OrgUpdateCard key={update.id} update={update} />)}</div>}
    {updates.length < total && <div className="archive-load-more"><Button kind="secondary" onClick={() => loadPage(updates.length, true)} disabled={loading}>{loading ? "Loading…" : `Load more · ${total - updates.length} remaining`}</Button></div>}
  </Page>
}

function outOfServiceNote(aircraft: Aircraft) {
  if (aircraft.status === "ASSIGNED") return "Assigned to another pilot"
  if (["AVAILABLE", "PLANNED"].includes(aircraft.status)) return null
  const until = aircraft.status_until ? ` · until ${new Date(aircraft.status_until).toLocaleString()}` : ""
  return `${aircraft.status_reason || "Out of service"}${until}`
}

function Flights() {
  const { me, refresh, notify, publicData } = useApp()
  const [routes, setRoutes] = useState<FlightRoute[]>([])
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [expanded, setExpanded] = useState<number | null>(null)
  const [openOrigins, setOpenOrigins] = useState<Record<string, boolean>>({})
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState("origin")
  const [pending, setPending] = useState<{ route: FlightRoute; registration: string } | null>(null)
  const [previewAircraft, setPreviewAircraft] = useState<Aircraft | null>(null)
  const volantaConsent = true
  const [booking, setBooking] = useState(false)
  const [volantaOpened, setVolantaOpened] = useState(false)
  useEffect(() => { if (me) api<{ routes: FlightRoute[] }>("/flights").then(value => setRoutes(value.routes)).catch(() => {}) }, [me])
  if (!me?.pilot) return <Page title="Flight board" icon={<FiMap />}><Empty icon={<FiShield />} title="A pilot record is required" body="Flight assignments become available after staff approve your pilot application."><Link className="button button-primary" to="/join">View pilot application</Link></Empty></Page>
  const aircraftAt = (icao: string) => (publicData?.aircraft ?? []).filter(aircraft => aircraft.current_airport === icao && !["RETIRED", "PLANNED"].includes(aircraft.status))
  const preferredLiverySimulator = me.application?.simulator?.includes("2020") ? "2020" : "2024"
  const downloadLivery = async (aircraft: Aircraft) => { try { const res = await post<{ url: string }>(`/liveries/${aircraft.registration}/${preferredLiverySimulator}/download`, {}); if (res.url) window.open(res.url, "_blank", "noopener"); notify(`Downloading ${aircraft.registration}${aircraft.livery_name ? ` (${aircraft.livery_name})` : ""} livery for MSFS ${preferredLiverySimulator}`); await refresh() } catch (error) { notify(error instanceof Error ? error.message : "Livery download failed", "error") } }
  const openVolantaForBooking = () => {
    launchVolantaDesktop()
    setVolantaOpened(true)
  }
  const closeBookingDialog = () => { if (!booking) { setPending(null); setVolantaOpened(false) } }
  const confirmBooking = async () => {
    if (!pending || !volantaOpened) return
    setBooking(true)
    try {
      const result = await post<{ existing?: boolean; rebooked?: boolean }>("/assignments", { routeId: pending.route.id, registration: pending.registration, flightDate: date, volantaTrackingConsent: volantaConsent })
      notify(result.existing ? `${routeCode(pending.route)} is already assigned to you` : result.rebooked ? `${routeCode(pending.route)} booked again with ${pending.registration}` : `${routeCode(pending.route)} booked with ${pending.registration}`, "ok", { label: "Go to hangar", to: "/portal" })
      setPending(null)
      setVolantaOpened(false)
      setExpanded(null)
      await refresh()
    } catch (error) { notify(error instanceof Error ? error.message : "Booking failed", "error") }
    finally { setBooking(false) }
  }
  return <Page title="Flight board" icon={<FiMap />} intro="Select a published route, operating date, and aircraft positioned at the origin.">
    <div className="flight-toolbar"><label><FiCalendar /> operating date<input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={event => setDate(event.target.value)} /></label>{me.assignment && <span><FiAlertCircle /> Finish or cancel the current assignment before booking another.</span>}</div>
    <div className="board-toolbar"><div className="search"><FiMap /><input placeholder="Search flight, origin, or destination" value={query} onChange={e => setQuery(e.target.value)} /></div><label>Sort<select value={sort} onChange={e => setSort(e.target.value)}><option value="origin">By origin</option><option value="shortest">Shortest</option><option value="longest">Longest</option><option value="ready">Aircraft ready</option></select></label></div>
    {(() => {
      const q = query.trim().toUpperCase()
      const filtered = routes.filter(r => !q || `AIR${String(r.flight_number).padStart(3, "0")}`.includes(q) || r.origin.includes(q) || r.destination.includes(q))
      const origins = Array.from(new Set(filtered.map(r => r.origin)))
      origins.sort((a, b) => sort === "ready" ? aircraftAt(b).filter(x => x.status === "AVAILABLE").length - aircraftAt(a).filter(x => x.status === "AVAILABLE").length : a.localeCompare(b))
      return origins.map(origin => { const originRoutes = filtered.filter(r => r.origin === origin).sort((a, b) => sort === "shortest" ? a.block_minutes - b.block_minutes : sort === "longest" ? b.block_minutes - a.block_minutes : a.destination.localeCompare(b.destination)); const isOpen = openOrigins[origin] ?? Boolean(q); const available = aircraftAt(origin).filter(a => a.status === "AVAILABLE").length; return <div key={origin} className="origin-group">
      <button className="origin-heading" onClick={() => setOpenOrigins(s => ({ ...s, [origin]: !(s[origin] ?? Boolean(q)) }))}><FiMapPin /> Departing {origin}<span>{originRoutes.length} routes · {available} aircraft ready</span><FiChevronDown className={isOpen ? "pirep-caret open" : "pirep-caret"} /></button>
      {isOpen && <div className="flight-table">{originRoutes.map(route => <article key={route.id} className={expanded === route.id ? "expanded" : ""}>
      <div className="flight-number"><span>flight</span><strong>{routeCode(route)}</strong></div>
      <div className="city-pair"><b>{route.origin}</b><FiArrowRight className="inline-arrow" /><b>{route.destination}</b><small>{formatMinutes(route.block_minutes)} · {route.days}</small></div>
      <div className="equipment"><Button kind={expanded === route.id ? "secondary" : "primary"} onClick={() => setExpanded(expanded === route.id ? null : route.id)}><TbPlane /> {expanded === route.id ? "hide aircraft" : "choose aircraft"}</Button></div>
      {expanded === route.id && <div className="aircraft-chooser">{aircraftAt(route.origin).map(aircraft => {
        const note = outOfServiceNote(aircraft)
        const selectable = aircraft.status === "AVAILABLE" && me.assignment == null
        return <div key={aircraft.registration} className="aircraft-option-wrap">
          <button className={selectable ? "aircraft-option" : "aircraft-option unavailable"} disabled={!selectable} onClick={() => { setPending({ route, registration: aircraft.registration }); setVolantaOpened(false) }}>
            <strong>{aircraft.registration}{aircraft.special_livery && <em className="special-livery-tag" title="Special livery">{aircraft.livery_name}</em>}</strong><Status value={aircraft.status} />
            <span>{aircraft.total_cycles} cycles · {formatMinutes(aircraft.total_block_minutes)} block</span>
            {note && <small>{note}</small>}
          </button>
          {aircraft.livery_url && !(me.downloadedLiveries ?? []).includes(aircraft.registration) && <button type="button" className="aircraft-preview-btn livery-dl-btn" onClick={() => downloadLivery(aircraft)} aria-label={`Download ${aircraft.registration} livery`} title={`Download MSFS ${preferredLiverySimulator} livery (not yet downloaded)`}><FiDownload /></button>}
          <button type="button" className="aircraft-preview-btn" onClick={() => setPreviewAircraft(aircraft)} aria-label={`Preview ${aircraft.registration}`} title="Preview aircraft"><FiEye /></button>
        </div>
      })}{aircraftAt(route.origin).length === 0 && <small className="chooser-empty">No airframes are positioned at {route.origin}.</small>}</div>}
    </article>)}</div>}
    </div> })
    })()}
    {pending && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeBookingDialog() }}>
      <section className="confirm-dialog booking-dialog" role="alertdialog" aria-modal="true" aria-labelledby="booking-title">
        {volantaOpened ? <FiCheckCircle /> : <FiActivity />}<h2 id="booking-title">{volantaOpened ? "Confirm this booking?" : "Open Volanta first"}</h2>
        <p>{routeCode(pending.route)} · {pending.route.origin} to {pending.route.destination} on {date} with {pending.registration}.</p>
        <div className="volanta-consent required"><FiActivity /><span><strong>{volantaOpened ? "Step 2 of 2 · Confirm the booking." : "Step 1 of 2 · Open the Volanta desktop app."}</strong> {volantaOpened ? "No booking exists yet. Confirm only after Volanta is open and ready to track." : "This launches the installed desktop client through the volanta:// protocol without reserving the aircraft."} <a href="https://volanta.app/" target="_blank" rel="noreferrer">Install Volanta</a>.</span></div>
        <div><Button kind="secondary" onClick={closeBookingDialog} disabled={booking}>Keep browsing</Button><Button onClick={volantaOpened ? confirmBooking : openVolantaForBooking} disabled={booking}>{volantaOpened ? (booking ? "Booking..." : "Confirm booking") : <><FiActivity /> Open Volanta</>}</Button></div>
      </section>
    </div>}
    {previewAircraft && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPreviewAircraft(null) }}>
      <section className="aircraft-preview" role="dialog" aria-modal="true" aria-label={`${previewAircraft.registration} preview`}>
        <button className="pilot-modal-close" onClick={() => setPreviewAircraft(null)} aria-label="Close"><FiX /></button>
        <div className="aircraft-preview-image"><img src={previewAircraft.thumbnail_url || "/assets/airdash-aircraft-front-cutout.png"} alt={`airDash Airbus A220-300 ${previewAircraft.registration}`} onError={e => { (e.currentTarget as HTMLImageElement).src = "/assets/airdash-aircraft-front-cutout.png" }} /></div>
        <h2>{previewAircraft.registration}</h2>
        {previewAircraft.special_livery && <p className="special-livery-line"><FiStar /> Special livery · {previewAircraft.livery_name}</p>}
        <p>Airbus A220-300 · fleet {previewAircraft.fleet_number} · {previewAircraft.current_airport}</p>
        <div className="aircraft-preview-stats"><div><strong>{previewAircraft.total_cycles}</strong><small>cycles</small></div><div><strong>{formatMinutes(previewAircraft.total_block_minutes)}</strong><small>block time</small></div><div><Status value={previewAircraft.status} /></div></div>
        {outOfServiceNote(previewAircraft) && <p className="oos-reason">{outOfServiceNote(previewAircraft)}</p>}
        {previewAircraft.livery_url && <Button kind="secondary" onClick={() => downloadLivery(previewAircraft)}><FiDownload /> {(me.downloadedLiveries ?? []).includes(previewAircraft.registration) ? "Download livery again" : "Download livery"}</Button>}
      </section>
    </div>}
  </Page>
}

function PirepHistory() {
  const [pireps, setPireps] = useState<any[]>([])
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => { api<any>("/pireps").then(value => setPireps(value.pireps)).catch(() => {}) }, [])
  if (!pireps.length) return null
  const fmt = (value: string | null) => value ? new Date(value).toLocaleString() : "—"
  return <section className="pirep-history"><h3>Your pilot reports</h3><div className="pirep-list">{pireps.map(p => { const outcome = (p.outcome_type ?? "COMPLETED") as PirepOutcome; const punc = outcome === "COMPLETED" ? punctuality(p.actual_out_at, p.actual_in_at, p.block_minutes) : null; const blockMin = p.actual_out_at && p.actual_in_at ? Math.round((new Date(p.actual_in_at).getTime() - new Date(p.actual_out_at).getTime()) / 60000) : null; return <article key={p.id} className={open === p.id ? "open" : ""}>
    <button className="pirep-head" onClick={() => setOpen(open === p.id ? null : p.id)}><span>AIR{String(p.flight_number).padStart(3, "0")} · {p.origin} <FiArrowRight className="inline-arrow" /> {p.destination}</span><span className="pirep-head-right">{punc && <em className={`punc ${punc.cls}`}>{punc.label}</em>}{outcome !== "COMPLETED" && <Status value={outcome} />}<Status value={p.review_status} /><FiChevronDown className={open === p.id ? "pirep-caret open" : "pirep-caret"} /></span></button>
    {open === p.id && <div className="pirep-detail"><div><span>Aircraft</span>{p.registration}</div><div><span>Outcome</span>{outcomeLabel(outcome)}</div><div><span>Out</span>{fmt(p.actual_out_at)}</div><div><span>Off</span>{fmt(p.actual_off_at)}</div><div><span>On</span>{fmt(p.actual_on_at)}</div><div><span>{outcome === "INCOMPLETE" ? "Record end" : "In"}</span>{fmt(p.actual_in_at)}</div><div><span>Actual block</span>{blockMin == null ? "—" : formatMinutes(blockMin)}{p.block_minutes ? ` · sched ${formatMinutes(p.block_minutes)}` : ""}</div><div><span>Credited block</span>{p.credited_block_minutes == null ? "—" : formatMinutes(Number(p.credited_block_minutes))}{Number(p.credit_multiplier ?? 1) < 1 ? ` · ${Math.round(Number(p.credit_multiplier) * 100)}% credit` : ""}</div><div><span>Source</span>{p.source === "MISSION" ? (p.mission_type === "RECOVERY" ? "Recovery ferry" : "Mission") : p.source === "SCHEDULE" ? "Schedule" : "Self-assigned"}</div><div><span>Experience</span>{p.credited_minutes == null ? "—" : `${p.credited_minutes} XP`}{p.streak_bonus_experience > 0 ? ` · +${p.streak_bonus_experience} streak (${p.streak_bonus_percent}%)` : ""}</div><div><span>Landing rate</span><b style={{ color: landingColor(p.landing_rate) }}>{p.landing_rate == null ? "not recorded" : `${p.landing_rate} fpm`}</b></div><div><span>Network</span>{p.vatsim_flown ? "VATSIM" : (p.network ?? "—")}</div><div><span>Callsign</span>{p.callsign ?? "—"}</div><div><span>Distance</span>{p.distance_nm ? `${Math.round(p.distance_nm)} NM` : "—"}</div><div><span>Fuel burn</span>{p.fuel_burn ? `${Math.round(p.fuel_burn)}` : "—"}</div>{outcome !== "COMPLETED" && <><div><span>Aircraft reposition</span>{p.reposition_airport ?? "—"}<small className="pirep-field-help">{repositionMethodLabel(p.reposition_method)}</small></div><div><span>Reason</span>{diversionReasonLabel(p.diversion_reason_code)}</div>{p.diversion_details && <div className="pirep-remarks"><span>Operations details</span>{p.diversion_details}</div>}</>}{p.remarks && <div className="pirep-remarks"><span>Remarks</span>{p.remarks}</div>}{p.review_notes && <div className="pirep-remarks"><span>Staff notes</span>{p.review_notes}</div>}{p.time_compression_detected && <div className="pirep-compression"><FiAlertCircle /><span>Time compression detected · {Number(p.time_compression_ratio).toFixed(2)}x · {p.credited_minutes ?? 0} XP credited</span></div>}{p.volanta_url && <div className="pirep-remarks"><span>Volanta</span><a href={p.volanta_url} target="_blank" rel="noreferrer">flight link</a></div>}</div>}
  </article> })}</div></section>
}

function AssignmentHistory() {
  const [items, setItems] = useState<any[]>([])
  useEffect(() => { api<any>("/assignments/history").then(value => setItems(value.assignments)).catch(() => {}) }, [])
  if (!items.length) return null
  return <section className="pirep-history"><h3>Your assignment history</h3><div className="assignment-history">{items.map(a => { const outcome = a.pirep_outcome_type as PirepOutcome | undefined; return <article key={a.id}><div className="ah-flight"><strong>AIR{String(a.flight_number).padStart(3, "0")}</strong><span>{a.origin} <FiArrowRight className="inline-arrow" /> {a.destination}</span>{a.mission_type === "RECOVERY" && <small className="ah-recovery"><TbPlane /> Operations recovery ferry · 0 passenger payload · normal XP</small>}{outcome && outcome !== "COMPLETED" && <small className="ah-diversion"><FiAlertCircle /> {outcomeLabel(outcome)} · {a.reposition_airport ?? "position pending"}{a.diversion_reason_code ? ` · ${diversionReasonLabel(a.diversion_reason_code)}` : ""}</small>}{["CANCELLED", "EXPIRED"].includes(a.status) && a.cancellation_reason && <small className="ah-cancellation"><FiXCircle /> {a.cancellation_reason}{a.cancelled_at ? ` · ${new Date(a.cancelled_at).toLocaleString()}` : ""}</small>}</div><div className="ah-meta"><span>{a.registration}</span><span>{a.flight_date}</span></div><Status value={a.status} /></article> })}</div></section>
}

function Schedule() {
  const [schedule, setSchedule] = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("all")
  useEffect(() => { const load = () => api<any>("/schedule").then(v => setSchedule(v.schedule)).catch(() => {}).finally(() => setLoaded(true)); load(); const t = window.setInterval(load, 60000); return () => window.clearInterval(t) }, [])
  const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + "Z"
  const day = (value: string) => new Date(value).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
  const q = query.trim().toUpperCase()
  const visible = schedule.filter(s => s.status !== "DEPARTED")
    .filter(s => filter === "all" || (filter === "open" && s.status === "OPEN") || (filter === "active" && s.assignment_status && ["BOOKED", "ACTIVE", "PIREP_SUBMITTED"].includes(s.assignment_status)))
    .filter(s => !q || `AIR${String(s.flight_number).padStart(3, "0")}`.includes(q) || s.origin.includes(q) || s.destination.includes(q))
  return <Page title="Schedule" icon={<FiCalendar />} intro="Live airDash timetable in Zulu (UTC). Open recommendations appear alongside every active flight, including assignments started from the Flight Board or Missions.">
    <LiveClock />
    <div className="board-toolbar"><div className="search"><FiCalendar /><input placeholder="Search flight, origin, or destination" value={query} onChange={e => setQuery(e.target.value)} /></div><div className="filter-chips">{[["all", "All"], ["open", "Open"], ["active", "In progress"]].map(([v, l]) => <button key={v} className={filter === v ? "on" : ""} onClick={() => setFilter(v)}>{l}</button>)}</div></div>
    {!loaded ? <Spinner label="Loading schedule" /> : <div className="schedule-list">{visible.length === 0 ? <Empty icon={<FiCalendar />} title="No matching flights" body={filter === "active" ? "No pilots currently have an active assignment matching this search." : "Adjust the search or filter, or wait for new recommendations."} /> : visible.map(s => {
      const active = s.assignment_status && ["BOOKED", "ACTIVE", "PIREP_SUBMITTED"].includes(s.assignment_status)
      const completed = s.pirep_status === "APPROVED"
      const dep = completed && s.actual_out_at ? s.actual_out_at : s.dep_time
      const arr = completed && s.actual_in_at ? s.actual_in_at : s.arr_time
      const sourceLabel = s.assignment_source === "MISSION" ? "Mission" : s.assignment_source === "SCHEDULE" ? "Schedule" : "Flight Board"
      const timingLabel = s.unscheduled_assignment ? `${sourceLabel} · ${s.actual_in_at ? "arrived" : "estimated arrival"} ${time(arr)}` : `arrives ${time(arr)} · ${formatMinutes(s.block_minutes)}`
      return <article key={s.id} className={active ? "schedule-row active" : "schedule-row"}>
        <div className="sched-time"><strong>{time(dep)}</strong><small>{day(dep)}</small></div>
        <div className="sched-flight"><b>AIR{String(s.flight_number).padStart(3, "0")}</b><span>{s.origin} <FiArrowRight className="inline-arrow" /> {s.destination}</span><small>{timingLabel}</small></div>
        <div className="sched-status">{active ? <div className="sched-pilot"><img src={s.profile_image_url || s.avatar_url} alt="" /><span>{s.pilot}<small>{s.registration} · {s.assignment_status === "ACTIVE" ? "flying" : s.assignment_status === "PIREP_SUBMITTED" ? "report submitted" : "booked"}</small></span></div> : completed ? <Status value="COMPLETED" /> : <Status value="OPEN" />}</div>
      </article>
    })}</div>}
  </Page>
}

function Report() {
  const { me, refresh, notify } = useApp()
  const [sending, setSending] = useState(false)
  const [importing, setImporting] = useState(false)
  const [volantaUrl, setVolantaUrl] = useState("")
  const [volanta, setVolanta] = useState<VolantaFlight | null>(null)
  const [analysis, setAnalysis] = useState<FlightOutcomeAnalysis | null>(null)
  const [diversionReasonCode, setDiversionReasonCode] = useState("")
  const [diversionDetails, setDiversionDetails] = useState("")
  const [vatsimFlown, setVatsimFlown] = useState(false)
  const [remarks, setRemarks] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  if (!me?.assignment) return <Page title="Pilot report" icon={<FiFileText />} intro="Submitted reports remain here for your records."><div className="empty"><Empty icon={<FiFileText />} title="No active flight to report" body="A new pilot report is attached to an active assignment. Your submitted reports are listed below."><Link className="button button-primary" to="/flights">flight board</Link></Empty></div><PirepHistory /><AssignmentHistory /></Page>
  const resetImportedFlight = () => { setVolanta(null); setAnalysis(null); setDiversionReasonCode(""); setDiversionDetails(""); setRemarks(""); setConfirmOpen(false) }
  const importFlight = async (sourceUrl = volantaUrl) => {
    const normalizedUrl = sourceUrl.trim()
    if (!normalizedUrl || importing) return
    setImporting(true)
    resetImportedFlight()
    try {
      const value = await post<{ flight: VolantaFlight; analysis: FlightOutcomeAnalysis }>("/volanta/import", { url: normalizedUrl, assignmentId: me.assignment!.id })
      setVolanta(value.flight); setAnalysis(value.analysis)
      if (value.analysis.requiresReason) setDiversionReasonCode(suggestedDiversionReason(value.analysis.suggestedReason))
      notify(value.analysis.outcome === "COMPLETED" ? "Volanta flight verified" : "Volanta identified a non-complete outcome")
    } catch (error) { notify(error instanceof Error ? error.message : "Volanta import failed", "error") }
    finally { setImporting(false) }
  }
  const submit = async () => {
    if (!volanta || !analysis) return
    setSending(true)
    try {
      await post("/pireps", { assignmentId: me.assignment!.id, volantaUrl, vatsimFlown, remarks, diversionReasonCode, diversionDetails })
      notify(analysis.outcome === "COMPLETED" ? "Pilot report submitted" : "Diversion report submitted for Operations review")
      setConfirmOpen(false)
      await refresh()
    } catch (error) { notify(error instanceof Error ? error.message : "Report failed", "error") }
    finally { setSending(false) }
  }
  const value = (key: keyof VolantaFlight) => String(volanta?.[key] ?? "").slice(0, 16)
  const nonComplete = analysis?.requiresReason === true
  const reasonValid = !nonComplete || (Boolean(diversionReasonCode) && (diversionReasonCode !== "OTHER" || Boolean(diversionDetails.trim())))
  const outcomeMessage = analysis?.outcome === "DIVERTED"
    ? `Volanta recorded a diversion${analysis.diversionAirport ? ` to ${analysis.diversionAirport}` : ""}. What happened?`
    : `Hmm, it looks like you did not arrive at ${me.assignment.destination}. What happened?`
  const onPasteVolantaUrl = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedUrl = event.clipboardData.getData("text").trim()
    if (!isPublicVolantaFlightUrl(pastedUrl)) return
    event.preventDefault()
    setVolantaUrl(pastedUrl)
    void importFlight(pastedUrl)
  }
  return <Page title="Pilot report" icon={<FiFileText />} intro={`${routeCode(me.assignment as unknown as FlightRoute)} · ${me.assignment.origin} to ${me.assignment.destination} · ${me.assignment.registration}`}>
    <section className="volanta-import required">
      <h3>Volanta flight</h3>
      <p>Paste the public Volanta flight link after the record has ended. A valid pasted flight link is verified automatically. airDash verifies the planned route and aircraft, then identifies a completed, diverted, or incomplete outcome. <a href="https://volanta.app/" target="_blank" rel="noreferrer">Open Volanta</a>.</p>
      <div><input value={volantaUrl} onChange={event => { setVolantaUrl(event.target.value); resetImportedFlight() }} onPaste={onPasteVolantaUrl} placeholder="https://fly.volanta.app/flights/.../stats" /><Button onClick={() => importFlight()} disabled={!volantaUrl || importing}>{importing ? "verifying" : "verify flight"}</Button></div>
      {volanta && <small>{String(volanta.origin)} to {String(volanta.destination)} · {String(volanta.distanceNm ?? "—")} NM · {volanta.callsign ? `${volanta.callsign} · ` : ""}landing {String(volanta.landingRate ?? "not recorded")}{volanta.timeCompressionDetected ? ` · TIME COMPRESSION ${Number(volanta.timeCompressionRatio).toFixed(2)}x` : " · real-time verified"}</small>}
    </section>
    {volanta && analysis && <div className="imported-report">
      {nonComplete && <section className={`pirep-outcome-card outcome-${analysis.outcome.toLowerCase()}`}><FiAlertCircle /><div><span>Flight data issue</span><h3>{outcomeMessage}</h3><p>{analysis.outcome === "INCOMPLETE" ? "This flight ended without a verified arrival or on-block event." : "Volanta provided diversion evidence for this ended flight."} When Operations approves the report, the aircraft will move to <strong>{analysis.repositionAirport ?? "the operations position"}</strong>. Your block-time and base XP credit will be reduced by 10%.</p><div className="diversion-report-fields"><label>What happened?<select value={diversionReasonCode} onChange={event => setDiversionReasonCode(event.target.value)} required><option value="">Choose a reason</option>{DIVERSION_REASON_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select>{analysis.suggestedReason && <small>Volanta reported: {analysis.suggestedReason}</small>}</label><label>Additional details <small>{diversionReasonCode === "OTHER" ? "Required for Other" : "Optional"}</small><textarea value={diversionDetails} onChange={event => setDiversionDetails(event.target.value)} rows={4} maxLength={500} placeholder="Give Operations enough context to understand the diversion or incomplete flight" /></label></div><dl><div><dt>Progress</dt><dd>{analysis.progressRatio == null ? "Not available" : `${Math.round(analysis.progressRatio * 100)}% of planned distance`}</dd></div><div><dt>Repositioning</dt><dd>{repositionMethodLabel(analysis.repositionMethod)}</dd></div>{analysis.suggestedReason && <div><dt>Volanta note</dt><dd>{analysis.suggestedReason}</dd></div>}</dl></div></section>}
      <section className="vatsim-toggle-box">
        <div><FiGlobe /><span><strong>VATSIM flight</strong><small>Turn this on if the flight was operated on VATSIM. It is stored as the report network because Volanta does not reliably expose the online network.</small></span></div>
        <label className="switch"><input type="checkbox" checked={vatsimFlown} onChange={event => setVatsimFlown(event.target.checked)} /><span /></label>
      </section>
      <details className="report-details">
        <summary><span>Report details</span><small>Review the verified times, network, and tracking result.</small><FiChevronDown /></summary>
        <div className="report-details-content">
          <div className="form-grid">
            <label>Out time<input type="datetime-local" readOnly value={value("actualOutAt")} /></label><label>Off time<input type="datetime-local" readOnly value={value("actualOffAt")} /></label>
            <label>On time<input type="datetime-local" readOnly value={value("actualOnAt")} /></label><label>{analysis.outcome === "INCOMPLETE" ? "Record end time" : "In time"}<input type="datetime-local" readOnly value={String(volanta.actualInAt ?? volanta.reportEndAt ?? "").slice(0, 16)} /></label>
            <label>Landing rate<input type="text" readOnly value={volanta.landingRate == null ? "Not recorded" : `${volanta.landingRate} fpm`} /></label>
            <label>Tracking result<input type="text" readOnly value={analysis.outcome === "COMPLETED" ? (volanta.timeCompressionDetected ? `Compression ${Number(volanta.timeCompressionRatio).toFixed(2)}x` : "Arrival verified") : `${outcomeLabel(analysis.outcome)} · ${Math.round(analysis.creditMultiplier * 100)}% credit`} /></label>
          </div>
        </div>
      </details>
      <div className="form-submit report-submit"><Button onClick={() => setConfirmOpen(true)} disabled={sending || !reasonValid}><FiSend /> {nonComplete ? "submit diversion report" : "submit pilot report"}</Button></div>
    </div>}
    {volanta && analysis && confirmOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !sending) setConfirmOpen(false) }}>
      <section className="confirm-dialog report-confirm" role="alertdialog" aria-modal="true" aria-labelledby="report-confirm-title">
        <FiFileText /><h2 id="report-confirm-title">Confirm your pilot report</h2>
        <p>Review the details below. You can go back to edit anything before submitting.</p>
        <dl className="report-confirm-details">
          <div><dt>Flight</dt><dd>{me.assignment.origin} to {me.assignment.destination} · {me.assignment.registration}</dd></div>
          <div><dt>Outcome</dt><dd>{outcomeLabel(analysis.outcome)}</dd></div>
          <div><dt>Network</dt><dd>{vatsimFlown ? "VATSIM" : "Offline"}</dd></div>
          <div><dt>Landing rate</dt><dd>{volanta.landingRate == null ? "Not recorded" : `${volanta.landingRate} fpm`}</dd></div>
          {nonComplete && <div><dt>Reason</dt><dd>{DIVERSION_REASON_OPTIONS.find(([code]) => code === diversionReasonCode)?.[1] ?? "—"}</dd></div>}
          {nonComplete && diversionDetails.trim() && <div><dt>Details</dt><dd>{diversionDetails}</dd></div>}
        </dl>
        <label className="report-confirm-remarks">Remarks<textarea value={remarks} onChange={event => setRemarks(event.target.value)} rows={4} maxLength={1500} placeholder="Delays, diversions, or anything staff should review" /></label>
        <div><Button kind="secondary" onClick={() => setConfirmOpen(false)} disabled={sending}>back and edit</Button><Button onClick={submit} disabled={sending || !reasonValid}><FiSend /> {sending ? "submitting" : "confirm and submit"}</Button></div>
      </section>
    </div>}
    <PirepHistory />
    <AssignmentHistory />
  </Page>
}

function Fleet() {
  const { publicData, me, notify, refresh } = useApp()
  const [view, setView] = useState<"liveries" | "aircraft">("aircraft")
  const [liverySimulator, setLiverySimulator] = useState<"2024" | "2020">(() => me?.application?.simulator?.includes("2020") ? "2020" : "2024")
  const [openBases, setOpenBases] = useState<Record<string, boolean>>({})
  const aircraft = publicData?.aircraft ?? []
  const liveryCount = (item: Aircraft) => liverySimulator === "2020" ? item.livery_msfs2020_download_count ?? 0 : item.livery_download_count ?? 0
  const liveryUrl = (item: Aircraft) => liverySimulator === "2020" ? item.livery_msfs2020_url : item.livery_url
  const totalDownloads = aircraft.reduce((total, item) => total + liveryCount(item), 0)
  const bases = ["KATL", "KDEN", "MDSD", "MDPC", "MDST", ...Array.from(new Set(aircraft.map(a => a.current_airport)))].filter((c, i, arr) => arr.indexOf(c) === i).filter(code => aircraft.some(a => a.current_airport === code))
  const toggle = (code: string) => setOpenBases(s => ({ ...s, [code]: !s[code] }))
  const downloadLivery = async (item: Aircraft) => {
    try {
      const result = await post<{ url: string; downloadCount: number }>(`/liveries/${item.registration}/${liverySimulator}/download`, {})
      if (result.url) window.open(result.url, "_blank", "noopener")
      notify(`Downloading ${item.registration}${item.livery_name ? ` (${item.livery_name})` : ""} livery for MSFS ${liverySimulator}`)
      await refresh()
    } catch (error) { notify(error instanceof Error ? error.message : "Livery download failed", "error") }
  }
  const downloadControl = (item: Aircraft) => {
    if (!liveryUrl(item)) return <div className="download unavailable"><FiPackage /> Package in preparation</div>
    const count = liveryCount(item)
    const contents = <><FiDownload /><strong>Download MSFS {liverySimulator} ZIP</strong><span>{count} recorded download{count === 1 ? "" : "s"}</span></>
    return me
      ? <button type="button" className="download" onClick={() => downloadLivery(item)}>{contents}</button>
      : <a className="download" href={`/api/liveries/${encodeURIComponent(item.registration)}/${liverySimulator}/download`}>{contents}</a>
  }
  return <Page title="Fleet and liveries" icon={<TbPlane />} intro="Download the current airDash liveries for MSFS 2020 or MSFS 2024, and review fleet location, cycles, and block-time statistics.">
    <div className="admin-tabs"><button className={view === "aircraft" ? "active" : ""} onClick={() => setView("aircraft")}><TbPlane />aircraft list</button><button className={view === "liveries" ? "active" : ""} onClick={() => setView("liveries")}><FiDownload />liveries</button></div>
    {view === "liveries" && <>
      <section className="livery-version-bar"><div><span className="eyebrow"><FiDownload /> simulator package</span><h2>Choose your MSFS version</h2><p>Each ZIP is built for the selected simulator. Install only the matching version in that simulator's Community folder.</p></div><div className="livery-version-switch" role="group" aria-label="Livery simulator version"><button className={liverySimulator === "2024" ? "active" : ""} onClick={() => setLiverySimulator("2024")}>MSFS 2024</button><button className={liverySimulator === "2020" ? "active" : ""} onClick={() => setLiverySimulator("2020")}>MSFS 2020</button></div></section>
      <section className="livery-download-total"><FiDownload /><div><strong>{totalDownloads}</strong><span>recorded MSFS {liverySimulator} livery download{totalDownloads === 1 ? "" : "s"}</span></div></section>
      <div className="fleet-cards">{aircraft.map(item => <article key={item.registration}><img className="fleet-thumbnail" src={`/downloads/liveries/${item.registration.toLowerCase()}/thumbnail.png?v=5`} alt={`${item.registration} airDash livery thumbnail`} /><div className="fleet-card-footer"><div className="fleet-summary"><Status value={item.status} /><span>{item.current_airport}</span><span>{item.total_cycles} cycles</span><span>{formatMinutes(item.total_block_minutes)} block</span><span>MSFS {liverySimulator}</span></div>{outOfServiceNote(item) && item.status !== "ASSIGNED" && <small className="oos-reason">{outOfServiceNote(item)}</small>}{downloadControl(item)}</div></article>)}</div>
    </>}
    {view === "aircraft" && <div className="fleet-by-base">{bases.map(code => { const list = aircraft.filter(a => a.current_airport === code); const isOpen = openBases[code] ?? false; return <div key={code} className="fleet-base-group"><button className="fleet-base-heading" onClick={() => toggle(code)}><FiMapPin /> {code} <span>{list.length} aircraft</span><FiChevronDown className={isOpen ? "pirep-caret open" : "pirep-caret"} /></button>{isOpen && <div className="admin-list">{list.map(item => <article key={item.registration}><TbPlane className="list-icon" /><div><h3>{item.registration}{item.special_livery && <em className="special-livery-tag" title="Special livery">{item.livery_name}</em>}</h3><p>Airbus A220-300 · {item.total_cycles} cycles · {formatMinutes(item.total_block_minutes)} block · {item.livery_download_count ?? 0} MSFS 2024 downloads · {item.livery_msfs2020_download_count ?? 0} MSFS 2020 downloads</p>{outOfServiceNote(item) && item.status !== "ASSIGNED" && <small className="oos-reason">{outOfServiceNote(item)}</small>}</div><Status value={item.status} /></article>)}</div>}</div> })}</div>}
  </Page>
}

function Profile() {
  const { notify, refresh, openBrief, publicData, me } = useApp(); const [profile, setProfile] = useState<any>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { api<any>("/profile").then(value => setProfile(value.profile)).catch(() => {}) }, [])
  useEffect(() => { if (profile && window.location.hash === "#dispatch-integrations") { const el = document.getElementById("dispatch-integrations"); if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); const input = el.querySelector<HTMLInputElement>('input[name="simbriefUsername"]'); input?.focus() } } }, [profile])
  if (!profile) return <Page title="Pilot profile" icon={<FiUser />}><Spinner label="Loading profile" /></Page>
  const uploadImage = (file: File | undefined) => {
    if (!file) return
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return notify("Use a PNG, JPEG, or WebP image", "error")
    if (file.size > 1_500_000) return notify("Profile images are limited to 1.5 MB", "error")
    setUploading(true)
    const reader = new FileReader()
    reader.onerror = () => { setUploading(false); notify("The image could not be read", "error") }
    reader.onload = async () => {
      try { const value = await post<any>("/profile/image", { imageData: reader.result }); setProfile({ ...profile, ...value.profile }); notify("Profile picture updated"); await refresh() }
      catch (error) { notify(error instanceof Error ? error.message : "Image upload failed", "error") }
      finally { setUploading(false) }
    }
    reader.readAsDataURL(file)
  }
  const save = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { const value = await post<any>("/profile", Object.fromEntries(form)); setProfile({ ...profile, ...value.profile }); notify("Pilot profile saved"); await refresh() } catch (error) { notify(error instanceof Error ? error.message : "Profile update failed", "error") } }
  return <Page title="Pilot profile" icon={<FiUser />} intro={`Discord username @${profile.username} is your account identity.`}>
    <section className={dragging ? "image-drop dragging" : "image-drop"} role="button" tabIndex={0} aria-label="Upload a profile picture" onClick={() => fileInputRef.current?.click()} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click() }} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); uploadImage(event.dataTransfer.files?.[0]) }}>
      <img src={profile.profile_image_url || profile.avatar_url} alt="Current profile picture" />
      <div><h3>{uploading ? "Uploading picture..." : "Profile picture"}</h3><p>Drag and drop an image here, or click to choose a file. PNG, JPEG, or WebP up to 1.5 MB.</p></div>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { uploadImage(event.target.files?.[0]); event.target.value = "" }} />
    </section>
    <section className="profile-streaks"><header><span className="eyebrow"><TbFlame /> streaks</span><h2>Flight momentum</h2><p>Flight days use UTC dates. Route continuity continues when the next origin matches the previous destination.</p></header><StreakCards streaks={me?.streaks} /></section>
    <form id="dispatch-integrations" className="form-grid" onSubmit={save}><label>Pilot nickname<input name="displayName" defaultValue={profile.display_name} required /></label><label>Pronouns<input name="pronouns" defaultValue={profile.pronouns} /></label><label>SimBrief username<input name="simbriefUsername" defaultValue={profile.simbrief_username ?? ""} placeholder="your simbrief.com username" autoComplete="off" /><small className="field-hint">airDash uses this to pull your latest OFP automatically for dispatch. It is your simBrief.com / Navigraph username, not your VATSIM CID.</small></label><label className="full">About me<textarea name="aboutMe" defaultValue={profile.about_me} rows={5} /></label><label>Request home base<select name="homeBaseRequest" defaultValue={profile.home_base_request ?? ""}><option value="">Keep {profile.base_code}</option>{(publicData?.bases ?? []).filter(b => b.code !== profile.base_code).map(b => <option key={b.code} value={b.code}>{b.name}, {b.code}</option>)}</select></label><label>Request reason<input name="homeBaseRequestReason" defaultValue={profile.home_base_request_reason ?? ""} /></label><div className="full form-submit"><Button type="submit">save profile</Button></div></form>
    <section className="brief-launch download-reset-card"><div><h3>Downloaded liveries</h3><p>{(me?.downloadedLiveryVersions ?? []).length} livery package version{(me?.downloadedLiveryVersions ?? []).length === 1 ? "" : "s"} recorded for your account. Resetting clears only your checkmarks so the download buttons reappear in the flight board; it does not change the fleet download totals.</p></div><Button kind="secondary" onClick={async () => { try { await post("/profile/liveries/reset", {}); notify("Livery downloads reset"); await refresh() } catch (error) { notify(error instanceof Error ? error.message : "Reset failed", "error") } }} disabled={(me?.downloadedLiveryVersions ?? []).length === 0}><FiDownload /> Reset downloads</Button></section>
    <section className="brief-launch"><div><h3>New pilot brief</h3><p>Review current dispatch, recovery ferries, report verification, experience, and notification workflows.</p></div><Button kind="secondary" onClick={openBrief}><FiFileText /> View the brief</Button></section>
    <BrowserNotificationSetting />
  </Page>
}

function BrowserNotificationSetting() {
  const { notify } = useApp()
  const [support, setSupport] = useState<WebPushSupport>(() => webPushSupport())
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(true)
  const refreshState = async () => { const state = await webPushState(); setSupport(state.support); setEnabled(state.subscribed); return state }
  useEffect(() => { void refreshState().finally(() => setBusy(false)) }, [])
  const toggle = async (next: boolean) => {
    setBusy(true)
    try {
      const state = next ? await subscribeWebPush() : await unsubscribeWebPush()
      setSupport(state.support); setEnabled(state.subscribed)
      if (state.subscribed) {
        notify("Background notifications enabled")
        try { await testWebPush() } catch (error) { notify(error instanceof Error ? error.message : "Test notification could not be delivered", "error") }
      } else if (!next) notify("Background notifications turned off on this device")
      else if (state.support === "denied") notify("Your browser blocked notifications. Enable them in site settings, then try again.", "error")
    } catch (error) {
      notify(error instanceof Error ? error.message : "Background notifications could not be configured", "error")
      await refreshState()
    } finally { setBusy(false) }
  }
  const description = support === "unsupported"
    ? "This browser does not support service-worker push notifications."
    : support === "denied"
      ? "Notifications are blocked for this site. Enable them in the browser's site settings, then reload."
      : "Receive operations alerts even when airDash is closed. Permission and subscription are stored separately on each device."
  return <section className="brief-launch browser-notify-card">
    <div><h3>Background browser notifications</h3><p>{description}</p>{enabled && <button type="button" className="browser-push-test" onClick={() => { void testWebPush().then(() => notify("Test notification sent")).catch(error => notify(error instanceof Error ? error.message : "Test notification failed", "error")) }}>Send a test notification</button>}</div>
    <label className={`switch${support === "unsupported" || support === "denied" ? " switch-disabled" : ""}`}>
      <input type="checkbox" checked={enabled} disabled={busy || support === "unsupported" || support === "denied"} onChange={event => { void toggle(event.target.checked) }} />
      <span />
    </label>
  </section>
}

function Pilots() {
  const { publicData } = useApp()
  const topId = publicData?.topPilot?.discord_id
  const [pilots, setPilots] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [detail, setDetail] = useState<any>(null)
  useEffect(() => { api<any>("/pilots").then(value => setPilots(value.pilots)).catch(() => {}) }, [])
  const open = (pilot: any) => { setSelected(pilot); setDetail(null); api<any>(`/pilots/${pilot.discord_id}`).then(setDetail).catch(() => {}) }
  return <Page title="Pilots" icon={<FiUsers />} intro="Meet the approved pilots currently flying with airDash. Select a pilot to see their flights.">
    <div className="pilot-directory">{pilots.map(pilot => <article key={pilot.discord_id} className="pilot-card" role="button" tabIndex={0} onClick={() => open(pilot)} onKeyDown={e => { if (e.key === "Enter") open(pilot) }}><img src={pilot.profile_image_url || pilot.avatar_url} alt="" /><div><h2>{pilot.display_name}{pilot.discord_id === topId && <TbCrown className="pilot-crown" title="Most hours flown" />}</h2><p>{pilot.rank_name || "Captain"} · {pilot.pilot_number} · {pilot.base_code}{pilot.pronouns ? ` · ${pilot.pronouns}` : ""}</p>{pilot.leadership_title && <span className="pilot-leadership"><TbCrown /> {pilot.leadership_title}</span>}<div className="pilot-card-stats"><small>{pilot.total_flights} flights · {formatMinutes(pilot.total_block_minutes)}</small><small style={{ color: landingColor(pilot.average_landing_rate) }}>avg landing {pilot.average_landing_rate == null ? "—" : `${pilot.average_landing_rate} fpm`}</small></div><LevelBar experience={xpOf(pilot)} /><StreakCards streaks={pilot.streaks} compact /><div className="pilot-flight-slot">{pilot.active_flight_number && <p className="pilot-active-flight"><FiSend /> Flying AIR{String(pilot.active_flight_number).padStart(3, "0")} · {pilot.active_origin} to {pilot.active_destination} · {pilot.active_registration}</p>}</div></div></article>)}</div>
    {selected && <div className="dialog-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null) }}>
      <section className="pilot-modal" role="dialog" aria-modal="true">
        <button className="pilot-modal-close" onClick={() => setSelected(null)} aria-label="Close"><FiX /></button>
        <header><img src={selected.profile_image_url || selected.avatar_url} alt="" /><div><h2>{selected.display_name}{selected.discord_id === topId && <TbCrown className="pilot-crown" title="Most hours flown" />}</h2><p>{selected.rank_name || "Captain"} · {selected.pilot_number} · based {selected.base_code}{selected.pronouns ? ` · ${selected.pronouns}` : ""}</p>{selected.leadership_title && <span className="pilot-leadership"><TbCrown /> {selected.leadership_title}</span>}</div></header>
        <LevelBar experience={xpOf(selected)} />
        <div className="pilot-modal-stats"><div><strong>{selected.total_flights}</strong><small>flights</small></div><div><strong>{formatMinutes(selected.total_block_minutes)}</strong><small>block time</small></div><div><strong>{xpOf(selected)}</strong><small>experience</small></div><div><strong>{detail?.pilot?.missions_completed ?? 0}</strong><small>missions</small></div><div><strong style={{ color: landingColor(selected.average_landing_rate) }}>{selected.average_landing_rate == null ? "—" : `${selected.average_landing_rate} fpm`}</strong><small>avg landing</small></div></div>
        <StreakCards streaks={detail?.pilot?.streaks ?? selected.streaks} />
        {selected.about_me && <p className="pilot-modal-about">{selected.about_me}</p>}
        <h3>Recent flights</h3>
        {!detail ? <Spinner label="Loading flights" /> : detail.flights.length === 0 ? <p className="notif-empty">No approved flights yet.</p> : <div className="pilot-flights">{detail.flights.map((f: any, i: number) => <div key={i}><b>AIR{String(f.flight_number).padStart(3, "0")}</b><span>{f.origin} <FiArrowRight className="inline-arrow" /> {f.destination}</span><small>{f.registration} · {f.reviewed_at ? new Date(f.reviewed_at).toLocaleDateString() : ""}</small></div>)}</div>}
      </section>
    </div>}
  </Page>
}

function Missions() {
  const { me, refresh, notify } = useApp()
  const [data, setData] = useState<any>(null)
  const [pending, setPending] = useState<any>(null)
  const volantaConsent = true
  const [booking, setBooking] = useState(false)
  const [volantaOpened, setVolantaOpened] = useState(false)
  const [sort, setSort] = useState("expiry")
  const [query, setQuery] = useState("")
  const [now, setNow] = useState(Date.now())
  const load = () => api<any>("/missions").then(setData).catch(() => {})
  useEffect(() => { if (me?.pilot) load() }, [me?.pilot])
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t) }, [])
  if (!me?.pilot) return <Page title="Missions" icon={<FiStar />}><Empty icon={<FiShield />} title="A pilot record is required" body="Missions become available after staff approve your pilot application."><Link className="button button-primary" to="/join">View pilot application</Link></Empty></Page>
  if (!data) return <Page title="Missions" icon={<FiStar />}><Spinner label="Building your next mission" /></Page>
  const today = new Date().toISOString().slice(0, 10)
  const flown = new Set<string>(data.flownDestinations ?? [])
  const missions = (data.suggestions ?? []).map((r: any) => {
    const isRecovery = r.mission_type === "RECOVERY"
    return { ...r, isRecovery, expiresAt: isRecovery ? Number.POSITIVE_INFINITY : missionExpiry(r.id), multiplier: isRecovery ? 1 : missionMultiplier(r.block_minutes), isNew: !flown.has(r.destination) }
  }).filter((m: any) => m.isRecovery || m.expiresAt > now).filter((m: any) => { const q = query.trim().toUpperCase(); return !q || `AIR${String(m.flight_number).padStart(3, "0")}`.includes(q) || m.destination.includes(q) || m.origin.includes(q) || (m.isRecovery && "RECOVERY FERRY".includes(q)) })
  const sorted = [...missions].sort((a, b) => {
    if (a.isRecovery !== b.isRecovery) return a.isRecovery ? -1 : 1
    if (sort === "expiry") return a.expiresAt - b.expiresAt
    if (sort === "shortest") return a.block_minutes - b.block_minutes
    if (sort === "longest") return b.block_minutes - a.block_minutes
    if (sort === "multiplier") return b.multiplier - a.multiplier
    if (sort === "new") return Number(b.isNew) - Number(a.isNew) || a.block_minutes - b.block_minutes
    if (sort === "destination") return a.destination.localeCompare(b.destination)
    return 0
  })
  const openVolantaForMission = () => {
    launchVolantaDesktop()
    setVolantaOpened(true)
  }
  const closeMissionDialog = () => { if (!booking) { setPending(null); setVolantaOpened(false) } }
  const confirmMission = async () => {
    if (!pending || !data.aircraft || !volantaOpened) return
    setBooking(true)
    try {
      const value = pending.isRecovery
        ? await post<{ assignment: Assignment }>("/missions/recovery", { sourceAssignmentId: pending.sourceAssignmentId, flightDate: today })
        : await post<{ assignment: Assignment }>("/assignments", { routeId: pending.id, registration: data.aircraft.registration, flightDate: today, volantaTrackingConsent: volantaConsent, source: "MISSION" })
      const bookedFlightNumber = value.assignment?.flight_number ?? pending.flight_number
      notify(`${pending.isRecovery ? "Recovery ferry " : ""}AIR${String(bookedFlightNumber).padStart(3, "0")} booked with ${data.aircraft.registration}`, "ok", { label: "Go to hangar", to: "/portal" })
      setPending(null)
      setVolantaOpened(false)
      await Promise.all([refresh(), load()])
    } catch (error) { notify(error instanceof Error ? error.message : "Booking failed", "error") }
    finally { setBooking(false) }
  }
  const countdown = (expiresAt: number) => { const s = Math.max(0, Math.round((expiresAt - now) / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60; return h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s` }
  return <Page title="Missions" icon={<FiStar />} intro="Continue from your last aircraft, or pick up an available airframe where it is parked. Standard missions award scaled bonus experience and expire. Operations recovery ferries remain available until the diverted aircraft reaches its planned destination and award normal experience." >
    <div className="mission-summary">
      <article><span>last flight</span>{data.lastFlight ? <><h3>AIR{String(data.lastFlight.flight_number).padStart(3, "0")}</h3><p>{data.lastFlight.origin} to {data.lastFlight.destination} · {data.lastFlight.registration}</p><small>{data.lastFlight.planned_destination && data.lastFlight.planned_destination !== data.lastFlight.destination ? `Aircraft recovery required from ${data.lastFlight.destination} to planned destination ${data.lastFlight.planned_destination}.` : `You ended the day at ${data.lastFlight.destination}`}</small></> : <><h3>No flights yet</h3><p>Your first completed flight starts your mission history.</p></>}</article>
      <article><span>mission aircraft</span>{data.aircraft ? <><h3>{data.aircraft.registration}</h3><p>Parked at {data.aircraft.current_airport}</p>{data.fallback && <small>Your last aircraft is in use, so this available airframe is suggested instead.</small>}</> : <><h3>No aircraft available</h3><p>Every airframe is currently assigned. Check back soon.</p></>}</article>
    </div>
    {me.assignment && <div className="flight-toolbar"><span><FiAlertCircle /> Finish or cancel the current assignment before starting a mission.</span></div>}
    {sorted.length > 0 && <div className="board-toolbar"><div className="search"><FiStar /><input placeholder="Search mission or destination" value={query} onChange={e => setQuery(e.target.value)} /></div><label>Sort<select value={sort} onChange={e => setSort(e.target.value)}><option value="expiry">Expiring soonest</option><option value="new">New destinations</option><option value="shortest">Shortest first</option><option value="longest">Longest first</option><option value="multiplier">Highest bonus</option><option value="destination">Destination</option></select></label></div>}
    <div className="mission-list">{sorted.map((m: any) => { const total = 7200000; const pct = m.isRecovery ? 1 : Math.max(0, Math.min(1, (m.expiresAt - now) / total)); const soon = !m.isRecovery && m.expiresAt - now < 20 * 60000; return <article key={m.id} className={`mission-card${m.isRecovery ? " mission-recovery-card" : ""}`}>
      <div className="mission-card-head"><div><strong>AIR{String(m.flight_number).padStart(3, "0")}</strong> <span className="mission-route">{m.origin} <FiArrowRight className="inline-arrow" /> {m.destination}</span></div><div className="mission-badges">{m.isRecovery ? <><em className="mission-recovery">RECOVERY FERRY</em><em className="mission-mult">1.00x NORMAL</em></> : <>{m.isNew && <em className="mission-new">NEW</em>}<em className="mission-mult">{m.multiplier.toFixed(2)}x</em></>}</div></div>
      <div className="mission-meta"><span>{formatMinutes(m.block_minutes)}{m.isRecovery ? " · 0 passengers · 0 cargo" : ""}</span><span className={soon ? "mission-expiry soon" : "mission-expiry"}>{m.isRecovery ? <><FiAlertCircle /> Operations recovery · no expiry</> : <><FiClock /> {countdown(m.expiresAt)} left</>}</span></div>
      {!m.isRecovery && <div className="mission-track"><div className={soon ? "mission-fill soon" : "mission-fill"} style={{ width: `${pct * 100}%` }} /></div>}
      <Button onClick={() => { setPending(m); setVolantaOpened(false) }} disabled={me.assignment != null || !data.aircraft}><TbPlane /> {m.isRecovery ? "recover aircraft" : "fly this mission"}</Button>
    </article> })}</div>
    {sorted.length === 0 && data.aircraft && <Empty icon={<FiMap />} title={`No missions from ${data.aircraft.current_airport}`} body="No open recommendation currently departs this airport. New ones appear over time." />}
    {pending && data.aircraft && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeMissionDialog() }}>
      <section className="confirm-dialog booking-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mission-title">
        {volantaOpened ? <FiCheckCircle /> : <FiActivity />}<h2 id="mission-title">{volantaOpened ? "Confirm this mission?" : "Open Volanta first"}</h2>
        <p>AIR{String(pending.flight_number).padStart(3, "0")} · {pending.origin} to {pending.destination} today with {data.aircraft.registration}. {pending.isRecovery ? "This is an Operations recovery ferry with 0 passengers and 0 cargo. Flight crew are part of the aircraft operating weight, not passenger payload. It awards normal minute-for-minute experience with no mission multiplier." : `This mission awards about ${missionMultiplier(pending.block_minutes).toFixed(2)}x experience.`} Bookings are forfeited two and a half hours after the scheduled arrival if no pilot report is submitted, and you are notified.</p>
        <div className="volanta-consent required"><FiActivity /><span><strong>{volantaOpened ? "Step 2 of 2 · Confirm the mission." : "Step 1 of 2 · Open the Volanta desktop app."}</strong> {volantaOpened ? "The mission is not booked yet. Confirm only after Volanta is open and ready to track." : "This launches the installed desktop client through the volanta:// protocol without booking the mission."} <a href="https://volanta.app/" target="_blank" rel="noreferrer">Install Volanta</a>.</span></div>
        <div><Button kind="secondary" onClick={closeMissionDialog} disabled={booking}>Keep browsing</Button><Button onClick={volantaOpened ? confirmMission : openVolantaForMission} disabled={booking}>{volantaOpened ? (booking ? "Booking..." : "Confirm mission") : <><FiActivity /> Open Volanta</>}</Button></div>
      </section>
    </div>}
  </Page>
}

const HEALTH_LABEL: Record<string, string> = { UNDER_SERVED: "Under-served", HEALTHY: "Healthy", OVER_SERVED: "Over-served", DORMANT: "Dormant", NO_AIRCRAFT: "No aircraft" }
function Health() {
  const [data, setData] = useState<any>(null)
  useEffect(() => { api<any>("/hub-health").then(setData).catch(() => {}) }, [])
  if (!data) return <Page title="Network health" icon={<FiActivity />}><Spinner label="Analyzing the network" /></Page>
  return <Page title="Network health" icon={<FiActivity />} intro="Base health reacts to flights completed over the last 30 days, compared with the 30 before it. Demand is how many completed flights touched a base; the forecast projects the next 30 days from that trend.">
    <div className="metric-row"><Metric icon={<FiFileText />} value={String(data.totals.completed30)} label="flights last 30 days" /><Metric icon={<FiClock />} value={String(data.totals.completed60)} label="flights last 60 days" /><Metric icon={<FiMapPin />} value={String(data.bases.length)} label="active hubs" /></div>
    <div className="health-grid">{data.bases.map((b: any) => <article key={b.code} className={`health-card health-${b.status.toLowerCase()}`}>
      <div className="health-card-head"><h3>{b.code} <span>{b.name}</span></h3><span className="health-score">{b.score}</span></div>
      <div className="health-track"><div className="health-fill" style={{ width: `${b.score}%` }} /></div>
      <p className="health-status-line">{HEALTH_LABEL[b.status] ?? b.status}<span>{b.recommendation}</span></p>
      <div className="health-stats"><div><strong>{b.demand}</strong><small>flights 30d</small></div><div><strong>{b.forecast}</strong><small>forecast 30d</small></div><div><strong>{b.capacity}</strong><small>aircraft</small></div><div><strong>{b.perAircraft}</strong><small>per aircraft</small></div><div><strong>{b.growthPct > 0 ? `+${b.growthPct}` : b.growthPct}%</strong><small>trend</small></div></div>
    </article>)}</div>
    <section className="health-candidates"><h2>Candidate airports</h2><p>Non-hub airports ranked by completed-flight demand. A consistently busy airport with rising demand is a signal it could support a new base.</p>
      {data.candidates.length === 0 ? <p className="notif-empty">Not enough completed flights yet to surface candidates.</p> : <div className="candidate-list">{data.candidates.map((c: any) => <div key={c.code} className="candidate"><div className="candidate-top"><strong>{c.code}</strong><em className={c.growthPct >= 0 ? "up" : "down"}>{c.growthPct >= 0 ? `+${c.growthPct}` : c.growthPct}%</em></div><span>{c.recent} flight{c.recent === 1 ? "" : "s"} · last 30d</span></div>)}</div>}
    </section>
  </Page>
}

function Admin() {
  const { me, notify, refresh, refreshNotifications } = useApp()
  const [data, setData] = useState<AdminOverview | null>(null)
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get("tab") || "applications")
  const [statusDialog, setStatusDialog] = useState<{ registration: string; status: string } | null>(null)
  const [statusReason, setStatusReason] = useState("")
  const [savingStatus, setSavingStatus] = useState(false)
  const [openPirep, setOpenPirep] = useState<string | null>(null)
  const [acQuery, setAcQuery] = useState("")
  const [acFilter, setAcFilter] = useState("all")
  const [acSort, setAcSort] = useState("fleet")
  const [auditQuery, setAuditQuery] = useState("")
  const [auditAction, setAuditAction] = useState("all")
  const [auditEntity, setAuditEntity] = useState("all")
  const [auditSort, setAuditSort] = useState("newest")
  const [reviewDialog, setReviewDialog] = useState<{ id: unknown; decision: string } | null>(null)
  const [reviewNotes, setReviewNotes] = useState("")
  const [baseForm, setBaseForm] = useState<any>(null)
  const [pilotFlights, setPilotFlights] = useState<{ pilot: any; flights: any[] | null } | null>(null)
  const [confirmDeleteFlight, setConfirmDeleteFlight] = useState<{ id: unknown; label: string } | null>(null)
  const [orgKind, setOrgKind] = useState("GENERAL")
  const [orgTitle, setOrgTitle] = useState("")
  const [orgBody, setOrgBody] = useState("")
  const [orgPublic, setOrgPublic] = useState(false)
  const [orgSummary, setOrgSummary] = useState("")
  const [orgHeroImage, setOrgHeroImage] = useState("")
  const [orgAuthor, setOrgAuthor] = useState("Staff Writer")
  const [creatingUpdate, setCreatingUpdate] = useState(false)
  const openPilotFlights = (pilot: any) => { setPilotFlights({ pilot, flights: null }); api<any>(`/admin/pilots/${pilot.discord_id}/flights`).then(v => setPilotFlights({ pilot, flights: v.flights })).catch(() => setPilotFlights({ pilot, flights: [] })) }
  const deleteFlight = async (assignmentId: unknown, pilot: any) => { try { await remove(`/admin/assignments/${assignmentId}`); notify("Flight deleted"); const v = await api<any>(`/admin/pilots/${pilot.discord_id}/flights`); setPilotFlights({ pilot, flights: v.flights }); await Promise.all([load(), refresh()]) } catch (error) { notify(error instanceof Error ? error.message : "Delete failed", "error") } }
  const [auditSeen, setAuditSeen] = useState<number>(() => Number(localStorage.getItem("airdash-audit-seen") || 0))
  const newAuditCount = data ? (data.audit as any[]).filter(e => new Date(e.created_at as string).getTime() > auditSeen).length : 0
  const auditActions = data ? Array.from(new Set(data.audit.map(item => String(item.action)))).sort() : []
  const auditEntities = data ? Array.from(new Set(data.audit.map(item => String(item.entity_type)))).sort() : []
  const visibleAudit = data ? data.audit.filter(item => {
    const query = auditQuery.trim().toLowerCase()
    const action = String(item.action)
    const entity = String(item.entity_type)
    const haystack = [action, entity, item.entity_id, item.actor_name, item.actor_discord_id, JSON.stringify(item.details ?? {})].join(" ").toLowerCase()
    return (!query || haystack.includes(query)) && (auditAction === "all" || action === auditAction) && (auditEntity === "all" || entity === auditEntity)
  }).sort((left, right) => {
    if (auditSort === "oldest") return new Date(String(left.created_at)).getTime() - new Date(String(right.created_at)).getTime()
    if (auditSort === "action") return String(left.action).localeCompare(String(right.action)) || new Date(String(right.created_at)).getTime() - new Date(String(left.created_at)).getTime()
    if (auditSort === "actor") return String(left.actor_name ?? left.actor_discord_id ?? "system").localeCompare(String(right.actor_name ?? right.actor_discord_id ?? "system"))
    return new Date(String(right.created_at)).getTime() - new Date(String(left.created_at)).getTime()
  }) : []
  useEffect(() => { if (tab === "audit" && data) { const latest = Math.max(auditSeen, Date.now()); localStorage.setItem("airdash-audit-seen", String(latest)); setAuditSeen(latest) } }, [tab, data])
  const load = () => api<AdminOverview>("/admin/overview").then(setData).catch(error => notify(error.message, "error"))
  useEffect(() => { if (me?.isOwner) load() }, [me?.isOwner])
  if (!me?.isOwner) return <Page title="Administration" icon={<FiShield />}><Empty icon={<FiShield />} title="Owner access required" body="This area manages applications, pilot reports, fleet state, and audit records." /></Page>
  const decide = async (kind: "applications" | "pireps", id: unknown, decision: string, notes = "") => { try { await post(`/admin/${kind}/${id}/${decision}`, { notes }); notify(`${decision} recorded`); await Promise.all([load(), refresh()]); refreshNotifications() } catch (error) { notify(error instanceof Error ? error.message : "Decision failed", "error") } }
  const setAircraftStatus = async (registration: string, status: string, reason: string) => {
    setSavingStatus(true)
    try { await post(`/admin/aircraft/${registration}/status`, { status, reason }); notify(`${registration} set to ${status}`); setStatusDialog(null); setStatusReason(""); await Promise.all([load(), refresh()]); refreshNotifications() }
    catch (error) { notify(error instanceof Error ? error.message : "Status change failed", "error") }
    finally { setSavingStatus(false) }
  }
  const saveBase = async (base: any) => { try { await post("/admin/bases", base); notify(`Base ${base.code} saved`); setBaseForm(null); await Promise.all([load(), refresh()]) } catch (error) { notify(error instanceof Error ? error.message : "Base save failed", "error") } }
  const deleteBase = async (code: string) => { try { await remove(`/admin/bases/${code}`); notify(`Base ${code} removed`); await Promise.all([load(), refresh()]) } catch (error) { notify(error instanceof Error ? error.message : "Base removal failed", "error") } }
  const managePilot = async (id: string, body: { baseCode?: string; status?: string }) => { try { await post(`/admin/pilots/${id}/manage`, body); notify("Pilot updated"); await Promise.all([load(), refresh()]); refreshNotifications() } catch (error) { notify(error instanceof Error ? error.message : "Pilot update failed", "error") } }
  const decideBaseRequest = async (id: string, decision: string) => { try { await post(`/admin/pilots/${id}/base`, { decision }); notify(`Base request ${decision}d`); await Promise.all([load(), refresh()]); refreshNotifications() } catch (error) { notify(error instanceof Error ? error.message : "Base request failed", "error") } }
  const createOrgUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreatingUpdate(true)
    try {
      await post("/admin/org-updates", { kind: orgKind, title: orgTitle, body: orgBody, isPublic: orgPublic,
        summary: orgSummary, heroImageUrl: orgHeroImage, authorName: orgAuthor })
      setOrgKind("GENERAL"); setOrgTitle(""); setOrgBody(""); setOrgPublic(false); setOrgSummary(""); setOrgHeroImage(""); setOrgAuthor("Staff Writer")
      notify(orgPublic ? "Press release published to the News Hub" : "Organization update published")
      await load()
    } catch (error) { notify(error instanceof Error ? error.message : "Update publication failed", "error") }
    finally { setCreatingUpdate(false) }
  }
  return <Page title="Operations administration" icon={<FiShield />} intro="Review people, flights, equipment, and the record of every material decision.">
    <div className="admin-tabs">{[["applications", FiUsers], ["updates", FiBell], ["pireps", FiFileText], ["pilots", FiUser], ["bases", FiMapPin], ["visitors", FiUserCheck], ["assignments", FiMap], ["aircraft", TbPlane], ["audit", FiActivity], ["settings", FiSettings]].map(([name, Icon]) => <button key={String(name)} className={tab === name ? "active" : ""} onClick={() => setTab(String(name))}><Icon />{String(name)}{name === "pireps" && data && data.pireps.filter(p => p.review_status === "SUBMITTED").length > 0 && <span className="tab-badge">{data.pireps.filter(p => p.review_status === "SUBMITTED").length}</span>}{name === "applications" && data && data.applications.filter(a => ["SUBMITTED", "UNDER_REVIEW"].includes(a.status)).length > 0 && <span className="tab-badge">{data.applications.filter(a => ["SUBMITTED", "UNDER_REVIEW"].includes(a.status)).length}</span>}{name === "pilots" && data && data.pilots.filter(p => (p as any).home_base_request).length > 0 && <span className="tab-badge">{data.pilots.filter(p => (p as any).home_base_request).length}</span>}{name === "audit" && newAuditCount > 0 && tab !== "audit" && <span className="tab-badge">{newAuditCount}</span>}</button>)}</div>
    {!data ? <Spinner label="Loading administration" /> : <div className="admin-list">
      {tab === "updates" && <>
        <section className="admin-update-composer">
          <header><span className="eyebrow"><FiBell /> communications</span><h2>Publish an update or press release</h2><p>Internal updates appear in the signed-in Hangar. Public releases also appear on the home page and News Hub.</p></header>
          <form className="admin-update-form" onSubmit={createOrgUpdate}>
            <label>Category<select value={orgKind} onChange={event => setOrgKind(event.target.value)}><option value="GENERAL">General</option><option value="OPERATIONS">Operations</option><option value="FLEET">Fleet</option><option value="MAINTENANCE">Maintenance</option><option value="NEW_PILOT">New pilot</option><option value="ACHIEVEMENT">Achievement</option><option value="LEVEL_UP">Level up</option></select></label>
            <label>Title<input value={orgTitle} onChange={event => setOrgTitle(event.target.value)} required maxLength={120} placeholder="What changed?" /></label>
            <label className="full admin-public-toggle"><input type="checkbox" checked={orgPublic} onChange={event => setOrgPublic(event.target.checked)} /><span><strong>Publish to the public News Hub</strong><small>Also feature this release on the public home page. Leave off for pilot-only communications.</small></span></label>
            {orgPublic && <><label className="full">Public summary<textarea value={orgSummary} onChange={event => setOrgSummary(event.target.value)} required maxLength={320} rows={3} placeholder="A concise deck shown on the home page and News Hub." /></label><label>Byline<input value={orgAuthor} onChange={event => setOrgAuthor(event.target.value)} maxLength={80} placeholder="Staff Writer" /></label><label>Hero image URL<input value={orgHeroImage} onChange={event => setOrgHeroImage(event.target.value)} maxLength={500} placeholder="/assets/news/release-image.png" /></label></>}
            <label className="full">{orgPublic ? "Press release" : "Message"}<textarea value={orgBody} onChange={event => setOrgBody(event.target.value)} required maxLength={orgPublic ? 10000 : 1000} rows={orgPublic ? 9 : 5} placeholder={orgPublic ? "Write the complete public release." : "Give pilots the details they need."} /></label>
            <div className="full admin-update-actions"><small>{orgBody.length}/{orgPublic ? "10,000" : "1,000"}</small><Button type="submit" disabled={creatingUpdate || !orgTitle.trim() || !orgBody.trim() || (orgPublic && !orgSummary.trim())}><FiSend /> {creatingUpdate ? "publishing" : orgPublic ? "publish release" : "publish update"}</Button></div>
          </form>
        </section>
        <h2 className="admin-update-history-title">Recent updates</h2>
        {(data.orgUpdates ?? []).length === 0 ? <p className="notif-empty">No organization updates have been published.</p> : (data.orgUpdates ?? []).map(update => <article key={update.id} className={`admin-update-row kind-${update.kind.toLowerCase().replaceAll("_", "-")}`}><FiBell className="list-icon" /><div><h3>{update.title}{update.is_public && <em className="news-public-tag">News Hub</em>}</h3><p>{update.body}</p><small>{update.kind.replaceAll("_", " ")} · {new Date(update.created_at).toLocaleString()}{update.created_by_name ? ` · ${update.created_by_name}` : ""}</small></div></article>)}
      </>}
      {tab === "applications" && data.applications.map(item => <article key={item.id}><img src={item.avatar_url} alt="" /><div><h3>{item.preferred_name}</h3><p>@{item.username} · VATSIM {item.vatsim_cid} · {item.base_code}</p><small>{item.experience} · {item.simulator}</small>{item.introduction && <p className="application-introduction"><strong>Why they want to join</strong>{item.introduction}</p>}</div><Status value={item.status} />{["SUBMITTED", "UNDER_REVIEW", "RETURNED"].includes(item.status) && <div className="decision-buttons"><button onClick={() => decide("applications", item.id, "approved")}><FiCheck /></button><button onClick={() => decide("applications", item.id, "returned")}><FiAlertCircle /></button><button onClick={() => decide("applications", item.id, "rejected")}><FiX /></button></div>}</article>)}
      {tab === "pireps" && data.pireps.map((item, index) => { const id = String(item.id ?? index); const isOpen = openPirep === id; const outAt = item.actual_out_at ? String(item.actual_out_at) : null; const inAt = item.actual_in_at ? String(item.actual_in_at) : null; const plannedMin = typeof item.block_minutes === "number" ? item.block_minutes : null; const punc = punctuality(outAt, inAt, plannedMin); const blockMin = outAt && inAt ? Math.round((new Date(inAt).getTime() - new Date(outAt).getTime()) / 60000) : null; const fpm = item.landing_rate == null ? null : Number(item.landing_rate); return <article key={id} className="admin-pirep"><button className="admin-pirep-head" onClick={() => setOpenPirep(isOpen ? null : id)}><img className="admin-pirep-avatar" src={String(item.profile_image_url || item.avatar_url || "")} alt="" /><div className="admin-pirep-title"><h3>{String(item.display_name)}</h3><span>AIR{String(item.flight_number).padStart(3, "0")} · {String(item.origin)} <FiArrowRight className="inline-arrow" /> {String(item.destination)}</span></div>{punc && <em className={`punc ${punc.cls}`}>{punc.label}</em>}{String(item.outcome_type ?? "COMPLETED") !== "COMPLETED" && <Status value={String(item.outcome_type)} />}<Status value={String(item.review_status)} /><FiChevronDown className={isOpen ? "pirep-caret open" : "pirep-caret"} /></button>{isOpen && <div className="admin-pirep-body"><div className="pirep-detail"><div><span>Aircraft</span>{String(item.registration)}</div><div><span>Out</span>{outAt ? new Date(outAt).toLocaleString() : "—"}</div><div><span>In</span>{inAt ? new Date(inAt).toLocaleString() : "—"}</div><div><span>Block time</span>{blockMin == null ? "—" : formatMinutes(blockMin)}{plannedMin ? ` · sched ${formatMinutes(plannedMin)}` : ""}</div><div><span>Source</span>{item.source === "MISSION" ? (item.mission_type === "RECOVERY" ? "Recovery ferry" : "Mission") : item.source === "SCHEDULE" ? "Schedule" : "Self-assigned"}</div><div><span>Landing</span><b style={{ color: landingColor(fpm) }}>{fpm == null ? "not recorded" : `${fpm} fpm`}</b></div><div><span>Network</span>{item.vatsim_flown ? "VATSIM" : String(item.network ?? "offline")}</div><div><span>Distance</span>{item.distance_nm ? `${Math.round(Number(item.distance_nm))} NM` : "—"}</div>{Boolean(item.remarks) && <div className="pirep-remarks"><span>Pilot remarks</span>{String(item.remarks)}</div>}{Boolean(item.review_notes) && <div className="pirep-remarks"><span>Staff notes</span>{String(item.review_notes)}</div>}{Boolean(item.time_compression_detected) && <div className="pirep-compression"><FiAlertCircle /><span>TIME COMPRESSION · {Number(item.time_compression_ratio).toFixed(2)}x · {String(item.credited_minutes ?? 0)} XP</span></div>}{Boolean(item.volanta_url) && <div className="pirep-remarks"><span>Volanta</span><a href={String(item.volanta_url)} target="_blank" rel="noreferrer">flight link</a></div>}</div>{item.review_status === "SUBMITTED" && <div className="pirep-decisions"><Button onClick={() => decide("pireps", item.id, "approved")}><FiCheck /> approve</Button><Button kind="secondary" onClick={() => { setReviewNotes(""); setReviewDialog({ id: item.id, decision: "returned" }) }}><FiAlertCircle /> return</Button><Button kind="danger" onClick={() => { setReviewNotes(""); setReviewDialog({ id: item.id, decision: "rejected" }) }}><FiX /> reject</Button></div>}</div>}</article> })}
      {tab === "pilots" && data.pilots.map(item => { const p = item as any; return <article key={item.discord_id} className="admin-pilot"><img src={p.profile_image_url || p.avatar_url} alt="" /><div><h3>{item.pilot_number} · {item.display_name}</h3><p>{item.base_code} · {item.total_flights} flights · {formatMinutes(item.total_block_minutes)} · {p.experience ?? item.total_block_minutes} XP · VATSIM {item.vatsim_cid}</p>{p.home_base_request && <p className="base-request-note"><FiMapPin /> Requests {item.base_code} <FiArrowRight className="inline-arrow" /> {p.home_base_request}{p.home_base_request_reason ? ` — ${p.home_base_request_reason}` : ""} <button className="mini-approve" onClick={() => decideBaseRequest(item.discord_id, "approve")}><FiCheck /> approve</button><button className="mini-deny" onClick={() => decideBaseRequest(item.discord_id, "deny")}><FiX /> deny</button></p>}</div><div className="admin-pilot-controls"><label>base<select value={item.base_code} onChange={e => managePilot(item.discord_id, { baseCode: e.target.value })}>{(data.bases ?? []).filter(b => b.is_active || b.code === item.base_code).map(b => <option key={b.code} value={b.code}>{b.code}</option>)}</select></label><label>status<select value={item.status} onChange={e => managePilot(item.discord_id, { status: e.target.value })}>{["ACTIVE", "LEAVE", "INACTIVE", "SUSPENDED"].map(s => <option key={s} value={s}>{s}</option>)}</select></label><button className="pilot-flights-btn" onClick={() => openPilotFlights(item)}><FiFileText /> flights</button></div></article> })}
      {tab === "bases" && <><div className="admin-bases-actions"><Button onClick={() => setBaseForm({ code: "", name: "", lat: "", lon: "", role: "", sortOrder: 100, isActive: true, isNew: true })}><FiMapPin /> Add a base</Button></div>{(data.bases ?? []).map(b => <article key={b.code} className="admin-base"><FiMapPin className="list-icon" /><div><h3>{b.code} · {b.name}{!b.is_active && <em className="base-inactive"> inactive</em>}</h3><p>{b.role || "No role set"} · {b.lat.toFixed(4)}, {b.lon.toFixed(4)} · {b.pilot_count ?? 0} pilot(s)</p></div><div className="equipment-actions"><button onClick={() => setBaseForm({ ...b, sortOrder: b.sort_order, isActive: b.is_active, isNew: false })}>edit</button><button onClick={() => saveBase({ code: b.code, name: b.name, lat: b.lat, lon: b.lon, role: b.role, sortOrder: b.sort_order, isActive: !b.is_active })}>{b.is_active ? "deactivate" : "activate"}</button><button className="danger" onClick={() => deleteBase(b.code)}>delete</button></div></article>)}</>}
      {tab === "visitors" && ((data.visitors ?? []).length === 0 ? <p className="notif-empty">No signed-in visitors are waiting. Everyone who signed in has applied or is a pilot.</p> : (data.visitors ?? []).map(v => <article key={v.discord_id}><img src={v.avatar_url} alt="" /><div><h3>{v.display_name}</h3><p>@{v.username} · signed in, no application yet</p><small>Last seen {new Date(v.last_login_at).toLocaleString()}</small></div></article>))}
      {tab === "assignments" && data.assignments.map(item => <article key={item.id} className="admin-assignment"><FiMap className="list-icon" /><div><h3>AIR{String(item.flight_number).padStart(3, "0")} · {item.registration}</h3><p>{item.origin} to {item.destination} · {item.flight_date}</p><small className="assignment-pilot"><FiUser /> {item.pilot_name ?? item.pilot_username ?? "Unknown pilot"}</small>{["CANCELLED", "EXPIRED"].includes(item.status) && <small className="assignment-cancelled"><FiXCircle /> {item.cancellation_reason ?? (item.status === "EXPIRED" ? "Booking expired" : "Assignment cancelled")} · {item.cancelled_by_name ?? item.cancelled_by_username ?? (item.status === "EXPIRED" ? "system" : "unknown actor")}{item.cancelled_at ? ` · ${new Date(item.cancelled_at).toLocaleString()}` : ""}</small>}</div><Status value={item.status} /></article>)}
      {tab === "aircraft" && <><div className="board-toolbar"><div className="search"><TbPlane /><input placeholder="Search registration or airport" value={acQuery} onChange={e => setAcQuery(e.target.value)} /></div><div className="filter-chips">{[["all", "All"], ["AVAILABLE", "Available"], ["ASSIGNED", "In use"], ["MAINTENANCE", "Maintenance"], ["INSPECTION", "Inspection"], ["RETIRED", "Retired"]].map(([v, l]) => <button key={v} className={acFilter === v ? "on" : ""} onClick={() => setAcFilter(v)}>{l}</button>)}</div><label>Sort<select value={acSort} onChange={e => setAcSort(e.target.value)}><option value="fleet">Fleet number</option><option value="cycles">Most cycles</option><option value="hours">Most hours</option><option value="registration">Registration</option></select></label></div>
      {[...data.aircraft].filter(a => { const q = acQuery.trim().toUpperCase(); return !q || a.registration.includes(q) || a.current_airport.includes(q) }).filter(a => acFilter === "all" || a.status === acFilter).sort((a, b) => acSort === "cycles" ? b.total_cycles - a.total_cycles : acSort === "hours" ? b.total_block_minutes - a.total_block_minutes : acSort === "registration" ? a.registration.localeCompare(b.registration) : a.fleet_number - b.fleet_number).map(item => <article key={item.registration}><TbPlane className="list-icon" /><div><h3>{item.registration}{item.special_livery && <em className="special-livery-tag" title="Special livery">{item.livery_name}</em>}</h3><p>Fleet {item.fleet_number} · {item.current_airport} · {item.total_cycles} cycles · {formatMinutes(item.total_block_minutes)} block · {item.livery_download_count ?? 0} MSFS 2024 downloads · {item.livery_msfs2020_download_count ?? 0} MSFS 2020 downloads</p>{item.status_reason && <small className="oos-reason">{item.status_reason}{item.status_until ? ` · until ${new Date(item.status_until).toLocaleString()}` : ""}</small>}</div><Status value={item.status} /><div className="equipment-actions">{item.status !== "AVAILABLE" && item.status !== "ASSIGNED" && <button onClick={() => setAircraftStatus(item.registration, "AVAILABLE", "")}>return to service</button>}{item.status !== "ASSIGNED" && <><button onClick={() => { setStatusReason(""); setStatusDialog({ registration: item.registration, status: "MAINTENANCE" }) }}>maintenance</button><button onClick={() => { setStatusReason(""); setStatusDialog({ registration: item.registration, status: "INSPECTION" }) }}>inspection</button><button className="danger" onClick={() => { setStatusReason(""); setStatusDialog({ registration: item.registration, status: "RETIRED" }) }}>retire</button></>}</div></article>)}</>}
      {tab === "audit" && <>
        <div className="board-toolbar audit-toolbar"><div className="search"><FiActivity /><input placeholder="Search action, actor, entity, ID, or details" value={auditQuery} onChange={event => setAuditQuery(event.target.value)} /></div><label>Action<select value={auditAction} onChange={event => setAuditAction(event.target.value)}><option value="all">All actions</option>{auditActions.map(action => <option key={action} value={action}>{action.replaceAll("_", " ")}</option>)}</select></label><label>Entity<select value={auditEntity} onChange={event => setAuditEntity(event.target.value)}><option value="all">All entities</option>{auditEntities.map(entity => <option key={entity} value={entity}>{entity}</option>)}</select></label><label>Sort<select value={auditSort} onChange={event => setAuditSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="action">Action</option><option value="actor">Actor</option></select></label></div>
        <p className="audit-result-count">Showing {visibleAudit.length} of {data.audit.length} audit events</p>
        {visibleAudit.length === 0 ? <p className="notif-empty">No audit events match these filters.</p> : visibleAudit.map((item, index) => { const details = item.details && typeof item.details === "object" ? Object.entries(item.details as Record<string, unknown>) : []; return <article className="audit-row" key={String(item.id ?? index)}><FiActivity className="list-icon" /><div><h3>{String(item.action).replaceAll("_", " ")}</h3><p>{String(item.entity_type)} {String(item.entity_id)} · by {item.actor_name ? String(item.actor_name) : item.actor_discord_id ? String(item.actor_discord_id) : "system"}</p>{details.length > 0 && <small className="audit-details">{details.map(([key, value]) => `${key.replaceAll("_", " ")}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ")}</small>}</div><time>{new Date(String(item.created_at)).toLocaleString()}</time></article> })}
      </>}
      {tab === "settings" && <div className="admin-settings"><label className="settings-toggle"><input type="checkbox" checked={Boolean(data.settings?.autoApprovePireps)} onChange={async event => { try { const value = await post<{ settings: any }>("/admin/settings", { autoApprovePireps: event.target.checked }); setData(data ? { ...data, settings: value.settings } : data); notify("Settings saved") } catch (error) { notify(error instanceof Error ? error.message : "Settings update failed", "error") } }} /><span><strong>Automatically approve pilot reports</strong>When enabled, submitted pilot reports are approved immediately. Pilot totals, aircraft position, and hard-landing inspections still apply.</span></label></div>}
    </div>}
    {statusDialog && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !savingStatus) setStatusDialog(null) }}>
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="status-title">
        <FiAlertCircle /><h2 id="status-title">{statusDialog.status === "RETIRED" ? "Retire" : statusDialog.status === "INSPECTION" ? "Inspect" : "Ground"} {statusDialog.registration}?</h2>
        <p>{statusDialog.status === "INSPECTION" ? "Inspection removes the aircraft from service for 48 hours, then returns it automatically." : statusDialog.status === "RETIRED" ? "Retired aircraft no longer appear for booking." : "Maintenance removes the aircraft from service until it is returned manually."} Pilots will see the reason on the fleet page and flight board.</p>
        <label className="status-reason-label">Reason code or description<input value={statusReason} onChange={event => setStatusReason(event.target.value)} maxLength={300} placeholder={statusDialog.status === "MAINTENANCE" ? "MX-SCHD · A-check due" : statusDialog.status === "INSPECTION" ? "INSP-HL · hard landing review" : "RET-FLEET · leaving the fleet"} /></label>
        <div><Button kind="secondary" onClick={() => setStatusDialog(null)} disabled={savingStatus}>Cancel</Button><Button kind={statusDialog.status === "RETIRED" ? "danger" : "primary"} onClick={() => setAircraftStatus(statusDialog.registration, statusDialog.status, statusReason)} disabled={savingStatus || !statusReason.trim()}>{savingStatus ? "Saving..." : `Confirm ${statusDialog.status.toLowerCase()}`}</Button></div>
      </section>
    </div>}
    {pilotFlights && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPilotFlights(null) }}>
      <section className="pilot-modal pilot-flights-modal" role="dialog" aria-modal="true">
        <button className="pilot-modal-close" onClick={() => setPilotFlights(null)} aria-label="Close"><FiX /></button>
        <h2>{pilotFlights.pilot.display_name}</h2>
        <p className="pilot-flights-sub">{pilotFlights.pilot.pilot_number} · flight history</p>
        {!pilotFlights.flights ? <Spinner label="Loading flights" /> : pilotFlights.flights.length === 0 ? <p className="notif-empty">No flights on record.</p> : <div className="admin-flight-list">{pilotFlights.flights.map((f: any) => <div key={f.id} className="admin-flight-row"><div><b>AIR{String(f.flight_number).padStart(3, "0")}</b> <span>{f.origin} <FiArrowRight className="inline-arrow" /> {f.destination}</span><small>{f.registration} · {f.source?.toLowerCase()} · {f.review_status ? String(f.review_status).toLowerCase() : String(f.status).toLowerCase()}{f.reviewed_at ? ` · ${new Date(f.reviewed_at).toLocaleDateString()}` : f.booked_at ? ` · ${new Date(f.booked_at).toLocaleDateString()}` : ""}</small></div><button className="danger" onClick={() => setConfirmDeleteFlight({ id: f.id, label: `AIR${String(f.flight_number).padStart(3, "0")} ${f.origin}-${f.destination}` })} aria-label="Delete flight"><FiX /></button></div>)}</div>}
      </section>
    </div>}
    <ConfirmDialog open={Boolean(confirmDeleteFlight)} title="Delete this flight?" body={`This permanently removes ${confirmDeleteFlight?.label ?? "the flight"} and its pilot report. If it was approved, the pilot's flights, hours, and experience are adjusted down. This cannot be undone.`} confirmLabel="Delete flight" onConfirm={() => { if (confirmDeleteFlight && pilotFlights) deleteFlight(confirmDeleteFlight.id, pilotFlights.pilot); setConfirmDeleteFlight(null) }} onCancel={() => setConfirmDeleteFlight(null)} />
    {baseForm && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setBaseForm(null) }}>
      <section className="confirm-dialog base-dialog" role="dialog" aria-modal="true" aria-labelledby="base-title">
        <header className="base-dialog-head">
          <span><FiMapPin /></span>
          <div><small>{baseForm.isNew ? "New operating base" : "Operating base"}</small><h2 id="base-title">{baseForm.isNew ? "Add a base" : `Edit ${baseForm.code}`}</h2><p>Airport identity, map position, and pilot availability.</p></div>
        </header>

        <div className="base-editor-section">
          <h3>Airport identity</h3>
          <div className="base-form-grid identity-fields">
            <label>ICAO code<input value={baseForm.code} disabled={!baseForm.isNew} maxLength={4} onChange={e => setBaseForm({ ...baseForm, code: e.target.value.toUpperCase() })} placeholder="KGEG" /></label>
            <label>Airport name<input value={baseForm.name} maxLength={60} onChange={e => setBaseForm({ ...baseForm, name: e.target.value })} placeholder="Spokane" /></label>
            <label className="base-role-field">Role in the network<input value={baseForm.role} maxLength={60} onChange={e => setBaseForm({ ...baseForm, role: e.target.value })} placeholder="Northwest base" /></label>
          </div>
        </div>

        <div className="base-editor-section">
          <h3>Map position</h3>
          <p className="base-section-help">Decimal coordinates place the base marker on the public network map.</p>
          <div className="base-form-grid coordinate-fields">
            <label>Latitude<input value={baseForm.lat} inputMode="decimal" onChange={e => setBaseForm({ ...baseForm, lat: e.target.value })} placeholder="47.6199" /></label>
            <label>Longitude<input value={baseForm.lon} inputMode="decimal" onChange={e => setBaseForm({ ...baseForm, lon: e.target.value })} placeholder="-117.5339" /></label>
          </div>
        </div>

        <div className="base-editor-section base-display-section">
          <div><h3>Display and availability</h3><p className="base-section-help">Lower sort values place the base earlier in lists.</p></div>
          <label className="sort-order-field">Sort order<input value={baseForm.sortOrder} inputMode="numeric" onChange={e => setBaseForm({ ...baseForm, sortOrder: e.target.value })} /></label>
          <label className="base-active-card"><input type="checkbox" checked={Boolean(baseForm.isActive)} onChange={e => setBaseForm({ ...baseForm, isActive: e.target.checked })} /><span className="base-toggle-visual" /><span><strong>{baseForm.isActive ? "Active base" : "Inactive base"}</strong><small>{baseForm.isActive ? "Accepts pilots and appears on the public map" : "Hidden from applications and the public map"}</small></span></label>
        </div>

        <footer className="base-dialog-actions"><Button kind="secondary" onClick={() => setBaseForm(null)}>Cancel</Button><Button onClick={() => saveBase({ code: baseForm.code, name: baseForm.name, lat: Number(baseForm.lat), lon: Number(baseForm.lon), role: baseForm.role, sortOrder: Number(baseForm.sortOrder) || 100, isActive: Boolean(baseForm.isActive) })}>Save base</Button></footer>
      </section>
    </div>}
    {reviewDialog && <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setReviewDialog(null) }}>
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="review-title">
        <FiAlertCircle /><h2 id="review-title">{reviewDialog.decision === "returned" ? "Return this report?" : "Reject this report?"}</h2>
        <p>{reviewDialog.decision === "returned" ? "Returning sends the report back to the pilot so they can correct it and resubmit. The aircraft stays assigned." : "Rejecting discards the report, cancels the assignment, and releases the aircraft."}</p>
        <label className="status-reason-label">Reason for the pilot<textarea value={reviewNotes} onChange={event => setReviewNotes(event.target.value)} rows={4} maxLength={1000} placeholder={reviewDialog.decision === "returned" ? "e.g. Out and In times do not match your Volanta flight" : "e.g. This flight was not operated on an airDash route"} /></label>
        <div><Button kind="secondary" onClick={() => setReviewDialog(null)}>Cancel</Button><Button kind={reviewDialog.decision === "rejected" ? "danger" : "primary"} onClick={() => { decide("pireps", reviewDialog.id, reviewDialog.decision, reviewNotes); setReviewDialog(null) }} disabled={!reviewNotes.trim()}>{reviewDialog.decision === "returned" ? "Return report" : "Reject report"}</Button></div>
      </section>
    </div>}
  </Page>
}

function Page({ title, icon, intro, children }: { title: string; icon: ReactNode; intro?: ReactNode; children: ReactNode }) {
  return <motion.div {...fade} className="page"><header className="page-heading"><motion.span initial={{ scale: 0.6, rotate: -12, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }} whileHover={{ rotate: [0, -8, 8, 0], transition: { duration: 0.5 } }}>{icon}</motion.span><div><h1>{title}</h1>{intro && <p>{intro}</p>}</div></header>{children}</motion.div>
}
function Metric({ icon, value, label }: { icon: ReactNode; value: string; label: string }) { return <article className="metric"><motion.span whileHover={{ scale: 1.15, rotate: -6 }} transition={{ type: "spring", stiffness: 300, damping: 15 }}>{icon}</motion.span><strong>{value}</strong><small>{label}</small></article> }
function ExpiryBar({ bookedAt, expiresAt }: { bookedAt: string; expiresAt: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(t) }, [])
  const start = new Date(bookedAt).getTime()
  const end = new Date(expiresAt).getTime()
  const total = Math.max(1, end - start)
  const remaining = end - now
  const pct = Math.max(0, Math.min(1, remaining / total))
  const mins = Math.max(0, Math.round(remaining / 60000))
  const label = remaining <= 0 ? "Expired" : `${Math.floor(mins / 60)}h ${mins % 60}m left to file`
  const level = pct < 0.15 ? "danger" : pct < 0.35 ? "warning" : "ok"
  return <section className="expiry" tabIndex={0} aria-label="Time remaining to file your pilot report">
    <div className="expiry-head"><span>Time to file your report</span><span>{label}</span></div>
    <div className="expiry-track"><div className={`expiry-fill ${level}`} style={{ width: `${pct * 100}%` }} /></div>
    <span className="expiry-tip">This booking is held for the flight time plus two and a half hours. File your pilot report before this runs out, or the flight is forfeited, the aircraft returns to the fleet, and you are notified.</span>
  </section>
}

function Spinner({ label }: { label?: string }) {
  return <div className="spinner"><span className="spinner-mark" />{label && <small>{label}</small>}</div>
}

function LiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(t) }, [])
  const zulu = now.toLocaleTimeString([], { hour12: false, timeZone: "UTC" })
  const local = now.toLocaleTimeString([], { hour12: false })
  return <div className="live-clock"><span><FiGlobe /> {zulu}Z</span><span><FiClock /> {local} local</span></div>
}

function Empty({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children?: ReactNode }) { return <div className="empty"><span>{icon}</span><h2>{title}</h2><p>{body}</p>{children}</div> }

// Increment this value whenever tutorial content changes so every pilot sees the new brief once.
const BRIEF_VERSION = "2026-09-10-news-hub-v2"
const briefStorageKey = (pilotId: string) => `airdash-brief-seen:${BRIEF_VERSION}:${pilotId}`

const BRIEF_CARDS = [
  { icon: <FiUserCheck />, title: "Welcome to airDash", body: "This brief explains the current pilot workflow. airDash operates the Airbus A220-300 from Atlanta, Denver, Santo Domingo, and Spokane. You can reopen this tutorial from Pilot Profile at any time." },
  { icon: <FiMap />, title: "Book the aircraft where it is", body: "The Flight Board lists published routes and the aircraft available at each origin. Every airframe has a real network position, so you can book it only from the airport where it is currently parked." },
  { icon: <FiHome />, title: "Use the Hangar as dispatch", body: "The Pilot Portal Hangar holds your active assignment, separately labeled departure and arrival gates, aircraft, filing deadline, SimBrief tools, VATSIM pre-file, updates, and pilot statistics. airDash assigns fallback stands when an airport has no custom gate table; resolve an occupied stand there before departure." },
  { icon: <FiSend />, title: "SimBrief and callsigns", body: "Save your SimBrief or Navigraph username in Pilot Profile. Generate creates a LIDO OFP for the assigned A220, and Pre-file fetches that completed OFP before opening VATSIM. D1 is the commercial designator; AIR followed by the flight number is the ATC callsign." },
  { icon: <FiCalendar />, title: "Schedule and standard missions", body: "Schedule recommendations roll off after departure. Standard Missions continue from an available aircraft's location, expire on their own countdown, and award a flight-length multiplier in addition to normal verified experience." },
  { icon: <TbPlane />, title: "Recovery ferry missions", body: "If an approved diverted or incomplete flight leaves an aircraft away from its planned destination, Operations creates a persistent recovery ferry. It uses an AIR9xxx callsign, 0 passengers, 0 cargo, and normal base XP without the standard mission multiplier." },
  { icon: <FiActivity />, title: "Volanta is required", body: "Run Volanta for the full flight and end its record before reporting. airDash checks the public link against the assigned route and aircraft, verifies real elapsed time, detects the final aircraft position, and imports landing data when Volanta recorded it." },
  { icon: <FiFileText />, title: "Verify and review your report", body: "Paste a valid public Volanta flight link and airDash verifies it automatically. The VATSIM toggle and submit action remain visible. Submit opens a confirmation window where you can review the result, add remarks, or go back and edit." },
  { icon: <FiAlertCircle />, title: "Diversions and incomplete flights", body: "If the data does not show arrival at the planned destination, choose what happened and add Operations details when needed. Approved non-complete reports still count as flights, use adjusted block-time credit, and position the aircraft at the verified recovery airport." },
  { icon: <FiActivity />, title: "Experience and landing data", body: "Base experience follows real-time minutes verified by Volanta, with flight-day streak bonuses applied afterward. Time compression cannot create extra XP. A missing landing rate is stored as no data, not 0, so it cannot distort averages." },
  { icon: <FiCheckCircle />, title: "Review and aircraft status", body: "Approved reports add flight credit and move the aircraft. Returned reports can be corrected and resubmitted; rejected reports release the aircraft. A landing at or below -450 fpm triggers an automatic 48-hour inspection." },
  { icon: <FiMapPin />, title: "Explore the network maps", body: "The public home map shows every base, route origin, route line, and live flight, and supports scroll-wheel zoom. Pilots can open Network Map from the overflow menu for searchable layers and detailed airport, route, aircraft, flight, and pilot views." },
  { icon: <FiFileText />, title: "News Hub and press releases", body: "The home page shows the latest public airDash release. Open News from navigation for the complete newsroom, category filters, full articles, and share links. Pilot-only Operations updates remain inside the Hangar announcements archive." },
  { icon: <FiBell />, title: "Notifications and history", body: "The bell shows unread Operations, report, equipment, progress, and announcement updates. Opening the panel keeps them unread until you dismiss it. Notification history lives under Portal Updates, and Pilot Profile can enable background browser push on each device." },
  { icon: <FiClock />, title: "Deadlines and cancellations", body: "A booking is held for the flight time plus two and a half hours. File before the timer expires or the booking is forfeited and the aircraft is released. If you cannot fly, cancel with the correct reason so Operations history remains accurate." },
  { icon: <FiHome />, title: "You are ready", body: "Choose a route, prepare the OFP, run Volanta, fly in real time, and confirm the imported report. The fleet, your experience, and the route network will update from the approved result. Welcome aboard, Captain." },
]

function Brief({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const card = BRIEF_CARDS[index]
  const last = index === BRIEF_CARDS.length - 1
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="brief-dialog" role="dialog" aria-modal="true" aria-labelledby="brief-title">
      <div className="brief-icon">{card.icon}</div>
      <h2 id="brief-title">{card.title}</h2>
      <p>{card.body}</p>
      <div className="brief-dots">{BRIEF_CARDS.map((_, i) => <span key={i} className={i === index ? "on" : ""} />)}</div>
      <div className="brief-actions">
        <button className="brief-skip" onClick={onClose}>Skip</button>
        <div>
          {index > 0 && <Button kind="secondary" onClick={() => setIndex(index - 1)}>Back</Button>}
          {last ? <Button onClick={onClose}>Finish</Button> : <Button onClick={() => setIndex(index + 1)}>Next</Button>}
        </div>
      </div>
    </section>
  </div>
}

function Toast({ toast, onClose }: { toast: { message: string; kind: "ok" | "error"; action?: { label: string; to: string } }; onClose: () => void }) {
  const timer = useRef<number | undefined>(undefined)
  const start = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(onClose, 4500) }
  useEffect(() => { start(); return () => window.clearTimeout(timer.current) }, [])
  return <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`toast ${toast.kind}`} onMouseEnter={() => window.clearTimeout(timer.current)} onMouseLeave={start} role="status">
    {toast.kind === "ok" ? <FiCheckCircle /> : <FiXCircle />}
    <span>{toast.message}</span>
    {toast.action && <Link to={toast.action.to} className="toast-action" onClick={onClose}>{toast.action.label} <FiArrowRight className="inline-arrow" /></Link>}
  </motion.div>
}

export default function App() {
  const [publicData, setPublicData] = useState<PublicResponse | null>(null)
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ message: string; kind: "ok" | "error"; action?: { label: string; to: string }; id: number } | null>(null)
  const [rawNotifications, setRawNotifications] = useState<NotificationPayload | null>(null)
  const [notifTick, setNotifTick] = useState(0)
  const refreshNotifications = () => setNotifTick(t => t + 1)
  const [briefOpen, setBriefOpen] = useState(false)
  const tutorialKey = me?.pilot?.discord_id ? briefStorageKey(me.pilot.discord_id) : ""
  const openBrief = () => setBriefOpen(true)
  const closeBrief = () => {
    setBriefOpen(false)
    if (tutorialKey) {
      try { localStorage.setItem(tutorialKey, "1") } catch {}
    }
  }
  const refresh = async () => {
    try {
      const [publicValue, meValue] = await Promise.all([
        api<PublicResponse>("/public"),
        api<MeResponse>("/me").catch(() => null),
      ])
      setPublicData(publicValue)
      setMe(meValue)
    } catch (error) {
      setPublicData({ aircraft: [], routes: [], bases: [] })
      setMe(null)
      notify(error instanceof Error ? error.message : "AirDash data is temporarily unavailable", "error")
    } finally {
      setLoading(false)
    }
  }
  const notifications = rawNotifications
  const markNotificationsRead = async (ids?: number[]) => {
    try {
      await post("/notifications/read", { ids: ids?.length ? ids : undefined })
      const now = new Date().toISOString()
      const selected = ids?.length ? new Set(ids) : null
      setRawNotifications(current => {
        if (!current) return current
        const history = (current.history ?? []).map(item => (!selected || selected.has(item.id)) && !item.read_at ? { ...item, read_at: now } : item)
        const newlyRead = selected ? (current.history ?? []).filter(item => selected.has(item.id) && !item.read_at).length : current.total
        return { ...current, history, total: Math.max(0, current.total - newlyRead) }
      })
    } catch (error) {
      notify(error instanceof Error ? error.message : "Notifications could not be marked read", "error")
    }
  }
  useEffect(() => { history.scrollRestoration = "manual"; requestAnimationFrame(() => window.scrollTo(0, 0)); return () => { history.scrollRestoration = "auto" } }, [])
  useEffect(() => { refresh(); const params = new URLSearchParams(location.search); if (params.has("auth")) history.replaceState({}, "", location.pathname) }, [])
  useEffect(() => { if (!me?.user) { setRawNotifications(null); return } const endpoint = me.isOwner ? "/admin/notifications" : "/notifications"; const load = () => api<NotificationPayload>(endpoint).then(setRawNotifications).catch(() => {}); load(); const timer = window.setInterval(load, 60000); return () => window.clearInterval(timer) }, [me?.isOwner, me?.user?.id, notifTick])
  useEffect(() => {
    if (!tutorialKey) return
    try { if (!localStorage.getItem(tutorialKey)) setBriefOpen(true) }
    catch { setBriefOpen(true) }
  }, [tutorialKey])
  const notify = (message: string, kind: "ok" | "error" = "ok", action?: { label: string; to: string }) => { setToast({ message, kind, action, id: Date.now() }) }
  const context = useMemo(() => ({ publicData, me, loading, refresh, notify, notifications, markNotificationsRead, refreshNotifications, openBrief }), [publicData, me, loading, notifications])
  if (loading) return <div className="boot"><img src="/assets/airdash.logo.png" alt="airDash" /><span /></div>
  return <AppContext.Provider value={context}><Layout><Routes>
    <Route path="/" element={<Home />} /><Route path="/news" element={<NewsHub />} /><Route path="/news/:slug" element={<NewsArticle />} /><Route path="/join" element={<Join />} /><Route path="/portal" element={<Portal />} /><Route path="/announcements" element={<Announcements />} />
    <Route path="/flights" element={<Flights />} /><Route path="/schedule" element={<Schedule />} /><Route path="/missions" element={<Missions />} /><Route path="/map" element={<NetworkMapPage />} /><Route path="/report" element={<Report />} /><Route path="/profile" element={<Profile />} /><Route path="/pilots" element={<Pilots />} /><Route path="/fleet" element={<Fleet />} /><Route path="/health" element={<Health />} />
    <Route path="/admin" element={<Admin />} /><Route path="*" element={<Home />} />
  </Routes></Layout><AnimatePresence>{toast && <Toast key={toast.id} toast={toast} onClose={() => setToast(null)} />}</AnimatePresence>{briefOpen && <Brief onClose={closeBrief} />}</AppContext.Provider>
}
