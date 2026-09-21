import Backdrop from '../ui/Backdrop'
import Logo from '../ui/Logo'
import GameCard from '../ui/GameCard'
import { GAMES } from '../data/games'

/*
 * The collection. The brand sits in a slim bar at the top rather than a block
 * of its own, so the one card you can actually play is in the first viewport
 * on a phone with the next two peeking underneath, inviting the scroll.
 *
 * On a wide screen the three cards lay out as a row, the playable one first
 * and twice the width.
 */
export default function Home() {
  const [featured, ...rest] = GAMES

  return (
    <div className="min-h-dvh">
      <Backdrop accent={featured.accent} />

      <div
        className="mx-auto w-full max-w-5xl px-5 pb-20"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        {/* ---- brand ---- */}
        <header className="mb-6 flex h-12 items-center gap-2.5">
          <Logo mark className="h-7 shrink-0 text-text" />
          <p className="text-callout font-semibold tracking-[-0.01em] text-text">False Nine</p>
          <p className="ml-auto text-footnote text-text-3">Football party games</p>
        </header>

        <div className="mb-7">
          <h1 className="display text-[2.5rem] text-balance text-text md:text-[3.25rem]">
            Phones out.{' '}
            <span className="text-gold">One code.</span>
          </h1>
          <p className="mt-2.5 max-w-[34ch] text-callout leading-relaxed text-text-2">
            No app to install, nothing to sign up for. Pick a game and read the
            room.
          </p>
        </div>

        {/* ---- the collection ---- */}
        <div className="md:grid md:grid-cols-[minmax(0,26rem)_1fr] md:items-start md:gap-8">
          <GameCard game={featured} layout="featured" />

          <div className="mt-8 md:mt-0 md:max-w-lg">
            <h2 className="eyebrow mb-3">More to come</h2>
            <div className="grid gap-3">
              {rest.map((game) => (
                <GameCard key={game.id} game={game} />
              ))}
            </div>
          </div>
        </div>

        <footer className="mt-12 text-center">
          <p className="eyebrow">Best played in the same room</p>
        </footer>
      </div>
    </div>
  )
}
