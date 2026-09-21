import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Screen from '../ui/Screen'
import Button from '../ui/Button'
import Field, { Alert } from '../ui/Field'
import Panel from '../ui/Panel'
import { supabase, readableError, isSupabaseConfigured } from '../lib/supabase'
import { saveIdentity } from '../lib/identity'

export default function JoinGame() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  // Invite links land here as /imposter/join?code=ABC12.
  const [code, setCode] = useState((params.get('code') || '').toUpperCase())
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (busy) return

    const trimmedCode = code.trim().toUpperCase()
    const trimmedName = name.trim()

    if (trimmedCode.length !== 5) {
      setError('Join codes are five characters.')
      return
    }
    if (!trimmedName) {
      setError('Enter a display name so people know who you are.')
      return
    }

    setBusy(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('join_session', {
      p_code: trimmedCode,
      p_display_name: trimmedName,
    })

    const row = Array.isArray(data) ? data[0] : data

    if (rpcError || !row) {
      setError(readableError(rpcError, 'Could not join that game.'))
      setBusy(false)
      return
    }

    saveIdentity(row.code, {
      sessionId: row.session_id,
      playerId: row.player_id,
      displayName: trimmedName,
      isHost: false,
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
      title="Join game"
      subtitle="Ask the host for the code on their screen."
    >
      <form onSubmit={handleSubmit} noValidate>
        <Panel title="Your seat" bodyClassName="space-y-5">
          <Field
            label="Join code"
            placeholder="ABC12"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))
              if (error) setError(null)
            }}
            // The code reads like the scoreboard on the host's screen.
            variant="code"
            maxLength={5}
            autoFocus={!code}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="next"
          />

          <Field
            label="Your display name"
            placeholder="Your Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError(null)
            }}
            hint="20 characters max. Has to be different from everyone else in the lobby."
            maxLength={20}
            autoFocus={Boolean(code)}
            autoComplete="nickname"
            enterKeyHint="go"
          />

          {error && <Alert>{error}</Alert>}
        </Panel>

        <Button
          type="submit"
          size="lg"
          fullWidth
          className="mt-6"
          disabled={busy || code.length !== 5 || !name.trim()}
        >
          {busy ? 'Joining…' : 'Join game'}
        </Button>
      </form>
    </Screen>
  )
}
