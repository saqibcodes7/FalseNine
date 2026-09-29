/**
 * The Stage 5A integration gate: Football Tic-Tac-Toe against real Supabase
 * Auth, PostgREST, row level security and Realtime, through the project's
 * public API with the publishable key, exactly as the browser will use it.
 *
 *   npm run integration:dev:gate
 *   npm run integration:dev:gate:expiry   also outlive an access token (--wait-for-expiry)
 *
 * Sections:
 *   0. the development project answers, with Anonymous Sign-ins on
 *   1. Anonymous Auth: real users, their tokens, a saved session reloaded
 *   2. a whole match: create, join, two seats, settings, start, right, wrong,
 *      pass, refusals, a win, difficulty between boards, rematch
 *   3. nobody can act for anyone else, from inside or outside the lobby
 *   4. who can read what, the private tables, the helper functions, and the
 *      API surface (new signatures present, old ones gone)
 *   5. leaving, and a replacement opponent
 *   6. Football Imposter unchanged
 *   7. Realtime, with separately signed-in clients
 *   8. the important races, through the API
 *
 * It creates about six anonymous users (FN_DEV_MAX_SIGNINS caps it) and a
 * handful of lobbies, closes every lobby except one kept for
 * integration:dev:verify to inspect, and writes .integration/last-run.json.
 * It never uses a secret key and never connects to the database.
 */
import { describeTarget, loadConfig, parseArgs } from './config.mjs'
import { createReport } from './report.mjs'
import { Gate, Stop } from './gate/kit.mjs'
import { anonymousAuth, leaving, nobodyActsForAnyoneElse, preflight, wholeMatch, whoCanRead } from './gate/ttt.mjs'
import { imposter } from './gate/imposter.mjs'
import { realtime } from './gate/realtime.mjs'
import { races } from './gate/races.mjs'

const args = parseArgs(['--wait-for-expiry'])
const config = loadConfig({ needApi: true, needDb: false })
console.log(`\nintegration:dev:gate\n\n${describeTarget(config)}\n`)
const report = createReport('gate')
const gate = new Gate(config, report)
// Off by default: with Supabase's default one-hour access token it would wait
// an hour. See scripts/integration/README.md.
gate.waitForExpiry = args.has('--wait-for-expiry')
const startedAt = new Date().toISOString()

const sections = [
  ['preflight', preflight, true],
  ['anonymous auth', anonymousAuth, true],
  ['a whole match', wholeMatch, true],
  ['nobody acts for anyone else', nobodyActsForAnyoneElse, false],
  ['who can read what', whoCanRead, false],
  ['leaving', leaving, false],
  ['Football Imposter', imposter, false],
  ['Realtime', realtime, false],
  ['races', races, false],
]

try {
  for (const [name, run, essential] of sections) {
    try {
      await run(gate)
    } catch (error) {
      if (error instanceof Stop) report.fail(`${name} stopped`, error.message)
      else report.fail(`${name} stopped on an unexpected error`, error.stack ?? error.message)
      if (essential) {
        report.note('The sections after this one depend on it, so the gate stops here.')
        break
      }
    }
  }
} finally {
  await gate.cleanup().catch((error) => report.info('cleanup did not finish', error.message))
}

report.info('anonymous users created by this run', `${gate.signIns}; they stay in the development project's Auth users (removing them needs the secret key, which the gate never uses)`)
const kept = gate.lobbies.filter((l) => l.kept).map((l) => `${l.label} ${l.code}`)
report.info('lobbies left open on purpose, for integration:dev:verify', kept.join(', ') || 'none')

const code = report.finish({
  json: {
    file: 'last-run.json',
    data: {
      startedAt,
      finishedAt: new Date().toISOString(),
      target: { ref: config.ref, url: config.url },
      failed: report.failed,
      users: Object.fromEntries(Object.entries(gate.users).map(([label, u]) => [label, u.id])),
      keptSeats: gate.keptSeats,
      closedLobbies: gate.closedLobbies,
    },
  },
})
process.exit(code)
