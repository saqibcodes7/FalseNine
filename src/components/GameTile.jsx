import { Link } from 'react-router-dom'

function Inner({ game }) {
  const live = game.status === 'live'

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <h2
          className={`text-xl leading-tight font-black tracking-tight ${
            live ? 'text-chalk-100' : 'text-chalk-600'
          }`}
        >
          {game.name}
        </h2>

        {!live && (
          <span className="shrink-0 rounded-full border border-pitch-600 px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] text-chalk-600 uppercase">
            Coming soon
          </span>
        )}
      </div>

      <p
        className={`mt-2 text-sm leading-relaxed ${
          live ? 'text-chalk-400' : 'text-chalk-600'
        }`}
      >
        {game.tagline}
      </p>

      <div className="mt-5 flex items-center justify-between">
        <span
          className={`text-xs font-medium ${live ? 'text-chalk-600' : 'text-chalk-600/70'}`}
        >
          {game.players}
        </span>

        {live && (
          <span className="text-sm font-bold text-lime-400">
            Play <span aria-hidden="true">&rarr;</span>
          </span>
        )}
      </div>
    </>
  )
}

export default function GameTile({ game }) {
  const shared =
    'rounded-tile border p-5 flex flex-col justify-between min-h-[10.5rem] transition-all duration-200'

  if (game.status !== 'live') {
    return (
      <div
        className={`${shared} border-pitch-700/60 bg-pitch-900/40`}
        aria-disabled="true"
      >
        <Inner game={game} />
      </div>
    )
  }

  return (
    <Link
      to={game.path}
      className={`${shared} border-pitch-700 bg-pitch-800 hover:-translate-y-0.5 hover:border-lime-400 hover:shadow-[0_0_36px_-14px_var(--color-lime-400)]`}
    >
      <Inner game={game} />
    </Link>
  )
}
