/**
 * Checks the integration configuration and shows the target, without making
 * a single network request.
 *
 *   npm run integration:dev:check
 *
 * Run it first, and read what it prints: it names the only project the other
 * integration commands will touch.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { COMMANDS, ROOT, describeTarget, loadConfig, parseArgs, parseEnvText } from './config.mjs'

parseArgs([])
const config = loadConfig({ needApi: true, needDb: false })
const envPath = path.join(ROOT, config.envFile)
const fileVars = existsSync(envPath) ? parseEnvText(readFileSync(envPath, 'utf8')) : {}
let dbLine = 'Database:   FN_DEV_DB_URL not set (only integration:dev:plan, migrate and verify need it)'
if (process.env.FN_DEV_DB_URL || fileVars.FN_DEV_DB_URL) {
  // Exits with a refusal if the connection string is not acceptable.
  const withDb = loadConfig({ needApi: true, needDb: true })
  dbLine = describeTarget(withDb).split('\n').find((l) => l.startsWith('Database:'))
}
console.log(`\n${describeTarget(config)}`)
console.log(dbLine)
for (const file of ['scripts/integration/expectations.json', 'scripts/integration/fixture-oracle.json']) {
  if (!existsSync(path.join(ROOT, file))) {
    console.error(`\nMissing ${file}. Run npm run integration:build-expectations against a local Postgres first.`)
    process.exit(2)
  }
}
console.log('\nConfiguration accepted. No network request was made.\n')
console.log(`The integration commands, one per mode (never add flags after "npm run ... --"):\n\n${COMMANDS}\n`)
