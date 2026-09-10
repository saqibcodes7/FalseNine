import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * True once .env.local has real values in it. The app shell is built to run
 * without a backend so you can work on layout and design before the Supabase
 * project exists — the Imposter screens check this and explain themselves
 * rather than throwing a stack trace at you.
 */
export const isSupabaseConfigured = Boolean(
  url && anonKey && !url.includes('your-project-ref'),
)

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        // No logins in this game. Skipping session persistence keeps
        // localStorage clean and avoids a pointless token refresh timer.
        persistSession: false,
        autoRefreshToken: false,
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    })
  : null

/**
 * Postgres raises with a message written for the player, not for a log file.
 * supabase-js wraps that in an object; this digs the useful sentence back out.
 */
export function readableError(error, fallback = 'Something went wrong.') {
  if (!error) return fallback
  const message = error.message || error.error_description || ''
  if (!message) return fallback

  // The app is ahead of the database: a migration has not been run yet.
  // PostgREST reports this as a missing function, which is not what the person
  // holding the phone needs to hear.
  if (/could not find the function public\.(create_session|update_session_settings)/i.test(message)) {
    return 'The database is a step behind the app. Run the newest file in supabase/migrations in the Supabase SQL editor, then try again.'
  }

  // supabase-js prefixes some Postgres errors. Strip the noise.
  const cleaned = message
    .replace(/^.*?violates row-level security policy.*$/i, 'That action is not allowed.')
    .replace(/^Failed to fetch$/i, 'Could not reach the server. Check your connection.')
    .trim()

  return cleaned || fallback
}

/** Every column the browser is allowed to read from `sessions`. */
export const SESSION_COLUMNS =
  'id, code, host_player_id, player_pack, difficulty, num_imposters, ai_hints_enabled, discussion_seconds, voting_seconds, status, current_round, created_at, started_at'

/** Every column the browser is allowed to read from `players`. */
export const PLAYER_COLUMNS =
  'id, session_id, display_name, is_host, is_active, has_peeked, joined_at'
