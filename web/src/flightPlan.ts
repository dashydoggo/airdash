export const AIRDASH_CALLSIGN_REMARK = "CALLSIGN AIR DASH OPR AIRDASH VIRTUAL"
export const AIRDASH_SITE_REMARK = "AIR.DASHYDOGGO.COM"

function completeRemark(existing: string): string {
  let remark = existing.replace(/\s+/g, " ").trim()
  remark = remark.replace(/\s+-\s+(?=AIR\.DASHYDOGGO\.COM\b)/gi, " ")
  const upper = remark.toUpperCase()
  if (!upper.includes(AIRDASH_CALLSIGN_REMARK)) remark = `${remark}${remark ? " " : ""}${AIRDASH_CALLSIGN_REMARK}`
  if (!remark.toUpperCase().includes(AIRDASH_SITE_REMARK)) remark = `${remark}${remark ? " " : ""}${AIRDASH_SITE_REMARK}`
  return remark
}

export function appendAirDashRemark(raw: string): string {
  if (/RMK\//i.test(raw)) {
    return raw.replace(/RMK\/([^)]*)/i, (_match, existing: string) => `RMK/${completeRemark(existing)}`)
  }
  return raw.replace(/\)\s*$/, ` RMK/${completeRemark("")})`)
}

export interface VatsimPrefilePlan {
  atcFlightPlan: string
  endurance?: number | null
}

export function buildVatsimPrefileUrl(plan: VatsimPrefilePlan): string {
  const raw = appendAirDashRemark(plan.atcFlightPlan)
  const params = new URLSearchParams({ raw })
  if (plan.endurance) {
    const minutes = Math.round(plan.endurance / 60)
    params.set("fuel_time", `${String(Math.floor(minutes / 60)).padStart(2, "0")}${String(minutes % 60).padStart(2, "0")}`)
  }
  return `https://my.vatsim.net/pilots/flightplan?${params.toString()}`
}
