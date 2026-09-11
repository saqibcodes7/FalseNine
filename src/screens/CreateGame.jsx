import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Screen from '../ui/Screen'
import Button from '../ui/Button'
import Field from '../ui/Field'
import Panel from '../ui/Panel'
import { supabase, readableError, isSupabaseConfigured } from '../lib/supabase'
import { saveIdentity } from '../lib/identity'
import { DEFAULT_PACK_ID, DEFAULT_DIFFICULTY_ID } from '../data/packs'

/*
 * The host needs a name before a lobby can exist, since the lobby's host is a
 * row in `players`. One field, then straight into host setup with a live code.
 */
export default function CreateGame() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (busy) return

    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a display name so people know who you are.')
      return
    }

    setBusy(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('create_session', {
      p_display_name: trimmed,
      p_player_pack: DEFAULT_PACK_ID,
      p_difficulty: DEFAULT_DIFFICULTY_ID,
      p_num_imposters: 1,
      p_ai_hints_enabled: false,
      p_votes_visible: false,
      p_discussion_seconds: 180,
      p_voting_seconds: 60,
    })

    const row = Array.isArray(data) ? data[0] : data

    if (rpcError || !row) {
      setError(readableError(rpcError, 'Could not create the game.'))
      setBusy(false)
      return
    }

    saveIdentity(row.code, {
      sessionId: row.session_id,
      playerId: row.player_id,
      displayName: trimmed,
      isHost: true,
      savedAt: Date.now(),
    })

    navigate(`/imposter/lobby/${row.code}`, { replace: true })
  }

  if (!isSupabaseConfigured) {
    navigate('/imposter', { replace: true })
    return null
  }

  return (
    <Screen
      back="/imposter"
      title="Create game"
      subtitle="You will be the host. You pick the pack, the timers and when to kick off."
    >
      <form onSubmit={handleSubmit} noValidate>
        <Panel title="The host">
          <Field
            label="Your display name"
            placeholder="e.g. Saqib"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError(null)
            }}
            error={error}
            hint="This is what everyone else sees. 20 characters max."
            maxLength={20}
            autoFocus
            autoComplete="nickname"
            enterKeyHint="go"
          />
        </Panel>

        <Button
          type="submit"
          size="lg"
          fullWidth
          className="mt-6"
          disabled={busy || !name.trim()}
        >
          {busy ? 'Creating…' : 'Create game'}
        </Button>
      </form>
    </Screen>
  )
}
