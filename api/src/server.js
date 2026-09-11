import "dotenv/config"
import express from "express"
import { promises as fs } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { audit, migrate, pool, publishOrgUpdate } from "./database.js"
import { OWNER_ID, requireAirDashOrigin, requireOwner, requireUser } from "./auth.js"
import { generateGates, selectGate, importSimBrief, importSimBriefByUsername, importVolanta } from "./integrations.js"
import { applyStreakBonus, calculatePilotStreaks, publicStreaks } from "./streaks.js"
import { analyzeFlightOutcome, isNonCompleteOutcome, normalizeDiversionReasonCode, PIREP_OUTCOME_TYPES } from "./flightOutcome.js"
import { markNotificationsRead, syncNotificationHistory } from "./notifications.js"
import { pushConfiguration, removePushSubscription, savePushSubscription, sendTestPush, startPushWorker } from "./push.js"
import { assignmentExperienceMultiplier, buildRecoveryMission, buildSimBriefDispatchParams, ensureRecoveryRoute, estimateRecoveryBlockMinutes, recoveryPayloadIsValid } from "./recoveryMissions.js"
import { repairMissingActiveGates } from "./gates.js"
import { repairAircraftParkingGates, selectAircraftGate } from "./aircraftGates.js"

const app = express()
const port = Number(process.env.PORT ?? 3006)
app.set("trust proxy", 1)
app.use(express.json({ limit: "2mb" }))
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("X-Frame-Options", "DENY")
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
  next()
})
app.use(requireAirDashOrigin)

const clean = (value, maximum = 500) => typeof value === "string" ? value.trim().slice(0, maximum) : ""
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "")
const newsSlug = value => String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100)
const validNewsImage = value => !value || value.startsWith("/assets/news/") || (value.startsWith("https://") && URL.canParse(value))

async function uniqueNewsSlug(value) {
  const base = newsSlug(value) || `release-${Date.now()}`
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`
    const existing = await pool.query("SELECT 1 FROM airdash.org_updates WHERE slug=$1", [candidate])
    if (!existing.rows[0]) return candidate
  }
  throw Object.assign(new Error("Could not allocate a unique news slug"), { status: 409 })
}
const ORG_UPDATE_KINDS = new Set(["GENERAL", "OPERATIONS", "FLEET", "MAINTENANCE", "NEW_PILOT", "ACHIEVEMENT", "LEVEL_UP"])
const ASSIGNMENT_CANCEL_REASONS = new Map([
  ["FILED_IN_ERROR", "Filed in error"],
  ["UNABLE_TO_COMPLETE", "Unable to complete"],
  ["SIMULATOR_ISSUE", "Simulator or aircraft issue"],
  ["NETWORK_ISSUE", "Network or connectivity issue"],
  ["WEATHER_OR_OPERATIONS", "Weather or operational conditions"],
  ["PERSONAL_INTERRUPTION", "Personal interruption"],
  ["OTHER", "Other"],
])

async function syncUser(user) {
  await pool.query(`INSERT INTO airdash.users (discord_id, username, display_name, avatar_url)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (discord_id) DO UPDATE SET username=$2, display_name=$3, avatar_url=$4, last_login_at=NOW()`,
    [user.id, user.username, user.displayName ?? user.username, user.avatar ?? null])
}

async function loadAccount(discordId) {
  const [application, pilot, assignment] = await Promise.all([
    pool.query("SELECT * FROM airdash.applications WHERE discord_id=$1", [discordId]),
    pool.query("SELECT * FROM airdash.pilots WHERE discord_id=$1", [discordId]),
    pool.query(`SELECT a.*, r.flight_number, r.origin, r.destination, r.block_minutes
      FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
      WHERE a.discord_id=$1 AND a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED') ORDER BY a.booked_at DESC LIMIT 1`, [discordId]),
  ])
  const [lastFlight, liveries, streaks] = await Promise.all([
    pool.query(`SELECT MAX(actual_in_at) last_at FROM airdash.pireps WHERE discord_id=$1 AND review_status='APPROVED'`, [discordId]),
    pool.query("SELECT registration, simulator FROM airdash.livery_downloads WHERE discord_id=$1", [discordId]),
    calculatePilotStreaks(pool, discordId),
  ])
  return { application: application.rows[0] ?? null, pilot: pilot.rows[0] ?? null, assignment: assignment.rows[0] ?? null, lastFlightAt: lastFlight.rows[0]?.last_at ?? null, downloadedLiveries: [...new Set(liveries.rows.map(r => r.registration))], downloadedLiveryVersions: liveries.rows.map(r => ({ registration: r.registration, simulator: r.simulator })), streaks: publicStreaks(streaks) }
}

async function expireAssignments() {
  const client = await pool.connect()
  let expired = []
  try {
    await client.query("BEGIN")
    const result = await client.query(`UPDATE airdash.assignments SET status='EXPIRED', cancelled_at=NOW(), cancelled_by=NULL, cancellation_code='DEADLINE_EXPIRED', cancellation_reason='Flight report deadline expired'
      WHERE status IN ('BOOKED','ACTIVE') AND expires_at < NOW() RETURNING id, registration, discord_id`)
    expired = result.rows
    for (const row of expired) {
      await client.query("UPDATE airdash.aircraft SET status='AVAILABLE' WHERE registration=$1 AND status='ASSIGNED'", [row.registration])
    }
    await client.query("COMMIT")
  } catch {
    await client.query("ROLLBACK")
  } finally {
    client.release()
  }
  for (const row of expired) {
    await audit(row.discord_id, "ASSIGNMENT_EXPIRED", "assignment", row.id, { registration: row.registration })
  }
  const released = await pool.query(`UPDATE airdash.aircraft SET status='AVAILABLE', status_reason='', status_until=NULL
    WHERE status IN ('INSPECTION','MAINTENANCE') AND status_until IS NOT NULL AND status_until < NOW() RETURNING registration`)
  for (const row of released.rows) {
    await audit(null, "AIRCRAFT_RELEASED_FROM_HOLD", "aircraft", row.registration, {})
  }
}

setInterval(() => { expireAssignments().catch(() => {}) }, 5 * 60 * 1000).unref()

function scheduleHash(value) {
  let result = 2166136261
  for (const character of String(value)) { result ^= character.charCodeAt(0); result = Math.imul(result, 16777619) }
  return result >>> 0
}

async function ensureSchedule() {
  const routes = await pool.query("SELECT id, block_minutes FROM airdash.routes WHERE status='ACTIVE'")
  const now = new Date()
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    const day = new Date(now); day.setUTCHours(0, 0, 0, 0); day.setUTCDate(day.getUTCDate() + dayOffset)
    const dayKey = day.toISOString().slice(0, 10)
    for (const route of routes.rows) {
      for (let slot = 0; slot < 2; slot += 1) {
        const h = scheduleHash(`${route.id}:${dayKey}:${slot}`)
        const minutesIntoDay = (h % 1080) + 300 // 05:00 to 23:00 UTC
        const dep = new Date(day.getTime() + minutesIntoDay * 60000)
        const arr = new Date(dep.getTime() + route.block_minutes * 60000)
        await pool.query(`INSERT INTO airdash.schedule (route_id, dep_time, arr_time) VALUES ($1,$2,$3)
          ON CONFLICT (route_id, dep_time) DO NOTHING`, [route.id, dep, arr])
      }
    }
  }
  await pool.query("UPDATE airdash.schedule SET status='DEPARTED' WHERE status='OPEN' AND dep_time < NOW()")
  await pool.query("DELETE FROM airdash.schedule WHERE status='DEPARTED' AND dep_time < NOW() - INTERVAL '6 hours'")
}
setInterval(() => { ensureSchedule().catch(() => {}) }, 10 * 60 * 1000).unref()
ensureSchedule().catch(() => {})

app.get("/schedule", async (_req, res) => {
  await ensureSchedule().catch(() => {})
  const result = await pool.query(`WITH scheduled_rows AS (
      SELECT s.id::text id, s.dep_time, s.arr_time, s.status,
        r.flight_number, r.origin, r.destination, r.block_minutes,
        a.registration, a.status assignment_status,
        p.display_name pilot, p.profile_image_url, u.avatar_url,
        pr.actual_out_at, pr.actual_in_at, pr.review_status pirep_status,
        a.source assignment_source, FALSE unscheduled_assignment
      FROM airdash.schedule s JOIN airdash.routes r ON r.id=s.route_id
      LEFT JOIN airdash.assignments a ON a.id=s.assignment_id
      LEFT JOIN airdash.pilots p ON p.discord_id=a.discord_id
      LEFT JOIN airdash.users u ON u.discord_id=a.discord_id
      LEFT JOIN airdash.pireps pr ON pr.assignment_id=a.id
      WHERE s.dep_time > NOW() - INTERVAL '2 hours'
        OR a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED')
    ), active_assignment_rows AS (
      SELECT ('assignment-' || a.id)::text id,
        COALESCE(pr.actual_out_at, a.started_at, a.booked_at) dep_time,
        COALESCE(pr.actual_in_at, COALESCE(pr.actual_out_at, a.started_at, a.booked_at) + make_interval(mins => r.block_minutes)) arr_time,
        'TAKEN'::text status,
        r.flight_number, r.origin, r.destination, r.block_minutes,
        a.registration, a.status assignment_status,
        p.display_name pilot, p.profile_image_url, u.avatar_url,
        pr.actual_out_at, pr.actual_in_at, pr.review_status pirep_status,
        a.source assignment_source, TRUE unscheduled_assignment
      FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
      JOIN airdash.pilots p ON p.discord_id=a.discord_id
      JOIN airdash.users u ON u.discord_id=a.discord_id
      LEFT JOIN airdash.pireps pr ON pr.assignment_id=a.id
      WHERE a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED') AND a.schedule_id IS NULL
    )
    SELECT * FROM (
      SELECT * FROM scheduled_rows
      UNION ALL
      SELECT * FROM active_assignment_rows
    ) rows
    ORDER BY dep_time
    LIMIT 160`)
  res.json({ schedule: result.rows })
})

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1")
    res.json({ ok: true, database: true })
  } catch {
    res.status(503).json({ ok: false, database: false })
  }
})

app.get("/public", async (_req, res) => {
  const [aircraft, routes, bases, pilots] = await Promise.all([
    pool.query("SELECT registration, fleet_number, aircraft_type, status, status_reason, status_until, current_airport, current_gate, livery_url, livery_sha256, livery_msfs2020_url, livery_msfs2020_sha256, livery_name, special_livery, thumbnail_url, total_block_minutes, total_cycles, livery_download_count, livery_msfs2020_download_count FROM airdash.aircraft ORDER BY fleet_number"),
    pool.query("SELECT id, flight_number, origin, destination, block_minutes, days FROM airdash.routes WHERE status='ACTIVE' ORDER BY flight_number"),
    pool.query("SELECT code, name, lat, lon, role FROM airdash.bases WHERE is_active=TRUE ORDER BY sort_order, code"),
    pool.query(`SELECT p.discord_id, p.pilot_number, p.display_name, p.base_code, p.rank_name, p.leadership_title,
        p.profile_image_url, p.total_flights, p.total_block_minutes, p.joined_at, u.avatar_url
      FROM airdash.pilots p JOIN airdash.users u USING(discord_id)
      WHERE p.status='ACTIVE' AND p.public_profile_enabled=TRUE ORDER BY p.pilot_number`),
  ])
  const top = await pool.query("SELECT discord_id, display_name, total_block_minutes FROM airdash.pilots WHERE total_block_minutes > 0 ORDER BY total_block_minutes DESC LIMIT 1")
  res.json({ aircraft: aircraft.rows, routes: routes.rows, bases: bases.rows, pilots: pilots.rows, topPilot: top.rows[0] ?? null })
})

