import { useEffect, useState } from 'react'
import PassSetup from './pass/PassSetup'
import PassDeal from './pass/PassDeal'
import PassClock from './pass/PassClock'
import PassOutcome from './pass/PassOutcome'
import PassEnded from './pass/PassEnded'
import {
  DEFAULT_SETTINGS,
  deal,
  passOn,
  toVoting,
  toOutcome,
  voteOut,
  nextRound,
  finish,
  again,
  loadGame,
  saveGame,
  clearGame,
} from '../lib/passplay'

/*
 * Pass & Play, end to end. One device, no network, no Supabase client: this
 * route is the whole mode, and it is the only part of Football Imposter that
 * works with nothing configured at all.
 *
 *   setup → deal (pass the phone) → discussion → voting → outcome ─┬→ discussion
 *                                                                  └→ ended
 *
 * The game is mirrored into sessionStorage after every move, so a phone that
 * locks or a tab the browser quietly discards does not cost the table their
 * game.
 */
export default function PassPlay() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [game, setGame] = useState(null)
  const [restored, setRestored] = useState(false)

  // Pick up an interrupted game once, on arrival.
  useEffect(() => {
    const saved = loadGame()
    if (saved) {
      setGame(saved)
      setSettings(saved.settings)
    }
    setRestored(true)
  }, [])

  // And keep it mirrored from then on.
  useEffect(() => {
    if (!restored) return
    saveGame(game)
  }, [game, restored])

  // A blank first paint rather than the setup screen flashing up in front of a
  // game that is about to be restored.
  if (!restored) return null

  if (!game) {
    return (
      <PassSetup
        settings={settings}
        onChange={setSettings}
        onDeal={() => setGame(deal(settings))}
      />
    )
  }

  const move = (fn) => () => setGame(fn)

  // Abandoning throws the deal away rather than leaving it to be resumed; the
  // back chevron is the one that keeps it.
  const quit = () => {
    clearGame()
    setGame(null)
  }

  switch (game.phase) {
    case 'deal':
      return <PassDeal game={game} onPass={move(passOn)} onQuit={quit} />

    case 'discussion':
      return <PassClock game={game} onAdvance={move(toVoting)} onQuit={quit} />

    case 'voting':
      return <PassClock game={game} onAdvance={move(toOutcome)} onQuit={quit} />

    case 'outcome':
      return (
        <PassOutcome
          game={game}
          onVoteOut={(n) => setGame((g) => voteOut(g, n))}
          onSkip={() => setGame((g) => voteOut(g, null))}
          onNextRound={move(nextRound)}
          onFinish={move(finish)}
          onQuit={quit}
        />
      )

    case 'ended':
      return (
        <PassEnded
          game={game}
          onAgain={move(again)}
          onNewSetup={quit}
        />
      )

    default:
      // An unknown phase means storage from a different version of the app.
      clearGame()
      setGame(null)
      return null
  }
}
