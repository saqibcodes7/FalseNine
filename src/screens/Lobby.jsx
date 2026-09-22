import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Screen from '../ui/Screen'
import Button from '../ui/Button'
import Panel from '../ui/Panel'
import Chip from '../ui/Chip'
import Stepper from '../ui/Stepper'
import Toggle from '../ui/Toggle'
import Segmented from '../ui/Segmented'
import { Alert } from '../ui/Field'
import JoinCodeDisplay from '../ui/JoinCodeDisplay'
import PlayerRoster from '../ui/PlayerRoster'
import { useLobby } from '../hooks/useLobby'
import Game from './Game'
import { supabase, readableError } from '../lib/supabase'
import { loadIdentity, clearIdentity } from '../lib/identity'
import { PACKS, DIFFICULTIES, getPack, getDifficulty, playersFor, candidatesFor } from '../data/packs'
import { DISCUSSION_STEPS, VOTING_STEPS, formatClock } from '../lib/clocks'

const MIN_PLAYERS = 3

function LiveChip({ live }) {
  return live ? <Chip tone="go">Live</Chip> : <Chip tone="neutral">Reconnecting</Chip>
}

export default function Lobby() {
  const { code } = useParams()
  const navigate = useNavigate()
  const upperCode = (code || '').toUpperCase()

  const identity = useMemo(() => loadIdentity(upperCode), [upperCode])
  const { session, players, rounds, votes, status, live, clockOffset } = useLobby(upperCode)

  const isHost = Boolean(
    identity && session && session.host_player_id === identity.playerId,
  )

  // Host-only draft of the settings. Seeded once from the server, then owned by
  // this screen — the host is the only person who can change them, so letting a
  // realtime echo overwrite the draft would just fight the person typing.
  const [draft, setDraft] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [startError, setStartError] = useState(null)
  const [starting, setStarting] = useState(false)
  const seeded = useRef(false)

  useEffect(() => {
    if (!session || seeded.current) return
    seeded.current = true
    setDraft({
      player_pack: session.player_pack,
      difficulty: session.difficulty,
      num_imposters: session.num_imposters,
      hints_enabled: session.hints_enabled,
      votes_visible: session.votes_visible,
      discussion_seconds: session.discussion_seconds,
      voting_seconds: session.voting_seconds,
    })
  }, [session])

  // Push settings after the host stops fiddling, rather than on every tap.
  useEffect(() => {
    if (!isHost || !draft || !session || !identity || session.status !== 'waiting') return undefined

    const timer = setTimeout(async () => {
      const { error } = await supabase.rpc('update_session_settings', {
        p_session_id: session.id,
        p_player_id: identity.playerId,
        p_player_pack: draft.player_pack,
        p_difficulty: draft.difficulty,
        p_num_imposters: draft.num_imposters,
        p_hints_enabled: draft.hints_enabled,
        p_votes_visible: draft.votes_visible,
        p_discussion_seconds: draft.discussion_seconds,
        p_voting_seconds: draft.voting_seconds,
      })
      setSaveError(error ? readableError(error, 'Could not save settings.') : null)
    }, 400)

    return () => clearTimeout(timer)
  }, [draft, isHost, session?.id, session?.status, identity?.playerId])

  async function startGame() {
    if (!draft || starting) return
    setStarting(true)
    setStartError(null)
    // Both arrays go up, in step with each other. The server draws the index.
    const { names, hints } = candidatesFor(draft.player_pack, draft.difficulty)
    const { error } = await supabase.rpc('start_game', {
      p_session_id: session.id,
      p_player_id: identity.playerId,
      p_candidates: names,
      p_hints: hints,
    })
    setStarting(false)
    if (error) setStartError(readableError(error, 'Could not start the game.'))
  }

  async function leave() {
    if (session && identity) {
      await supabase.rpc('leave_session', {
        p_session_id: session.id,
        p_player_id: identity.playerId,
      })
    }
    clearIdentity(upperCode)
    navigate('/imposter', { replace: true })
  }

  // ---- Loading and dead ends -------------------------------------------

  if (status === 'loading') {
    return (
      <Screen back="/imposter" title="Loading lobby…">
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="surface h-16 animate-pulse" />
          ))}
        </div>
      </Screen>
    )
  }

  if (status === 'missing') {
    return (
      <Screen back="/imposter" title="That lobby is gone">
        <p className="max-w-[38ch] text-body leading-relaxed text-text-2">
          Either the code was mistyped, or the host closed the game. Ask them to start
          a new one.
        </p>
        <Button
          fullWidth
          size="lg"
          className="mt-6"
          onClick={() => {
            clearIdentity(upperCode)
            navigate('/imposter', { replace: true })
          }}
        >
          Back to Football Imposter
        </Button>
      </Screen>
    )
  }

  if (!identity) {
    return (
      <Screen back="/imposter" title="You are not in this lobby">
        <p className="max-w-[38ch] text-body leading-relaxed text-text-2">
          This browser has no seat in game{' '}
          <span className="tabular font-bold tracking-[0.08em] text-gold">{upperCode}</span>.
          Join it with your display name and you are in.
        </p>
        <Button
          fullWidth
          size="lg"
          className="mt-6"
          onClick={() => navigate(`/imposter/join?code=${upperCode}`)}
        >
          Join this game
        </Button>
      </Screen>
    )
  }

  // ---- The game itself, once the host has started it ---------------------

  if (session.status !== 'waiting') {
    return (
      <Game
        session={session}
        players={players}
        rounds={rounds}
        votes={votes}
        identity={identity}
        live={live}
        clockOffset={clockOffset}
      />
    )
  }

  // ---- Shared state ------------------------------------------------------

  const imposters = draft?.num_imposters ?? session.num_imposters
  const civilians = players.length - imposters
  const ratioOk = imposters < civilians
  const enoughPlayers = players.length >= MIN_PLAYERS
  const canStart = ratioOk && enoughPlayers

  // ---- Non-host waiting room --------------------------------------------

  if (!isHost) {
    const pack = getPack(session.player_pack)
    const difficulty = getDifficulty(session.difficulty)

    return (
      <Screen
        status={<LiveChip live={live} />}
        title="You're in"
        subtitle="Waiting for the host to kick off."
      >
        {/* Anyone in the lobby can read the code out or pass the link on —
            it is not the host's to keep. */}
        <div className="mb-7">
          <JoinCodeDisplay code={session.code} />
        </div>

        <Panel title="Match settings" className="mb-6" bodyClassName="p-0">
          <dl className="divide-hairline">
            {[
              ['Pack', pack.name],
              ['Mode', difficulty.name],
              ['Imposters', String(session.num_imposters)],
              ['Discussion', formatClock(session.discussion_seconds)],
              ['Voting', formatClock(session.voting_seconds)],
              ['Hints for imposters', session.hints_enabled ? 'On' : 'Off'],
              ['Live votes', session.votes_visible ? 'Shown' : 'Hidden'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                <dt className="text-subhead text-text-2">{k}</dt>
                <dd className="tabular text-callout font-semibold text-text">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <PlayerRoster players={players} youId={identity.playerId} minPlayers={MIN_PLAYERS} />

        <Button variant="quiet" fullWidth className="mt-8" onClick={leave}>
          Leave game
        </Button>
      </Screen>
    )
  }

  // ---- Host setup --------------------------------------------------------

  const set = (patch) => setDraft((prev) => ({ ...prev, ...patch }))
  const inPlay = playersFor(draft?.player_pack, draft?.difficulty).length
  const squadSize = playersFor(draft?.player_pack, 'you_know_ball').length

  return (
    <Screen
      status={<LiveChip live={live} />}
      title="Game setup"
      subtitle="Players can join while you sort the settings."
    >
      <div className="mb-7">
        <JoinCodeDisplay code={session.code} />
      </div>

      <div className="space-y-7">
        <Panel title="Player pack" bodyClassName="p-0">
          <ul className="divide-hairline" role="list">
            {PACKS.map((pack) => {
              const selected = draft?.player_pack === pack.id
              return (
                <li key={pack.id}>
                  <button
                    type="button"
                    onClick={() => set({ player_pack: pack.id })}
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
            value={draft?.difficulty ?? 'casual'}
            onChange={(v) => set({ difficulty: v })}
          />
          <p className="mt-2 text-footnote leading-snug text-text-3" data-testid="difficulty-blurb">
            {getDifficulty(draft?.difficulty).blurb}
          </p>
          </div>
        </Panel>

        <Panel title="Rules" bodyClassName="space-y-6">
          <Stepper
            label="Imposters"
            hint={`${players.length} in the lobby`}
            value={imposters}
            onChange={(v) => set({ num_imposters: v })}
            min={1}
            max={4}
            warning={
              !ratioOk && enoughPlayers
                ? `Imposters have to be outnumbered. With ${players.length} players you can have at most ${Math.max(1, Math.ceil(players.length / 2) - 1)}.`
                : null
            }
          />

          <Stepper
            label="Discussion timer"
            hint="Wind it down for no limit"
            value={draft?.discussion_seconds ?? 180}
            onChange={(v) => set({ discussion_seconds: v })}
            steps={DISCUSSION_STEPS}
            format={formatClock}
          />

          <Stepper
            label="Voting timer"
            hint="Wind it down for no limit"
            value={draft?.voting_seconds ?? 60}
            onChange={(v) => set({ voting_seconds: v })}
            steps={VOTING_STEPS}
            format={formatClock}
          />

          <Toggle
            label="Hints for imposters"
            description="Each imposter gets one vague word about the footballer instead of nothing at all. Easier for them, harder for you."
            checked={draft?.hints_enabled ?? false}
            onChange={(v) => set({ hints_enabled: v })}
          />

          <Toggle
            label="Show votes as they land"
            description="On: everyone watches who voted for whom during the vote. Off: only the count shows until the reveal."
            checked={draft?.votes_visible ?? false}
            onChange={(v) => set({ votes_visible: v })}
          />
        </Panel>

        <PlayerRoster players={players} youId={identity.playerId} minPlayers={MIN_PLAYERS} />
      </div>

      {saveError && <Alert>{saveError}</Alert>}

      {/* the whistle: pinned to the thumb */}
      <div
        className="surface-bar sticky bottom-0 z-30 -mx-5 mt-8 px-5 pt-3"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="hairline mb-3 -mx-5" aria-hidden="true" />

        <Button size="lg" fullWidth disabled={!canStart || starting} onClick={startGame}>
          {starting ? 'Dealing…' : 'Start game'}
        </Button>

        <p className="mt-2.5 text-center text-footnote text-text-2">
          {!enoughPlayers
            ? `Need ${MIN_PLAYERS - players.length} more player${
                MIN_PLAYERS - players.length === 1 ? '' : 's'
              } to start.`
            : !ratioOk
              ? 'Too many imposters for this many players.'
              : `Ready with ${players.length} players.`}
        </p>

        {startError && <Alert>{startError}</Alert>}

        <button
          type="button"
          onClick={leave}
          className="pressable mt-1 h-11 w-full text-subhead font-semibold text-text-3 transition-colors hover:text-flag"
        >
          Close lobby
        </button>
      </div>
    </Screen>
  )
}