app.get("/news", async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit ?? "12"), 10) || 12))
  const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? "0"), 10) || 0)
  const query = clean(req.query.q, 100)
  const kind = clean(req.query.kind, 30).toUpperCase()
  const values = []
  const filters = ["is_public=TRUE", "published_at IS NOT NULL", "published_at<=NOW()", "slug IS NOT NULL"]
  if (query) { values.push(`%${query}%`); filters.push(`(title ILIKE $${values.length} OR summary ILIKE $${values.length} OR body ILIKE $${values.length})`) }
  if (kind) { values.push(kind); filters.push(`kind=$${values.length}`) }
  const where = `WHERE ${filters.join(" AND ")}`
  const pageValues = [...values, limit, offset]
  const [items, count, kinds] = await Promise.all([
    pool.query(`SELECT id,kind,title,summary,slug,hero_image_url,author_name,published_at FROM airdash.org_updates ${where}
      ORDER BY published_at DESC,id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, pageValues),
    pool.query(`SELECT COUNT(*)::int total FROM airdash.org_updates ${where}`, values),
    pool.query("SELECT DISTINCT kind FROM airdash.org_updates WHERE is_public=TRUE AND published_at<=NOW() ORDER BY kind"),
  ])
  res.setHeader("Cache-Control", "public, max-age=60")
  res.json({ releases: items.rows, total: count.rows[0]?.total ?? 0, kinds: kinds.rows.map(row => row.kind), limit, offset })
})

app.get("/news/:slug", async (req, res) => {
  const slug = newsSlug(req.params.slug)
  if (!slug || slug !== req.params.slug) return res.status(404).json({ error: "Press release not found" })
  const result = await pool.query(`SELECT id,kind,title,summary,body,slug,hero_image_url,author_name,published_at
    FROM airdash.org_updates WHERE slug=$1 AND is_public=TRUE AND published_at IS NOT NULL AND published_at<=NOW()`, [slug])
  if (!result.rows[0]) return res.status(404).json({ error: "Press release not found" })
  res.setHeader("Cache-Control", "public, max-age=60")
  res.json({ release: result.rows[0] })
})

async function activeBaseCodes() {
  const result = await pool.query("SELECT code FROM airdash.bases WHERE is_active=TRUE")
  return result.rows.map(row => row.code)
}

app.get("/hub-health", async (_req, res) => {
  const [bases, aircraft, flights] = await Promise.all([
    pool.query("SELECT code, name, lat, lon, role FROM airdash.bases WHERE is_active=TRUE ORDER BY sort_order, code"),
    pool.query("SELECT current_airport, COUNT(*)::int n FROM airdash.aircraft WHERE status <> 'RETIRED' GROUP BY current_airport"),
    pool.query(`SELECT r.origin, COALESCE(p.actual_destination, p.reposition_airport, r.destination) destination, p.reviewed_at
      FROM airdash.pireps p JOIN airdash.assignments a ON a.id=p.assignment_id JOIN airdash.routes r ON r.id=a.route_id
      WHERE p.review_status='APPROVED' AND p.reviewed_at > NOW() - INTERVAL '60 days'`),
  ])
  const now = Date.now(), day = 86400000
  const acByAirport = Object.fromEntries(aircraft.rows.map(r => [r.current_airport, r.n]))
  const touch = {}
  for (const f of flights.rows) {
    const bucket = (now - new Date(f.reviewed_at).getTime()) / day <= 30 ? "recent" : "prev"
    for (const ap of [f.origin, f.destination]) { (touch[ap] ??= { recent: 0, prev: 0 })[bucket]++ }
  }
  const baseCodes = new Set(bases.rows.map(b => b.code))
  const baseHealth = bases.rows.map(b => {
    const t = touch[b.code] ?? { recent: 0, prev: 0 }
    const capacity = acByAirport[b.code] ?? 0
    const demand = t.recent
    const growth = t.prev > 0 ? (t.recent - t.prev) / t.prev : (t.recent > 0 ? 1 : 0)
    const forecast = Math.max(0, Math.round(demand * (1 + growth)))
    const perAircraft = capacity > 0 ? demand / capacity : demand
    let status, score, recommendation
    if (capacity === 0) { status = "NO_AIRCRAFT"; score = demand > 0 ? 25 : 55; recommendation = demand > 0 ? "Demand exists but no aircraft are based here. Position an airframe." : "No aircraft and no demand yet." }
    else if (perAircraft >= 8) { status = "UNDER_SERVED"; score = 95; recommendation = "High demand per aircraft. Add capacity to keep up." }
    else if (perAircraft >= 3) { status = "HEALTHY"; score = 82; recommendation = "Demand and capacity are well matched." }
    else if (demand === 0) { status = "DORMANT"; score = 30; recommendation = "No completed flights in 30 days. Consider reducing aircraft or promoting routes." }
    else { status = "OVER_SERVED"; score = 55; recommendation = "Light demand for the based fleet. Some aircraft may be underused." }
    return { ...b, capacity, demand, previous: t.prev, growthPct: Math.round(growth * 100), forecast, perAircraft: Math.round(perAircraft * 10) / 10, status, score, recommendation }
  })
  const candidates = Object.entries(touch)
    .filter(([ap]) => !baseCodes.has(ap))
    .map(([code, t]) => ({ code, recent: t.recent, previous: t.prev, growthPct: t.prev > 0 ? Math.round((t.recent - t.prev) / t.prev * 100) : (t.recent > 0 ? 100 : 0) }))
    .filter(c => c.recent > 0)
    .sort((a, b) => b.recent - a.recent).slice(0, 6)
  const totals = {
    completed30: flights.rows.filter(f => (now - new Date(f.reviewed_at).getTime()) / day <= 30).length,
    completed60: flights.rows.length,
  }
  res.json({ bases: baseHealth, candidates, totals })
})

app.get("/live", async (_req, res) => {
  const result = await pool.query(`SELECT a.id, a.registration, a.status, a.source, a.mission_type, a.recovery_of_assignment_id,
      TO_CHAR(a.flight_date,'YYYY-MM-DD') flight_date, a.booked_at, a.started_at, a.expires_at, a.departure_gate, a.arrival_gate,
      r.flight_number, r.origin, r.destination, r.block_minutes, a.discord_id, p.pilot_number, p.display_name pilot, p.profile_image_url, u.avatar_url
    FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id JOIN airdash.pilots p ON p.discord_id=a.discord_id JOIN airdash.users u ON u.discord_id=a.discord_id
    WHERE a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED') ORDER BY a.booked_at DESC LIMIT 50`)
  res.json({ flights: result.rows })
})

app.get("/profile", requireUser, async (req, res) => {
  await syncUser(req.user)
  const [result, streaks] = await Promise.all([
    pool.query(`SELECT p.*, u.username, u.avatar_url FROM airdash.pilots p JOIN airdash.users u USING(discord_id) WHERE p.discord_id=$1`, [req.user.id]),
    calculatePilotStreaks(pool, req.user.id),
  ])
  if (!result.rows[0]) return res.status(404).json({ error: "An approved pilot account is required" })
  res.json({ profile: result.rows[0], streaks: publicStreaks(streaks) })
})

app.post("/profile", requireUser, async (req, res) => {
  const displayName = clean(req.body.displayName, 60)
  const pronouns = clean(req.body.pronouns, 50)
  const aboutMe = clean(req.body.aboutMe, 1000)
  const imageUrl = clean(req.body.profileImageUrl, 500)
  const requestedBase = clean(req.body.homeBaseRequest, 4).toUpperCase()
  const requestReason = clean(req.body.homeBaseRequestReason, 500)
  const simbriefUsername = clean(req.body.simbriefUsername, 50)
  if (!displayName) return res.status(400).json({ error: "Enter a pilot display name" })
  if (simbriefUsername && !/^[A-Za-z0-9_.-]{2,50}$/.test(simbriefUsername)) return res.status(400).json({ error: "Enter a valid SimBrief username" })
  if (imageUrl && !imageUrl.startsWith("/downloads/profiles/") && (!/^https:\/\//.test(imageUrl) || !URL.canParse(imageUrl))) return res.status(400).json({ error: "Use a valid HTTPS profile image URL" })
  if (requestedBase && !(await activeBaseCodes()).includes(requestedBase)) return res.status(400).json({ error: "Choose an airDash operating base" })
  const result = await pool.query(`UPDATE airdash.pilots SET display_name=$1, profile_image_url=COALESCE(NULLIF($2,''), profile_image_url), pronouns=$3, about_me=$4,
    home_base_request=$5, home_base_request_reason=$6, home_base_requested_at=CASE WHEN $5 <> '' THEN NOW() ELSE NULL END, simbrief_username=NULLIF($7,'') WHERE discord_id=$8 RETURNING *`,
    [displayName, imageUrl || null, pronouns, aboutMe, requestedBase || null, requestReason, simbriefUsername, req.user.id])
  if (!result.rows[0]) return res.status(404).json({ error: "An approved pilot account is required" })
  await audit(req.user.id, "PILOT_PROFILE_UPDATED", "pilot", req.user.id, { requestedBase: requestedBase || null })
  res.json({ profile: result.rows[0] })
})

function liveryPackageSpec(value) {
  const simulator = String(value ?? "2024").toUpperCase().replaceAll("MSFS", "")
  if (simulator === "2020") return { simulator: "MSFS2020", urlColumn: "livery_msfs2020_url", countColumn: "livery_msfs2020_download_count" }
  if (simulator === "2024") return { simulator: "MSFS2024", urlColumn: "livery_url", countColumn: "livery_download_count" }
  return null
}

async function publicLiveryDownload(req, res, simulatorValue = req.params.simulator) {
  const spec = liveryPackageSpec(simulatorValue)
  if (!spec) return res.status(400).json({ error: "Choose MSFS 2020 or MSFS 2024" })
  const registration = clean(req.params.registration, 10).toUpperCase()
  const aircraft = await pool.query(`UPDATE airdash.aircraft
    SET ${spec.countColumn}=${spec.countColumn}+1
    WHERE registration=$1 AND ${spec.urlColumn} LIKE '/downloads/liveries/%'
    RETURNING ${spec.urlColumn} livery_url`, [registration])
  if (!aircraft.rows[0]) return res.status(404).json({ error: "Livery package not found" })
  res.setHeader("Cache-Control", "no-store")
  res.redirect(302, aircraft.rows[0].livery_url)
}

async function authenticatedLiveryDownload(req, res, simulatorValue = req.params.simulator) {
  const spec = liveryPackageSpec(simulatorValue)
  if (!spec) return res.status(400).json({ error: "Choose MSFS 2020 or MSFS 2024" })
  const registration = clean(req.params.registration, 10).toUpperCase()
  const aircraft = await pool.query(`SELECT registration, ${spec.urlColumn} livery_url FROM airdash.aircraft WHERE registration=$1 AND ${spec.urlColumn} IS NOT NULL`, [registration])
  if (!aircraft.rows[0]) return res.status(404).json({ error: "Livery package not found" })
  const result = await pool.query(`WITH download_state AS (
      INSERT INTO airdash.livery_downloads (discord_id, registration, simulator) VALUES ($1,$2,$3)
      ON CONFLICT (discord_id, registration, simulator) DO UPDATE SET downloaded_at=NOW()
    )
    UPDATE airdash.aircraft SET ${spec.countColumn}=${spec.countColumn}+1
    WHERE registration=$2 RETURNING ${spec.countColumn} download_count`, [req.user.id, registration, spec.simulator])
  res.json({ url: aircraft.rows[0].livery_url, downloadCount: result.rows[0].download_count, simulator: spec.simulator })
}

app.get("/liveries/:registration/:simulator/download", (req, res) => publicLiveryDownload(req, res))
app.get("/liveries/:registration/download", (req, res) => publicLiveryDownload(req, res, "2024"))
app.post("/liveries/:registration/:simulator/download", requireUser, (req, res) => authenticatedLiveryDownload(req, res))
app.post("/liveries/:registration/download", requireUser, (req, res) => authenticatedLiveryDownload(req, res, "2024"))

app.post("/profile/liveries/reset", requireUser, async (req, res) => {
  await pool.query("DELETE FROM airdash.livery_downloads WHERE discord_id=$1", [req.user.id])
  res.json({ ok: true })
})

app.post("/profile/image", requireUser, async (req, res) => {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.imageData ?? ""))
  if (!match) return res.status(400).json({ error: "Upload a PNG, JPEG, or WebP image" })
  const buffer = Buffer.from(match[2], "base64")
  if (buffer.length < 128) return res.status(400).json({ error: "The uploaded image is empty" })
  if (buffer.length > 1_500_000) return res.status(400).json({ error: "Profile images are limited to 1.5 MB" })
  const pilot = await pool.query("SELECT 1 FROM airdash.pilots WHERE discord_id=$1", [req.user.id])
  if (!pilot.rows[0]) return res.status(404).json({ error: "An approved pilot account is required" })
  const extension = match[1] === "jpeg" ? "jpg" : match[1]
  const directory = process.env.PROFILE_IMAGE_DIR ?? path.resolve(process.cwd(), "../site/downloads/profiles")
  await fs.mkdir(directory, { recursive: true, mode: 0o755 })
  for (const stale of ["png", "jpg", "webp"].filter(kind => kind !== extension)) {
    await fs.rm(path.join(directory, `${req.user.id}.${stale}`), { force: true })
  }
  const filePath = path.join(directory, `${req.user.id}.${extension}`)
  await fs.writeFile(filePath, buffer, { mode: 0o644 })
  const imageUrl = `/downloads/profiles/${req.user.id}.${extension}?v=${Date.now()}`
  const result = await pool.query("UPDATE airdash.pilots SET profile_image_url=$1 WHERE discord_id=$2 RETURNING *", [imageUrl, req.user.id])
  await audit(req.user.id, "PILOT_PROFILE_IMAGE_UPLOADED", "pilot", req.user.id, { bytes: buffer.length, type: extension })
  res.json({ profile: result.rows[0] })
})

app.get("/pilots", requireUser, async (req, res) => {
  await expireAssignments()
  const access = await pool.query("SELECT 1 FROM airdash.pilots WHERE discord_id=$1 AND status='ACTIVE'", [req.user.id])
  if (!access.rows[0]) return res.status(403).json({ error: "An approved pilot account is required" })
  const result = await pool.query(`SELECT p.discord_id, p.pilot_number, p.display_name, p.base_code, p.rank_name, p.leadership_title, p.pronouns, p.about_me, p.profile_image_url, p.total_flights, p.total_block_minutes, p.missions_completed, p.assignments_completed, p.joined_at,
      (SELECT ROUND(AVG(pr.landing_rate))::int FROM airdash.pireps pr WHERE pr.discord_id=p.discord_id AND pr.review_status='APPROVED' AND pr.landing_rate IS NOT NULL AND pr.landing_rate <> 0) average_landing_rate,
      u.username, u.avatar_url,
      a.registration active_registration, a.status active_status, r.flight_number active_flight_number, r.origin active_origin, r.destination active_destination
    FROM airdash.pilots p JOIN airdash.users u USING(discord_id)
    LEFT JOIN airdash.assignments a ON a.discord_id=p.discord_id AND a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED')
    LEFT JOIN airdash.routes r ON r.id=a.route_id
    WHERE p.status='ACTIVE' ORDER BY p.pilot_number`)
  const pilots = await Promise.all(result.rows.map(async pilot => ({
    ...pilot,
    streaks: publicStreaks(await calculatePilotStreaks(pool, pilot.discord_id)),
  })))
  res.json({ pilots })
})

app.get("/pilots/:id", requireUser, async (req, res) => {
  const access = await pool.query("SELECT 1 FROM airdash.pilots WHERE discord_id=$1 AND status='ACTIVE'", [req.user.id])
  if (!access.rows[0]) return res.status(403).json({ error: "An approved pilot account is required" })
  const pilot = await pool.query(`SELECT p.discord_id, p.pilot_number, p.display_name, p.base_code, p.rank_name, p.leadership_title, p.pronouns, p.about_me, p.profile_image_url, p.total_flights, p.total_block_minutes, p.missions_completed, p.assignments_completed, p.joined_at,
      (SELECT ROUND(AVG(pr.landing_rate))::int FROM airdash.pireps pr WHERE pr.discord_id=p.discord_id AND pr.review_status='APPROVED' AND pr.landing_rate IS NOT NULL AND pr.landing_rate <> 0) average_landing_rate,
      u.username, u.avatar_url,
      a.registration active_registration, a.status active_status, r.flight_number active_flight_number, r.origin active_origin, r.destination active_destination
    FROM airdash.pilots p JOIN airdash.users u USING(discord_id)
    LEFT JOIN airdash.assignments a ON a.discord_id=p.discord_id AND a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED')
    LEFT JOIN airdash.routes r ON r.id=a.route_id
    WHERE p.discord_id=$1`, [req.params.id])
  if (!pilot.rows[0]) return res.status(404).json({ error: "Pilot not found" })
  const [flights, streaks] = await Promise.all([
    pool.query(`SELECT r.flight_number, r.origin, r.destination, a.registration, pr.actual_out_at, pr.actual_in_at, pr.landing_rate, pr.reviewed_at
      FROM airdash.pireps pr JOIN airdash.assignments a ON a.id=pr.assignment_id JOIN airdash.routes r ON r.id=a.route_id
      WHERE pr.discord_id=$1 AND pr.review_status='APPROVED' ORDER BY pr.actual_out_at DESC LIMIT 20`, [req.params.id]),
    calculatePilotStreaks(pool, req.params.id),
  ])
  res.json({ pilot: { ...pilot.rows[0], streaks: publicStreaks(streaks) }, flights: flights.rows })
})

app.get("/missions", requireUser, async (req, res) => {
  await expireAssignments()
  const pilot = await pool.query("SELECT * FROM airdash.pilots WHERE discord_id=$1 AND status='ACTIVE'", [req.user.id])
  if (!pilot.rows[0]) return res.status(403).json({ error: "An approved pilot account is required" })
  const last = await pool.query(`SELECT a.id assignment_id, a.registration, a.flight_date, r.flight_number, r.origin,
      r.destination planned_destination, r.block_minutes, p.outcome_type, p.progress_ratio, p.reposition_airport,
      COALESCE(p.actual_destination, p.reposition_airport, r.destination) destination,
      recovery.status recovery_status
    FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
    JOIN airdash.pireps p ON p.assignment_id=a.id
    LEFT JOIN LATERAL (SELECT ra.status FROM airdash.assignments ra WHERE ra.recovery_of_assignment_id=a.id ORDER BY ra.id DESC LIMIT 1) recovery ON TRUE
    WHERE a.discord_id=$1 AND a.status IN ('COMPLETED','DIVERTED') AND p.review_status='APPROVED'
    ORDER BY a.booked_at DESC LIMIT 1`, [req.user.id])
  const lastFlight = last.rows[0] ?? null
  let aircraft = null
  let fallback = false
  if (lastFlight) {
    const preferred = await pool.query("SELECT * FROM airdash.aircraft WHERE registration=$1 AND status='AVAILABLE'", [lastFlight.registration])
    aircraft = preferred.rows[0] ?? null
    fallback = !aircraft
  }
  if (!aircraft) {
    const location = lastFlight?.destination ?? pilot.rows[0].base_code
    const nearby = await pool.query("SELECT * FROM airdash.aircraft WHERE status='AVAILABLE' AND current_airport=$1 ORDER BY fleet_number LIMIT 1", [location])
    aircraft = nearby.rows[0] ?? null
    if (!aircraft) {
      const anywhere = await pool.query("SELECT * FROM airdash.aircraft WHERE status='AVAILABLE' ORDER BY fleet_number LIMIT 1")
      aircraft = anywhere.rows[0] ?? null
    }
  }
  let suggestions = aircraft
    ? (await pool.query("SELECT id, flight_number, origin, destination, block_minutes, days, 'STANDARD' mission_type FROM airdash.routes WHERE status='ACTIVE' AND origin=$1 ORDER BY flight_number", [aircraft.current_airport])).rows
    : []
  let recoveryMission = null
  if (lastFlight && aircraft) {
    const recoveryRoute = await pool.query(`SELECT id,flight_number FROM airdash.routes
      WHERE origin=$1 AND destination=$2 AND status='INACTIVE' AND days='Recovery ferry' LIMIT 1`, [lastFlight.destination, lastFlight.planned_destination])
    recoveryMission = buildRecoveryMission(lastFlight, aircraft, recoveryRoute.rows[0] ?? null)
    if (recoveryMission) suggestions = [recoveryMission, ...suggestions.filter(route => route.destination !== recoveryMission.destination)]
  }
  const flown = await pool.query("SELECT DISTINCT COALESCE(pr.actual_destination, pr.reposition_airport, r.destination) destination FROM airdash.pireps pr JOIN airdash.assignments a ON a.id=pr.assignment_id JOIN airdash.routes r ON r.id=a.route_id WHERE pr.discord_id=$1 AND pr.review_status='APPROVED'", [req.user.id])
  res.json({ lastFlight, aircraft, suggestions, recoveryMission, fallback, flownDestinations: flown.rows.map(r => r.destination) })
})

app.post("/missions/recovery", requireUser, async (req, res) => {
  if (!isDate(req.body.flightDate)) return res.status(400).json({ error: "Use a valid flight date" })
  const sourceAssignmentId = Number(req.body.sourceAssignmentId)
  if (!Number.isInteger(sourceAssignmentId) || sourceAssignmentId <= 0) return res.status(400).json({ error: "Choose a valid recovery mission" })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const pilot = await client.query("SELECT * FROM airdash.pilots WHERE discord_id=$1 AND status='ACTIVE' FOR UPDATE", [req.user.id])
    if (!pilot.rows[0]) throw Object.assign(new Error("An approved pilot account is required"), { status: 403 })
    const active = await client.query("SELECT id FROM airdash.assignments WHERE discord_id=$1 AND status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED') FOR UPDATE", [req.user.id])
    if (active.rows[0]) throw Object.assign(new Error("Cancel or complete the current assignment before booking the recovery ferry"), { status: 409 })
    const source = await client.query(`SELECT a.*, r.destination planned_destination, r.block_minutes original_block_minutes,
        COALESCE(p.actual_destination,p.reposition_airport,r.destination) recovery_origin, p.outcome_type, p.progress_ratio
      FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id JOIN airdash.pireps p ON p.assignment_id=a.id
      WHERE a.id=$1 AND a.discord_id=$2 AND a.status='DIVERTED' AND p.review_status='APPROVED'
        AND p.outcome_type IN ('DIVERTED','INCOMPLETE') FOR UPDATE OF a,p`, [sourceAssignmentId, req.user.id])
    const sourceRow = source.rows[0]
    if (!sourceRow) throw Object.assign(new Error("This diversion no longer has an open recovery mission"), { status: 404 })
    const laterUse = await client.query(`SELECT id FROM airdash.assignments WHERE registration=$1 AND id<>$2 AND booked_at>$3
      AND (recovery_of_assignment_id IS NULL OR recovery_of_assignment_id<>$2) AND status NOT IN ('CANCELLED','EXPIRED') LIMIT 1`, [sourceRow.registration, sourceRow.id, sourceRow.booked_at])
    if (laterUse.rows[0]) throw Object.assign(new Error("The aircraft has already moved since this diversion"), { status: 409 })
    const existingClosed = await client.query(`SELECT a.*,r.flight_number,r.origin,r.destination,r.block_minutes FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
      WHERE a.recovery_of_assignment_id=$1 AND a.status NOT IN ('CANCELLED','EXPIRED') ORDER BY a.id DESC LIMIT 1 FOR UPDATE OF a`, [sourceRow.id])
    if (existingClosed.rows[0]) {
      if (["BOOKED", "ACTIVE", "PIREP_SUBMITTED"].includes(existingClosed.rows[0].status)) {
        await client.query("COMMIT")
        return res.json({ assignment: existingClosed.rows[0], existing: true })
      }
      throw Object.assign(new Error("This recovery ferry has already been completed"), { status: 409 })
    }
    const origin = String(sourceRow.recovery_origin ?? "").toUpperCase()
    const destination = String(sourceRow.planned_destination ?? "").toUpperCase()
    const aircraft = await client.query("SELECT * FROM airdash.aircraft WHERE registration=$1 FOR UPDATE", [sourceRow.registration])
    if (!aircraft.rows[0] || aircraft.rows[0].status !== "AVAILABLE" || aircraft.rows[0].current_airport !== origin) {
      throw Object.assign(new Error("The diverted aircraft is no longer available at the recovery airport"), { status: 409 })
    }
    const blockMinutes = estimateRecoveryBlockMinutes(sourceRow.original_block_minutes, sourceRow.progress_ratio)
    const route = await ensureRecoveryRoute(client, { sourceAssignmentId: sourceRow.id, origin, destination, blockMinutes })
    const occupiedDepartures = await client.query(`SELECT a.departure_gate FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
      WHERE r.origin=$1 AND a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED') AND a.departure_gate IS NOT NULL`, [origin])
    const occupiedArrivals = await client.query(`SELECT a.arrival_gate FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
      WHERE r.destination=$1 AND a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED') AND a.arrival_gate IS NOT NULL`, [destination])
    const departureGate = await selectAircraftGate(client, origin, `recovery:${sourceRow.id}:${req.body.flightDate}:departure`, aircraft.rows[0].current_gate, sourceRow.registration)
    const arrivalGate = selectGate(destination, `recovery:${sourceRow.id}:${req.body.flightDate}:arrival`, occupiedArrivals.rows.map(row => row.arrival_gate))
    if (!departureGate || !arrivalGate) throw Object.assign(new Error("Could not assign both recovery gates"), { status: 409 })
    const cancelled = await client.query("SELECT id FROM airdash.assignments WHERE recovery_of_assignment_id=$1 AND status IN ('CANCELLED','EXPIRED') ORDER BY id DESC LIMIT 1 FOR UPDATE", [sourceRow.id])
    const assignment = cancelled.rows[0]
      ? await client.query(`UPDATE airdash.assignments SET route_id=$1,flight_date=$2,registration=$3,status='BOOKED',booked_at=NOW(),started_at=NULL,
          cancelled_at=NULL,cancelled_by=NULL,cancellation_code=NULL,cancellation_reason=NULL,expires_at=NOW()+make_interval(mins=>$4+150),
          departure_gate=$5,arrival_gate=$6,tail_number=$7,simbrief_url=NULL,simbrief_format=NULL,flight_plan=NULL,
          volanta_tracking_consent=TRUE,file_vatsim=FALSE,source='MISSION',mission_type='RECOVERY' WHERE id=$8 RETURNING *`,
        [route.id, req.body.flightDate, sourceRow.registration, blockMinutes, departureGate, arrivalGate, sourceRow.registration.slice(1,4), cancelled.rows[0].id])
      : await client.query(`INSERT INTO airdash.assignments
          (route_id,flight_date,discord_id,registration,status,expires_at,departure_gate,arrival_gate,tail_number,
           volanta_tracking_consent,file_vatsim,source,mission_type,recovery_of_assignment_id)
          VALUES ($1,$2,$3,$4,'BOOKED',NOW()+make_interval(mins=>$5+150),$6,$7,$8,TRUE,FALSE,'MISSION','RECOVERY',$9) RETURNING *`,
        [route.id, req.body.flightDate, req.user.id, sourceRow.registration, blockMinutes, departureGate, arrivalGate, sourceRow.registration.slice(1,4), sourceRow.id])
    await client.query("UPDATE airdash.aircraft SET status='ASSIGNED', current_gate=$1 WHERE registration=$2", [departureGate, sourceRow.registration])
    await client.query("COMMIT")
    await audit(req.user.id, "RECOVERY_FERRY_BOOKED", "assignment", assignment.rows[0].id, { sourceAssignmentId: sourceRow.id, registration: sourceRow.registration, origin, destination, passengers: 0, cargo: 0 })
    res.status(cancelled.rows[0] ? 200 : 201).json({ assignment: { ...assignment.rows[0], flight_number: route.flight_number, origin, destination, block_minutes: blockMinutes }, rebooked: Boolean(cancelled.rows[0]) })
  } catch (error) {
    await client.query("ROLLBACK")
    const status = error.code === "23505" ? 409 : error.status ?? 500
    res.status(status).json({ error: status === 500 ? "Recovery ferry could not be booked" : error.message })
  } finally { client.release() }
})

