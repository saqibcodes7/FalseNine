import { useEffect, useRef, useState } from 'react'
import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import Panel from '../../ui/Panel'
import { Alert } from '../../ui/Field'
import TttScoreboard from '../../ui/ttt/TttScoreboard'
import TttPlayArea from '../../ui/ttt/TttPlayArea'
import TttResult from '../../ui/ttt/TttResult'
import DifficultyPicker, { DifficultyReadout } from '../../ui/ttt/DifficultyPicker'
import { LiveChip } from './TttLobby'
import { rematch, setDifficulty } from '../../lib/tttApi'
import { playMove, playPass } from '../../lib/tttMoves'
import { RIGHT_ANSWER, WRONG_ANSWER, tttErrorMessage } from '../../lib/tttErrors'
import { lastMove, markOfSeat, matchPhase, matchScore, nameOfMark, turnKey, winningCells } from '../../lib/tttBoard'
import { DEFAULT_TTT_DIFFICULTY, getTttDifficulty } from '../../data/tttDifficulties'

/*
 * An Online board, from both sides of it: the scoreboard, the board, and
 * whatever the person holding this phone can do now.
 *
 * The turn is the server's. This phone may move only when the board says it
 * is its mark's turn, and once a move has been accepted it waits for the
 * board to show the next turn before it offers anything else, so a quick
 * second tap cannot become a second move. Every move and pass is followed by
 * a fetch of the real state, and the other phone hears of it through Realtime.
 */
export default function TttOnlineMatch({ client, view, isHost, onLeave, leaving, leaveError }) {
  const { session, game, games, moves, cells, axes, boardDifficulty, lines, settings, players, live, refresh, mySeat, inStep } = view
  const phase = matchPhase(session, game)
  const myMark = markOfSeat(game, mySeat)
  const key = turnKey(game, moves)
  const [spentKey, setSpentKey] = useState(null)
  const myTurn = phase === 'playing' && inStep && Boolean(myMark) && game.turn_mark === myMark
  const canAct = myTurn && key !== spentKey && Boolean(axes)

  // A line about the move just made from this phone, for a few seconds.
  const [notice, setNotice] = useState(null)
  const noticeTimer = useRef(null)
  useEffect(() => () => clearTimeout(noticeTimer.current), [])
  function flash(text, tone) {
    clearTimeout(noticeTimer.current)
    setNotice({ text, tone })
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }

  async function onSubmit(cell, footballer) {
    const outcome = await playMove(client, session.id, cell, footballer.id)
    if (outcome.ok) {
      setSpentKey(key)
      if (outcome.outcome === 'claimed') flash(RIGHT_ANSWER, 'go')
      else flash(WRONG_ANSWER, 'flag')
    }
    refresh()
    return outcome
  }

  async function onPass() {
    const outcome = await playPass(client, session.id)
    if (outcome.ok) {
      setSpentKey(key)
      flash('You passed.', 'neutral')
    }
    refresh()
    return outcome
  }

  const difficulty = settings?.difficulty ?? DEFAULT_TTT_DIFFICULTY
  const opponentName = game ? nameOfMark(game, myMark === 'X' ? 'O' : 'X') : null
  const host = players.find((p) => p.id === session.host_player_id)

  return (
    <Screen back="/tic-tac-toe/online" backLabel="Online" accent="accent-teal" width="lg" status={<LiveChip live={live} />}>
      <div className="mx-auto w-full max-w-[34rem]" data-testid="ttt-match" data-phase={phase} data-my-mark={myMark ?? ''}>
        <p className="eyebrow mb-3 text-center" data-testid="board-caption">
          Board {game.board_number}
          {boardDifficulty ? ` · ${getTttDifficulty(boardDifficulty).name}` : ''}
        </p>
        <TttScoreboard game={game} youMark={myMark} score={matchScore(games, game)} />
        <p className="mt-4 mb-4 min-h-[1.5rem] text-center text-callout font-semibold text-text" aria-live="polite" data-testid="turn-status">
          {inStep ? statusLine({ phase, game, myMark, moves, opponentName }) : ''}
        </p>
      </div>

      {axes ? (
        <TttPlayArea
          key={key ?? `board-${game.id}`}
          client={client}
          axes={axes}
          cells={cells}
          winning={winningCells(game, lines)}
          playing={phase === 'playing'}
          canAct={canAct}
          onSubmit={onSubmit}
          onPass={onPass}
          notice={notice && <Notice {...notice} />}
        />
      ) : (
        <div className="surface mx-auto aspect-[4/3] w-full max-w-[34rem] animate-pulse" aria-label="Loading the board" />
      )}

      <div className="mx-auto mt-6 w-full max-w-[34rem] space-y-4">
        {phase === 'between' && (
          <TttResult game={game} youMark={myMark}>
            {isHost ? (
              <HostNextBoard client={client} session={session} difficulty={difficulty} refresh={refresh} />
            ) : (
              <div className="space-y-4">
                <p className="text-center text-subhead text-text-2" data-testid="guest-waiting">
                  Waiting for {host?.display_name ?? 'the host'} to start the next board.
                </p>
                <Panel>
                  <DifficultyReadout value={difficulty} />
                </Panel>
              </div>
            )}
          </TttResult>
        )}

        {phase === 'ended' && (
          <TttResult game={game} youMark={myMark}>
            <p className="text-center text-subhead text-text-2" data-testid="game-over">
              {isHost ? 'You left this game, so it is over.' : `${host?.display_name ?? 'The host'} left, so this game is over.`}
            </p>
          </TttResult>
        )}

        <LeaveControl phase={phase} isHost={isHost} onLeave={onLeave} leaving={leaving} leaveError={leaveError} />
      </div>
    </Screen>
  )
}

