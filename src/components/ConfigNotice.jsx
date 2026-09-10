/**
 * Shown when .env.local has not been filled in yet. The shell is deliberately
 * usable without a backend so you can work on layout first, but anything that
 * talks to Supabase has to say so plainly rather than failing silently.
 */
export default function ConfigNotice() {
  return (
    <div className="rounded-tile border border-flag-500/40 bg-flag-500/5 p-5">
      <h2 className="text-base font-bold text-chalk-100">
        Supabase is not connected yet
      </h2>

      <p className="mt-2 text-sm leading-relaxed text-chalk-400">
        Creating and joining games needs a database. Copy{' '}
        <code className="rounded bg-pitch-800 px-1.5 py-0.5 text-xs text-lime-400">
          .env.example
        </code>{' '}
        to{' '}
        <code className="rounded bg-pitch-800 px-1.5 py-0.5 text-xs text-lime-400">
          .env.local
        </code>
        , paste in your project URL and anon key, run{' '}
        <code className="rounded bg-pitch-800 px-1.5 py-0.5 text-xs text-lime-400">
          supabase/migrations/0001_init.sql
        </code>{' '}
        in the SQL editor, then restart the dev server.
      </p>

      <p className="mt-3 text-sm text-chalk-600">
        Full walkthrough is in the README.
      </p>
    </div>
  )
}
