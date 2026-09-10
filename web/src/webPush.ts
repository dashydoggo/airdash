import { api, post } from "./api"

export type WebPushSupport = "unsupported" | "default" | "granted" | "denied"
export interface WebPushState { support: WebPushSupport; subscribed: boolean }

export function webPushSupport(): WebPushSupport {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported"
  return Notification.permission as WebPushSupport
}

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = window.atob(base64)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index)
  return output
}

async function serviceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/airdash-sw.js", { scope: "/" })
  return navigator.serviceWorker.ready
}

export async function webPushState(): Promise<WebPushState> {
  const support = webPushSupport()
  if (support === "unsupported") return { support, subscribed: false }
  try {
    const registration = await navigator.serviceWorker.getRegistration("/")
    const subscription = await registration?.pushManager.getSubscription()
    return { support, subscribed: Boolean(subscription) }
  } catch {
    return { support, subscribed: false }
  }
}

export async function subscribeWebPush(): Promise<WebPushState> {
  let support = webPushSupport()
  if (support === "unsupported") return { support, subscribed: false }
  if (support === "default") support = (await Notification.requestPermission()) as WebPushSupport
  if (support !== "granted") return { support, subscribed: false }

  const [{ publicKey }, registration] = await Promise.all([
    api<{ publicKey: string }>("/push/public-key"),
    serviceWorkerRegistration(),
  ])
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(publicKey),
    })
  }
  await post("/push/subscriptions", { subscription: subscription.toJSON() })
  return { support, subscribed: true }
}

export async function unsubscribeWebPush(): Promise<WebPushState> {
  const support = webPushSupport()
  if (support === "unsupported") return { support, subscribed: false }
  const registration = await navigator.serviceWorker.getRegistration("/")
  const subscription = await registration?.pushManager.getSubscription()
  if (subscription) {
    await api("/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) })
    await subscription.unsubscribe()
  }
  return { support, subscribed: false }
}

export async function testWebPush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration("/")
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) throw new Error("This browser is not subscribed")
  await post("/push/test", { endpoint: subscription.endpoint })
}
