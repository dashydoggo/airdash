/* airDash Web Push service worker. Served at /airdash-sw.js so its scope covers the site. */

self.addEventListener("push", event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data?.text() || "A new update is available." } }
  const title = data.title || "airDash"
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "A new update is available.",
    icon: data.icon || "/assets/airdash.logo.png",
    badge: data.badge || "/assets/airdash.logo.png",
    tag: data.tag || "airdash-update",
    renotify: true,
    data: { url: data.url || "/portal#portal-updates", notificationId: data.notificationId || null },
  }))
})

self.addEventListener("notificationclick", event => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || "/portal#portal-updates", self.location.origin).href
  const notificationId = event.notification.data?.notificationId
  event.waitUntil((async () => {
    if (notificationId) {
      try {
        await fetch("/api/notifications/read", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [notificationId] }),
        })
      } catch {}
    }
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true })
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin)
    if (existing) { await existing.navigate(target); return existing.focus() }
    return clients.openWindow(target)
  })())
})

function applicationServerKey(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4)
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(raw, character => character.charCodeAt(0))
}

self.addEventListener("pushsubscriptionchange", event => {
  event.waitUntil((async () => {
    try {
      const response = await fetch("/api/push/public-key", { credentials: "include" })
      if (!response.ok) return
      const { publicKey } = await response.json()
      const subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) })
      await fetch("/api/push/subscriptions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      })
    } catch {}
  })())
})
