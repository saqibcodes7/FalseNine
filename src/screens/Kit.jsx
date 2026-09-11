import { useEffect, useState } from 'react'
import Screen from '../ui/Screen'
import Button from '../ui/Button'
import Panel from '../ui/Panel'
import Chip from '../ui/Chip'
import Field from '../ui/Field'
import Stepper from '../ui/Stepper'
import Toggle from '../ui/Toggle'
import Segmented from '../ui/Segmented'
import Logo from '../ui/Logo'
import JoinCodeDisplay from '../ui/JoinCodeDisplay'
import PlayerRoster from '../ui/PlayerRoster'
import VoteSheet from '../ui/VoteSheet'
import GameCard from '../ui/GameCard'
import TimerDisplay from '../ui/TimerDisplay'
import RoleCard from '../ui/RoleCard'
import RevealCard from '../ui/RevealCard'
import { GAMES } from '../data/games'
import { DIFFICULTIES, getDifficulty, playersFor } from '../data/packs'

/*
 * The kit. Every primitive in every state, on one page, so the system can be
 * judged as a system. Also where the reveal, timer and role card live until
 * the round engine wires them up.
 */

function Section({ title, children }) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="display text-title leading-none text-gold engraved">{title}</h2>
        <span className="hairline metal-gold flex-1" aria-hidden="true" />
      </div>
      {children}
    </section>
  )
}

const SWATCHES = [
  ['ink-0', 'bg-ink-0'],
  ['ink-2', 'bg-ink-2'],
  ['navy', 'bg-navy'],
  ['chalk-0', 'bg-chalk-0'],
  ['gold', 'bg-gold'],
  ['copper', 'bg-copper'],
  ['silver', 'bg-silver'],
  ['steel', 'bg-steel'],
  ['red', 'bg-red'],
  ['malachite', 'bg-malachite'],
  ['lime', 'bg-lime'],
  ['flag', 'bg-flag'],
]

const ROSTER = [
  { id: 'a', display_name: 'Saqib', is_host: true, is_active: true },
  { id: 'b', display_name: 'Amir', is_host: false, is_active: true },
  { id: 'c', display_name: 'Priya', is_host: false, is_active: true },
]