app.get("/me", requireUser, async (req, res) => {
  await expireAssignments()
  await syncUser(req.user)
  const account = await loadAccount(req.user.id)
  res.json({ user: req.user, isOwner: req.user.id === OWNER_ID, ...account })
})

app.get("/org-updates", requireUser, async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? "20"), 10) || 20))
  const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? "0"), 10) || 0)
  const query = clean(req.query.q, 120)
  const kind = clean(req.query.kind, 30).toUpperCase()
  const direction = String(req.query.sort).toLowerCase() === "oldest" ? "ASC" : "DESC"
  if (kind && !ORG_UPDATE_KINDS.has(kind)) return res.status(400).json({ error: "Choose a supported update category" })

  const values = []
  const filters = []
  if (query) {
    values.push(`%${query}%`)
    const parameter = `$${values.length}`
    filters.push(`(o.title ILIKE ${parameter} OR o.body ILIKE ${parameter} OR o.kind ILIKE ${parameter}
      OR p.display_name ILIKE ${parameter} OR p.pilot_number ILIKE ${parameter} OR a.registration ILIKE ${parameter})`)
  }
  if (kind) {
    values.push(kind)
    filters.push(`o.kind=$${values.length}`)
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
  const joins = `FROM airdash.org_updates o
    LEFT JOIN airdash.pilots p ON p.discord_id=o.pilot_discord_id
    LEFT JOIN airdash.aircraft a ON a.registration=o.aircraft_registration`
  const pageValues = [...values, limit, offset]
  const limitParameter = `$${values.length + 1}`
  const offsetParameter = `$${values.length + 2}`
  const [result, count, kinds] = await Promise.all([
    pool.query(`SELECT o.*, p.display_name pilot_name, p.pilot_number, a.registration
      ${joins} ${where}
      ORDER BY o.created_at ${direction}, o.id ${direction}
      LIMIT ${limitParameter} OFFSET ${offsetParameter}`, pageValues),
    pool.query(`SELECT COUNT(*)::int total ${joins} ${where}`, values),
    pool.query("SELECT DISTINCT kind FROM airdash.org_updates ORDER BY kind"),
  ])
  res.json({
    updates: result.rows,
    total: count.rows[0]?.total ?? 0,
    limit,
    offset,
    kinds: kinds.rows.map(row => row.kind),
  })
})

