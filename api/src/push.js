import "dotenv/config"
import webpush from "web-push"
import { syncNotificationHistory } from "./notifications.js"

const publicKey = process.env.VAPID_PUBLIC_KEY ?? ""
const privateKey = process.env.VAPID_PRIVATE_KEY ?? ""
const subject = process.env.VAPID_SUBJECT ?? "https://air.dashydoggo.com"
const configured = Boolean(publicKey && privateKey)

if (configured) webpush.setVapidDetails(subject, publicKey, privateKey)

export function pushConfiguration() {
  return { configured, publicKey: configured ? publicKey : null }
}

function validSubscription(subscription) {
  return subscription
    && typeof subscription.endpoint === "string"
    && subscription.endpoint.startsWith("https://")
    && subscription.endpoint.length <= 2000
    && typeof subscription.keys?.p256dh === "string"
    && subscription.keys.p256dh.length <= 500
    && typeof subscription.keys?.auth === "string"
    && subscription.keys.auth.length <= 500
}

export async function savePushSubscription(pool, discordId, subscription, userAgent = "", owner = false) {
  if (!configured) throw Object.assign(new Error("Web Push is not configured"), { status: 503 })
  if (!validSubscription(subscription)) throw Object.assign(new Error("Invalid push subscription"), { status: 400 })
  await pool.query(`INSERT INTO airdash.push_subscriptions
    (endpoint, discord_id, p256dh, auth, user_agent, updated_at)
    VALUES ($1,$2,$3,$4,$5,NOW())
    ON CONFLICT (endpoint) DO UPDATE SET discord_id=EXCLUDED.discord_id, p256dh=EXCLUDED.p256dh,
      auth=EXCLUDED.auth, user_agent=EXCLUDED.user_agent, updated_at=NOW(), disabled_at=NULL, last_error=''`,
    [subscription.endpoint, discordId, subscription.keys.p256dh, subscription.keys.auth, String(userAgent).slice(0, 500)])
  await syncNotificationHistory(pool, discordId, owner)
  // Existing alerts form the subscription baseline and must not all be pushed at once.
  await pool.query("UPDATE airdash.notification_history SET pushed_at=COALESCE(pushed_at,NOW()) WHERE discord_id=$1", [discordId])
}

export async function removePushSubscription(pool, discordId, endpoint) {
  if (typeof endpoint !== "string" || !endpoint) return 0
  const result = await pool.query("DELETE FROM airdash.push_subscriptions WHERE discord_id=$1 AND endpoint=$2", [discordId, endpoint])
  return result.rowCount
}

function pushPayload(record) {
  return JSON.stringify({
    title: record.title || "airDash",
    body: record.body || "A new update is available.",
    icon: "/assets/airdash.logo.png",
    badge: "/assets/airdash.logo.png",
    url: record.href || "/portal#portal-updates",
    tag: record.event_key || `airdash-${record.id ?? Date.now()}`,
    notificationId: record.id ?? null,
  })
}

async function deliver(pool, subscription, payload) {
  try {
    await webpush.sendNotification({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }, payload, { TTL: 86400, urgency: "normal" })
    await pool.query("UPDATE airdash.push_subscriptions SET last_success_at=NOW(), last_error='' WHERE endpoint=$1", [subscription.endpoint])
    return true
  } catch (error) {
    const status = Number(error?.statusCode ?? error?.status ?? 0)
    if (status === 404 || status === 410) {
      await pool.query("DELETE FROM airdash.push_subscriptions WHERE endpoint=$1", [subscription.endpoint])
    } else {
      await pool.query("UPDATE airdash.push_subscriptions SET last_error=$1 WHERE endpoint=$2", [String(error?.message ?? "Push delivery failed").slice(0, 500), subscription.endpoint])
    }
    return false
  }
}

async function subscriptionsFor(pool, discordId) {
  const result = await pool.query(`SELECT endpoint, p256dh, auth FROM airdash.push_subscriptions
    WHERE discord_id=$1 AND disabled_at IS NULL ORDER BY created_at`, [discordId])
  return result.rows
}

export async function sendTestPush(pool, discordId, endpoint = null) {
  if (!configured) throw Object.assign(new Error("Web Push is not configured"), { status: 503 })
  const subscriptions = (await subscriptionsFor(pool, discordId)).filter(subscription => !endpoint || subscription.endpoint === endpoint)
  if (!subscriptions.length) throw Object.assign(new Error("This browser is not subscribed"), { status: 404 })
  const payload = pushPayload({ title: "airDash notifications enabled", body: "Background alerts are connected on this device.", href: "/profile", event_key: "airdash-push-test" })
  const results = await Promise.all(subscriptions.map(subscription => deliver(pool, subscription, payload)))
  return results.filter(Boolean).length
}

async function pushPendingForUser(pool, discordId, owner) {
  await syncNotificationHistory(pool, discordId, owner)
  const [subscriptions, pending] = await Promise.all([
    subscriptionsFor(pool, discordId),
    pool.query(`SELECT id, event_key, title, body, href FROM airdash.notification_history
      WHERE discord_id=$1 AND pushed_at IS NULL ORDER BY created_at, id LIMIT 50`, [discordId]),
  ])
  if (!subscriptions.length) return
  for (const record of pending.rows) {
    const payload = pushPayload(record)
    const results = await Promise.all(subscriptions.map(subscription => deliver(pool, subscription, payload)))
    if (results.some(Boolean)) await pool.query("UPDATE airdash.notification_history SET pushed_at=NOW() WHERE id=$1", [record.id])
  }
}

export function startPushWorker(pool, ownerId, intervalMs = 60_000) {
  if (!configured) {
    console.warn("[airdash-push] VAPID keys are not configured; background push is disabled")
    return () => {}
  }
  let running = false
  const poll = async () => {
    if (running) return
    running = true
    try {
      const users = await pool.query("SELECT DISTINCT discord_id FROM airdash.push_subscriptions WHERE disabled_at IS NULL")
      for (const row of users.rows) await pushPendingForUser(pool, row.discord_id, row.discord_id === ownerId)
    } catch (error) {
      console.error("[airdash-push] polling failed", error?.message ?? error)
    } finally {
      running = false
    }
  }
  const initial = setTimeout(() => { void poll() }, 5_000)
  const timer = setInterval(() => { void poll() }, intervalMs)
  initial.unref()
  timer.unref()
  return () => { clearTimeout(initial); clearInterval(timer) }
}
