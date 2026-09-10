const DAY_MS = 86_400_000

const dayKey = value => new Date(value).toISOString().slice(0, 10)
const dayNumber = value => Date.parse(`${value}T00:00:00Z`) / DAY_MS

export function streakBonusPercent(dayStreak) {
  if (dayStreak < 3) return 0
  return Math.min(15, (dayStreak - 2) * 5)
}

export function applyStreakBonus(baseExperience, dayStreak) {
  const bonusPercent = streakBonusPercent(dayStreak)
  const bonusExperience = Math.round(baseExperience * bonusPercent / 100)
  return { baseExperience, bonusPercent, bonusExperience, totalExperience: baseExperience + bonusExperience }
}

export function computeStreaks(rows, now = new Date()) {
  const flights = rows
    .filter(row => row.actual_out_at && !Number.isNaN(new Date(row.actual_out_at).valueOf()))
    .map(row => ({ ...row, flightDay: dayKey(row.actual_out_at) }))
    .sort((a, b) => new Date(a.actual_out_at).valueOf() - new Date(b.actual_out_at).valueOf() || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }))

  if (flights.length === 0) {
    return {
      flightDays: { current: 0, best: 0, lastFlightDate: null, bonusPercent: 0 },
      continuity: { current: 0, best: 0, lastDestination: null },
      awards: {},
    }
  }

  const distinctDays = [...new Set(flights.map(flight => flight.flightDay))]
  const dayRuns = new Map()
  let previousDay = null
  let dayRun = 0
  let bestDayRun = 0
  for (const flightDay of distinctDays) {
    const currentDay = dayNumber(flightDay)
    dayRun = previousDay !== null && currentDay - previousDay === 1 ? dayRun + 1 : 1
    dayRuns.set(flightDay, dayRun)
    bestDayRun = Math.max(bestDayRun, dayRun)
    previousDay = currentDay
  }

  let continuityRun = 0
  let bestContinuityRun = 0
  let previousDestination = null
  const awards = {}
  for (const flight of flights) {
    const origin = String(flight.origin ?? "").toUpperCase()
    const destination = String(flight.destination ?? "").toUpperCase()
    continuityRun = previousDestination && origin === previousDestination ? continuityRun + 1 : 1
    bestContinuityRun = Math.max(bestContinuityRun, continuityRun)
    awards[String(flight.id)] = {
      flightDays: dayRuns.get(flight.flightDay) ?? 1,
      continuity: continuityRun,
    }
    previousDestination = destination || null
  }

  const lastFlightDate = distinctDays.at(-1)
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / DAY_MS
  const activeDayRun = today - dayNumber(lastFlightDate) <= 1 ? dayRuns.get(lastFlightDate) ?? 0 : 0

  return {
    flightDays: {
      current: activeDayRun,
      best: bestDayRun,
      lastFlightDate,
      bonusPercent: streakBonusPercent(activeDayRun),
    },
    continuity: {
      current: continuityRun,
      best: bestContinuityRun,
      lastDestination: previousDestination,
    },
    awards,
  }
}

export function publicStreaks(streaks) {
  return { flightDays: streaks.flightDays, continuity: streaks.continuity }
}

export async function calculatePilotStreaks(executor, discordId, now = new Date()) {
  const result = await executor.query(`SELECT p.id, p.actual_out_at, r.origin, COALESCE(p.actual_destination, p.reposition_airport, r.destination) destination
    FROM airdash.pireps p
    JOIN airdash.assignments a ON a.id=p.assignment_id
    JOIN airdash.routes r ON r.id=a.route_id
    WHERE p.discord_id=$1 AND p.review_status='APPROVED'
    ORDER BY p.actual_out_at, p.id`, [discordId])
  return computeStreaks(result.rows, now)
}