app.post("/admin/org-updates", requireOwner, async (req, res) => {
  const kind = clean(req.body.kind, 30).toUpperCase() || "GENERAL"
  const title = clean(req.body.title, 120)
  const isPublic = Boolean(req.body.isPublic)
  const body = clean(req.body.body, isPublic ? 10000 : 1000)
  const summary = clean(req.body.summary, 320)
  const heroImageUrl = clean(req.body.heroImageUrl, 500)
  const authorName = clean(req.body.authorName, 80) || "Staff Writer"
  if (!ORG_UPDATE_KINDS.has(kind)) return res.status(400).json({ error: "Choose a supported update category" })
  if (!title || !body) return res.status(400).json({ error: "Title and body are required" })
  if (isPublic && !summary) return res.status(400).json({ error: "A public press release requires a summary" })
  if (!validNewsImage(heroImageUrl)) return res.status(400).json({ error: "Use a managed News Hub image or a valid HTTPS image URL" })
  const slug = isPublic ? await uniqueNewsSlug(clean(req.body.slug, 100) || title) : null
  const update = await publishOrgUpdate({ kind, title, body, createdBy: req.user.id, isPublic, slug, summary,
    heroImageUrl: heroImageUrl || null, authorName, publishedAt: isPublic ? new Date() : null,
    pilotDiscordId: clean(req.body.pilotDiscordId, 30) || null,
    aircraftRegistration: clean(req.body.aircraftRegistration, 10).toUpperCase() || null })
  await audit(req.user.id, "ORG_UPDATE_CREATED", "org_update", update.id, { kind, isPublic, slug })
  res.status(201).json({ update })
})

app.post("/applications", requireUser, async (req, res) => {
  await syncUser(req.user)
  const preferredName = clean(req.body.preferredName, 60)
  const vatsimCid = clean(req.body.vatsimCid, 12)
  const baseCode = clean(req.body.baseCode, 4).toUpperCase()
  const simulator = clean(req.body.simulator, 80)
  const experience = clean(req.body.experience, 80)
  const introduction = clean(req.body.introduction, 1000)
  if (!preferredName || !/^\d{4,12}$/.test(vatsimCid) || !(await activeBaseCodes()).includes(baseCode) || !simulator || !experience) {
    return res.status(400).json({ error: "Complete every required application field" })
  }
  const existing = await pool.query("SELECT status FROM airdash.applications WHERE discord_id=$1", [req.user.id])
  if (existing.rows[0] && !["RETURNED", "REJECTED"].includes(existing.rows[0].status)) {
    return res.status(409).json({ error: "An application already exists" })
  }
  const { rows } = await pool.query(`INSERT INTO airdash.applications
    (discord_id, preferred_name, vatsim_cid, base_code, simulator, experience, introduction)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (discord_id) DO UPDATE SET preferred_name=$2, vatsim_cid=$3, base_code=$4,
      simulator=$5, experience=$6, introduction=$7, status='SUBMITTED', reviewer_notes='', updated_at=NOW()
    RETURNING *`, [req.user.id, preferredName, vatsimCid, baseCode, simulator, experience, introduction])
  await audit(req.user.id, "APPLICATION_SUBMITTED", "application", rows[0].id)
  res.status(201).json({ application: rows[0] })
})

app.get("/flights", requireUser, async (req, res) => {
  await expireAssignments()
  await syncUser(req.user)
  const account = await loadAccount(req.user.id)
  const routes = await pool.query(`SELECT r.*, ARRAY_REMOVE(ARRAY_AGG(a.registration) FILTER (WHERE a.status='AVAILABLE' AND a.current_airport=r.origin), NULL) available_aircraft
    FROM airdash.routes r LEFT JOIN airdash.aircraft a ON a.current_airport=r.origin
    WHERE r.status='ACTIVE' GROUP BY r.id ORDER BY r.flight_number`)
  res.json({ routes: routes.rows, ...account })
})

app.post("/assignments", requireUser, async (req, res) => {
  if (!isDate(req.body.flightDate)) return res.status(400).json({ error: "Use a valid flight date" })
  const routeId = Number(req.body.routeId)
  const registration = clean(req.body.registration, 10).toUpperCase()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const pilot = await client.query("SELECT * FROM airdash.pilots WHERE discord_id=$1 AND status='ACTIVE' FOR UPDATE", [req.user.id])
    if (!pilot.rows[0]) throw Object.assign(new Error("An approved pilot account is required"), { status: 403 })
    const route = await client.query("SELECT * FROM airdash.routes WHERE id=$1 AND status='ACTIVE'", [routeId])
    if (!route.rows[0]) throw Object.assign(new Error("Flight not found"), { status: 404 })
    const existing = await client.query(`SELECT * FROM airdash.assignments
      WHERE route_id=$1 AND flight_date=$2 AND discord_id=$3 FOR UPDATE`, [routeId, req.body.flightDate, req.user.id])
    const existingAssignment = existing.rows[0]
    if (existingAssignment && ["BOOKED", "ACTIVE", "PIREP_SUBMITTED"].includes(existingAssignment.status)) {
      await client.query("COMMIT")
      return res.json({ assignment: existingAssignment, existing: true })
    }
    if (existingAssignment?.status === "COMPLETED") {
      throw Object.assign(new Error("This pilot has already completed the selected flight"), { status: 409 })
    }

    const activeAssignment = await client.query(`SELECT id FROM airdash.assignments
      WHERE discord_id=$1 AND status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED') FOR UPDATE`, [req.user.id])
    if (activeAssignment.rows[0]) {
      throw Object.assign(new Error("Cancel or complete the current assignment before booking another flight"), { status: 409 })
    }

    const aircraft = await client.query("SELECT * FROM airdash.aircraft WHERE registration=$1 FOR UPDATE", [registration])
    if (!aircraft.rows[0] || aircraft.rows[0].status !== "AVAILABLE" || aircraft.rows[0].current_airport !== route.rows[0].origin) {
      throw Object.assign(new Error("Aircraft is not available at this origin"), { status: 409 })
    }
    const routeRow = route.rows[0]
    const occupiedDepartures = await client.query(`SELECT a.departure_gate FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
      WHERE r.origin=$1 AND a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED') AND a.departure_gate IS NOT NULL`, [routeRow.origin])
    const occupiedArrivals = await client.query(`SELECT a.arrival_gate FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
      WHERE r.destination=$1 AND a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED') AND a.arrival_gate IS NOT NULL`, [routeRow.destination])
    const previousGate = await client.query(`SELECT a.arrival_gate FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
      WHERE a.registration=$1 AND a.status IN ('COMPLETED','DIVERTED') AND r.destination=$2 AND a.arrival_gate IS NOT NULL ORDER BY a.id DESC LIMIT 1`, [registration, routeRow.origin])
    const occupiedDepartureGates = occupiedDepartures.rows.map(item => item.departure_gate)
    const preferredGate = aircraft.rows[0].current_gate ?? previousGate.rows[0]?.arrival_gate ?? null
    const departureGate = preferredGate && !occupiedDepartureGates.includes(preferredGate)
      ? preferredGate
      : selectGate(routeRow.origin, `${routeId}:${req.body.flightDate}:${registration}:departure`, occupiedDepartureGates)
    const arrivalGate = selectGate(routeRow.destination, `${routeId}:${req.body.flightDate}:${registration}:arrival`, occupiedArrivals.rows.map(item => item.arrival_gate))
    if (!departureGate || !arrivalGate) throw Object.assign(new Error("Could not assign both flight gates"), { status: 409 })
    const gates = { departureGate, arrivalGate }
    const tailNumber = registration.slice(1, 4)
    const result = existingAssignment
      ? await client.query(`UPDATE airdash.assignments SET registration=$1, status='BOOKED', booked_at=NOW(),
          expires_at=NOW() + make_interval(mins => $6 + 150), departure_gate=$2, arrival_gate=$3, tail_number=$4,
          simbrief_url=NULL, simbrief_format=NULL, flight_plan=NULL, started_at=NULL, cancelled_at=NULL, cancelled_by=NULL, cancellation_code=NULL, cancellation_reason=NULL WHERE id=$5 RETURNING *`,
        [registration, gates.departureGate, gates.arrivalGate, tailNumber, existingAssignment.id, routeRow.block_minutes])
      : await client.query(`INSERT INTO airdash.assignments
          (route_id, flight_date, discord_id, registration, departure_gate, arrival_gate, tail_number, expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() + make_interval(mins => $8 + 150)) RETURNING *`,
        [routeId, req.body.flightDate, req.user.id, registration, gates.departureGate, gates.arrivalGate, tailNumber, routeRow.block_minutes])
    await client.query("UPDATE airdash.assignments SET volanta_tracking_consent=TRUE, file_vatsim=$1, source=$2, mission_type='STANDARD', recovery_of_assignment_id=NULL WHERE id=$3", [Boolean(req.body.fileVatsim), ["BOARD", "MISSION", "SCHEDULE"].includes(String(req.body.source)) ? req.body.source : "BOARD", result.rows[0].id])
    await client.query("UPDATE airdash.aircraft SET status='ASSIGNED', current_gate=$1 WHERE registration=$2", [gates.departureGate, registration])
    const scheduleId = Number(req.body.scheduleId)
    if (scheduleId) {
      await client.query("UPDATE airdash.schedule SET status='TAKEN', assignment_id=$1 WHERE id=$2 AND status='OPEN'", [result.rows[0].id, scheduleId])
      await client.query("UPDATE airdash.assignments SET schedule_id=$1 WHERE id=$2", [scheduleId, result.rows[0].id])
    }
    await client.query("COMMIT")
    await audit(req.user.id, existingAssignment ? "ASSIGNMENT_REBOOKED" : "ASSIGNMENT_CREATED", "assignment", result.rows[0].id, { registration, routeId })
    res.status(existingAssignment ? 200 : 201).json({ assignment: result.rows[0], rebooked: Boolean(existingAssignment) })
  } catch (error) {
    await client.query("ROLLBACK")
    const status = error.code === "23505" ? 409 : error.status ?? 500
    const message = error.code === "23505" ? "The selected aircraft or pilot now has an active assignment. Refresh the flight board and try again." : error.message
    res.status(status).json({ error: status === 500 ? "Assignment could not be created" : message })
  } finally {
    client.release()
  }
})

