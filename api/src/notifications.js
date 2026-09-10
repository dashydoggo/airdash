import { createHash } from "node:crypto"

export const notificationGroups = [
  "applications", "pireps", "aircraft", "baseRequests", "progress",
  "orgUpdates", "expired", "filingSoon", "gateChanges",
]

function stableSerialize(value) {
  if (value === undefined) return "undefined"
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`
}

function eventKey(group, item) {
  const identity = item?.id ?? item?.registration ?? item?.discord_id ?? item?.entity_id ?? item?.assignment_id ?? "record"
  const fingerprint = createHash("sha256").update(stableSerialize(item)).digest("hex").slice(0, 24)
  return `${group}:${String(identity)}:${fingerprint}`
}

function flightNumber(value) {
  return `AIR${String(value ?? "").padStart(3, "0")}`
}

function recordTimestamp(item) {
  return item?.reviewed_at ?? item?.submitted_at ?? item?.created_at ?? item?.home_base_requested_at ?? item?.status_set_at ?? item?.expires_at ?? new Date()
}

function normalizeRecord(group, item, owner) {
  let title = "airDash update"
  let body = "A new update is available."
  let href = "/portal#portal-updates"

  switch (group) {
    case "applications":
      title = "New pilot application"
      body = `${item.preferred_name} applied for ${item.base_code}.`
      href = "/admin?tab=applications"
      break
    case "pireps":
      if (owner && item.display_name) {
        title = "Pilot report awaiting review"
        body = `${item.display_name} filed ${flightNumber(item.flight_number)} in ${item.registration}.`
        href = "/admin?tab=pireps"
      } else {
        title = `Pilot report ${String(item.review_status ?? "updated").toLowerCase()}`
        body = `${flightNumber(item.flight_number)} · ${item.registration}`
        href = "/report"
      }
      break
    case "aircraft":
      title = `${item.registration} ${String(item.status ?? "status").toLowerCase()}`
      body = item.status_reason || "Operations updated this aircraft's availability."
      href = owner ? "/admin?tab=aircraft" : "/portal#hangar-equipment"
      break
    case "baseRequests":
      title = "Base change request"
      body = `${item.display_name} requests ${item.base_code} to ${item.home_base_request}.`
      href = "/admin?tab=pilots"
      break
    case "progress":
      title = "Pilot progress updated"
      body = `${flightNumber(item.flight_number)} approved · +${item.credited_minutes} XP${Number(item.streak_bonus_experience ?? 0) > 0 ? ` · +${item.streak_bonus_experience} streak bonus` : ""}.`
      href = "/portal#hangar-progress"
      break
    case "orgUpdates":
      title = item.title || "Organization announcement"
      body = item.body || "A new organization announcement was published."
      href = "/portal#hangar-announcements"
      break
    case "expired":
      title = "Flight booking expired"
      body = "The booking deadline passed and the aircraft was released."
      href = "/flights"
      break
    case "filingSoon":
      title = "Pilot report due soon"
      body = `30 minutes remain to file ${flightNumber(item.flight_number)} · ${item.registration}.`
      href = "/report"
      break
    case "gateChanges":
      title = "Destination gate changed"
      body = `${item.details?.from ?? "TBD"} to ${item.details?.to ?? "TBD"}.`
      href = "/portal#portal-current-assignment"
      break
  }

  return {
    eventKey: eventKey(group, item),
    kind: group,
    title,
    body,
    href,
    payload: item,
    createdAt: recordTimestamp(item),
  }
}

export async function getNotificationPayload(pool, discordId, owner = false) {
  if (owner) {
    const [applications, pireps, aircraft, baseRequests, progress, orgUpdates] = await Promise.all([
      pool.query("SELECT id, preferred_name, base_code, submitted_at FROM airdash.applications WHERE status IN ('SUBMITTED','UNDER_REVIEW') ORDER BY submitted_at DESC"),
      pool.query(`SELECT p.id, p.submitted_at, p.landing_rate, u.display_name, r.flight_number, a.registration
        FROM airdash.pireps p JOIN airdash.users u USING(discord_id) JOIN airdash.assignments a ON a.id=p.assignment_id JOIN airdash.routes r ON r.id=a.route_id
        WHERE p.review_status='SUBMITTED' ORDER BY p.submitted_at DESC`),
      pool.query("SELECT registration, status, status_reason, status_until, status_set_at FROM airdash.aircraft WHERE status IN ('INSPECTION','MAINTENANCE') ORDER BY registration"),
      pool.query("SELECT discord_id, display_name, base_code, home_base_request, home_base_requested_at FROM airdash.pilots WHERE home_base_request IS NOT NULL AND home_base_request <> '' ORDER BY home_base_requested_at DESC"),
      pool.query(`SELECT p.id, p.reviewed_at, p.credited_minutes, p.streak_bonus_experience, p.streak_bonus_percent, p.day_streak_at_award, p.continuity_streak_at_award, r.flight_number, a.registration
        FROM airdash.pireps p JOIN airdash.assignments a ON a.id=p.assignment_id JOIN airdash.routes r ON r.id=a.route_id
        WHERE p.discord_id=$1 AND p.review_status='APPROVED' AND p.credited_minutes > 0 AND p.reviewed_at > NOW() - INTERVAL '7 days'
        ORDER BY p.reviewed_at DESC LIMIT 20`, [discordId]),
      pool.query("SELECT id, kind, title, LEFT(COALESCE(NULLIF(summary,''),body),240) body, created_at FROM airdash.org_updates WHERE created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 10"),
    ])
    return { applications: applications.rows, pireps: pireps.rows, aircraft: aircraft.rows, baseRequests: baseRequests.rows, progress: progress.rows, orgUpdates: orgUpdates.rows, expired: [], filingSoon: [], gateChanges: [] }
  }

  const [pireps, progress, orgUpdates, aircraft, expired, filingSoon, gateChanges] = await Promise.all([
    pool.query(`SELECT p.id, p.review_status, p.reviewed_at, r.flight_number, a.registration
      FROM airdash.pireps p JOIN airdash.assignments a ON a.id=p.assignment_id JOIN airdash.routes r ON r.id=a.route_id
      WHERE p.discord_id=$1 AND p.review_status IN ('RETURNED','REJECTED') AND p.reviewed_at > NOW() - INTERVAL '7 days'
      ORDER BY p.reviewed_at DESC LIMIT 20`, [discordId]),
    pool.query(`SELECT p.id, p.reviewed_at, p.credited_minutes, p.streak_bonus_experience, p.streak_bonus_percent, p.day_streak_at_award, p.continuity_streak_at_award, r.flight_number, a.registration
      FROM airdash.pireps p JOIN airdash.assignments a ON a.id=p.assignment_id JOIN airdash.routes r ON r.id=a.route_id
      WHERE p.discord_id=$1 AND p.review_status='APPROVED' AND p.credited_minutes > 0 AND p.reviewed_at > NOW() - INTERVAL '7 days'
      ORDER BY p.reviewed_at DESC LIMIT 20`, [discordId]),
    pool.query("SELECT id, kind, title, LEFT(COALESCE(NULLIF(summary,''),body),240) body, created_at FROM airdash.org_updates WHERE created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 10"),
    pool.query("SELECT registration, status, status_reason, status_until, status_set_at FROM airdash.aircraft WHERE status IN ('INSPECTION','MAINTENANCE') ORDER BY registration"),
    pool.query(`SELECT id, action, entity_id, created_at FROM airdash.audit_events
      WHERE actor_discord_id=$1 AND action='ASSIGNMENT_EXPIRED' AND created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 10`, [discordId]),
    pool.query(`SELECT a.id, a.expires_at - INTERVAL '30 minutes' created_at, a.expires_at, a.registration, r.flight_number FROM airdash.assignments a JOIN airdash.routes r ON r.id=a.route_id
      WHERE a.discord_id=$1 AND a.status='BOOKED' AND a.expires_at > NOW() AND a.expires_at <= NOW() + INTERVAL '30 minutes' ORDER BY a.expires_at`, [discordId]),
    pool.query(`SELECT id, entity_id assignment_id, details, created_at FROM airdash.audit_events
      WHERE actor_discord_id=$1 AND action='ARRIVAL_GATE_REASSIGNED' AND created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 10`, [discordId]),
  ])
  return { applications: [], pireps: pireps.rows, aircraft: aircraft.rows, baseRequests: [], progress: progress.rows, orgUpdates: orgUpdates.rows, expired: expired.rows, filingSoon: filingSoon.rows, gateChanges: gateChanges.rows }
}

export async function syncNotificationHistory(pool, discordId, owner = false, historyLimit = 100) {
  const payload = await getNotificationPayload(pool, discordId, owner)
  const inserted = []
  for (const group of notificationGroups) {
    for (const item of payload[group] ?? []) {
      const record = normalizeRecord(group, item, owner)
      const result = await pool.query(`INSERT INTO airdash.notification_history
        (discord_id, event_key, kind, title, body, href, payload, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (discord_id, event_key) DO NOTHING
        RETURNING *`,
        [discordId, record.eventKey, record.kind, record.title, record.body, record.href, record.payload, record.createdAt])
      if (result.rows[0]) inserted.push(result.rows[0])
    }
  }
  const limit = Math.min(250, Math.max(1, Number(historyLimit) || 100))
  const [history, unread] = await Promise.all([
    pool.query(`SELECT id, event_key, kind, title, body, href, payload, created_at, read_at
      FROM airdash.notification_history WHERE discord_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2`, [discordId, limit]),
    pool.query("SELECT COUNT(*)::INTEGER total FROM airdash.notification_history WHERE discord_id=$1 AND read_at IS NULL", [discordId]),
  ])
  return { ...payload, total: unread.rows[0]?.total ?? 0, history: history.rows, inserted }
}

export async function markNotificationsRead(pool, discordId, ids = null) {
  if (Array.isArray(ids) && ids.length) {
    const normalized = ids.map(Number).filter(Number.isInteger).slice(0, 250)
    if (!normalized.length) return 0
    const result = await pool.query("UPDATE airdash.notification_history SET read_at=COALESCE(read_at,NOW()) WHERE discord_id=$1 AND id=ANY($2::bigint[])", [discordId, normalized])
    return result.rowCount
  }
  const result = await pool.query("UPDATE airdash.notification_history SET read_at=COALESCE(read_at,NOW()) WHERE discord_id=$1 AND read_at IS NULL", [discordId])
  return result.rowCount
}
