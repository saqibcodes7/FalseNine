import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import Field, { Alert } from '../../ui/Field'
import Panel from '../../ui/Panel'
import TttScoreboard from '../../ui/ttt/TttScoreboard'
import TttPlayArea from '../../ui/ttt/TttPlayArea'
import TttResult from '../../ui/ttt/TttResult'
import TttHandoff from '../../ui/ttt/TttHandoff'
import DifficultyPicker from '../../ui/ttt/DifficultyPicker'
import { isSupabaseConfigured } from '../../lib/supabase'
import { useTttAuth } from '../../hooks/useTttAuth'
import { useTicTacToeSession } from '../../hooks/useTicTacToeSession'
import { PassPlayError, clearPassRecord, endPassGame, loadPassRecord, loadPassSetup, passClients, restorePassGame, setUpPassGame } from '../../lib/tttPass'
import { rematch, setDifficulty, startGame } from '../../lib/tttApi'
import { playMove, playPass } from '../../lib/tttMoves'
import { RIGHT_ANSWER, WRONG_ANSWER, tttErrorMessage } from '../../lib/tttErrors'
import { lastMove, matchPhase, matchScore, nameOfMark, passSeating, turnKey, winningCells } from '../../lib/tttBoard'
import { DEFAULT_TTT_DIFFICULTY, getTttDifficulty } from '../../data/tttDifficulties'

/*
 * Pass & Play Football Tic-Tac-Toe, at /tic-tac-toe/pass.
 *
 *   setup → (two players, one lobby, first board) → play ⇄ pass the device
 *                                                 → result → play again / end
 *
 * The rules are the server's, exactly as Online: see lib/tttPass.js for how
 * two people on one device become two seats. This screen decides only whose
 * client makes the next move (from the board's turn and the seats the server
 * gave each player) and when to hand the device over.
 *
 * On arrival a saved game is picked back up if there is one. Reloading,
 * locking the phone or leaving the page never ends a game; End game does.
 */
