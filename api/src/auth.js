const AUTH_URL = process.env.AUTH_URL ?? "http://127.0.0.1:3002/auth/me"
export const OWNER_ID = process.env.OWNER_DISCORD_ID ?? "860900952097030184"

export async function authenticatedUser(cookie) {
  if (!cookie) return null
  try {
    const response = await fetch(AUTH_URL, {
      headers: { cookie },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null
    const body = await response.json()
    return body.user?.id ? body.user : null
  } catch {
    return null
  }
}

export async function requireUser(req, res, next) {
  const user = await authenticatedUser(req.headers.cookie)
  if (!user) return res.status(401).json({ error: "Discord sign-in required" })
  req.user = user
  next()
}

export async function requireOwner(req, res, next) {
  const user = await authenticatedUser(req.headers.cookie)
  if (!user || user.id !== OWNER_ID) return res.status(403).json({ error: "Owner access required" })
  req.user = user
  next()
}

export function requireAirDashOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next()
  const origin = req.get("origin")
  if (origin !== "https://air.dashydoggo.com" && origin !== "http://localhost:5174") {
    return res.status(403).json({ error: "Invalid request origin" })
  }
  next()
}
