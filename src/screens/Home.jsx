import Backdrop from '../ui/Backdrop'
import Logo from '../ui/Logo'
import GameCard from '../ui/GameCard'
import { GAMES } from '../data/games'

/*
 * The collection. The brand sits in a slim bar at the top rather than a block
 * of its own, so the featured game is in the first viewport on a phone with
 * the rest peeking underneath, inviting the scroll.
 *
 * Which card is big comes from the registry, not from the order of the list:
 * the live game marked `featured` gets the big card, every other live game a
 * playable row, and anything still to come a dimmed row under "More to come".
 *
 * On a wide screen the featured card sits on the left at twice the width and
 * the rows stack beside it.
 */
const live = GAMES.filter((game) => game.status === 'live')
const featured = live.find((game) => game.featured) ?? live[0] ?? null
const alsoLive = live.filter((game) => game !== featured)
const comingSoon = GAMES.filter((game) => game.status !== 'live')

export default function Home() {

  return (
    <div className="min-h-dvh">
      <Backdrop accent={featured?.accent} />

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
          {featured && <GameCard game={featured} layout="featured" />}

          <div className="mt-8 space-y-8 md:mt-0 md:max-w-lg">
            {alsoLive.length > 0 && (
              <section>
                <h2 className="eyebrow mb-3">Also live</h2>
                <div className="grid gap-3">
                  {alsoLive.map((game) => (
                    <GameCard key={game.id} game={game} />
                  ))}
                </div>
              </section>
            )}

            {comingSoon.length > 0 && (
              <section>
                <h2 className="eyebrow mb-3">More to come</h2>
                <div className="grid gap-3">
                  {comingSoon.map((game) => (
                    <GameCard key={game.id} game={game} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        <footer className="mt-12 text-center">
          <p className="eyebrow">Best played in the same room</p>
        </footer>
      </div>
    </div>
  )
}
