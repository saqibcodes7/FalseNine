import { useState } from 'react'
import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import Panel from '../../ui/Panel'
import Chip from '../../ui/Chip'
import { Alert } from '../../ui/Field'
import JoinCodeDisplay from '../../ui/JoinCodeDisplay'
import PlayerRoster from '../../ui/PlayerRoster'
import DifficultyPicker, { DifficultyReadout } from '../../ui/ttt/DifficultyPicker'
import { setDifficulty, startGame } from '../../lib/tttApi'
import { tttErrorMessage } from '../../lib/tttErrors'
import { DEFAULT_TTT_DIFFICULTY } from '../../data/tttDifficulties'

/*
 * The Online waiting room: the code to share, who is here, the difficulty,
 * and Start. Also where a lobby comes back to when the opponent leaves, so it
 * says what happened to the last board before waiting for someone new.
 *
 * Only the host gets controls, and even then Start is the server's call: it
 * is offered once two players are seated, and ttt_start_game checks again.
 */
export function LiveChip({ live }) {
  return live ? <Chip tone="go">Live</Chip> : <Chip tone="neutral">Reconnecting</Chip>
}

export default function TttLobby({ client, view, isHost, onLeave, leaving, leaveError }) {
  const { session, players, settings, game, live, refresh, mySeat } = view
  const seated = players.filter((p) => p.is_active)
  const host = players.find((p) => p.id === session.host_player_id)
  const opponent = players.find((p) => p.id !== session.host_player_id && p.is_active)
  const canStart = seated.length === 2

  const serverDifficulty = settings?.difficulty ?? DEFAULT_TTT_DIFFICULTY
  const [pendingDifficulty, setPendingDifficulty] = useState(null)
  const [settingsError, setSettingsError] = useState(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState(null)

  async function changeDifficulty(next) {
    setPendingDifficulty(next)
    setSettingsError(null)
    const { error } = await setDifficulty(client, session.id, next)
    if (error) setSettingsError(tttErrorMessage(error, 'difficulty'))
    await refresh()
    setPendingDifficulty(null)
  }

  async function start() {
    if (starting) return
    setStarting(true)
    setStartError(null)
    const { error } = await startGame(client, session.id)
    if (error) setStartError(tttErrorMessage(error, 'start'))
    await refresh()
    setStarting(false)
  }

  // The lobby is back to waiting because the opponent left. Tell the host what
  // became of the board they left, as the server recorded it. (A new opponent
  // who has just joined has no interest in the last one's exit.)
  const lastBoard = isHost && !opponent && game && game.status !== 'playing' ? game : null
  const leaverName = lastBoard ? (lastBoard.x_player_id === session.host_player_id ? lastBoard.o_name : lastBoard.x_name) : null
  const lastWord = lastBoard
    ? lastBoard.status === 'forfeited'
      ? `${leaverName} left mid-board, so board ${lastBoard.board_number} went to you by forfeit.`
      : `${leaverName} left the game.`
    : null

  const title = isHost ? (canStart ? 'Ready to play' : 'Waiting for an opponent') : "You're in"
  const subtitle = isHost
    ? canStart
      ? `${opponent?.display_name} is here. Start when you're ready.`
      : 'Share the code. Your opponent joins with it.'
    : `Waiting for ${host?.display_name ?? 'the host'} to start.`

  return (
    <Screen back="/tic-tac-toe/online" backLabel="Online" accent="accent-teal" status={<LiveChip live={live} />} title={title} subtitle={subtitle}>
      <div className="space-y-7" data-testid="ttt-lobby" data-role={isHost ? 'host' : 'guest'}>
        {lastWord && (
          <p className="surface accent-teal p-4 text-subhead leading-relaxed text-text-2" style={{ '--tint': '8%' }} data-testid="lobby-last-board">
            {lastWord}
          </p>
        )}

        <JoinCodeDisplay code={session.code} joinPath="/tic-tac-toe/online/join" />

        <PlayerRoster players={seated} youId={mySeat} minPlayers={2} title="Players" />

        <Panel title="Settings">
          {isHost ? (
            <DifficultyPicker
              value={pendingDifficulty ?? serverDifficulty}
              onChange={changeDifficulty}
              disabled={pendingDifficulty !== null || starting}
              hint="For the next board"
            />
          ) : (
            <DifficultyReadout value={serverDifficulty} />
          )}
          {settingsError && <Alert>{settingsError}</Alert>}
        </Panel>
      </div>

      {isHost ? (
        <div className="surface-bar sticky bottom-0 z-30 -mx-5 mt-8 px-5 pt-3" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <div className="hairline mb-3 -mx-5" aria-hidden="true" />
          <Button size="lg" fullWidth disabled={!canStart || starting || pendingDifficulty !== null} onClick={start} data-testid="ttt-start">
            {starting ? 'Starting…' : 'Start game'}
          </Button>
          <p className="mt-2.5 text-center text-footnote text-text-2" data-testid="ttt-start-hint">
            {canStart ? 'A coin toss decides who goes first.' : 'Waiting for an opponent to join.'}
          </p>
          {startError && <Alert>{startError}</Alert>}
          {leaveError && <Alert>{leaveError}</Alert>}
          <button
            type="button"
            onClick={onLeave}
            disabled={leaving}
            className="pressable mt-1 h-11 w-full text-subhead font-semibold text-text-3 transition-colors hover:text-flag"
            data-testid="ttt-leave"
          >
            {leaving ? 'Closing…' : 'Close game'}
          </button>
        </div>
      ) : (
        <>
          {leaveError && <Alert>{leaveError}</Alert>}
          <Button variant="quiet" fullWidth className="mt-8" onClick={onLeave} disabled={leaving} data-testid="ttt-leave">
            {leaving ? 'Leaving…' : 'Leave game'}
          </Button>
        </>
      )}
    </Screen>
  )
}
