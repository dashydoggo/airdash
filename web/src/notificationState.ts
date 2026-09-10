export interface NotificationHistoryItem {
  id: number
  event_key: string
  kind: NotificationGroup
  title: string
  body: string
  href: string
  payload: any
  created_at: string
  read_at: string | null
}

export interface NotificationPayload {
  total: number
  history?: NotificationHistoryItem[]
  applications?: any[]
  pireps: any[]
  progress?: any[]
  orgUpdates?: any[]
  aircraft?: any[]
  expired?: any[]
  filingSoon?: any[]
  gateChanges?: any[]
  baseRequests?: any[]
}

export const notificationGroups = [
  "applications",
  "pireps",
  "aircraft",
  "baseRequests",
  "progress",
  "orgUpdates",
  "expired",
  "filingSoon",
  "gateChanges",
] as const

export type NotificationGroup = typeof notificationGroups[number]

function stableSerialize(value: unknown): string {
  if (value === undefined) return "undefined"
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value)
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`
}

function fingerprint(value: string): string {
  let first = 0xdeadbeef ^ value.length
  let second = 0x41c6ce57 ^ value.length
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 2654435761)
    second = Math.imul(second ^ code, 1597334677)
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909)
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909)
  return `${(second >>> 0).toString(36)}${(first >>> 0).toString(36)}`
}

export function notificationRecordKey(group: NotificationGroup, item: any): string {
  const identity = item?.id ?? item?.registration ?? item?.discord_id ?? item?.entity_id ?? item?.assignment_id ?? "record"
  const serialized = stableSerialize(item)
  return `${group}:${String(identity)}:${serialized.length.toString(36)}:${fingerprint(serialized)}`
}

export function notificationRecordKeys(payload: NotificationPayload): string[] {
  return notificationGroups.flatMap(group => (payload[group] ?? []).map(item => notificationRecordKey(group, item)))
}

export function filterDismissedNotifications(payload: NotificationPayload, dismissed: ReadonlySet<string>): NotificationPayload {
  const filtered = { ...payload } as NotificationPayload
  let total = 0
  for (const group of notificationGroups) {
    const rows = payload[group] ?? []
    const visible = rows.filter(item => !dismissed.has(notificationRecordKey(group, item)))
    ;(filtered as unknown as Record<NotificationGroup, any[]>)[group] = visible
    total += visible.length
  }
  filtered.total = total
  return filtered
}
