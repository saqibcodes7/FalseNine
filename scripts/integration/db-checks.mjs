/**
 * Read-only checks of the development project's database, used by
 * integration:dev:verify and at the end of integration:dev:migrate.
 *
 * Compares the project against scripts/integration/expectations.json (built
 * from the migrations on a plain local Postgres with no default grants):
 * every privilege anon and authenticated hold in public, the read policies,
 * row level security and the Realtime publication. So any grant a migration
 * forgot, which Supabase used to add automatically, shows up here as a
 * difference. It also checks the fictional fixture and the difficulty
 * profile the gate needs.
 *
 * After `npm run integration:dev:gate` has run, it also checks the gate's own
 * evidence (.integration/last-run.json): that each anonymous user the Auth API
 * created exists in auth.users as anonymous, and that each seat the gate kept
 * open is owned, in seat_owners, by the user whose token created it. That is
 * the proof that auth.uid() inside the RPCs is the signed-in user.
 *
 * Nothing here writes to the database.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { OUTPUT_DIR, ROOT } from './config.mjs'
import { migrationState, scalar } from './db.mjs'
import { DEFAULT_ACL_SQL, ORACLE_SQL, POLICIES_SQL, PRIVILEGES_SQL, PUBLICATION_SQL, RLS_SQL, SCHEMA_USAGE_SQL } from './sql.mjs'

const readJson = (file) => JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'))

// Tables whose rows belong to a lobby. No read policy on these may be "true".
const GUARDED_TABLES = ['sessions', 'players', 'seat_owners', 'ttt_settings', 'ttt_boards', 'ttt_board_axes', 'ttt_games', 'ttt_moves', 'ttt_board_cells', 'ttt_move_checks']

const normaliseQual = (q) => String(q ?? '').toLowerCase().replace(/::text/g, '').replace(/[\s()]/g, '')

async function json(client, sql) {
  return scalar(client, sql)
}

export async function runVerify(client, report, config, { withEvidence = true } = {}) {
  const expectations = readJson('scripts/integration/expectations.json')
  const oracle = readJson('scripts/integration/fixture-oracle.json')

  report.section('Migrations')
  const state = await migrationState(client)
  const missing = state.filter((m) => !m.applied).map((m) => m.version)
  report.check('migrations 0001 to 0010 are all applied', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '')
  if (missing.length) return

  report.section('Grants: nothing relies on Supabase adding them automatically')
  const live = await json(client, PRIVILEGES_SQL)
  const key = (p) => `${p.kind} ${p.name} ${p.role}`
  const expectedMap = new Map(expectations.privileges.map((p) => [key(p), p]))
  const liveMap = new Map(live.map((p) => [key(p), p]))
  const diffs = []
  for (const [k, exp] of expectedMap) {
    const got = liveMap.get(k)
    if (!got) diffs.push({ k, expected: exp.privs, got: '(object missing)', trigger: exp.trigger_function })
    else if (got.privs !== exp.privs) diffs.push({ k, expected: exp.privs || '(none)', got: got.privs || '(none)', trigger: exp.trigger_function })
  }
  for (const [k, got] of liveMap) {
    if (!expectedMap.has(k)) diffs.push({ k, expected: '(object not in the migrations)', got: got.privs || '(none)', trigger: got.trigger_function })
  }
  const hard = diffs.filter((d) => !d.trigger)
  const soft = diffs.filter((d) => d.trigger)
  report.check(
    `anon and authenticated hold exactly the privileges the migrations grant (${live.length} checked, ${live.filter((p) => p.privs).length} granted)`,
    hard.length === 0,
    hard.length ? `${hard.length} differences` : '',
  )
  for (const d of hard.slice(0, 40)) report.note(`${d.k}: expected ${d.expected}, found ${d.got}`)
  for (const d of soft) report.info(`trigger function ${d.k} (cannot be called directly)`, `expected ${d.expected || '(none)'}, found ${d.got}`)

  const usage = await json(client, SCHEMA_USAGE_SQL)
  report.check('anon and authenticated can use the public schema, and cannot create objects in it',
    usage.anon_usage && usage.authenticated_usage && !usage.anon_create && !usage.authenticated_create, usage)

  const defaults = await json(client, DEFAULT_ACL_SQL)
  const autoGrants = defaults.filter((d) => /(anon|authenticated)=/.test(d.acl) && (d.objects === 'tables' || d.objects === 'sequences'))
  report.info(
    autoGrants.length
      ? 'new tables or sequences in public WOULD be granted to anon/authenticated automatically (legacy default)'
      : 'new tables and sequences in public are NOT granted to anon/authenticated automatically ("Automatically expose new tables" is off)',
    defaults.map((d) => `${d.owner} ${d.objects}: ${d.acl}`).join('; ') || 'no default privileges in public',
  )

  report.section('Row level security and read policies')
  const rls = await json(client, RLS_SQL)
  report.check(`row level security is on for every table in public (${rls.tables} tables)`, rls.without_rls.length === 0, rls.without_rls.join(', '))

  const policies = await json(client, POLICIES_SQL)
  const pkey = (p) => `${p.table} / ${p.policy}`
  const expPolicies = new Map(expectations.policies.map((p) => [pkey(p), p]))
  const livePolicies = new Map(policies.map((p) => [pkey(p), p]))
  const policyDiffs = []
  for (const [k, exp] of expPolicies) {
    const got = livePolicies.get(k)
    if (!got) policyDiffs.push(`${k}: missing`)
    else {
      if (got.cmd !== exp.cmd) policyDiffs.push(`${k}: command ${got.cmd}, expected ${exp.cmd}`)
      if (JSON.stringify(got.roles) !== JSON.stringify(exp.roles)) policyDiffs.push(`${k}: roles ${got.roles}, expected ${exp.roles}`)
      if (normaliseQual(got.qual) !== normaliseQual(exp.qual)) policyDiffs.push(`${k}: using (${got.qual}), expected (${exp.qual})`)
    }
  }
  for (const k of livePolicies.keys()) if (!expPolicies.has(k)) policyDiffs.push(`${k}: not in the migrations`)
  report.check(`the ${expectations.policies.length} read policies are exactly the migrations' ones`, policyDiffs.length === 0, policyDiffs.length ? `${policyDiffs.length} differences` : '')
  for (const d of policyDiffs) report.note(d)
  const open = policies.filter((p) => GUARDED_TABLES.includes(p.table) && normaliseQual(p.qual) === 'true')
  report.check('no lobby table (sessions, players, seat owners, ttt_*) has a USING (true) read policy', open.length === 0, open.map(pkey).join(', '))

  report.section('Realtime publication')
  const pub = await json(client, PUBLICATION_SQL)
  report.check('supabase_realtime publishes exactly the tables the migrations add',
    JSON.stringify(pub.tables) === JSON.stringify(expectations.publication.tables), `${pub.tables.join(', ')}`)
  const notFull = Object.entries(pub.replica_identity).filter(([, v]) => v !== 'f').map(([t]) => t)
  report.check('every published table has REPLICA IDENTITY FULL', notFull.length === 0, notFull.join(', '))

  report.section('Fictional fixture and test settings')
  const liveOracle = await json(client, ORACLE_SQL)
  const nonFixture = await scalar(client, "select count(*)::int from public.football_players where source <> 'fixture'")
  report.check(`the fictional fixture is loaded (${liveOracle.players?.length ?? 0} footballers)`, (liveOracle.players?.length ?? 0) === oracle.players.length)
  report.check('there are no non-fixture footballers', nonFixture === 0, `${nonFixture} found`)
  const same = JSON.stringify({ p: liveOracle.players, c: liveOracle.categories }) === JSON.stringify({ p: oracle.players, c: oracle.categories })
  report.check('who fits each criterion matches scripts/integration/fixture-oracle.json, which the gate relies on', same)
  const profile = await scalar(client, 'select active_profile from public.ttt_config')
  report.check('boards are generated with the dev difficulty profile, which the small fixture needs', profile === 'dev', `active_profile = ${profile}`)
  const uidDef = await scalar(client, "select pg_get_functiondef('auth.uid()'::regprocedure)")
  report.info('auth.uid() reads the request JWT', /request\.jwt\.claim/.test(uidDef ?? '') ? 'reads request.jwt.claim(s)' : 'definition does not mention request.jwt.claim(s)')
  const orphanSeats = await scalar(client, `
    select count(*)::int from public.players p join public.sessions s on s.id = p.session_id
    where s.game_mode = 'tic_tac_toe' and not exists (select 1 from public.seat_owners o where o.player_id = p.id)`)
  report.check('every Tic-Tac-Toe seat in the project has an owner', orphanSeats === 0, `${orphanSeats} without`)

  if (!withEvidence) return
  const evidenceFile = path.join(ROOT, OUTPUT_DIR, 'last-run.json')
  if (!existsSync(evidenceFile)) {
    report.skip('the gate\'s evidence', 'no .integration/last-run.json yet; run npm run integration:dev:gate, then verify again')
    return
  }
  const evidence = JSON.parse(readFileSync(evidenceFile, 'utf8'))
  report.section(`The gate's evidence (${path.relative(ROOT, evidenceFile)}, from ${evidence.finishedAt ?? evidence.startedAt})`)
  if (evidence.target?.ref !== config.ref) {
    report.fail('the evidence file is from a run against a different target', evidence.target)
    return
  }
  for (const [label, id] of Object.entries(evidence.users ?? {})) {
    const row = (await client.query('select id, is_anonymous from auth.users where id = $1', [id])).rows[0]
    report.check(`user ${label} exists in Supabase Auth as an anonymous user`, Boolean(row?.is_anonymous), row ? `is_anonymous = ${row.is_anonymous}` : 'not found')
  }
  for (const seat of evidence.keptSeats ?? []) {
    const owner = (await client.query('select auth_user_id from public.seat_owners where player_id = $1 and session_id = $2', [seat.playerId, seat.sessionId])).rows[0]
    const expected = evidence.users?.[seat.user]
    report.check(
      `seat ${seat.label} is owned by user ${seat.user}: the auth.uid() inside ${seat.via} was that user's Auth id`,
      Boolean(owner) && owner.auth_user_id === expected,
      owner ? `owner ${owner.auth_user_id}, user ${expected}` : 'seat or owner row not found',
    )
  }
  const left = await scalar(client, 'select count(*)::int from public.sessions where id = any($1::uuid[])', [evidence.closedLobbies ?? []])
  report.check('every lobby the gate said it closed is gone', left === 0, `${left} still there`)
}
