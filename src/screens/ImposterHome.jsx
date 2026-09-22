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

      {/* a sliver of the key art beside the facts */}
      <div className="mb-7 flex items-center gap-4">
        <div className="art accent-crimson h-[4.75rem] w-[4.75rem] shrink-0 rounded-[18px] shadow-[inset_0_0_0_1px_oklch(100%_0_0/.1)]">
          <picture>
            <source srcSet="/assets/art/imposter.webp" type="image/webp" />
            <img
              src="/assets/art/imposter.png"
              alt=""
              className="object-[56%_22%]"
              width="720"
              height="720"
            />
          </picture>
        </div>
        <ul className="space-y-1 text-subhead font-medium text-text-2">
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

      {/* Everything above needs a phone each and a connection. Everything below
          needs neither, which is a big enough difference to draw a line at. */}
      <div className="my-6 flex items-center gap-3.5" aria-hidden="true">
        <span className="hairline flex-1" />
        <span className="eyebrow">Or one phone</span>
        <span className="hairline flex-1" />
      </div>

      <div className="space-y-3">
        {/* Not disabled by the config notice: this one needs no backend. */}
        <Button
          size="lg"
          variant="secondary"
          fullWidth
          onClick={() => navigate('/imposter/pass')}
        >
          Pass &amp; Play
        </Button>
        <p className="px-1 text-center text-footnote leading-snug text-text-3">
          No codes, nobody online. Pass it round the table.
        </p>
      </div>

      {openLobbies.length > 0 && (
        <Panel title="Rejoin" className="mt-8" bodyClassName="p-0">
          <ul className="divide-hairline">
            {openLobbies.map((entry) => (
              <li key={entry.code}>
                <button
                  type="button"
                  onClick={() => navigate(`/imposter/lobby/${entry.code}`)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="min-w-0">
                    <span
                      className="tabular block text-title3 font-bold tracking-[0.06em] text-gold"
                      data-testid="rejoin-code"
                    >
                      {entry.code}
                    </span>
                    <span className="block truncate text-footnote text-text-3">
                      as {entry.displayName}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {entry.isHost && <Chip tone="gold">Host</Chip>}
                    <svg aria-hidden="true" viewBox="0 0 12 20" className="h-4 w-2.5 text-text-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 2l8 8-8 8" />
                    </svg>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="How it plays" className="mt-8" bodyClassName="p-0">
        <ol className="divide-hairline">
          {RULES.map((rule, i) => (
            <li key={rule} className="flex gap-3.5 px-4 py-3.5">
              <span
                className="accent-gold fill-accent grid h-6 w-6 shrink-0 place-items-center rounded-full text-caption font-bold"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span className="text-subhead leading-relaxed text-text-2">{rule}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </Screen>
  )
}
