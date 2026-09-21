import { useState } from 'react'
import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import Panel from '../../ui/Panel'
import Field from '../../ui/Field'
import Chip from '../../ui/Chip'
import PlayerRoster from '../../ui/PlayerRoster'
import { Alert } from '../../ui/Field'

/*
 * Section 6, the salvage guess. The last imposter, just voted out, gets one
 * typed guess at the footballer. Everyone else waits. Close spellings and a
 * bare surname count; the server does the comparing so the name never
 * travels to the imposter's phone.
 */
export default function SalvagePhase({ session, players, me, call, busy, error, status, leave }) {
  const [guess, setGuess] = useState('')
  const guesser = players.find((p) => p.id === session.salvage_player_id) ?? null
  const itsMe = guesser?.id === me.id

  async function submit(event) {
    event.preventDefault()
    if (!guess.trim() || busy) return
    await call('salvage_guess', { p_guess: guess.trim() }, 'Could not send your guess.')
  }

  return (
    <Screen
      status={status}
      title={itsMe ? 'Steal the win' : 'Last chance'}
      subtitle={
        itsMe
          ? 'You were the last imposter. Name the footballer and the win is yours.'
          : `${guesser?.display_name ?? 'The last imposter'} gets one guess at the footballer.`
      }
    >
      {itsMe ? (
        <form onSubmit={submit} noValidate>
          <Panel title="One guess" accent="accent-crimson" tint>
            <Field
              label="The footballer"
              placeholder="e.g. Erling Haaland"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              hint="Close spellings count, and so does a surname on its own. No second go."
              maxLength={80}
              autoFocus
              autoComplete="off"
              enterKeyHint="go"
            />
            <Button type="submit" size="lg" fullWidth className="mt-4" disabled={busy || !guess.trim()}>
              {busy ? 'Checking…' : 'Lock it in'}
            </Button>
            {error && <Alert>{error}</Alert>}
          </Panel>
        </form>
      ) : (
        <Panel title="Hold on" accent="accent-gold" tint>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="flag">Imposter</Chip>
            <span className="font-ui text-callout font-semibold text-text">{guesser?.display_name}</span>
          </div>
          <p className="mt-3 text-body leading-snug text-text-2">
            Every imposter has been found. Before the civilians take it, {guesser?.display_name ?? 'they'} can
            still steal the win by naming the footballer. One guess, no retries. Say nothing.
          </p>
        </Panel>
      )}

      <div className="mt-7">
        <PlayerRoster players={players} youId={me.id} minPlayers={0} title="The table" />
      </div>

      <button
        type="button"
        onClick={leave}
        className="pressable mt-8 h-11 w-full text-subhead font-semibold text-text-3 transition-colors hover:text-flag"
      >
        Leave game
      </button>
    </Screen>
  )
}
