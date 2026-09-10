import { useNavigate } from 'react-router-dom'
import Screen from '../components/Screen'
import Button from '../components/Button'
import ConfigNotice from '../components/ConfigNotice'
import { isSupabaseConfigured } from '../lib/supabase'
import { listIdentities } from '../lib/identity'

const RULES = [
  'Everyone gets the same footballer. Everyone except the imposter.',
  'Take turns dropping a clue. Vague enough to survive, sharp enough to prove you know.',
  'Vote someone out. Get it wrong and the imposter is still at the table.',
]

export default function ImposterHome() {
  const navigate = useNavigate()
  const openLobbies = isSupabaseConfigured ? listIdentities() : []

  return (
    <Screen
      back="/"
      backLabel="All games"
      title="Football Imposter"
      subtitle="Three to twelve players. Bring your worst poker face."
    >
      {!isSupabaseConfigured && (
        <div className="mb-6">
          <ConfigNotice />
        </div>
      )}

      <div className="space-y-3">
        <Button
          size="lg"
          fullWidth
          disabled={!isSupabaseConfigured}
          onClick={() => navigate('/imposter/create')}
        >
          Create game
        </Button>

        <Button
          size="lg"
          variant="secondary"
          fullWidth
          disabled={!isSupabaseConfigured}
          onClick={() => navigate('/imposter/join')}
        >
          Join game
        </Button>
      </div>

      {openLobbies.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-bold tracking-[0.14em] text-chalk-600 uppercase">
            Rejoin
          </h2>
          <ul className="space-y-2">
            {openLobbies.map((entry) => (
              <li key={entry.code}>
                <button
                  type="button"
                  onClick={() => navigate(`/imposter/lobby/${entry.code}`)}
                  className="flex w-full items-center justify-between rounded-xl border border-pitch-700 bg-pitch-900 px-4 py-3 text-left transition-colors hover:border-lime-400"
                >
                  <span className="min-w-0">
                    <span className="tabular block font-bold text-lime-400">
                      {entry.code}
                    </span>
                    <span className="block truncate text-sm text-chalk-400">
                      as {entry.displayName}
                      {entry.isHost ? ' · host' : ''}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-chalk-600">
                    &rarr;
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10 rounded-tile border border-pitch-700 bg-pitch-900 p-5">
        <h2 className="text-sm font-bold tracking-[0.14em] text-chalk-600 uppercase">
          How it plays
        </h2>
        <ol className="mt-4 space-y-3">
          {RULES.map((rule, i) => (
            <li key={rule} className="flex gap-3">
              <span
                aria-hidden="true"
                className="tabular grid h-6 w-6 shrink-0 place-items-center rounded-full bg-pitch-700 text-xs font-bold text-lime-400"
              >
                {i + 1}
              </span>
              <span className="text-sm leading-relaxed text-chalk-400">
                {rule}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </Screen>
  )
}