app.post("/assignments/:id/cancel", requireUser, async (req, res) => {
  const reasonCode = clean(req.body.reasonCode, 40).toUpperCase()
  const details = clean(req.body.details, 300)
  const reasonLabel = ASSIGNMENT_CANCEL_REASONS.get(reasonCode)
  if (!reasonLabel) return res.status(400).json({ error: "Choose a cancellation reason" })
  if (reasonCode === "OTHER" && !details) return res.status(400).json({ error: "Describe the cancellation reason" })
  const reason = details ? `${reasonLabel}: ${details}` : reasonLabel
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const assignment = await client.query(`SELECT a.*, s.dep_time schedule_departure
      FROM airdash.assignments a
      LEFT JOIN airdash.schedule s ON s.id=a.schedule_id
      WHERE a.id=$1 AND a.discord_id=$2 AND a.status IN ('BOOKED','ACTIVE')
      FOR UPDATE OF a`, [req.params.id, req.user.id])
    if (!assignment.rows[0]) throw Object.assign(new Error("Only your booked or flying assignment can be cancelled"), { status: 404 })
    const row = assignment.rows[0]
    const result = await client.query(`UPDATE airdash.assignments
      SET status='CANCELLED', cancelled_at=NOW(), cancelled_by=$2, cancellation_code=$3, cancellation_reason=$4
      WHERE id=$1 RETURNING *`, [row.id, req.user.id, reasonCode, reason])
    await client.query("UPDATE airdash.aircraft SET status='AVAILABLE' WHERE registration=$1 AND status='ASSIGNED'", [row.registration])
    if (row.schedule_id) {
      const canReopen = row.status === "BOOKED" && row.schedule_departure && new Date(row.schedule_departure) > new Date()
      if (canReopen) await client.query("UPDATE airdash.schedule SET status='OPEN', assignment_id=NULL WHERE id=$1", [row.schedule_id])
      else await client.query("UPDATE airdash.schedule SET status='DEPARTED' WHERE id=$1", [row.schedule_id])
    }
    await client.query("COMMIT")
    await audit(req.user.id, "ASSIGNMENT_CANCELLED", "assignment", row.id, { reasonCode, reason, previousStatus: row.status, registration: row.registration })
    res.json({ assignment: result.rows[0] })
  } catch (error) {
    await client.query("ROLLBACK")
    res.status(error.status ?? 500).json({ error: error.status ? error.message : "Flight could not be cancelled" })
  } finally { client.release() }
})

app.delete("/assignments/:id", requireUser, async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const result = await client.query(`UPDATE airdash.assignments SET status='CANCELLED', cancelled_at=NOW(), cancelled_by=$2, cancellation_code='OTHER', cancellation_reason='Cancelled by pilot'
      WHERE id=$1 AND discord_id=$2 AND status='BOOKED' RETURNING registration`, [req.params.id, req.user.id])
    if (!result.rows[0]) throw Object.assign(new Error("Only an active booked flight can be cancelled"), { status: 404 })
    await client.query("UPDATE airdash.aircraft SET status='AVAILABLE' WHERE registration=$1", [result.rows[0].registration])
    await client.query("COMMIT")
    await audit(req.user.id, "ASSIGNMENT_CANCELLED", "assignment", req.params.id, { reason: "Cancelled by pilot" })
    res.json({ ok: true })
  } catch (error) {
    await client.query("ROLLBACK")
    res.status(error.status ?? 500).json({ error: error.status ? error.message : "Booking could not be cancelled" })
  } finally { client.release() }
})

app.post("/assignments/:id/start", requireUser, async (req, res) => {
  const result = await pool.query(`UPDATE airdash.assignments a
    SET status='ACTIVE', started_at=NOW(), expires_at=NOW() + make_interval(mins => r.block_minutes + 150)
    FROM airdash.routes r
    WHERE a.route_id=r.id AND a.id=$1 AND a.discord_id=$2 AND a.status='BOOKED'
    RETURNING a.*`, [req.params.id, req.user.id])
  if (!result.rows[0]) return res.status(404).json({ error: "Only your booked flight can be started" })
  await audit(req.user.id, "ASSIGNMENT_STARTED", "assignment", req.params.id, { startedAt: result.rows[0].started_at })
  res.json({ assignment: result.rows[0] })
})

app.post("/assignments/:id/volanta", requireUser, async (req, res) => {
  try {
    const assignment = await pool.query(`SELECT a.*, r.origin, r.destination FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id WHERE a.id=$1 AND a.discord_id=$2 AND a.status IN ('BOOKED','ACTIVE')`, [req.params.id, req.user.id])
    const row = assignment.rows[0]
    if (!row) return res.status(404).json({ error: "Assignment not found" })
    if (!row.volanta_tracking_consent) return res.status(400).json({ error: "Enable Volanta tracking consent before linking a flight" })
    const flight = await importVolanta(clean(req.body.url, 500))
    if (flight.origin !== row.origin || flight.destination !== row.destination || flight.aircraftRegistration !== row.registration) return res.status(400).json({ error: "Volanta flight must match the assigned route and aircraft" })
    const updated = await pool.query("UPDATE airdash.assignments SET volanta_tracking_url=$1, volanta_tracking_data=$2, volanta_last_synced_at=NOW() WHERE id=$3 RETURNING *", [flight.sourceUrl, flight, row.id])
    await audit(req.user.id, "VOLANTA_TRACKING_LINKED", "assignment", row.id, { flightId: flight.flightId })
    res.json({ assignment: updated.rows[0], flight })
  } catch (error) { res.status(error.status ?? 500).json({ error: error.status ? error.message : "Volanta tracking could not be linked" }) }
})

app.post("/assignments/:id/gates", requireUser, async (req, res) => {
  const result = await pool.query(`SELECT a.*, r.origin, r.destination FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
    WHERE a.id=$1 AND a.discord_id=$2 AND a.status='BOOKED'`, [req.params.id, req.user.id])
  if (!result.rows[0]) return res.status(404).json({ error: "Booked assignment not found" })
  const row = result.rows[0]
  const gates = generateGates(row.origin, row.destination, `${row.id}:${row.registration}:${Date.now()}`)
  if (!gates.departureGate || !gates.arrivalGate) return res.status(409).json({ error: "Could not assign both flight gates" })
  const updated = await pool.query("UPDATE airdash.assignments SET departure_gate=$1, arrival_gate=$2 WHERE id=$3 RETURNING *", [gates.departureGate, gates.arrivalGate, row.id])
  await pool.query("UPDATE airdash.aircraft SET current_gate=$1 WHERE registration=$2", [gates.departureGate, row.registration])
  await audit(req.user.id, "ASSIGNMENT_GATES_GENERATED", "assignment", row.id, gates)
  res.json({ assignment: updated.rows[0] })
})

app.post("/assignments/:id/simbrief", requireUser, async (req, res) => {
  try {
    const assignment = await pool.query(`SELECT a.*, r.origin, r.destination FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
      WHERE a.id=$1 AND a.discord_id=$2 AND a.status IN ('BOOKED','ACTIVE')`, [req.params.id, req.user.id])
    if (!assignment.rows[0]) return res.status(404).json({ error: "Assignment not found" })
    const row = assignment.rows[0]
    const registration = clean(req.body.registration, 10).toUpperCase()
    const tailNumber = clean(req.body.tailNumber, 3)
    if (registration !== row.registration || tailNumber !== row.registration.slice(1, 4)) return res.status(400).json({ error: "Registration and three-digit tail number must match the assignment" })
    const plan = await importSimBrief(clean(req.body.url, 500))
    if (plan.origin !== row.origin || plan.destination !== row.destination) return res.status(400).json({ error: `SimBrief route ${plan.origin}-${plan.destination} does not match ${row.origin}-${row.destination}` })
    if (plan.aircraftIcao !== "BCS3") return res.status(400).json({ error: "SimBrief aircraft type must be BCS3" })
    if (row.mission_type === "RECOVERY" && !recoveryPayloadIsValid(plan)) return res.status(400).json({ error: "Recovery ferry OFP must use 0 passengers and 0 cargo" })
    const updated = await pool.query(`UPDATE airdash.assignments SET simbrief_url=$1, simbrief_format=$2, flight_plan=$3, tail_number=$4 WHERE id=$5 RETURNING *`, [plan.sourceUrl, plan.format, plan, tailNumber, row.id])


    await audit(req.user.id, "SIMBRIEF_IMPORTED", "assignment", row.id, { origin: plan.origin, destination: plan.destination, format: plan.format })
    res.json({ assignment: updated.rows[0], plan })
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.status ? error.message : "SimBrief import failed" })
  }
})

app.post("/assignments/:id/arrival-gate", requireUser, async (req, res) => {
  const result = await pool.query(`SELECT a.*, r.destination FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
    WHERE a.id=$1 AND a.discord_id=$2 AND a.status='BOOKED'`, [req.params.id, req.user.id])
  if (!result.rows[0]) return res.status(404).json({ error: "Booked assignment not found" })
  const row = result.rows[0]
  const occupied = await pool.query(`SELECT a.arrival_gate FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
    WHERE a.id<>$1 AND r.destination=$2 AND a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED') AND a.arrival_gate IS NOT NULL`, [row.id, row.destination])
  const excluded = [row.arrival_gate, ...occupied.rows.map(item => item.arrival_gate)].filter(Boolean)
  const arrivalGate = selectGate(row.destination, `${row.id}:arrival:conflict:${Date.now()}`, excluded)
  if (!arrivalGate) return res.status(409).json({ error: `No alternate gate is available at ${row.destination}` })
  const updated = await pool.query("UPDATE airdash.assignments SET arrival_gate=$1 WHERE id=$2 RETURNING *", [arrivalGate, row.id])
  await audit(req.user.id, "ARRIVAL_GATE_REASSIGNED", "assignment", row.id, { airport: row.destination, from: row.arrival_gate, to: arrivalGate })
  res.json({ assignment: updated.rows[0], previousGate: row.arrival_gate, arrivalGate })
})
app.post("/assignments/:id/departure-gate", requireUser, async (req, res) => {
  const result = await pool.query(`SELECT a.*, r.origin FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
    WHERE a.id=$1 AND a.discord_id=$2 AND a.status='BOOKED'`, [req.params.id, req.user.id])
  if (!result.rows[0]) return res.status(404).json({ error: "Booked assignment not found" })
  const row = result.rows[0]
  const occupied = await pool.query(`SELECT a.departure_gate FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
    WHERE a.id<>$1 AND r.origin=$2 AND a.status IN ('BOOKED','ACTIVE','PIREP_SUBMITTED') AND a.departure_gate IS NOT NULL`, [row.id, row.origin])
  const excluded = [row.departure_gate, ...occupied.rows.map(item => item.departure_gate)].filter(Boolean)
  const departureGate = selectGate(row.origin, `${row.id}:departure:conflict:${Date.now()}`, excluded)
  if (!departureGate) return res.status(409).json({ error: `No alternate gate is configured at ${row.origin}` })
  const updated = await pool.query("UPDATE airdash.assignments SET departure_gate=$1 WHERE id=$2 RETURNING *", [departureGate, row.id])
  await pool.query("UPDATE airdash.aircraft SET current_gate=$1 WHERE registration=$2", [departureGate, row.registration])
  await audit(req.user.id, "DEPARTURE_GATE_REASSIGNED", "assignment", row.id, { airport: row.origin, from: row.departure_gate, to: departureGate })
  res.json({ assignment: updated.rows[0], previousGate: row.departure_gate, departureGate })
})