function statusLine({ phase, game, myMark, moves, opponentName }) {
  if (phase !== 'playing') return ''
  if (game.turn_mark !== myMark) return `${opponentName} to play.`
  const last = lastMove(moves)
  if (last && last.mark !== myMark) {
    if (last.kind === 'pass') return `${opponentName} passed. Your turn.`
    if (last.kind === 'wrong') return `${opponentName} got one wrong. Your turn.`
  }
  return 'Your turn. Pick a square.'
}

function Notice({ text, tone }) {
  const colour = tone === 'go' ? 'text-go' : tone === 'flag' ? 'text-flag' : 'text-text-2'
  return (
    <p className={`text-center text-callout font-semibold ${colour}`} role="status" data-testid="move-feedback">
      {text}
    </p>
  )
}

function HostNextBoard({ client, session, difficulty, refresh }) {
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

  async function next() {
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
      <Panel>
        <DifficultyPicker value={pendingDifficulty ?? difficulty} onChange={changeDifficulty} disabled={pendingDifficulty !== null || busy} hint="For the next board" />
      </Panel>
      {error && <Alert>{error}</Alert>}
      <Button size="lg" fullWidth onClick={next} disabled={busy || pendingDifficulty !== null} data-testid="ttt-rematch">
        {busy ? 'Starting…' : 'Play again'}
      </Button>
      <p className="text-center text-footnote text-text-3">Same marks. The other player starts.</p>
    </div>
  )
}

/*
 * Leave, which the server treats differently depending on when: in the
 * middle of a board it forfeits that board, so it asks first.
 */
function LeaveControl({ phase, isHost, onLeave, leaving, leaveError }) {
  const [confirming, setConfirming] = useState(false)
  const label = phase === 'ended' ? (isHost ? 'Close game' : 'Leave game') : isHost && phase === 'between' ? 'Close game' : 'Leave game'

  if (phase === 'playing' && confirming) {
    return (
      <div className="surface accent-flag p-4 text-center" style={{ '--tint': '10%' }} data-testid="leave-confirm">
        <p className="text-callout font-semibold text-text">Leave now and forfeit this board?</p>
        <p className="mt-1 text-footnote text-text-3">
          {isHost ? 'It ends the game for both of you.' : 'Your opponent wins it and waits for someone new.'}
        </p>
        {leaveError && <Alert>{leaveError}</Alert>}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={leaving}>
            Stay
          </Button>
          <Button variant="danger" onClick={onLeave} disabled={leaving} data-testid="leave-confirm-yes">
            {leaving ? 'Leaving…' : 'Forfeit'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      {leaveError && <Alert>{leaveError}</Alert>}
      <button
        type="button"
        onClick={() => (phase === 'playing' ? setConfirming(true) : onLeave())}
        disabled={leaving}
        className="pressable h-11 w-full text-subhead font-semibold text-text-3 transition-colors hover:text-flag"
        data-testid="ttt-leave"
      >
        {leaving ? 'Leaving…' : label}
      </button>
    </>
  )
}
