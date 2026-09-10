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
import { supabase, readableError } from '../lib/supabase'
import { loadIdentity, clearIdentity } from '../lib/identity'
import { PACKS, DIFFICULTIES, getPack, getDifficulty, playersFor } from '../data/packs'

const MIN_PLAYERS = 3

function formatSeconds(total) {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function LiveChip({ live }) {
  return live ? <Chip tone="lime">Live</Chip> : <Chip tone="steel">Reconnecting</Chip>
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
      difficulty: session.difficulty,
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
        p_difficulty: draft.difficulty,
        p_num_imposters: draft.num_imposters,
        p_ai_hints_enabled: draft.ai_hints_enabled,
        p_discussion_seconds: draft.discussion_seconds,
        p_voting_seconds: draft.voting_seconds,
      })
      setSaveError(error ? readableError(error, 'Could not save settings.') : null)
    }, 400)

    return () => clearTimeout(timer)
  }, [draft, isHost, session?.id, identity?.playerId])

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
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="frame metal-steel animate-pulse" style={{ '--fw': '3px' }}>
              <div className="frame-inner enamel-ink-deep h-16" />
            </div>
          ))}
        </div>
      </Screen>
    )
  }

  if (status === 'missing') {
    return (
      <Screen back="/imposter" title="That lobby is gone">
        <p className="max-w-[38ch] text-body leading-relaxed text-chalk-1">
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
        <p className="max-w-[38ch] text-body leading-relaxed text-chalk-1">
          This browser has no seat in game{' '}
          <span className="display text-[1.3rem] tracking-[0.12em] text-lime">{upperCode}</span>.
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
        subtitle={
          gameStarted
            ? 'The host has started the game.'
            : 'Waiting for the host to kick off.'
        }
      >
        <Panel title="Match settings" className="mb-6">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {[
              ['Pack', pack.name],
              ['Mode', difficulty.name],
              ['Imposters', String(session.num_imposters)],
              ['Discussion', formatSeconds(session.discussion_seconds)],
              ['Voting', formatSeconds(session.voting_seconds)],
              ['AI hints', session.ai_hints_enabled ? 'On' : 'Off'],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="display text-[0.95rem] tracking-[0.18em] text-chalk-2 engraved">
                  {k}
                </dt>
                <dd className="display tabular text-[1.6rem] leading-none tracking-[0.04em] text-gold-hi engraved">
                  {v}
                </dd>
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
        <Panel title="Player pack">
          <ul className="divide-y divide-ink-3" role="list">
            {PACKS.map((pack) => {
              const selected = draft?.player_pack === pack.id
              return (
                <li key={pack.id}>
                  <button
                    type="button"
                    onClick={() => set({ player_pack: pack.id })}
                    aria-pressed={selected}
                    className="group flex w-full items-center gap-3 py-2.5 text-left transition-colors first:pt-1 last:pb-1"
                  >
                    <span
                      aria-hidden="true"
                      className={
                        selected
                          ? 'disc metal-gold shrink-0 text-[1rem]'
                          : 'inline-block h-8 w-8 shrink-0 rounded-full border border-dashed border-ink-4 transition-colors group-hover:border-gold-lo'
                      }
                    >
                      {selected ? '✓' : ''}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span
                        className={`display block text-[1.4rem] leading-none tracking-[0.05em] engraved ${
                          selected ? 'text-gold-hi' : 'text-chalk-1 group-hover:text-chalk-0'
                        }`}
                      >
                        {pack.name}
                      </span>
                      <span className="mt-0.5 block text-small leading-snug text-chalk-1">
                        {pack.blurb}
                      </span>
                    </span>

                    {selected && <Chip tone="lime">Selected</Chip>}
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="hairline metal-steel my-4" aria-hidden="true" />

          <Segmented
            label="How deep"
            hint={`${inPlay} of ${squadSize} in play`}
            options={DIFFICULTIES.map((d) => ({ id: d.id, name: d.name, meta: d.level }))}
            value={draft?.difficulty ?? 'casual'}
            onChange={(v) => set({ difficulty: v })}
          />
          <p className="mt-2 text-small leading-snug text-chalk-1" data-testid="difficulty-blurb">
            {getDifficulty(draft?.difficulty).blurb}
          </p>
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

          <Toggle
            label="AI hints for imposters"
            description="Gives each imposter a vague clue about the player instead of nothing at all. Easier for them, harder for you."
            checked={draft?.ai_hints_enabled ?? false}
            onChange={(v) => set({ ai_hints_enabled: v })}
          />
        </Panel>

        <PlayerRoster players={players} youId={identity.playerId} minPlayers={MIN_PLAYERS} />
      </div>

      {saveError && <Alert>{saveError}</Alert>}

      {/* the whistle: pinned to the thumb */}
      <div
        className="sticky bottom-0 z-30 -mx-5 mt-8 bg-ink-0 px-5 pt-3"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="hairline metal-steel mb-3" aria-hidden="true" />

        <Button size="lg" fullWidth disabled={!canStart} onClick={() => setStartNotice(true)}>
          Start game
        </Button>

        <p className="mt-2.5 text-center text-small text-chalk-1">
          {!enoughPlayers
            ? `Need ${MIN_PLAYERS - players.length} more player${
                MIN_PLAYERS - players.length === 1 ? '' : 's'
              } to start.`
            : !ratioOk
              ? 'Too many imposters for this many players.'
              : `Ready with ${players.length} players.`}
        </p>

        {startNotice && (
          <p role="status" className="mt-2 text-center text-small font-medium text-lime">
            Lobby is good to go. The round engine lands in the next step.
          </p>
        )}

        <button
          type="button"
          onClick={leave}
          className="display mt-2 w-full text-[1.05rem] tracking-[0.12em] text-chalk-2 engraved transition-colors hover:text-flag"
        >
          Close lobby
        </button>
      </div>
    </Screen>
  )
}
