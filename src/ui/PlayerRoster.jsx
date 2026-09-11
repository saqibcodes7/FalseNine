import Chip from './Chip'
import Panel from './Panel'

/*
 * The team sheet. One line per player, a stamped brass number, the host and
 * you marked in words. Short lines are drawn with dashed steel so the panel
 * reads as "waiting on people", not "broken".
 *
 * Once the game is on, a player who has been voted out is struck through
 * with OUT stamped beside them, and their role once it is public. `marks`
 * lets a phase add its own words per player ("Ready", "Voted") so state is
 * never carried by colour alone.
 */
export default function PlayerRoster({
  players,
  youId,
  minPlayers = 3,
  title,
  marks = () => [],
}) {
  const short = Math.max(0, minPlayers - players.length)
  const active = players.filter((p) => p.is_active).length
  const heading = title ?? `In the lobby · ${players.length}`

  return (
    <Panel title={heading}>
      <ul className="divide-y divide-ink-3">
        {players.map((player, i) => {
          const isYou = player.id === youId
          const out = !player.is_active
          return (
            <li
              key={player.id}
              className="flex items-center gap-3 py-2.5 first:pt-1 last:pb-1"
              data-out={out ? '' : undefined}
            >
              <span
                className={out ? 'disc metal-steel opacity-70' : 'disc metal-gold'}
                aria-hidden="true"
              >
                {i + 1}
              </span>

              <span
                className={`min-w-0 flex-1 truncate font-ui text-lead font-semibold ${
                  out ? 'text-chalk-2 line-through decoration-flag/70' : 'text-chalk-0'
                }`}
              >
                {player.display_name}
              </span>

              {isYou && <Chip tone="lime">You</Chip>}
              {player.is_host && !out && <Chip tone="gold">Host</Chip>}
              {out && <Chip tone="steel">Out</Chip>}
              {out && player.revealed_role === 'imposter' && <Chip tone="red">Imposter</Chip>}
              {out && player.revealed_role === 'civilian' && <Chip tone="silver">Civilian</Chip>}
              {!out &&
                marks(player).map((m) => (
                  <Chip key={m.text} tone={m.tone}>
                    {m.text}
                  </Chip>
                ))}
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
      {title && active < players.length && (
        <p className="mt-3 text-meta font-medium text-chalk-2">
          {active} still in it · {players.length - active} out
        </p>
      )}
    </Panel>
  )
}