app.post("/assignments/:id/simbrief-fetch", requireUser, async (req, res) => {
  try {
    const assignment = await pool.query(`SELECT a.*, r.origin, r.destination FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
      WHERE a.id=$1 AND a.discord_id=$2 AND a.status IN ('BOOKED','ACTIVE')`, [req.params.id, req.user.id])
    if (!assignment.rows[0]) return res.status(404).json({ error: "Assignment not found" })
    const row = assignment.rows[0]
    const pilot = await pool.query("SELECT simbrief_username FROM airdash.pilots WHERE discord_id=$1", [req.user.id])
    const username = pilot.rows[0]?.simbrief_username
    if (!username) return res.status(400).json({ error: "Set your SimBrief username in your profile first" })
    const tailNumber = row.registration.slice(1, 4)
    const plan = await importSimBriefByUsername(username)
    if (plan.origin !== row.origin || plan.destination !== row.destination) return res.status(400).json({ error: `Your latest SimBrief OFP is ${plan.origin}-${plan.destination}, not ${row.origin}-${row.destination}. Generate this route in SimBrief first.` })
    if (plan.aircraftIcao !== "BCS3") return res.status(400).json({ error: "Your latest SimBrief OFP is not a BCS3. Generate this route in SimBrief first." })
    if (row.mission_type === "RECOVERY" && !recoveryPayloadIsValid(plan)) return res.status(400).json({ error: "Your recovery ferry OFP must use 0 passengers and 0 cargo. Generate it from the Hangar link first." })
    const updated = await pool.query(`UPDATE airdash.assignments SET simbrief_url=$1, simbrief_format=$2, flight_plan=$3, tail_number=$4 WHERE id=$5 RETURNING *`, [plan.sourceUrl, plan.format, plan, tailNumber, row.id])
    await audit(req.user.id, "SIMBRIEF_FETCHED", "assignment", row.id, { origin: plan.origin, destination: plan.destination, format: plan.format })
    res.json({ assignment: updated.rows[0], plan })
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.status ? error.message : "SimBrief fetch failed" })
  }
})

app.get("/assignments/:id/simbrief-generate", requireUser, async (req, res) => {
  const assignment = await pool.query(`SELECT a.*, r.flight_number, r.origin, r.destination FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
    WHERE a.id=$1 AND a.discord_id=$2 AND a.status IN ('BOOKED','ACTIVE')`, [req.params.id, req.user.id])
  const row = assignment.rows[0]
  if (!row) return res.status(404).json({ error: "Assignment not found" })
  const airframe = process.env.SIMBRIEF_AIRFRAME || "BCS3"
  const params = new URLSearchParams(buildSimBriefDispatchParams(row, airframe))
  res.json({ url: `https://dispatch.simbrief.com/options/custom?${params.toString()}` })
})

app.post("/volanta/import", requireUser, async (req, res) => {
  try {
    const flight = await importVolanta(clean(req.body.url, 500))
    const assignmentId = Number(req.body.assignmentId)
    if (!assignmentId) return res.json({ flight, analysis: null })
    const assignment = await pool.query(`SELECT a.*, r.origin, r.destination FROM airdash.assignments a
      JOIN airdash.routes r ON r.id=a.route_id
      WHERE a.id=$1 AND a.discord_id=$2 AND a.status IN ('BOOKED','ACTIVE')`, [assignmentId, req.user.id])
    const row = assignment.rows[0]
    if (!row) return res.status(404).json({ error: "Assignment not found" })
    if (flight.origin !== row.origin || flight.destination !== row.destination) return res.status(400).json({ error: `Volanta planned route ${flight.origin}-${flight.destination} does not match ${row.origin}-${row.destination}` })
    if (flight.aircraftRegistration && flight.aircraftRegistration !== row.registration) return res.status(400).json({ error: `Volanta aircraft ${flight.aircraftRegistration} does not match ${row.registration}` })
    const analysis = analyzeFlightOutcome(flight, row)
    if (!analysis.reportable) return res.status(400).json({ error: "Volanta has not recorded a finished flight yet. End the flight in Volanta and wait for its public stats to update." })
    res.json({ flight, analysis })
  } catch (error) { res.status(error.status ?? 500).json({ error: error.status ? error.message : "Volanta import failed" }) }
})
app.get("/pireps", requireUser, async (req, res) => {
  const result = await pool.query(`SELECT p.id, p.review_status, p.review_notes, p.actual_out_at, p.actual_off_at, p.actual_on_at, p.actual_in_at,
      p.landing_rate, p.vatsim_flown, p.network, p.callsign, p.distance_nm, p.fuel_burn, p.remarks, p.submitted_at, p.reviewed_at, p.volanta_url, p.credited_minutes, p.credited_block_minutes, p.base_experience, p.streak_bonus_experience, p.streak_bonus_percent, p.day_streak_at_award, p.continuity_streak_at_award, p.sim_block_seconds, p.real_block_seconds, p.time_compression_ratio, p.time_compression_detected, p.time_compression_reason,
      p.outcome_type, p.diversion_reason_code, p.diversion_details, p.actual_destination, p.reposition_airport, p.reposition_method, p.progress_ratio, p.credit_multiplier,
      a.registration, a.flight_date, a.departure_gate, a.arrival_gate, a.flight_plan, a.source, a.mission_type, r.flight_number, r.origin, r.destination, r.block_minutes
    FROM airdash.pireps p JOIN airdash.assignments a ON a.id=p.assignment_id JOIN airdash.routes r ON r.id=a.route_id
    WHERE p.discord_id=$1 ORDER BY p.submitted_at DESC LIMIT 50`, [req.user.id])
  res.json({ pireps: result.rows })
})

app.get("/admin/notifications", requireOwner, async (req, res) => {
  try {
    const { inserted: _inserted, ...notifications } = await syncNotificationHistory(pool, req.user.id, true)
    res.json(notifications)
  } catch (error) {
    console.error("[airdash-notifications] owner sync failed", error?.message ?? error)
    res.status(500).json({ error: "Notifications could not be loaded" })
  }
})

app.get("/admin/pilots/:id/flights", requireOwner, async (req, res) => {
  const result = await pool.query(`SELECT a.id, a.status, a.flight_date, a.booked_at, a.registration, a.source, a.mission_type,
      r.flight_number, r.origin, r.destination, r.block_minutes,
      p.id pirep_id, p.review_status, p.actual_out_at, p.actual_in_at, p.credited_minutes, p.credited_block_minutes, p.outcome_type, p.reposition_airport, p.reviewed_at
    FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
    LEFT JOIN airdash.pireps p ON p.assignment_id=a.id
    WHERE a.discord_id=$1 ORDER BY a.booked_at DESC`, [req.params.id])
  res.json({ flights: result.rows })
})

app.delete("/admin/assignments/:id", requireOwner, async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const assignment = await client.query("SELECT * FROM airdash.assignments WHERE id=$1", [req.params.id])
    if (!assignment.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Assignment not found" }) }
    const row = assignment.rows[0]
    const pireps = await client.query("SELECT * FROM airdash.pireps WHERE assignment_id=$1", [req.params.id])
    for (const pirep of pireps.rows) {
      if (pirep.review_status === "APPROVED" && pirep.actual_out_at && pirep.actual_in_at) {
        const measuredMinutes = Math.max(1, Math.round((new Date(pirep.actual_in_at) - new Date(pirep.actual_out_at)) / 60000))
        const creditedBlockMinutes = pirep.credited_block_minutes ?? measuredMinutes
        const xp = pirep.credited_minutes ?? creditedBlockMinutes
        const completedOutcome = (pirep.outcome_type ?? PIREP_OUTCOME_TYPES.COMPLETED) === PIREP_OUTCOME_TYPES.COMPLETED
        const isMission = row.source === "MISSION"
        await client.query(`UPDATE airdash.pilots SET total_block_minutes=GREATEST(0,total_block_minutes-$1), experience=GREATEST(0,experience-$2),
          total_flights=GREATEST(0,total_flights-$3), missions_completed=GREATEST(0,missions_completed-$4), assignments_completed=GREATEST(0,assignments_completed-$5)
          WHERE discord_id=$6`, [creditedBlockMinutes, xp, 1, completedOutcome && isMission ? 1 : 0, completedOutcome && !isMission ? 1 : 0, row.discord_id])
      }
    }
    await client.query("DELETE FROM airdash.pireps WHERE assignment_id=$1", [req.params.id])
    await client.query("DELETE FROM airdash.assignments WHERE id=$1", [req.params.id])
    await client.query("COMMIT")
    await audit(req.user.id, "ASSIGNMENT_DELETED", "assignment", req.params.id, { pilot: row.discord_id, hadPirep: pireps.rowCount > 0 })
    res.json({ ok: true })
  } catch (error) {
    await client.query("ROLLBACK")
    res.status(500).json({ error: "Could not delete the flight" })
  } finally {
    client.release()
  }
})

app.post("/admin/pilots/:id/manage", requireOwner, async (req, res) => {
  const baseCode = clean(req.body.baseCode, 4).toUpperCase()
  const status = clean(req.body.status, 12).toUpperCase()
  const pilot = await pool.query("SELECT base_code, status FROM airdash.pilots WHERE discord_id=$1", [req.params.id])
  if (!pilot.rows[0]) return res.status(404).json({ error: "Pilot not found" })
  if (baseCode && !(await activeBaseCodes()).includes(baseCode)) return res.status(400).json({ error: "Choose an active operating base" })
  if (status && !["ACTIVE", "LEAVE", "INACTIVE", "SUSPENDED"].includes(status)) return res.status(400).json({ error: "Invalid pilot status" })
  const result = await pool.query("UPDATE airdash.pilots SET base_code=COALESCE(NULLIF($1,''), base_code), status=COALESCE(NULLIF($2,''), status) WHERE discord_id=$3 RETURNING *", [baseCode, status, req.params.id])
  await audit(req.user.id, "PILOT_MANAGED", "pilot", req.params.id, { baseCode: baseCode || null, status: status || null })
  res.json({ pilot: result.rows[0] })
})

app.post("/admin/pilots/:id/base", requireOwner, async (req, res) => {
  const decision = clean(req.body.decision, 10)
  const pilot = await pool.query("SELECT display_name, base_code, home_base_request FROM airdash.pilots WHERE discord_id=$1", [req.params.id])
  if (!pilot.rows[0]) return res.status(404).json({ error: "Pilot not found" })
  const requested = pilot.rows[0].home_base_request
  if (!requested) return res.status(400).json({ error: "No pending base request" })
  if (decision === "approve") {
    if (!(await activeBaseCodes()).includes(requested)) return res.status(400).json({ error: "The requested base is no longer active" })
    await pool.query("UPDATE airdash.pilots SET base_code=$1, home_base_request=NULL, home_base_request_reason='', home_base_requested_at=NULL WHERE discord_id=$2", [requested, req.params.id])
    await audit(req.user.id, "BASE_REQUEST_APPROVED", "pilot", req.params.id, { from: pilot.rows[0].base_code, to: requested })
  } else {
    await pool.query("UPDATE airdash.pilots SET home_base_request=NULL, home_base_request_reason='', home_base_requested_at=NULL WHERE discord_id=$1", [req.params.id])
    await audit(req.user.id, "BASE_REQUEST_DENIED", "pilot", req.params.id, { requested })
  }
  res.json({ ok: true })
})