export default function TttPassPlay() {
  const [stage, setStage] = useState(() => {
    const record = isSupabaseConfigured ? loadPassRecord() : null
    return record ? { name: 'restoring', record } : { name: 'setup' }
  })

  if (!isSupabaseConfigured) return <Navigate to="/tic-tac-toe" replace />

  if (stage.name === 'restoring') return <Restoring record={stage.record} onDone={setStage} />
  if (stage.name === 'lost') {
    return <Lost message={stage.message} onRetry={stage.retry ? () => setStage({ name: 'restoring', record: stage.record }) : null} onNew={() => {
      clearPassRecord()
      setStage({ name: 'setup' })
    }} />
  }
  if (stage.name === 'playing') {
    return <PassMatch key={stage.game.sessionId} game={stage.game} onEnded={() => setStage({ name: 'setup' })} onLost={(message) => setStage({ name: 'lost', message })} />
  }
  return <PassSetup onStarted={(game) => setStage({ name: 'playing', game })} />
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function PassSetup({ onStarted }) {
  const [saved] = useState(loadPassSetup)
  const [p1Name, setP1Name] = useState(saved.p1 ?? '')
  const [p2Name, setP2Name] = useState(saved.p2 ?? '')
  const [difficulty, setDifficultyChoice] = useState(saved.difficulty ?? DEFAULT_TTT_DIFFICULTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const one = p1Name.trim() || 'Player 1'
  const two = p2Name.trim() || 'Player 2'
  const clash = one.toLowerCase() === two.toLowerCase()

  async function start(event) {
    event.preventDefault()
    if (busy) return
    if (clash) {
      setError('The two names need to be different.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const game = await setUpPassGame({ p1Name: one, p2Name: two, difficulty })
      onStarted(game)
    } catch (setupError) {
      setError(setupError instanceof PassPlayError ? setupError.message : tttErrorMessage(setupError, 'create'))
      setBusy(false)
    }
  }

  return (
    <Screen back="/tic-tac-toe" backLabel="Tic-Tac-Toe" accent="accent-teal" title="Pass & Play" subtitle="Two players, one device. Hand it over after every turn.">
      <form onSubmit={start} noValidate data-testid="pass-setup">
        <Panel title="Players" bodyClassName="space-y-5">
          <Field
            label="Player 1"
            placeholder="Player 1"
            value={p1Name}
            onChange={(e) => {
              setP1Name(e.target.value)
              setError(null)
            }}
            maxLength={20}
            autoComplete="off"
            enterKeyHint="next"
          />
          <Field
            label="Player 2"
            placeholder="Player 2"
            value={p2Name}
            onChange={(e) => {
              setP2Name(e.target.value)
              setError(null)
            }}
            hint="A coin toss decides who goes first."
            maxLength={20}
            autoComplete="off"
            enterKeyHint="go"
          />
        </Panel>

        <Panel title="Settings" className="mt-6">
          <DifficultyPicker value={difficulty} onChange={setDifficultyChoice} />
        </Panel>

        {error && <Alert>{error}</Alert>}

        <Button type="submit" size="lg" fullWidth className="mt-6" disabled={busy || clash} data-testid="pass-start">
          {busy ? 'Setting up…' : error ? 'Try again' : 'Start game'}
        </Button>
        {clash && <p className="mt-2.5 text-center text-footnote text-text-2">The two names need to be different.</p>}
      </form>
    </Screen>
  )
}

// ---------------------------------------------------------------------------
// Picking a saved game back up
// ---------------------------------------------------------------------------

function Restoring({ record, onDone }) {
  useEffect(() => {
    let cancelled = false
    restorePassGame(record).then(
      (result) => {
        if (cancelled) return
        if (result.gone) {
          clearPassRecord()
          onDone({
            name: 'lost',
            message:
              result.gone === 'players'
                ? 'The two players on this device were reset, so that game cannot be picked up.'
                : 'That game has finished, so there is nothing to go back to.',
          })
        } else {
          onDone({ name: 'playing', game: { sessionId: record.sessionId, code: record.code, seats: result.seats } })
        }
      },
      (error) => {
        if (!cancelled) onDone({ name: 'lost', message: error.message, retry: true, record })
      },
    )
    return () => {
      cancelled = true
    }
  }, [record, onDone])

  return (
    <Screen back="/tic-tac-toe" backLabel="Tic-Tac-Toe" accent="accent-teal" title="Picking up your game…">
      <div className="surface h-64 animate-pulse" aria-hidden="true" />
    </Screen>
  )
}

function Lost({ message, onRetry, onNew }) {
  return (
    <Screen back="/tic-tac-toe" backLabel="Tic-Tac-Toe" accent="accent-teal" title="Couldn't pick your game up">
      <p className="max-w-[38ch] text-body leading-relaxed text-text-2" data-testid="pass-lost">
        {message}
      </p>
      <div className="mt-6 space-y-3">
        {onRetry && (
          <Button size="lg" fullWidth onClick={onRetry}>
            Try again
          </Button>
        )}
        <Button size="lg" fullWidth variant={onRetry ? 'secondary' : 'primary'} onClick={onNew}>
          Start a new game
        </Button>
      </div>
    </Screen>
  )
}

// ---------------------------------------------------------------------------
// The match
// ---------------------------------------------------------------------------

/*
 * Reads go through Player 1's client, the host, which holds a seat for the
 * whole match and so can see everything in it. That one client also carries
 * the match's only Realtime subscription: two people on one device need one
 * view of the board, not two. Moves are a separate matter: each goes through
 * the client of the player whose turn the server says it is.
 */
function PassMatch({ game: setup, onEnded, onLost }) {
  const { p1, p2 } = passClients()
  const auth = useTttAuth(p1, { create: false })
  const view = useTicTacToeSession(p1, setup.code, { ready: auth.status === 'ready' })
  const { session, players, game, games, moves, cells, axes, boardDifficulty, lines, settings, refresh, inStep } = view

  const seating = passSeating(game, setup.seats)
  const phase = matchPhase(session, game)
  const key = turnKey(game, moves)
  const [readyKey, setReadyKey] = useState(null)
  const [spentKey, setSpentKey] = useState(null)
  const [ending, setEnding] = useState(false)
  const [endError, setEndError] = useState(null)

  const nameOf = (who) => players.find((p) => p.id === setup.seats[who])?.display_name ?? (who === 'p1' ? 'Player 1' : 'Player 2')
  const acting = inStep ? seating.acting : null
  const actingClient = acting === 'p1' ? p1 : acting === 'p2' ? p2 : null
  const needsHandoff = phase === 'playing' && Boolean(key) && Boolean(acting) && readyKey !== key
  const canAct = phase === 'playing' && Boolean(actingClient) && !needsHandoff && key !== spentKey && Boolean(axes)

  // The lobby vanishing is news, unless End game is what removed it.
  useEffect(() => {
    if (view.status === 'missing' && !ending) onLost('That game has finished, so there is nothing to go back to.')
  }, [view.status, ending, onLost])

  // The board and the two seats should always agree. If for a moment they do
  // not, nobody may move, and the board is fetched again shortly.
  const outOfStep = phase === 'playing' && inStep && !seating.consistent
  useEffect(() => {
    if (!outOfStep) return undefined
    const timer = setTimeout(refresh, 1500)
    return () => clearTimeout(timer)
  }, [outOfStep, refresh])

  if (auth.status === 'none') {
    return <Lost message="The players on this device were reset, so this game cannot be picked up." onNew={() => {
      clearPassRecord()
      onEnded()
    }} />
  }
  if (auth.status === 'error') {
    return <Lost message={auth.error?.message} onRetry={auth.retry} onNew={() => {
      clearPassRecord()
      onEnded()
    }} />
  }
  if (!session || (!game && phase !== 'lobby')) {
    return (
      <Screen back="/tic-tac-toe" backLabel="Tic-Tac-Toe" accent="accent-teal" title="Loading game…">
        <div className="surface h-64 animate-pulse" aria-hidden="true" />
      </Screen>
    )
  }

  async function onSubmit(cell, footballer) {
    if (!actingClient) return { ok: false, message: 'Something went wrong. Try again.', stale: true }
    const outcome = await playMove(actingClient, session.id, cell, footballer.id)
    if (outcome.ok) setSpentKey(key)
    refresh()
    return outcome
  }

  async function onPass() {
    if (!actingClient) return { ok: false, message: 'Something went wrong. Try again.', stale: true }
    const outcome = await playPass(actingClient, session.id)
    if (outcome.ok) setSpentKey(key)
    refresh()
    return outcome
  }

  async function endGame() {
    if (ending) return
    setEnding(true)
    setEndError(null)
    const { error } = await endPassGame(session.id, setup.seats.p1)
    if (error) {
      setEndError(tttErrorMessage(error, 'leave'))
      setEnding(false)
      refresh()
      return
    }
    onEnded()
  }

  // The lobby never got its first board (setup was interrupted by a reload).
  if (phase === 'lobby') {
    return <Unstarted client={p1} session={session} refresh={refresh} onEnd={endGame} ending={ending} endError={endError} />
  }

  const actingName = acting ? nameOf(acting) : null
  const actingMark = acting ? seating[acting].mark : null

  return (
    <Screen back="/tic-tac-toe" backLabel="Tic-Tac-Toe" accent="accent-teal" width="lg">
      <div
        className="mx-auto w-full max-w-[34rem]"
        data-testid="ttt-match"
        data-mode="pass"
        data-phase={phase}
        data-acting={acting ?? ''}
        data-p1-mark={seating.p1.mark ?? ''}
        data-p2-mark={seating.p2.mark ?? ''}
      >
        <p className="eyebrow mb-3 text-center" data-testid="board-caption">
          Board {game.board_number}
          {boardDifficulty ? ` · ${getTttDifficulty(boardDifficulty).name}` : ''}
        </p>
        <TttScoreboard game={game} score={matchScore(games, game)} />
        <p className="mt-4 mb-4 min-h-[1.5rem] text-center text-callout font-semibold text-text" aria-live="polite" data-testid="turn-status">
          {phase === 'playing' && actingName ? `${actingName}'s turn` : ''}
        </p>
        {outOfStep && <Alert>Something is out of step. Reloading the board…</Alert>}
      </div>

      {axes ? (
        <TttPlayArea
          key={`${key ?? `board-${game.id}`}:${acting ?? ''}`}
          client={actingClient ?? p1}
          axes={axes}
          cells={cells}
          winning={winningCells(game, lines)}
          playing={phase === 'playing'}
          canAct={canAct}
          onSubmit={onSubmit}
          onPass={onPass}
        />
      ) : (
        <div className="surface mx-auto aspect-[4/3] w-full max-w-[34rem] animate-pulse" aria-label="Loading the board" />
      )}

      <div className="mx-auto mt-6 w-full max-w-[34rem] space-y-4">
        {(phase === 'between' || phase === 'ended') && (
          <TttResult game={game}>
            {phase === 'between' ? (
              <NextBoard client={p1} session={session} difficulty={settings?.difficulty ?? DEFAULT_TTT_DIFFICULTY} refresh={refresh} />
            ) : (
              <p className="text-center text-subhead text-text-2">This game is over.</p>
            )}
          </TttResult>
        )}
        <EndControl phase={phase} onEnd={endGame} ending={ending} endError={endError} />
      </div>

      {needsHandoff && (
        <TttHandoff
          name={actingName}
          mark={actingMark}
          feedback={handoffFeedback(game, moves, nameOfMark)}
          onReady={() => setReadyKey(key)}
        />
      )}
    </Screen>
  )
}

/** What happened on the turn just played, as the server recorded it. */
function handoffFeedback(game, moves, nameOf) {
  const last = lastMove(moves)
  if (!last) {
    const starter = nameOf(game, game.starter_mark)
    return { text: game.board_number === 1 ? `Coin toss: ${starter} goes first.` : `${starter} starts this board.`, tone: 'neutral' }
  }
  if (last.kind === 'claim') return { text: RIGHT_ANSWER, tone: 'go' }
  if (last.kind === 'wrong') return { text: WRONG_ANSWER, tone: 'flag' }
  return { text: `${nameOf(game, last.mark)} passed.`, tone: 'neutral' }
}

function NextBoard({ client, session, difficulty, refresh }) {
  const [pendingDifficulty, setPendingDifficulty] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function changeDifficulty(next) {
    setPendingDifficulty(next)
    setError(null)
    const { error: rpcError } = await setDifficulty(client, session.id, next)
    if (rpcError) setError(tttErrorMessage(rpcError, 'difficulty'))
    await refresh()
    setPendingDifficulty(null)
  }

  async function playAgain() {
    if (busy) return
    setBusy(true)
    setError(null)
    const { error: rpcError } = await rematch(client, session.id)
    if (rpcError) setError(tttErrorMessage(rpcError, 'rematch'))
    await refresh()
    setBusy(false)
  }

  return (
    <div className="space-y-4">
      <Button size="lg" fullWidth onClick={playAgain} disabled={busy || pendingDifficulty !== null} data-testid="pass-play-again">
        {busy ? 'Starting…' : 'Play again'}
      </Button>
      <p className="-mt-1 text-center text-footnote text-text-3">Same marks. The other player starts.</p>
      <Panel>
        <DifficultyPicker value={pendingDifficulty ?? difficulty} onChange={changeDifficulty} disabled={pendingDifficulty !== null || busy} hint="For the next board" />
      </Panel>
      {error && <Alert>{error}</Alert>}
    </div>
  )
}

function EndControl({ phase, onEnd, ending, endError }) {
  const [confirming, setConfirming] = useState(false)
  if (confirming) {
    return (
      <div className="surface accent-flag p-4 text-center" style={{ '--tint': '10%' }} data-testid="end-confirm">
        <p className="text-callout font-semibold text-text">End this game?</p>
        <p className="mt-1 text-footnote text-text-3">{phase === 'playing' ? 'The board in play will not be finished.' : 'You can always start a new one.'}</p>
        {endError && <Alert>{endError}</Alert>}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={ending}>
            Keep playing
          </Button>
          <Button variant="danger" onClick={onEnd} disabled={ending} data-testid="end-confirm-yes">
            {ending ? 'Ending…' : 'End game'}
          </Button>
        </div>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="pressable h-11 w-full text-subhead font-semibold text-text-3 transition-colors hover:text-flag"
      data-testid="end-game"
    >
      End game
    </button>
  )
}

function Unstarted({ client, session, refresh, onEnd, ending, endError }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function start() {
    setBusy(true)
    setError(null)
    const { error: rpcError } = await startGame(client, session.id)
    if (rpcError) setError(tttErrorMessage(rpcError, 'start'))
    await refresh()
    setBusy(false)
  }
  return (
    <Screen back="/tic-tac-toe" backLabel="Tic-Tac-Toe" accent="accent-teal" title="Ready when you are" subtitle="Setting up was interrupted before the first board.">
      {(error || endError) && <Alert>{error || endError}</Alert>}
      <div className="mt-6 space-y-3">
        <Button size="lg" fullWidth onClick={start} disabled={busy || ending}>
          {busy ? 'Starting…' : 'Start game'}
        </Button>
        <Button size="lg" fullWidth variant="secondary" onClick={onEnd} disabled={busy || ending}>
          {ending ? 'Ending…' : 'End game'}
        </Button>
      </div>
    </Screen>
  )
}
