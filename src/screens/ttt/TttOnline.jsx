import { useNavigate } from 'react-router-dom'
import Screen from '../../ui/Screen'
import Button from '../../ui/Button'
import Panel from '../../ui/Panel'
import Chip from '../../ui/Chip'
import { isSupabaseConfigured } from '../../lib/supabase'
import { listIdentities } from '../../lib/identity'
import { TTT_MODE } from '../../lib/tttApi'

/*
 * Online: start a game and share the code, or join one with a code.
 *
 * The Rejoin list is only a shortcut back to lobbies this device was in.
 * Whether you are still in one is the server's answer, asked when you open it.
 */
export default function TttOnline() {
  const navigate = useNavigate()
  const openLobbies = isSupabaseConfigured ? listIdentities({ mode: TTT_MODE }) : []

  return (
    <Screen back="/tic-tac-toe" backLabel="Tic-Tac-Toe" accent="accent-teal" title="Online" subtitle="One of you creates the game, the other joins with its code.">
      <div className="space-y-3">
        <Button size="lg" fullWidth disabled={!isSupabaseConfigured} onClick={() => navigate('/tic-tac-toe/online/create')}>
          Create game
        </Button>
        <Button size="lg" variant="secondary" fullWidth disabled={!isSupabaseConfigured} onClick={() => navigate('/tic-tac-toe/online/join')}>
          Join game
        </Button>
      </div>

      {openLobbies.length > 0 && (
        <Panel title="Rejoin" className="mt-8" bodyClassName="p-0">
          <ul className="divide-hairline">
            {openLobbies.map((entry) => (
              <li key={entry.code}>
                <button
                  type="button"
                  onClick={() => navigate(`/tic-tac-toe/game/${entry.code}`)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="tabular block text-title3 font-bold tracking-[0.06em] text-gold" data-testid="ttt-rejoin-code">
                      {entry.code}
                    </span>
                    <span className="block truncate text-footnote text-text-3">as {entry.displayName}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {entry.isHost && <Chip tone="gold">Host</Chip>}
                    <svg aria-hidden="true" viewBox="0 0 12 20" className="h-4 w-2.5 text-text-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 2l8 8-8 8" />
                    </svg>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </Screen>
  )
}
