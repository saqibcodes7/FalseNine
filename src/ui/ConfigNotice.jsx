/*
 * Shown when .env.local has not been filled in. A red enamel plate, because it
 * is the one thing on the screen that is actually wrong.
 */
export default function ConfigNotice() {
  const code = (t) => (
    <code className="rounded-[3px] bg-ink-0 px-1.5 py-0.5 font-ui text-[0.8rem] text-gold-hi">
      {t}
    </code>
  )

  return (
    <div className="frame metal-steel" style={{ '--fw': '3px' }} role="alert">
      <div className="frame-inner enamel-red px-4 pt-3 pb-4">
        <p className="display text-title leading-none text-gold-hi engraved">
          Supabase is not connected
        </p>
        <p className="mt-2 text-small leading-relaxed text-chalk-0">
          Creating and joining games needs a database. Copy {code('.env.example')} to{' '}
          {code('.env.local')}, paste in your project URL and publishable key, run{' '}
          {code('supabase/migrations/0001_init.sql')} in the SQL editor, then restart the
          dev server. The README has the full walkthrough.
        </p>
      </div>
    </div>
  )
}