export default function Kit() {
  const [flipped, setFlipped] = useState(false)
  const [role, setRole] = useState('civilian')
  const [stepper, setStepper] = useState(180)
  const [toggle, setToggle] = useState(true)
  const [difficulty, setDifficulty] = useState('ball_aware')
  const [seconds, setSeconds] = useState(24)

  useEffect(() => {
    if (seconds <= 0) return undefined
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => clearTimeout(id)
  }, [seconds])

  return (
    <Screen
      back="/"
      backLabel="Binder"
      title="The kit"
      subtitle="Every part of the interface, in every state, on one page."
      width="lg"
    >
      <Section title="Brand">
        <div className="flex flex-wrap items-end gap-8">
          <Logo className="h-28 text-lime" />
          <Logo mark className="h-20 text-gold engraved" />
          <Logo mark className="h-12 text-silver" />
          <Logo mark className="h-8 text-chalk-2" />
        </div>
      </Section>

      <Section title="Palette">
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-12">
          {SWATCHES.map(([name, cls]) => (
            <li key={name}>
              <div
                className={`${cls} h-12 rounded-[4px] shadow-[inset_0_0_0_1px_oklch(0%_0_0/.4)]`}
              />
              <p className="mt-1 text-meta text-chalk-2">{name}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Type">
        <p className="display text-display leading-none text-gold-hi engraved">Football Imposter</p>
        <p className="display mt-1 text-headline leading-none text-chalk-0 engraved">Screen title in Teko</p>
        <p className="display mt-1 text-title leading-none text-gold engraved">Plate label · 1.75rem</p>
        <p className="mt-3 max-w-[60ch] text-body text-chalk-0">
          Body copy in Saira at 16px. Take turns dropping a clue. Vague enough to survive,
          sharp enough to prove you know the player.
        </p>
        <p className="mt-1 max-w-[60ch] text-small text-chalk-1">
          Secondary text at 14px, for hints and metadata.
        </p>
      </Section>

      <Section title="Buttons">
        <div className="grid gap-3 sm:grid-cols-2">
          <Button size="lg" fullWidth>
            Start game
          </Button>
          <Button size="lg" fullWidth variant="secondary">
            Join game
          </Button>
          <Button size="lg" fullWidth disabled>
            Start game
          </Button>
          <Button size="lg" fullWidth variant="danger">
            Close lobby
          </Button>
          <Button size="md">Medium</Button>
          <Button size="sm" variant="secondary">
            Small
          </Button>
          <Button variant="quiet">Leave game</Button>
        </div>
      </Section>

      <Section title="Chips">
        <div className="flex flex-wrap gap-2">
          <Chip tone="lime">You</Chip>
          <Chip tone="gold">Host</Chip>
          <Chip tone="lime">Live</Chip>
          <Chip tone="steel">Reconnecting</Chip>
          <Chip tone="silver">Coming soon</Chip>
          <Chip tone="red">Imposter</Chip>
          <Chip tone="steel">Medium</Chip>
        </div>
      </Section>

      <Section title="Controls">
        <div className="grid gap-6 md:grid-cols-2">
          <Panel title="Fields" bodyClassName="space-y-5">
            <Field label="Your display name" placeholder="e.g. Saqib" hint="20 characters max." />
            <Field
              label="Join code"
              defaultValue="KADU6"
              variant="code"
            />
            <Field
              label="With an error"
              defaultValue="amir"
              error="Someone in this game is already called Amir"
            />
          </Panel>

          <Panel title="Rules" bodyClassName="space-y-6">
            <Stepper
              label="Discussion timer"
              hint="60s to 5 min"
              value={stepper}
              onChange={setStepper}
              min={60}
              max={300}
              step={30}
              format={(v) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`}
            />
            <Stepper
              label="Imposters"
              hint="4 in the lobby"
              value={3}
              onChange={() => {}}
              min={1}
              max={4}
              warning="Imposters have to be outnumbered. With 4 players you can have at most 1."
            />
            <Toggle
              label="AI hints for imposters"
              description="Gives each imposter a vague clue about the player."
              checked={toggle}
              onChange={setToggle}
            />
            <div>
              <Segmented
                label="How deep"
                hint={`${playersFor('premier_league', difficulty).length} of ${
                  playersFor('premier_league', 'you_know_ball').length
                } in play`}
                options={DIFFICULTIES.map((d) => ({ id: d.id, name: d.name, meta: d.level }))}
                value={difficulty}
                onChange={setDifficulty}
              />
              <p className="mt-2 text-small leading-snug text-chalk-1">
                {getDifficulty(difficulty).blurb}
              </p>
            </div>
          </Panel>
        </div>
      </Section>

      <Section title="Lobby">
        <div className="grid gap-6 md:grid-cols-2">
          <JoinCodeDisplay code="KADU6" />
          <PlayerRoster players={ROSTER} youId="b" minPlayers={4} />
        </div>
      </Section>

      <Section title="The vote">
        <div className="grid gap-6 md:grid-cols-2">
          <VoteSheet candidates={ROSTER} youId="b" onCast={() => {}} onSkip={() => {}} />
          <PlayerRoster
            players={[
              ...ROSTER.slice(0, 2),
              { ...ROSTER[2], is_active: false, revealed_role: 'imposter' },
            ]}
            youId="b"
            minPlayers={0}
            title="The table"
            marks={(p) => (p.id === 'a' ? [{ tone: 'lime', text: 'Voted' }] : [])}
          />
        </div>
      </Section>

      <Section title="Cards">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <GameCard game={GAMES[0]} featured />
          <GameCard game={GAMES[1]} />
          <GameCard game={GAMES[2]} />
        </div>
      </Section>

      <Section title="The peek">
        <div className="grid items-start gap-6 md:grid-cols-[minmax(0,20rem)_1fr]">
          <RoleCard
            flipped={flipped}
            role={role}
            playerName="Bukayo Saka"
            hint={role === 'imposter' ? 'Plays wide, favours the left foot, came through an academy.' : null}
            onFlip={() => setFlipped((f) => !f)}
          />
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setFlipped((f) => !f)}>
              {flipped ? 'Turn face down' : 'Turn face up'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setFlipped(false)
                setRole((r) => (r === 'civilian' ? 'imposter' : 'civilian'))
              }}
            >
              Deal as {role === 'civilian' ? 'imposter' : 'civilian'}
            </Button>
          </div>
        </div>
      </Section>

      <Section title="The clock">
        <div className="grid items-start gap-6 md:grid-cols-2">
          <TimerDisplay label="Discussion" secondsLeft={seconds} total={30} />
          <div>
            <Button variant="secondary" onClick={() => setSeconds(24)}>
              Restart at 0:24
            </Button>
            <p className="mt-3 max-w-[40ch] text-small text-chalk-1">
              Under ten seconds the enamel turns red, HURRY is stamped beside the label,
              and the digits tick once a second.
            </p>
          </div>
        </div>
      </Section>

      <Section title="The reveal">
        <div className="grid gap-6 md:grid-cols-2">
          <RevealCard
            name="Priya"
            tone="civilian"
            message="Priya was a civilian. The imposter is still at the table."
          />
          <RevealCard
            name="Amir"
            tone="imposter"
            message="Amir was indeed the Imposter. 1 imposter remains."
          />
          <RevealCard eyebrow="Full time" name="Civilians" tone="win" message="Every imposter found. The player was Bukayo Saka." />
          <RevealCard
            eyebrow="Stolen"
            name="Amir"
            tone="steal"
            message="Guessed Bukayo Saka with the last breath. The imposter wins."
          />
        </div>
      </Section>
    </Screen>
  )
}
