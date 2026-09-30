import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import Field from '../../ui/Field'
import Panel from '../../ui/Panel'
import DifficultyPicker from '../../ui/ttt/DifficultyPicker'
import { isSupabaseConfigured } from '../../lib/supabase'
import { ensureSession, tttClient } from '../../lib/tttClient'
import { TTT_MODE, createGame } from '../../lib/tttApi'
import { tttErrorMessage } from '../../lib/tttErrors'
import { saveIdentity } from '../../lib/identity'
import { DEFAULT_TTT_DIFFICULTY } from '../../data/tttDifficulties'

/*
 * Start an Online game: a name and a difficulty, then straight into the lobby
 * with a code to share.
 *
 * The seat belongs to this device's anonymous user, so the device gets one
 * first, silently, if it has none. The lobby is created only once it has.
 */
export default function TttCreate() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [difficulty, setDifficulty] = useState(DEFAULT_TTT_DIFFICULTY)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!isSupabaseConfigured) return <Navigate to="/tic-tac-toe" replace />

  async function handleSubmit(event) {
    event.preventDefault()
    if (busy) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a name so your opponent knows who you are.')
      return
    }

    setBusy(true)
    setError(null)
    const client = tttClient('online')

    try {
      await ensureSession(client)
    } catch (connectError) {
      setError(tttErrorMessage(connectError, 'create'))
      setBusy(false)
      return
    }

    const { row, error: rpcError } = await createGame(client, { name: trimmed, difficulty })
    if (rpcError || !row) {
      setError(tttErrorMessage(rpcError, 'create'))
      setBusy(false)
      return
    }

    // A shortcut back to this lobby for the Rejoin list. Never read as proof
    // of anything: the lobby asks the server which seat is yours.
    saveIdentity(row.code, { sessionId: row.session_id, playerId: row.player_id, displayName: trimmed, isHost: true, savedAt: Date.now() }, TTT_MODE)
    navigate(`/tic-tac-toe/game/${row.code}`, { replace: true })
  }

  return (
    <Screen back="/tic-tac-toe/online" backLabel="Online" accent="accent-teal" title="Create game" subtitle="You'll be the host. You pick the difficulty and when to start.">
      <form onSubmit={handleSubmit} noValidate>
        <Panel title="You" bodyClassName="space-y-6">
          <Field
            label="Your name"
            placeholder="Your Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError(null)
            }}
            error={error}
            hint="What your opponent sees. 20 characters max."
            maxLength={20}
            autoFocus
            autoComplete="nickname"
            enterKeyHint="go"
          />
          <DifficultyPicker value={difficulty} onChange={setDifficulty} hint="You can change it later" />
        </Panel>

        <Button type="submit" size="lg" fullWidth className="mt-6" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create game'}
        </Button>
      </form>
    </Screen>
  )
}
