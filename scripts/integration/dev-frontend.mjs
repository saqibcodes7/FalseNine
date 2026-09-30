/**
 * Starts the app's dev server against the DEVELOPMENT Supabase project, for
 * trying the frontend by hand, without touching .env.local.
 *
 *   npm run integration:dev:frontend
 *
 * It reads the same .env.integration.local as the rest of the integration
 * commands and makes the same checks before anything starts (config.mjs): the
 * URL must name FN_DEV_PROJECT_REF, the key must be a publishable key, and a
 * protected project (FN_PROTECTED_PROJECT_REFS, or whatever the app's own
 * .env files point at) is refused. Then it runs Vite with VITE_SUPABASE_URL
 * and VITE_SUPABASE_ANON_KEY set to the development project's URL and
 * publishable key, for that one process only. Values already in the
 * environment win over .env files in Vite, so .env.local (which may point at
 * production) is left exactly as it is and is simply not used for those two.
 *
 * Nothing else from .env.integration.local reaches Vite. The database URL and
 * its password are never read here, and no secret key is ever passed on.
 *
 * It serves on port 5180, not Vite's usual 5173, so a tab showing the
 * development project is never mistaken for one showing the normal app.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { ROOT, describeTarget, loadConfig, parseArgs } from './config.mjs'

const PORT = 5180

parseArgs([])
const config = loadConfig({ needApi: true, needDb: false })

const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
if (!existsSync(vite)) {
  console.error('\nVite is not installed. Run npm install first.\n')
  process.exit(2)
}

// The child gets the ordinary environment minus every integration setting,
// plus the two values the browser needs.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('FN_')))
env.VITE_SUPABASE_URL = config.url
env.VITE_SUPABASE_ANON_KEY = config.key

console.log(`\n${describeTarget(config)}`)
console.log(`
Frontend:   http://localhost:${PORT}  ->  ${config.mode === 'hosted' ? `development project ${config.ref}` : 'local stack'}
            .env.local is not changed and not used for the Supabase URL or key.
            Stop with Ctrl+C.
`)

const child = spawn(process.execPath, [vite, '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: 'inherit' })
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
