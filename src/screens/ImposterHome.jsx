import { useNavigate } from 'react-router-dom'
import Screen from '../ui/Screen'
import Button from '../ui/Button'
import Panel from '../ui/Panel'
import Chip from '../ui/Chip'
import ConfigNotice from '../ui/ConfigNotice'
import { isSupabaseConfigured } from '../lib/supabase'
import { listIdentities } from '../lib/identity'

const RULES = [
  'Everyone is shown the same footballer. Everyone except the imposter.',
  'Take turns dropping a clue. Vague enough to survive, sharp enough to prove you know.',
  'Vote someone out. Get it wrong and the imposter is still at the table.',
]

export default function ImposterHome() {
  const navigate = useNavigate()
  const openLobbies = isSupabaseConfigured ? listIdentities() : []

  return (
    <Screen
      back="/"
      backLabel="Binder"
      title="Football Imposter"
      subtitle="Three to twelve players. Bring your worst poker face."
    >
      {!isSupabaseConfigured && (
        <div className="mb-6">
          <ConfigNotice />
        </div>
      )}

      {/* match card: a sliver of the art beside the facts */}
      <div className="mb-6 flex items-center gap-4">
        <div
          className="frame metal-gold h-[4.5rem] w-[4.5rem] shrink-0"
          style={{ '--fw': '3px', '--fr': '10px' }}
        >
          <div className="frame-inner enamel-ink">
            <picture>
              <source srcSet="/assets/art/imposter.webp" type="image/webp" />
              <img
                src="/assets/art/imposter.png"
                alt=""
                className="block h-full w-full object-cover object-[50%_20%]"
                width="254"
                height="266"
              />
            </picture>
          </div>
        </div>
        <ul className="display space-y-0.5 text-[1.15rem] leading-[1.1] tracking-[0.1em] text-gold engraved">
          <li>One footballer</li>
          <li>One liar, or more</li>
          <li>One vote a round</li>
        </ul>
      </div>

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
        <Panel title="Rejoin" className="mt-8">
          <ul className="divide-y divide-ink-3">
            {openLobbies.map((entry) => (
              <li key={entry.code}>
                <button
                  type="button"
                  onClick={() => navigate(`/imposter/lobby/${entry.code}`)}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition-colors hover:text-gold-hi"
                >
                  <span className="min-w-0">
                    <span className="display tabular block text-[1.6rem] leading-none tracking-[0.12em] text-lime">
                      {entry.code}
                    </span>
                    <span className="block truncate text-small text-chalk-1">
                      as {entry.displayName}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {entry.isHost && <Chip tone="gold">Host</Chip>}
                    <span aria-hidden="true" className="text-gold">
                      &rarr;
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="How it plays" className="mt-8">
        <ol className="space-y-3">
          {RULES.map((rule, i) => (
            <li key={rule} className="flex gap-3">
              <span className="disc metal-gold shrink-0" aria-hidden="true">
                {i + 1}
              </span>
              <span className="pt-0.5 text-small leading-relaxed text-chalk-0">{rule}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </Screen>
  )
}
