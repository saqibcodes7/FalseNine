import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Screen from '../components/Screen'
import Button from '../components/Button'
import Stepper from '../components/Stepper'
import Toggle from '../components/Toggle'
import SessionCode from '../components/SessionCode'
import PlayerList from '../components/PlayerList'
import { useLobby } from '../hooks/useLobby'
import { supabase, readableError } from '../lib/supabase'
import { loadIdentity, clearIdentity } from '../lib/identity'
import { PACKS, getPack } from '../data/packs'

const MIN_PLAYERS = 3

function formatSeconds(total) {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function Lobby() {
  const { code } = useParams()
  const navigate = useNavigate()
  const upperCode = (code || '').toUpperCase()

  const identity = useMemo(() => loadIdentity(upperCode), [upperCode])
  const { session, players, status, live } = useLobby(upperCode)

  const isHost = Boolean(
    identity && session && session.host_player_id === identity.playerId,
  )

  // Host-only draft of the settings. Seeded once from the server, then owned by
  // this screen — the host is the only person who can change them, so letting a
  // realtime echo overwrite the draft would just fight the person typing.
  const [draft, setDraft] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [startNotice, setStartNotice] = useState(false)
  const seeded = useRef(false)

  useEffect(() => {
    if (!session || seeded.current) return
    seeded.current = true
    setDraft({
      player_pack: session.player_pack,
      num_imposters: session.num_imposters,
      ai_hints_enabled: session.ai_hints_enabled,
      discussion_seconds: session.discussion_seconds,
      voting_seconds: session.voting_seconds,
    })
  }, [session])

  // Push settings after the host stops fiddling, rather than on every tap.
  useEffect(() => {
    if (!isHost || !draft || !session || !identity) return undefined

    const timer = setTimeout(async () => {
      const { error } = await supabase.rpc('update_session_settings', {
        p_session_id: session.id,
        p_player_id: identity.playerId,
        p_player_pack: draft.player_pack,
        p_num_imposters: draft.num_imposters,
        p_ai_hints_enabled: draft.ai_hints_enabled,
        p_discussion_seconds: draft.discussion_seconds,
        p_voting_seconds: draft.voting_seconds,
      })
      setSaveError(error ? readableError(error, 'Could not save settings.') : null)
    }, 400)

    return () => clearTimeout(timer)
  }, [draft, isHost, session?.id, identity?.playerId])

  // The game moved on without this screen. Step 4 will route to the peek screen;
  // for now just make it obvious rather than sitting on a dead lobby.
  const gameStarted = session && session.status !== 'waiting'

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
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-xl border border-pitch-700 bg-pitch-900"
            />
          ))}
        </div>
      </Screen>
    )
  }

  if (status === 'missing') {
    return (
      <Screen back="/imposter" title="That lobby is gone">
        <p className="text-[15px] leading-relaxed text-chalk-400">
          Either the code was mistyped, or the host closed the game. Ask them to
          start a new one.
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
        <p className="text-[15px] leading-relaxed text-chalk-400">
          This browser has no seat in game <strong>{upperCode}</strong>. Join it
          with your display name and you are in.
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

  // ---- Shared state ------------------------------------------------------

  const imposters = draft?.num_imposters ?? session.num_imposters
  const civilians = players.length - imposters
  const ratioOk = imposters < civilians
  const enoughPlayers = players.length >= MIN_PLAYERS
  const canStart = ratioOk && enoughPlayers

  const liveDot = (
    <span className="flex items-center gap-1.5 text-xs font-medium text-chalk-600">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          live ? 'bg-lime-400' : 'animate-pulse bg-chalk-600'
        }`}
      />
      {live ? 'Live' : 'Reconnecting'}
    </span>
  )

  // ---- Non-host waiting room --------------------------------------------

  if (!isHost) {
    const pack = getPack(session.player_pack)

    return (
      <Screen
        back={null}
        action={liveDot}
        title="You're in"
        subtitle={
          gameStarted
            ? 'The host has started the game.'
            : 'Waiting for the host to kick off.'
        }
      >
        <div className="mb-6 rounded-tile border border-pitch-700 bg-pitch-900 p-5">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-chalk-600">Pack</dt>
              <dd className="mt-0.5 font-semibold text-chalk-100">{pack.name}</dd>
            </div>
            <div>
              <dt className="text-chalk-600">Imposters</dt>
              <dd className="tabular mt-0.5 font-semibold text-chalk-100">
                {session.num_imposters}
              </dd>
            </div>
            <div>
              <dt className="text-chalk-600">Discussion</dt>
              <dd className="tabular mt-0.5 font-semibold text-chalk-100">
                {formatSeconds(session.discussion_seconds)}
              </dd>
            </div>
            <div>
              <dt className="text-chalk-600">AI hints</dt>
              <dd className="mt-0.5 font-semibold text-chalk-100">
                {session.ai_hints_enabled ? 'On' : 'Off'}
              </dd>
            </div>
          </dl>
        </div>

        <PlayerList
          players={players}
          youId={identity.playerId}
          minPlayers={MIN_PLAYERS}
        />

        <Button variant="ghost" fullWidth className="mt-8" onClick={leave}>
          Leave game
        </Button>
      </Screen>
    )
  }

  // ---- Host setup --------------------------------------------------------

  const set = (patch) => setDraft((prev) => ({ ...prev, ...patch }))

  return (
    <Screen
      back={null}
      action={liveDot}
      title="Game setup"
      subtitle="Players can join while you sort the settings."
    >
      <div className="mb-7">
        <SessionCode code={session.code} />
      </div>

      <div className="space-y-7">
        <section>
          <h2 className="mb-3 text-sm font-bold tracking-[0.14em] text-chalk-600 uppercase">
            Player pack
          </h2>
          <div className="space-y-2">
            {PACKS.map((pack) => {
              const selected = draft?.player_pack === pack.id
              return (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => set({ player_pack: pack.id })}
                  aria-pressed={selected}
                  className={`w-full rounded-xl border p-4 text-left transition-colors ${
                    selected
                      ? 'border-lime-400 bg-lime-400/5'
                      : 'border-pitch-700 bg-pitch-900 hover:border-pitch-600'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-chalk-100">{pack.name}</span>
                    <span className="shrink-0 text-[10px] font-bold tracking-[0.1em] text-chalk-600 uppercase">
                      {pack.difficulty}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-snug text-chalk-400">
                    {pack.blurb}
                  </p>
                  <p className="tabular mt-2 text-xs text-chalk-600">
                    {pack.players.length} players
                  </p>
                </button>
              )
            })}
          </div>
        </section>

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
          hint="60s to 5 min"
          value={draft?.discussion_seconds ?? 180}
          onChange={(v) => set({ discussion_seconds: v })}
          min={60}
          max={300}
          step={30}
          format={formatSeconds}
        />

        <Stepper
          label="Voting timer"
          hint="30s minimum"
          value={draft?.voting_seconds ?? 60}
          onChange={(v) => set({ voting_seconds: v })}
          min={30}
          max={180}
          step={15}
          format={formatSeconds}
        />

        <div className="rounded-xl border border-pitch-700 bg-pitch-900 p-4">
          <Toggle
            label="AI hints for imposters"
            description="Gives each imposter a vague clue about the player instead of nothing at all. Easier for them, harder for you."
            checked={draft?.ai_hints_enabled ?? false}
            onChange={(v) => set({ ai_hints_enabled: v })}
          />
        </div>

        <PlayerList
          players={players}
          youId={identity.playerId}
          minPlayers={MIN_PLAYERS}
        />
      </div>

      {saveError && (
        <p role="alert" className="mt-5 text-sm text-flag-500">
          {saveError}
        </p>
      )}

      <div className="sticky bottom-0 -mx-5 mt-8 border-t border-pitch-800 bg-pitch-950/95 px-5 pt-4 pb-5 backdrop-blur">
        <Button
          size="lg"
          fullWidth
          disabled={!canStart}
          onClick={() => setStartNotice(true)}
        >
          Start game
        </Button>

        <p className="mt-2.5 text-center text-sm text-chalk-600">
          {!enoughPlayers
            ? `Need ${MIN_PLAYERS - players.length} more player${
                MIN_PLAYERS - players.length === 1 ? '' : 's'
              } to start.`
            : !ratioOk
              ? 'Too many imposters for this many players.'
              : `Ready with ${players.length} players.`}
        </p>

        {startNotice && (
          <p role="status" className="mt-3 text-center text-sm text-lime-400">
            Lobby is good to go. The round engine lands in the next step.
          </p>
        )}

        <button
          type="button"
          onClick={leave}
          className="mt-3 w-full text-sm font-medium text-chalk-600 transition-colors hover:text-flag-500"
        >
          Close lobby
        </button>
      </div>
    </Screen>
  )
}
