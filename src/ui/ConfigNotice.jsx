import Panel from './Panel'

/*
 * Shown when .env.local has not been filled in. It is the one thing on the
 * screen that is actually wrong, so it is the one thing wearing the flag.
 */
export default function ConfigNotice() {
  const code = (t) => (
    <code className="rounded-[5px] bg-black/35 px-1.5 py-0.5 text-[0.8em] text-gold">
      {t}
    </code>
  )

  return (
    <Panel title="Setup" accent="accent-flag" tint role="alert">
      <p className="text-callout font-semibold text-text">Supabase is not connected</p>
      <p className="mt-1.5 text-subhead leading-relaxed text-text-2">
        Creating and joining games needs a database. Copy {code('.env.example')} to{' '}
        {code('.env.local')}, paste in your project URL and publishable key, run the files
        in {code('supabase/migrations')} in the SQL editor, then restart the dev server.
        The README has the full walkthrough.
      </p>
    </Panel>
  )
}
