import Backdrop from '../ui/Backdrop'
import Logo from '../ui/Logo'
import GameCard from '../ui/GameCard'
import { GAMES } from '../data/games'

/*
 * The binder. Brand on top, the one card you can play right under it and
 * inside the first phone viewport, the locked ones beneath.
 *
 * On wide screens the three cards fan into a row with the live one raised
 * in the middle, the way you would lay them on a table.
 */
export default function Home() {
  const [featured, ...rest] = GAMES

  return (
    <div className="min-h-dvh">
      <Backdrop />

      <div
        className="mx-auto w-full max-w-5xl px-5 pb-16"
        style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}
      >
        {/* ---- brand ---- */}
        <header className="mb-6 flex items-center gap-5 md:mb-10 md:gap-8">
          <Logo className="h-[6.25rem] shrink-0 text-lime md:h-[7.5rem]" />

          <div className="min-w-0">
            <p className="display text-[1.6rem] leading-[0.92] tracking-[0.14em] text-gold engraved md:text-[2rem]">
              Football party games
            </p>
            <div className="hairline metal-gold my-2 max-w-[14rem]" aria-hidden="true" />
            <p className="max-w-[26ch] text-small leading-snug text-chalk-1 md:text-body">
              Phones out, one code, no app to install. Pick a card.
            </p>
          </div>
        </header>

        {/* ---- the table ---- */}
        <div className="md:grid md:grid-cols-[1fr_1.3fr_1fr] md:items-end md:gap-6">
          {/* featured: first on mobile, centre on desktop */}
          <div className="mx-auto w-full max-w-[21rem] md:order-2 md:max-w-none">
            <GameCard game={featured} featured />
          </div>

          {/* locked cards: a pair under the featured one on mobile */}
          <div className="mt-8 md:contents">
            <div className="mb-3 flex items-center gap-3 md:hidden">
              <span className="hairline metal-steel flex-1" aria-hidden="true" />
              <p className="display text-[1.05rem] tracking-[0.22em] text-chalk-2 engraved">
                More in the binder
              </p>
              <span className="hairline metal-steel flex-1" aria-hidden="true" />
            </div>

            <div className="grid grid-cols-2 gap-3 md:contents">
              {rest.map((game, i) => (
                <div key={game.id} className={i === 0 ? 'md:order-1' : 'md:order-3'}>
                  <GameCard game={game} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="mt-12 flex items-center gap-3">
          <span className="hairline metal-steel flex-1" aria-hidden="true" />
          <p className="display text-[0.95rem] tracking-[0.2em] text-chalk-2 engraved">
            Best played in the same room
          </p>
          <span className="hairline metal-steel flex-1" aria-hidden="true" />
        </footer>
      </div>
    </div>
  )
}
