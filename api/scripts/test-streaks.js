import assert from "node:assert/strict"
import { applyStreakBonus, computeStreaks, publicStreaks, streakBonusPercent } from "../src/streaks.js"

const flight = (id, day, origin, destination, hour = 12) => ({
  id,
  actual_out_at: `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`,
  origin,
  destination,
})

assert.equal(streakBonusPercent(0), 0)
assert.equal(streakBonusPercent(2), 0)
assert.equal(streakBonusPercent(3), 5)
assert.equal(streakBonusPercent(4), 10)
assert.equal(streakBonusPercent(5), 15)
assert.equal(streakBonusPercent(20), 15)
assert.deepEqual(applyStreakBonus(100, 2), { baseExperience: 100, bonusPercent: 0, bonusExperience: 0, totalExperience: 100 })
assert.deepEqual(applyStreakBonus(100, 3), { baseExperience: 100, bonusPercent: 5, bonusExperience: 5, totalExperience: 105 })
assert.deepEqual(applyStreakBonus(84, 4), { baseExperience: 84, bonusPercent: 10, bonusExperience: 8, totalExperience: 92 })
assert.deepEqual(applyStreakBonus(84, 5), { baseExperience: 84, bonusPercent: 15, bonusExperience: 13, totalExperience: 97 })
assert.deepEqual(applyStreakBonus(100, 20), { baseExperience: 100, bonusPercent: 15, bonusExperience: 15, totalExperience: 115 })

const empty = computeStreaks([], new Date("2026-09-10T12:00:00Z"))
assert.deepEqual(publicStreaks(empty), {
  flightDays: { current: 0, best: 0, lastFlightDate: null, bonusPercent: 0 },
  continuity: { current: 0, best: 0, lastDestination: null },
})

const chain = computeStreaks([
  flight(1, "2026-09-08", "KATL", "KMCO"),
  flight(2, "2026-09-09", "KMCO", "KJFK"),
  flight(3, "2026-09-10", "KJFK", "KBOS"),
], new Date("2026-09-10T23:00:00Z"))
assert.equal(chain.flightDays.current, 3)
assert.equal(chain.flightDays.best, 3)
assert.equal(chain.flightDays.bonusPercent, 5)
assert.equal(chain.continuity.current, 3)
assert.equal(chain.continuity.best, 3)
assert.deepEqual(chain.awards["3"], { flightDays: 3, continuity: 3 })

const sameDay = computeStreaks([
  flight(1, "2026-09-09", "KATL", "KMCO", 8),
  flight(2, "2026-09-09", "KMCO", "KJFK", 18),
  flight(3, "2026-09-10", "KJFK", "KBOS", 9),
], new Date("2026-09-10T12:00:00Z"))
assert.equal(sameDay.flightDays.current, 2)
assert.equal(sameDay.awards["1"].flightDays, 1)
assert.equal(sameDay.awards["2"].flightDays, 1)
assert.equal(sameDay.awards["3"].flightDays, 2)
assert.equal(sameDay.continuity.current, 3)

const broken = computeStreaks([
  flight(1, "2026-09-05", "KATL", "KMCO"),
  flight(2, "2026-09-06", "KMCO", "KJFK"),
  flight(3, "2026-09-07", "KJFK", "KBOS"),
  flight(4, "2026-09-10", "KDEN", "KLAX"),
], new Date("2026-09-10T12:00:00Z"))
assert.equal(broken.flightDays.current, 1)
assert.equal(broken.flightDays.best, 3)
assert.equal(broken.continuity.current, 1)
assert.equal(broken.continuity.best, 3)

const expired = computeStreaks([
  flight(1, "2026-09-05", "KATL", "KMCO"),
  flight(2, "2026-09-06", "KMCO", "KATL"),
], new Date("2026-09-10T12:00:00Z"))
assert.equal(expired.flightDays.current, 0)
assert.equal(expired.flightDays.best, 2)
assert.equal(expired.continuity.current, 2)

console.log("streak calculations verified")
