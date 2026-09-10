import Chip from './Chip'
import Panel from './Panel'

/*
 * The team sheet. One line per player, a stamped brass number, the host and
 * you marked in words. Short lines are drawn with dashed steel so the panel
 * reads as "waiting on people", not "broken".
 */
export default function PlayerRoster({ players, youId, minPlayers = 3 }) {
  const short = Math.max(0, minPlayers - players.length)

  return (
    <Panel title={`In the lobby · ${players.length}`}>
      <ul className="divide-y divide-ink-3">
        {players.map((player, i) => {
          const isYou = player.id === youId
          return (
            <li key={player.id} className="flex items-center gap-3 py-2.5 first:pt-1 last:pb-1">
              <span className="disc metal-gold" aria-hidden="true">
                {i + 1}
              </span>

              <span className="min-w-0 flex-1 truncate font-ui text-lead font-semibold text-chalk-0">
                {player.display_name}
              </span>

              {isYou && <Chip tone="lime">You</Chip>}
              {player.is_host && <Chip tone="gold">Host</Chip>}
            </li>
          )
        })}

        {Array.from({ length: short }).map((_, i) => (
          <li key={`empty-${i}`} className="flex items-center gap-3 py-2.5 last:pb-1">
            <span
              aria-hidden="true"
              className="inline-block h-8 w-8 shrink-0 rounded-full border border-dashed border-ink-4"
            />
            <span className="text-small text-chalk-2">Waiting for a player…</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
