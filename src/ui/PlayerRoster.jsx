import Chip from './Chip'
import Panel from './Panel'

/*
 * The team sheet: a grouped list, one row per player, hairlines between. A
 * player still to arrive gets a dashed placeholder rather than nothing, so
 * the panel reads as "waiting on people" instead of broken.
 *
 * Once the game is on, anyone voted out is struck through and stamped Out,
 * with their role beside it once it is public. `marks` lets a phase add its
 * own words per player — "Ready", "Voted" — so no state here is ever colour
 * on its own.
 */
function Avatar({ name, index, out }) {
  const initial = String(name || '?').trim().charAt(0).toUpperCase()
  return (
    <span
      aria-hidden="true"
      className={[
        'grid h-9 w-9 shrink-0 place-items-center rounded-full text-subhead font-semibold',
        out
          ? 'bg-white/[0.05] text-text-4'
          : 'fill-soft text-text',
      ].join(' ')}
    >
      {initial || index + 1}
    </span>
  )
}

export default function PlayerRoster({
  players,
  youId,
  minPlayers = 3,
  title,
  marks = () => [],
}) {
  const short = Math.max(0, minPlayers - players.length)
  const active = players.filter((p) => p.is_active !== false).length
  const heading = title ?? 'In the lobby'

  return (
    <Panel
      title={heading}
      action={
        <span className="tabular text-footnote font-semibold text-text-3">
          {active < players.length ? `${active} of ${players.length} left in` : players.length}
        </span>
      }
      bodyClassName="p-0"
    >
      <ul className="divide-hairline" role="list">
        {players.map((player, i) => {
          const isYou = player.id === youId
          const out = player.is_active === false
          return (
            <li
              key={player.id}
              className="flex items-center gap-3 px-4 py-2.5"
              data-out={out ? '' : undefined}
            >
              <Avatar name={player.display_name} index={i} out={out} />

              <span
                className={`min-w-0 flex-1 truncate text-callout font-semibold ${
                  out ? 'text-text-3 line-through decoration-flag/60' : 'text-text'
                }`}
              >
                {player.display_name}
              </span>

              {isYou && <Chip tone="gold">You</Chip>}
              {player.is_host && !out && <Chip tone="neutral">Host</Chip>}
              {out && <Chip tone="neutral">Out</Chip>}
              {out && player.revealed_role === 'imposter' && <Chip tone="flag">Imposter</Chip>}
              {out && player.revealed_role === 'civilian' && (
                <Chip tone="neutral">Civilian</Chip>
              )}
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
          <li key={`empty-${i}`} className="flex items-center gap-3 px-4 py-2.5">
            <span
              aria-hidden="true"
              className="h-9 w-9 shrink-0 rounded-full border border-dashed border-white/15"
            />
            <span className="text-subhead text-text-3">Waiting for a player…</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
