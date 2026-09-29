/**
 * Read-only checks of the development project's database.
 *
 *   npm run integration:dev:verify
 *
 * See db-checks.mjs for what is checked. Nothing here writes to the database.
 */
import { describeTarget, loadConfig } from './config.mjs'
import { connect, identifySupabase } from './db.mjs'
import { runVerify } from './db-checks.mjs'
import { createReport } from './report.mjs'

async function main() {
  const config = loadConfig({ needApi: false, needDb: true })
  console.log(`\nintegration:dev:verify (read-only)\n\n${describeTarget(config)}\n`)
  const report = createReport('verify')
  let client
  try {
    client = await connect(config)
    const who = await identifySupabase(client)
    const supabase = who.api_roles === 3 && who.has_auth && who.has_auth_users && who.has_auth_uid && who.has_realtime && who.has_publication
    report.section('Target')
    report.check('this is a Supabase database (API roles, Auth, Realtime and its publication are all there)', supabase, `Postgres ${who.server_version}, connected as ${who.current_user}`)
    if (supabase) await runVerify(client, report, config)
  } catch (error) {
    report.fail('verify could not finish', error.message)
  } finally {
    await client?.end().catch(() => {})
  }
  process.exit(report.finish())
}

main()