async function applyPirepReview(client, reportRow, decision, reviewerId, notes) {
  await client.query("UPDATE airdash.pireps SET review_status=$1, review_notes=$2, reviewed_by=$3, reviewed_at=NOW() WHERE id=$4", [decision, notes ?? "", reviewerId, reportRow.id])
  if (decision === "APPROVED") {
    const outcome = Object.values(PIREP_OUTCOME_TYPES).includes(reportRow.outcome_type) ? reportRow.outcome_type : PIREP_OUTCOME_TYPES.COMPLETED
    const creditMultiplier = outcome === PIREP_OUTCOME_TYPES.COMPLETED ? 1 : Math.min(1, Math.max(0.1, Number(reportRow.credit_multiplier ?? 0.9)))
    const measuredMinutes = Math.max(1, Math.round((new Date(reportRow.actual_in_at) - new Date(reportRow.actual_out_at)) / 60000))
    const operationalMinutes = reportRow.sim_block_seconds ? Math.max(1, Math.round(reportRow.sim_block_seconds / 60)) : measuredMinutes
    const realMinutes = reportRow.real_block_seconds ? Math.max(1, Math.round(reportRow.real_block_seconds / 60)) : measuredMinutes
    const eligibleMinutes = Math.min(operationalMinutes, realMinutes)
    const creditedBlockMinutes = Math.max(1, Math.round(eligibleMinutes * creditMultiplier))
    const completedOutcome = outcome === PIREP_OUTCOME_TYPES.COMPLETED
    const missionCompleted = completedOutcome && reportRow.source === "MISSION"
    const assignmentCompleted = completedOutcome && reportRow.source !== "MISSION"
    const experienceMultiplier = assignmentExperienceMultiplier({ source: reportRow.source, missionType: reportRow.mission_type, completedOutcome, creditedBlockMinutes })
    const baseExperience = Math.round(creditedBlockMinutes * experienceMultiplier)
    const streaks = await calculatePilotStreaks(client, reportRow.discord_id)
    const awardStreaks = streaks.awards[String(reportRow.id)] ?? { flightDays: 1, continuity: 1 }
    const award = applyStreakBonus(baseExperience, awardStreaks.flightDays)
    const xp = award.totalExperience
    await client.query(`UPDATE airdash.pireps SET credited_minutes=$1, credited_block_minutes=$2, base_experience=$3, streak_bonus_experience=$4,
      streak_bonus_percent=$5, day_streak_at_award=$6, continuity_streak_at_award=$7 WHERE id=$8`,
      [xp, creditedBlockMinutes, baseExperience, award.bonusExperience, award.bonusPercent, awardStreaks.flightDays, awardStreaks.continuity, reportRow.id])
    await client.query(`UPDATE airdash.pilots SET total_block_minutes=total_block_minutes+$1, experience=experience+$2,
      total_flights=total_flights+$3, missions_completed=missions_completed+$4, assignments_completed=assignments_completed+$5 WHERE discord_id=$6`,
      [creditedBlockMinutes, xp, 1, missionCompleted ? 1 : 0, assignmentCompleted ? 1 : 0, reportRow.discord_id])
    const repositionAirport = reportRow.reposition_airport || reportRow.destination
    const parkedGate = completedOutcome && reportRow.arrival_gate
      ? reportRow.arrival_gate
      : await selectAircraftGate(client, repositionAirport, `report:${reportRow.id}:${reportRow.registration}:parking`, null, reportRow.registration)
    const hardLanding = reportRow.landing_rate != null && Number(reportRow.landing_rate) <= -450
    if (hardLanding) {
      await client.query(`UPDATE airdash.aircraft SET total_block_minutes=total_block_minutes+$1, total_cycles=total_cycles+1, current_airport=$2, current_gate=$3,
        status='INSPECTION', status_reason=$4, status_until=NOW() + INTERVAL '48 hours', status_set_by=NULL, status_set_at=NOW() WHERE registration=$5`,
        [operationalMinutes, repositionAirport, parkedGate, `Hard landing ${reportRow.landing_rate} fpm; automatic 48-hour inspection`, reportRow.registration])
    } else {
      await client.query("UPDATE airdash.aircraft SET total_block_minutes=total_block_minutes+$1, total_cycles=total_cycles+1, current_airport=$2, current_gate=$3, status='AVAILABLE', status_reason='', status_until=NULL WHERE registration=$4", [operationalMinutes, repositionAirport, parkedGate, reportRow.registration])
    }
    await client.query("UPDATE airdash.assignments SET status=$1 WHERE id=$2", [completedOutcome ? "COMPLETED" : "DIVERTED", reportRow.assignment_id])
    if (hardLanding) await audit(null, "AIRCRAFT_INSPECTION_TRIGGERED", "aircraft", reportRow.registration, { landingRate: reportRow.landing_rate, pirep: reportRow.id, repositionAirport })
    if (isNonCompleteOutcome(outcome)) await audit(reviewerId, "PIREP_NON_COMPLETE_APPROVED", "pirep", reportRow.id, {
      outcome, reasonCode: reportRow.diversion_reason_code, details: reportRow.diversion_details, actualDestination: reportRow.actual_destination,
      repositionAirport, repositionMethod: reportRow.reposition_method, progressRatio: reportRow.progress_ratio, creditMultiplier,
      creditedBlockMinutes, operationalMinutes,
    })
  } else if (decision === "REJECTED") {
    await client.query("UPDATE airdash.aircraft SET status='AVAILABLE' WHERE registration=$1", [reportRow.registration])
    await client.query("UPDATE airdash.assignments SET status='CANCELLED', cancelled_at=NOW(), cancelled_by=$2, cancellation_code='PIREP_REJECTED', cancellation_reason=$3 WHERE id=$1", [reportRow.assignment_id, reviewerId, notes ? `PIREP rejected: ${notes}` : "PIREP rejected"])
  }
}

app.post("/pireps", requireUser, async (req, res) => {
  try {
    const assignmentId = Number(req.body.assignmentId)
    const volantaUrl = clean(req.body.volantaUrl, 500)
    if (!assignmentId || !volantaUrl) return res.status(400).json({ error: "A public Volanta flight link is required" })
    const assignment = await pool.query(`SELECT a.*, r.origin, r.destination FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
      WHERE a.id=$1 AND a.discord_id=$2 AND a.status IN ('BOOKED','ACTIVE')`, [assignmentId, req.user.id])
    const row = assignment.rows[0]
    if (!row) return res.status(404).json({ error: "Assignment not found" })
    const volanta = await importVolanta(volantaUrl)
    if (volanta.origin !== row.origin || volanta.destination !== row.destination) return res.status(400).json({ error: `Volanta planned route ${volanta.origin}-${volanta.destination} does not match ${row.origin}-${row.destination}` })
    if (volanta.aircraftRegistration && volanta.aircraftRegistration !== row.registration) return res.status(400).json({ error: `Volanta aircraft ${volanta.aircraftRegistration} does not match ${row.registration}` })
    const outcome = analyzeFlightOutcome(volanta, row)
    if (!outcome.reportable) return res.status(400).json({ error: "Volanta has not recorded a finished flight yet. End the flight in Volanta and wait for its public stats to update." })
    const out = new Date(volanta.actualOutAt)
    const off = volanta.actualOffAt ? new Date(volanta.actualOffAt) : null
    const on = volanta.actualOnAt ? new Date(volanta.actualOnAt) : null
    const inside = new Date(outcome.reportEndAt)
    if (Number.isNaN(out.valueOf()) || Number.isNaN(inside.valueOf()) || inside <= out) return res.status(400).json({ error: "Volanta did not provide a valid flight start and end time" })
    const submittedLandingRate = volanta.landingRate ?? (req.body.landingRate === "" || req.body.landingRate == null ? null : Number(req.body.landingRate))
    if (submittedLandingRate != null && !Number.isFinite(Number(submittedLandingRate))) return res.status(400).json({ error: "Landing rate is outside the accepted range" })
    const landingRate = submittedLandingRate == null || Number(submittedLandingRate) === 0 ? null : Number(submittedLandingRate)
    if (landingRate != null && (landingRate < -5000 || landingRate > 2000)) return res.status(400).json({ error: "Landing rate is outside the accepted range" })
    const reasonCode = normalizeDiversionReasonCode(req.body.diversionReasonCode)
    const diversionDetails = clean(req.body.diversionDetails, 500)
    if (outcome.requiresReason && !reasonCode) return res.status(400).json({ error: "Tell Operations what happened before filing a diverted or incomplete flight" })
    if (reasonCode === "OTHER" && !diversionDetails) return res.status(400).json({ error: "Provide details when selecting Other" })
    const result = await pool.query(`INSERT INTO airdash.pireps
      (assignment_id, discord_id, actual_out_at, actual_off_at, actual_on_at, actual_in_at, landing_rate, vatsim_flown, volanta_url, volanta_flight_id, volanta_data, distance_nm, fuel_burn, network, callsign, remarks, sim_block_seconds, real_block_seconds, time_compression_ratio, time_compression_detected, time_compression_reason, outcome_type, diversion_reason_code, diversion_details, actual_destination, reposition_airport, reposition_method, progress_ratio, credit_multiplier)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29) RETURNING *`,
      [assignmentId, req.user.id, out, off, on, inside, landingRate == null ? null : Math.round(landingRate), Boolean(req.body.vatsimFlown), volanta.sourceUrl, volanta.flightId, volanta, volanta.distanceNm ?? null, volanta.fuelBurn ?? null, Boolean(req.body.vatsimFlown) ? "VATSIM" : (volanta.network ?? "Offline"), volanta.callsign ?? null, clean(req.body.remarks, 1500), volanta.simBlockSeconds, volanta.realBlockSeconds, volanta.timeCompressionRatio, volanta.timeCompressionDetected, volanta.timeCompressionDetected ? `Simulator time ran ${volanta.timeCompressionRatio.toFixed(2)}x faster than real time` : "", outcome.outcome, outcome.requiresReason ? reasonCode : null, outcome.requiresReason ? diversionDetails : "", outcome.actualDestination, outcome.repositionAirport, outcome.repositionMethod, outcome.progressRatio, outcome.creditMultiplier])
    await pool.query("UPDATE airdash.assignments SET status='PIREP_SUBMITTED' WHERE id=$1", [assignmentId])
    await audit(req.user.id, "PIREP_SUBMITTED", "pirep", result.rows[0].id, { volanta: true, landingRate, timeCompressionDetected: volanta.timeCompressionDetected, timeCompressionRatio: volanta.timeCompressionRatio, outcome: outcome.outcome, reasonCode: outcome.requiresReason ? reasonCode : null, repositionAirport: outcome.repositionAirport, repositionMethod: outcome.repositionMethod, progressRatio: outcome.progressRatio, creditMultiplier: outcome.creditMultiplier })
    const settings = await pool.query("SELECT value FROM airdash.settings WHERE key='operations'")
    let autoApproved = false
    if (settings.rows[0]?.value?.autoApprovePireps) {
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const report = await client.query(`SELECT p.*, a.registration, a.route_id, a.source, a.mission_type, a.arrival_gate, r.destination FROM airdash.pireps p
          JOIN airdash.assignments a ON a.id=p.assignment_id JOIN airdash.routes r ON r.id=a.route_id WHERE p.id=$1 FOR UPDATE`, [result.rows[0].id])
        await applyPirepReview(client, report.rows[0], "APPROVED", null, "Automatically approved")
        await client.query("COMMIT")
        autoApproved = true
        await audit(null, "PIREP_AUTO_APPROVED", "pirep", result.rows[0].id, { outcome: outcome.outcome })
      } catch {
        await client.query("ROLLBACK")
      } finally { client.release() }
    }
    res.status(201).json({ pirep: result.rows[0], outcome, autoApproved })
  } catch (error) {
    console.error("[airdash:pirep]", { user: req.user?.id, assignmentId: req.body?.assignmentId, status: error.status ?? 500, message: error.message })
    res.status(error.status ?? 500).json({ error: error.status ? error.message : "Pilot report submission failed" })
  }
})

