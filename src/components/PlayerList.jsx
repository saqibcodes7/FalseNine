function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

export default function PlayerList({ players, youId, minPlayers = 3 }) {
  const short = Math.max(0, minPlayers - players.length)

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-bold tracking-[0.14em] text-chalk-600 uppercase">
          In the lobby
        </h2>
        <span className="tabular text-sm font-semibold text-chalk-400">
          {players.length}
        </span>
      </div>

      <ul className="space-y-2">
        {players.map((player) => {
          const isYou = player.id === youId
          return (
            <li
              key={player.id}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                isYou
                  ? 'border-lime-400/40 bg-lime-400/5'
                  : 'border-pitch-700 bg-pitch-900'
              }`}
            >
              <span
                aria-hidden="true"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pitch-700 text-xs font-bold text-chalk-100"
              >
                {initials(player.display_name)}
              </span>

              <span className="min-w-0 flex-1 truncate font-semibold text-chalk-100">
                {player.display_name}
                {isYou && (
                  <span className="ml-2 text-xs font-medium text-lime-400">
                    you
                  </span>
                )}
              </span>

              {player.is_host && (
                <span className="shrink-0 rounded-full bg-pitch-700 px-2.5 py-1 text-[10px] font-bold tracking-[0.1em] text-chalk-400 uppercase">
                  Host
                </span>
              )}
            </li>
          )
        })}

        {/* Ghost rows so the lobby reads as "waiting on people", not "broken". */}
        {Array.from({ length: short }).map((_, i) => (
          <li
            key={`empty-${i}`}
            className="flex items-center gap-3 rounded-xl border border-dashed border-pitch-700 px-4 py-3"
          >
            <span
              aria-hidden="true"
              className="h-9 w-9 shrink-0 rounded-full border border-dashed border-pitch-600"
            />
            <span className="text-sm text-chalk-600">Waiting for a player…</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
