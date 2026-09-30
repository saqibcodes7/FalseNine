import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import Field, { Alert } from '../../ui/Field'
import Panel from '../../ui/Panel'
import { isSupabaseConfigured } from '../../lib/supabase'
import { ensureSession, tttClient } from '../../lib/tttClient'
import { TTT_MODE, joinGame } from '../../lib/tttApi'
import { tttErrorMessage } from '../../lib/tttErrors'
import { saveIdentity } from '../../lib/identity'

/*
 * Join an Online game with its code. As with creating one, the device gets
 * its anonymous user first if it has none, and join_session is told this is a
 * Tic-Tac-Toe code, so an Imposter code is turned away with a message saying
 * so rather than landing anyone in the wrong game.
 */
export default function TttJoin() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [code, setCode] = useState((params.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!isSupabaseConfigured) return <Navigate to="/tic-tac-toe" replace />

  async function handleSubmit(event) {
    event.preventDefault()
    if (busy) return
    const trimmedCode = code.trim().toUpperCase()
    const trimmedName = name.trim()
    if (trimmedCode.length !== 5) {
      setError('Game codes are five characters.')
      return
    }
    if (!trimmedName) {
      setError('Enter a name so your opponent knows who you are.')
      return
    }

    setBusy(true)
    setError(null)
    const client = tttClient('online')

    try {
      await ensureSession(client)
    } catch (connectError) {
      setError(tttErrorMessage(connectError, 'join'))
      setBusy(false)
      return
    }

    const { row, error: rpcError } = await joinGame(client, { code: trimmedCode, name: trimmedName })

    // Already holding a seat in it (another tab, or a double tap): just go in.
    if (rpcError?.hint === 'ttt_already_seated') {
      navigate(`/tic-tac-toe/game/${trimmedCode}`, { replace: true })
      return
    }
    if (rpcError || !row) {
      setError(tttErrorMessage(rpcError, 'join'))
      setBusy(false)
      return
    }

    saveIdentity(row.code, { sessionId: row.session_id, playerId: row.player_id, displayName: trimmedName, isHost: false, savedAt: Date.now() }, TTT_MODE)
    navigate(`/tic-tac-toe/game/${row.code}`, { replace: true })
  }

  return (
    <Screen back="/tic-tac-toe/online" backLabel="Online" accent="accent-teal" title="Join game" subtitle="Ask the host for the code on their screen.">
      <form onSubmit={handleSubmit} noValidate>
        <Panel title="Your seat" bodyClassName="space-y-5">
          <Field
            label="Game code"
            placeholder="ABC12"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))
              if (error) setError(null)
            }}
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
            label="Your name"
            placeholder="Your Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError(null)
            }}
            hint="20 characters max. Has to be different from the host's."
            maxLength={20}
            autoFocus={Boolean(code)}
            autoComplete="nickname"
            enterKeyHint="go"
          />
          {error && <Alert>{error}</Alert>}
        </Panel>

        <Button type="submit" size="lg" fullWidth className="mt-6" disabled={busy || code.length !== 5 || !name.trim()}>
          {busy ? 'Joining…' : 'Join game'}
        </Button>
      </form>
    </Screen>
  )
}