app.get("/admin/overview", requireOwner, async (_req, res) => {
  const [applications, pireps, pilots, assignments, aircraft, auditRows, visitors, orgUpdates] = await Promise.all([
    pool.query("SELECT a.*, u.username, u.avatar_url FROM airdash.applications a JOIN airdash.users u USING(discord_id) ORDER BY submitted_at DESC"),
    pool.query(`SELECT p.*, u.display_name, u.avatar_url, pl.profile_image_url, a.registration, a.flight_plan, a.source, a.mission_type, r.flight_number, r.origin, r.destination, r.block_minutes
      FROM airdash.pireps p JOIN airdash.users u USING(discord_id) JOIN airdash.pilots pl USING(discord_id) JOIN airdash.assignments a ON a.id=p.assignment_id JOIN airdash.routes r ON r.id=a.route_id ORDER BY p.submitted_at DESC`),
    pool.query("SELECT p.*, u.avatar_url FROM airdash.pilots p JOIN airdash.users u USING(discord_id) ORDER BY joined_at DESC"),
    pool.query(`SELECT a.*, r.flight_number, r.origin, r.destination,
      u.display_name pilot_name, u.username pilot_username,
      cancelled_user.display_name cancelled_by_name, cancelled_user.username cancelled_by_username
      FROM airdash.assignments a
      JOIN airdash.routes r ON r.id=a.route_id
      JOIN airdash.users u ON u.discord_id=a.discord_id
      LEFT JOIN airdash.users cancelled_user ON cancelled_user.discord_id=a.cancelled_by
      ORDER BY a.booked_at DESC LIMIT 100`),
    pool.query("SELECT * FROM airdash.aircraft ORDER BY fleet_number"),
    pool.query(`SELECT e.*, u.display_name actor_name FROM airdash.audit_events e LEFT JOIN airdash.users u ON u.discord_id=e.actor_discord_id ORDER BY e.created_at DESC LIMIT 500`),
    pool.query(`SELECT u.discord_id, u.username, u.display_name, u.avatar_url, u.created_at, u.last_login_at
      FROM airdash.users u
      LEFT JOIN airdash.applications a USING(discord_id)
      LEFT JOIN airdash.pilots p USING(discord_id)
      WHERE a.discord_id IS NULL AND p.discord_id IS NULL
      ORDER BY u.last_login_at DESC LIMIT 100`),
    pool.query(`SELECT o.*, u.display_name created_by_name
      FROM airdash.org_updates o
      LEFT JOIN airdash.users u ON u.discord_id=o.created_by
      ORDER BY o.created_at DESC LIMIT 50`),
  ])
  const settings = await pool.query("SELECT value FROM airdash.settings WHERE key='operations'")
  const bases = await pool.query("SELECT code, name, lat, lon, role, is_active, sort_order, (SELECT COUNT(*) FROM airdash.pilots WHERE base_code=b.code)::int pilot_count FROM airdash.bases b ORDER BY sort_order, code")
  res.json({ applications: applications.rows, pireps: pireps.rows, pilots: pilots.rows, assignments: assignments.rows, aircraft: aircraft.rows, audit: auditRows.rows, visitors: visitors.rows, orgUpdates: orgUpdates.rows, settings: settings.rows[0]?.value ?? {}, bases: bases.rows })
})

app.post("/admin/bases", requireOwner, async (req, res) => {
  const code = clean(req.body.code, 4).toUpperCase()
  const name = clean(req.body.name, 60)
  const role = clean(req.body.role, 60)
  const lat = Number(req.body.lat)
  const lon = Number(req.body.lon)
  const sortOrder = Number.isFinite(Number(req.body.sortOrder)) ? Math.trunc(Number(req.body.sortOrder)) : 100
  const isActive = req.body.isActive === undefined ? true : Boolean(req.body.isActive)
  if (!/^[A-Z]{3,4}$/.test(code)) return res.status(400).json({ error: "Enter a 3 or 4 letter ICAO code" })
  if (!name) return res.status(400).json({ error: "Enter a base name" })
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) return res.status(400).json({ error: "Enter valid latitude and longitude" })
  const result = await pool.query(`INSERT INTO airdash.bases (code, name, lat, lon, role, is_active, sort_order)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (code) DO UPDATE SET name=$2, lat=$3, lon=$4, role=$5, is_active=$6, sort_order=$7 RETURNING *`,
    [code, name, lat, lon, role, isActive, sortOrder])
  await audit(req.user.id, "BASE_SAVED", "base", code, { name, lat, lon, isActive })
  res.json({ base: result.rows[0] })
})

app.delete("/admin/bases/:code", requireOwner, async (req, res) => {
  const code = clean(req.params.code, 4).toUpperCase()
  const inUse = await pool.query("SELECT COUNT(*)::int n FROM airdash.pilots WHERE base_code=$1", [code])
  if (inUse.rows[0].n > 0) return res.status(400).json({ error: `${inUse.rows[0].n} pilot(s) are based here. Reassign them or deactivate the base instead.` })
  const result = await pool.query("DELETE FROM airdash.bases WHERE code=$1 RETURNING code", [code])
  if (!result.rows[0]) return res.status(404).json({ error: "Base not found" })
  await audit(req.user.id, "BASE_DELETED", "base", code, {})
  res.json({ ok: true })
})

app.post("/admin/settings", requireOwner, async (req, res) => {
  const autoApprovePireps = Boolean(req.body.autoApprovePireps)
  const result = await pool.query("UPDATE airdash.settings SET value=jsonb_set(value,'{autoApprovePireps}',$1::jsonb), updated_at=NOW() WHERE key='operations' RETURNING value", [JSON.stringify(autoApprovePireps)])
  await audit(req.user.id, "SETTINGS_UPDATED", "settings", "operations", { autoApprovePireps })
  res.json({ settings: result.rows[0].value })
})

app.get("/assignments/history", requireUser, async (req, res) => {
  const result = await pool.query(`SELECT a.id, a.status, a.flight_date, a.booked_at, a.started_at, a.registration, a.source, a.mission_type, a.departure_gate, a.arrival_gate,
      a.cancelled_at, a.cancelled_by, a.cancellation_code, a.cancellation_reason,
      r.flight_number, r.origin, r.destination, r.block_minutes, p.review_status pirep_status,
      p.outcome_type pirep_outcome_type, p.reposition_airport, p.reposition_method, p.diversion_reason_code, p.diversion_details
    FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
    LEFT JOIN airdash.pireps p ON p.assignment_id=a.id
    WHERE a.discord_id=$1 ORDER BY a.booked_at DESC LIMIT 60`, [req.user.id])
  res.json({ assignments: result.rows })
})

app.get("/notifications", requireUser, async (req, res) => {
  try {
    const { inserted: _inserted, ...notifications } = await syncNotificationHistory(pool, req.user.id, req.user.id === OWNER_ID)
    res.json(notifications)
  } catch (error) {
    console.error("[airdash-notifications] pilot sync failed", error?.message ?? error)
    res.status(500).json({ error: "Notifications could not be loaded" })
  }
})

app.post("/notifications/read", requireUser, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : null
  const count = await markNotificationsRead(pool, req.user.id, ids)
  res.json({ ok: true, count })
})

app.get("/push/public-key", requireUser, (req, res) => {
  const configuration = pushConfiguration()
  if (!configuration.configured) return res.status(503).json({ error: "Web Push is not configured" })
  res.json({ publicKey: configuration.publicKey })
})

app.post("/push/subscriptions", requireUser, async (req, res) => {
  try {
    await savePushSubscription(pool, req.user.id, req.body.subscription, req.get("user-agent") ?? "", req.user.id === OWNER_ID)
    res.status(201).json({ ok: true })
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.status ? error.message : "Push subscription could not be saved" })
  }
})

app.delete("/push/subscriptions", requireUser, async (req, res) => {
  await removePushSubscription(pool, req.user.id, req.body.endpoint)
  res.json({ ok: true })
})

app.post("/push/test", requireUser, async (req, res) => {
  try {
    const delivered = await sendTestPush(pool, req.user.id, clean(req.body.endpoint, 2000) || null)
    res.json({ ok: true, delivered })
  } catch (error) {
    res.status(error.status ?? 500).json({ error: error.status ? error.message : "Test notification could not be delivered" })
  }
})

app.post("/admin/applications/:id/:decision", requireOwner, async (req, res) => {
  const decision = req.params.decision.toUpperCase()
  if (!["APPROVED", "RETURNED", "REJECTED"].includes(decision)) return res.status(400).json({ error: "Invalid decision" })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const application = await client.query(`UPDATE airdash.applications SET status=$1, reviewer_notes=$2, reviewed_by=$3, reviewed_at=NOW(), updated_at=NOW()
      WHERE id=$4 RETURNING *`, [decision, clean(req.body.notes, 1000), req.user.id, req.params.id])
    if (!application.rows[0]) return res.status(404).json({ error: "Application not found" })
    if (decision === "APPROVED") {
      const appRow = application.rows[0]
      const number = await client.query("SELECT nextval('airdash.pilot_number_seq') number")
      const pilotNumber = `AD${String(number.rows[0].number).padStart(4, "0")}`
      await client.query(`INSERT INTO airdash.pilots (discord_id, pilot_number, display_name, vatsim_cid, base_code)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (discord_id) DO NOTHING`, [appRow.discord_id, pilotNumber, appRow.preferred_name, appRow.vatsim_cid, appRow.base_code])
      await publishOrgUpdate({ kind: "NEW_PILOT", title: `Welcome aboard, ${appRow.preferred_name}`, body: `${appRow.preferred_name} has joined the airDash pilot team as ${pilotNumber}.`, pilotDiscordId: appRow.discord_id, createdBy: req.user.id }, client)
    }
    await client.query("COMMIT")
    await audit(req.user.id, `APPLICATION_${decision}`, "application", req.params.id)
    res.json({ application: application.rows[0] })
  } catch (error) {
    await client.query("ROLLBACK")
    res.status(500).json({ error: "Application decision failed" })
  } finally { client.release() }
})

app.post("/admin/aircraft/:registration/status", requireOwner, async (req, res) => {
  const status = clean(req.body.status, 20).toUpperCase()
  const reason = clean(req.body.reason, 300)
  const registration = clean(req.params.registration, 10).toUpperCase()
  if (!["AVAILABLE", "MAINTENANCE", "INSPECTION", "RETIRED"].includes(status)) return res.status(400).json({ error: "Choose a supported aircraft status" })
  if (status !== "AVAILABLE" && !reason) return res.status(400).json({ error: "Provide a reason code or description" })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const current = await client.query("SELECT * FROM airdash.aircraft WHERE registration=$1 FOR UPDATE", [registration])
    if (!current.rows[0]) throw Object.assign(new Error("Aircraft not found"), { status: 404 })
    if (current.rows[0].status === "ASSIGNED") throw Object.assign(new Error("Cancel the active assignment before changing this aircraft"), { status: 409 })
    const result = status === "INSPECTION"
      ? await client.query(`UPDATE airdash.aircraft SET status=$1, status_reason=$2, status_until=NOW() + INTERVAL '48 hours', status_set_by=$3, status_set_at=NOW() WHERE registration=$4 RETURNING *`, [status, reason, req.user.id, registration])
      : await client.query(`UPDATE airdash.aircraft SET status=$1, status_reason=$2, status_until=NULL, status_set_by=$3, status_set_at=NOW() WHERE registration=$4 RETURNING *`, [status, status === "AVAILABLE" ? "" : reason, req.user.id, registration])
    await client.query("COMMIT")
    await audit(req.user.id, "AIRCRAFT_STATUS_SET", "aircraft", registration, { status, reason })
    res.json({ aircraft: result.rows[0] })
  } catch (error) {
    await client.query("ROLLBACK")
    res.status(error.status ?? 500).json({ error: error.status ? error.message : "Aircraft status change failed" })
  } finally { client.release() }
})

app.post("/admin/pireps/:id/:decision", requireOwner, async (req, res) => {
  const decision = req.params.decision.toUpperCase()
  if (!["APPROVED", "RETURNED", "REJECTED"].includes(decision)) return res.status(400).json({ error: "Invalid decision" })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const report = await client.query(`SELECT p.*, a.registration, a.route_id, a.source, a.mission_type, a.arrival_gate, r.destination FROM airdash.pireps p
      JOIN airdash.assignments a ON a.id=p.assignment_id JOIN airdash.routes r ON r.id=a.route_id WHERE p.id=$1 FOR UPDATE`, [req.params.id])
    if (!report.rows[0]) return res.status(404).json({ error: "PIREP not found" })
    const row = report.rows[0]
    await applyPirepReview(client, row, decision, req.user.id, clean(req.body.notes, 1000))
    await client.query("COMMIT")
    await audit(req.user.id, `PIREP_${decision}`, "pirep", req.params.id)
    res.json({ ok: true })
  } catch {
    await client.query("ROLLBACK")
    res.status(500).json({ error: "PIREP decision failed" })
  } finally { client.release() }
})

await migrate()
const repairedGates = await repairMissingActiveGates(pool, audit)
const repairedAircraftGates = await repairAircraftParkingGates(pool, audit)
if (repairedGates > 0) console.log(`[airdash-api] repaired gates for ${repairedGates} active assignment${repairedGates === 1 ? "" : "s"}`)
if (repairedAircraftGates > 0) console.log(`[airdash-api] assigned parking gates for ${repairedAircraftGates} aircraft`)
const stopPushWorker = startPushWorker(pool, OWNER_ID)
const server = app.listen(port, "0.0.0.0", () => console.log(`[airdash-api] listening on 0.0.0.0:${port}`))
const shutdown = async () => { stopPushWorker(); server.close(); await pool.end(); process.exit(0) }
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
