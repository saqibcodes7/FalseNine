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
 * judged as a system rather than a screen at a time.
 */

function Section({ title, note, children }) {
  return (
    <section className="mb-12">
      <div className="mb-4">
        <h2 className="display text-title2 text-text">{title}</h2>
        {note && <p className="mt-1 text-footnote text-text-3">{note}</p>}
      </div>
      {children}
    </section>
  )
}

const SWATCHES = [
  ['bg', 'bg-bg'],
  ['surface 1', 'bg-surface-1'],
  ['surface 2', 'bg-surface-2'],
  ['surface 3', 'bg-surface-3'],
  ['text', 'bg-text'],
  ['gold', 'bg-gold'],
  ['gold soft', 'bg-gold-soft'],
  ['gold deep', 'bg-gold-deep'],
  ['crimson', 'bg-crimson'],
  ['teal', 'bg-teal'],
  ['royal', 'bg-royal'],
  ['go', 'bg-go'],
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
      backLabel="Home"
      accent="accent-gold"
      width="lg"
      title="The kit"
      subtitle="Every part of the interface, in every state, on one page."
    >
      <Section title="Brand" note="The mark takes currentColor, so it is whatever it sits on.">
        <div className="flex flex-wrap items-end gap-8">
          <Logo className="h-20 text-text" />
          <Logo mark className="h-14 text-gold" />
          <Logo mark className="h-9 text-text-2" />
          <Logo mark className="h-6 text-text-4" />
        </div>
      </Section>

      <Section title="Palette" note="Sampled from the three card designs.">
        <div className="flex flex-wrap gap-3">
          {SWATCHES.map(([name, cls]) => (
            <div key={name} className="w-[4.25rem]">
              <div
                className={`h-12 w-full rounded-[12px] shadow-[inset_0_0_0_1px_oklch(100%_0_0/.12)] ${cls}`}
              />
              <p className="mt-1.5 text-caption2 text-text-3">{name}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type" note="San Francisco where it exists, Inter everywhere else.">
        <p className="display text-large text-text">Football Imposter</p>
        <p className="display mt-1.5 text-title1 text-gold">Title · 28pt bold</p>
        <p className="mt-3 text-body text-text">
          Body is 17pt, the size iOS reads at. Everyone is shown the same footballer,
          everyone except the imposter.
        </p>
        <p className="mt-1.5 text-subhead text-text-2">
          Subhead 15pt, secondary, for the line under a control.
        </p>
        <p className="mt-1.5 text-footnote text-text-3">Footnote 13pt, tertiary, for hints.</p>
        <p className="eyebrow mt-3">Eyebrow · uppercase · letterspaced</p>
        <p className="tabular mt-3 text-display font-bold text-gold">2:48</p>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Create game</Button>
          <Button variant="secondary">Join game</Button>
          <Button variant="danger">Leave</Button>
          <Button variant="quiet">Cancel</Button>
          <Button disabled>Start game</Button>
        </div>
        <div className="mt-4 grid gap-3 sm:max-w-sm">
          <Button size="lg" fullWidth>
            Prominent, full width
          </Button>
        </div>
      </Section>

      <Section title="Chips" note="Every chip says its state in words.">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="gold">You</Chip>
          <Chip tone="neutral">Host</Chip>
          <Chip tone="go">Live</Chip>
          <Chip tone="neutral">Reconnecting</Chip>
          <Chip tone="neutral">Coming soon</Chip>
          <Chip tone="flag">Imposter</Chip>
          <Chip tone="crimson">Round 2 · Vote</Chip>
        </div>
      </Section>

      <Section title="Controls">
        <div className="grid gap-6 md:grid-cols-2">
          <Panel title="Fields">
            <Field label="Your display name" placeholder="Your Name" hint="20 characters max." />
            <Field label="Join code" variant="code" defaultValue="KADU6" className="mt-5" />
            <Field
              label="With an error"
              defaultValue="amir"
              error="Someone in this game is already called Amir"
              className="mt-5"
            />
          </Panel>

          <Panel title="Rules" bodyClassName="p-4 space-y-6">
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
              <p className="mt-2 text-footnote leading-snug text-text-3">
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
            marks={(p) => (p.id === 'a' ? [{ tone: 'go', text: 'Voted' }] : [])}
          />
        </div>
      </Section>

      <Section title="Cards">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <GameCard game={GAMES[0]} layout="featured" />
          <div className="grid content-start gap-3">
            <GameCard game={GAMES[1]} />
            <GameCard game={GAMES[2]} />
          </div>
        </div>
      </Section>

      <Section title="The peek" note="Tap the card to turn it over.">
        <div className="flex flex-wrap items-start gap-8">
          <RoleCard
            flipped={flipped}
            role={role}
            playerName="Bukayo Saka"
            hint={role === 'imposter' ? 'Left-footed, plays wide, wears number seven.' : null}
            onFlip={() => setFlipped((f) => !f)}
          />
          <div className="flex flex-col gap-3">
            <Button variant="secondary" onClick={() => setFlipped((f) => !f)}>
              {flipped ? 'Turn face down' : 'Turn face up'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setRole((r) => (r === 'civilian' ? 'imposter' : 'civilian'))}
            >
              Deal as {role === 'civilian' ? 'imposter' : 'civilian'}
            </Button>
          </div>
        </div>
      </Section>

      <Section title="The clock">
        <div className="flex flex-wrap items-start gap-5">
          <div className="w-52">
            <TimerDisplay label="Discussion" secondsLeft={seconds} total={180} />
          </div>
          <div className="w-52">
            <TimerDisplay label="Voting" secondsLeft={7} total={60} />
          </div>
          <Button variant="secondary" onClick={() => setSeconds(24)}>
            Run it again
          </Button>
        </div>
      </Section>

      <Section title="Reveals">
        <div className="grid gap-5 sm:grid-cols-2">
          <RevealCard
            eyebrow="Voted out"
            name="Priya"
            tone="civilian"
            message="Priya was a civilian. The imposter is still at the table."
          />
          <RevealCard
            eyebrow="Voted out"
            name="Tom"
            tone="imposter"
            message="Tom was indeed the Imposter. 1 imposter remains."
          />
          <RevealCard
            eyebrow="Full time"
            name="Clean sheet"
            tone="win"
            message="Every imposter was found. The player was Bukayo Saka."
          />
          <RevealCard
            eyebrow="Full time"
            name="Stolen"
            tone="steal"
            message="Tom guessed “Saka”. It was Bukayo Saka."
          />
        </div>
      </Section>
    </Screen>
  )
}
