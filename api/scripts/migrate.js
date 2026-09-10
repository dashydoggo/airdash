import "dotenv/config"
import { migrate, pool } from "../src/database.js"

await migrate()
console.log("airDash database migration complete")
await pool.end()
