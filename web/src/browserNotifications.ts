// Browser (desktop) notification support for airDash.
//
// The site shows an in-app notification bell. When the pilot is on another tab
// or has the window minimized, they never see new alerts. This module bridges
// the in-app notification payload to the Web Notifications API so the operating
// system can surface an alert while the pilot is away.

const ENABLED_KEY = "airdash-browser-notifications"

export type BrowserNotificationSupport = "unsupported" | "default" | "granted" | "denied"

// Reports whether the browser exposes the Notifications API and the current
// permission state. "unsupported" means the API is missing entirely.
export function browserNotificationSupport(): BrowserNotificationSupport {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported"
  return Notification.permission as BrowserNotificationSupport
}

// Whether the pilot has opted in through the profile toggle. Permission being
// granted is necessary but not sufficient; the pilot must also enable delivery.
export function browserNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1" && browserNotificationSupport() === "granted"
  } catch {
    return false
  }
}

export function setBrowserNotificationsEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(ENABLED_KEY, "1")
    else localStorage.removeItem(ENABLED_KEY)
  } catch {
    // Storage may be unavailable in private browsing; ignore.
  }
}

// Prompts the pilot for permission. Returns the resulting permission state so
// the caller can update the toggle. Enables delivery only when granted.
export async function requestBrowserNotifications(): Promise<BrowserNotificationSupport> {
  if (browserNotificationSupport() === "unsupported") return "unsupported"
  let permission = Notification.permission as BrowserNotificationSupport
  if (permission === "default") {
    try { permission = (await Notification.requestPermission()) as BrowserNotificationSupport }
    catch { return browserNotificationSupport() }
  }
  setBrowserNotificationsEnabled(permission === "granted")
  return permission
}

// Fires a desktop notification when the pilot is away. Suppressed when the tab
// is already visible so it does not duplicate the in-app toast, when delivery
// is disabled, or when permission is not granted.
export function showBrowserNotification(title: string, body: string, tag?: string): void {
  if (!browserNotificationsEnabled()) return
  if (typeof document !== "undefined" && document.visibilityState === "visible") return
  try {
    const notification = new Notification(title, { body, tag, icon: "/assets/airdash.logo.png" })
    notification.onclick = () => { try { window.focus() } catch {} finally { notification.close() } }
  } catch {
    // Constructing a Notification can throw on some platforms; ignore.
  }
}
