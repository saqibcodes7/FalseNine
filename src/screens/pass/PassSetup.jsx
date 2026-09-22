import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import Panel from '../../ui/Panel'
import Stepper from '../../ui/Stepper'
import Toggle from '../../ui/Toggle'
import Segmented from '../../ui/Segmented'
import { PACKS, DIFFICULTIES, getDifficulty, playersFor } from '../../data/packs'
import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  NO_LIMIT,
  maxImpostersFor,
  settingsAreValid,
} from '../../lib/passplay'

/*
 * The only setup screen in the mode. Nobody types a name and nobody types a
 * code: how many of you there are, how hard you want it, and how long you get.
 */
function clock(seconds) {
  if (seconds === NO_LIMIT) return 'No limit'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function PassSetup({ settings, onChange, onDeal }) {
  const set = (patch) => onChange({ ...settings, ...patch })
  const ratioOk = settings.imposters < settings.players - settings.imposters
  const inPlay = playersFor(settings.packId, settings.difficultyId).length
  const squadSize = playersFor(settings.packId, 'you_know_ball').length

  return (
    <Screen
      back="/imposter"
      backLabel="Imposter"
      title="Pass & Play"
      subtitle="One phone, no codes, nobody online. Set it up, then pass it round."
    >
      <div className="space-y-7">
        <Panel title="The table" bodyClassName="space-y-6">
          <Stepper
            label="Players"
            hint={`${MIN_PLAYERS} to ${MAX_PLAYERS}`}
            value={settings.players}
            onChange={(v) =>
              set({ players: v, imposters: Math.min(settings.imposters, maxImpostersFor(v)) })
            }
            min={MIN_PLAYERS}
            max={MAX_PLAYERS}
          />

          <Stepper
            label="Imposters"
            hint="They have to be outnumbered"
            value={settings.imposters}
            onChange={(v) => set({ imposters: v })}
            min={1}
            max={4}
            warning={
              !ratioOk
                ? `With ${settings.players} players you can have at most ${maxImpostersFor(settings.players)}.`
                : null
            }
          />
        </Panel>

        <Panel title="Player pack" bodyClassName="p-0">
          <ul className="divide-hairline" role="list">
            {PACKS.map((pack) => {
              const selected = settings.packId === pack.id
              return (
                <li key={pack.id}>
                  <button
                    type="button"
                    onClick={() => set({ packId: pack.id })}
                    aria-pressed={selected}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-callout font-semibold ${
                          selected ? 'text-gold' : 'text-text'
                        }`}
                      >
                        {pack.name}
                      </span>
                      <span className="mt-0.5 block text-footnote leading-snug text-text-3">
                        {pack.blurb}
                      </span>
                    </span>

                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      className={`h-[15px] w-[15px] shrink-0 transition-opacity duration-[var(--dur-state)] ${
                        selected ? 'text-gold opacity-100' : 'opacity-0'
                      }`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2.5 8.5 6.2 12.4 13.5 3.8" />
                    </svg>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="hairline" aria-hidden="true" />

          <div className="p-4">
            <Segmented
              label="How deep"
              hint={`${inPlay} of ${squadSize} in play`}
              options={DIFFICULTIES.map((d) => ({ id: d.id, name: d.name, meta: d.level }))}
              value={settings.difficultyId}
              onChange={(v) => set({ difficultyId: v })}
            />
            <p className="mt-2 text-footnote leading-snug text-text-3" data-testid="difficulty-blurb">
              {getDifficulty(settings.difficultyId).blurb}
            </p>
          </div>
        </Panel>

        <Panel title="Clocks" bodyClassName="space-y-6">
          <Stepper
            label="Discussion"
            hint="Wind it to zero for no limit"
            value={settings.discussionSeconds}
            onChange={(v) => set({ discussionSeconds: v })}
            min={NO_LIMIT}
            max={600}
            step={30}
            format={clock}
          />

          <Stepper
            label="Voting"
            hint="Wind it to zero for no limit"
            value={settings.votingSeconds}
            onChange={(v) => set({ votingSeconds: v })}
            min={NO_LIMIT}
            max={180}
            step={15}
            format={clock}
          />

          <Toggle
            label="Hints for imposters"
            description="Each imposter gets one vague word about the footballer instead of nothing at all."
            checked={settings.hints}
            onChange={(v) => set({ hints: v })}
          />
        </Panel>
      </div>

      <div
        className="surface-bar sticky bottom-0 z-30 -mx-5 mt-8 px-5 pt-3"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="hairline mb-3 -mx-5" aria-hidden="true" />

        <Button size="lg" fullWidth disabled={!settingsAreValid(settings)} onClick={onDeal}>
          Deal the cards
        </Button>

        <p className="mt-2.5 text-center text-footnote text-text-2">
          {settingsAreValid(settings)
            ? `${settings.players} players, ${settings.imposters} imposter${settings.imposters === 1 ? '' : 's'}. Player 1 goes first.`
            : 'Too many imposters for this many players.'}
        </p>
      </div>
    </Screen>
  )
}
