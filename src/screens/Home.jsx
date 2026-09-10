import GameTile from '../components/GameTile'
import { GAMES } from '../data/games'

export default function Home() {
  return (
    <div className="min-h-dvh bg-pitch-950">
      <div className="mx-auto w-full max-w-3xl px-5 pt-14 pb-16">
        <header className="mb-11">
          <p className="text-xs font-bold tracking-[0.3em] text-lime-400 uppercase">
            False Nine
          </p>

          <h1 className="mt-3 text-4xl leading-[1.05] font-black tracking-tight text-chalk-100 sm:text-5xl">
            Football games
            <br />
            for the group chat.
          </h1>

          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-chalk-400">
            No app to install and no account to make. One person starts a game,
            everyone else joins with a five-character code.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          {GAMES.map((game) => (
            <GameTile key={game.id} game={game} />
          ))}
        </div>

        <footer className="mt-14 border-t border-pitch-800 pt-6">
          <p className="text-xs text-chalk-600">
            More games on the way. Best played with your mates in the same room.
          </p>
        </footer>
      </div>
    </div>
  )
}
