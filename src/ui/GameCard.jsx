import { Link } from 'react-router-dom'
import Corners from './Corners'

/*
 * A collectible card from the False Nine binder.
 *
 * Three layers, all HTML: a bevelled metal frame, an interior split into a
 * title band / an art window / a plate, and (for locked cards) chrome corner
 * brackets riding the outside of the frame. The painting sits only in the
 * art window. The title, the plate and the state are live text.
 *
 *   status 'live'  → gold frame, the art in full colour, a PLAY NOW plate,
 *                    the whole card is the link, a restrained lift on hover.
 *   status 'soon'  → silver frame, desaturated art pushed back, chrome
 *                    corners, a COMING SOON plate. Not a link.
 */

/* "Tic-Tac-Toe" must not break at its hyphens on a narrow card. */
function Title({ text }) {
  return text.split(' ').map((word, i) => (
    <span key={i}>
      {i > 0 && ' '}
      {word.includes('-') ? <span className="whitespace-nowrap">{word}</span> : word}
    </span>
  ))
}

export default function GameCard({ game, featured = false, className = '' }) {
  const live = game.status === 'live'
  const metal = live ? 'metal-gold' : 'metal-silver'

  const interior = (
    <div
      className={`frame-inner ${live ? 'enamel-ink' : 'enamel-ink-deep'} ${live ? 'sweep' : ''} grid h-full grid-rows-[auto_1fr_auto]`}
    >
      {/* title band */}
      <div className="relative z-10 px-3 pt-3 pb-2 text-center">
        <h2
          className={`display text-[clamp(1.2rem,8cqw,1.9rem)] leading-[0.95] tracking-[0.07em] engraved ${
            live ? 'text-gold' : 'text-silver'
          }`}
        >
          <Title text={game.name} />
        </h2>
      </div>

      {/* art window */}
      <div className="relative mx-2 overflow-hidden rounded-[4px] shadow-[inset_0_0_0_1px_oklch(0%_0_0/.6),inset_0_2px_10px_oklch(0%_0_0/.6)]">
        <picture>
          <source srcSet={`/assets/art/${game.art}.webp`} type="image/webp" />
          <img
            src={`/assets/art/${game.art}.png`}
            alt=""
            width="254"
            height="266"
            loading={featured ? 'eager' : 'lazy'}
            decoding="async"
            className={`block h-full w-full object-cover object-top ${live ? '' : 'locked-art'}`}
          />
        </picture>
        {/* players line, engraved into the bottom of the window */}
        <p
          className={`display absolute right-2 bottom-1.5 left-2 z-10 text-right text-[clamp(0.8rem,4.5cqw,0.95rem)] tracking-[0.14em] engraved ${
            live ? 'text-gold-hi' : 'text-silver'
          }`}
        >
          {game.players}
        </p>
      </div>

      {/* plate */}
      <div className="relative z-10 px-3 pt-3 pb-3">
        <div
          className={`frame frame-sm ${live ? 'metal-gold' : 'metal-silver'}`}
          style={{ '--fr': '8px', '--fw': '2px' }}
        >
          <span
            className={`frame-inner plate display block py-2 text-center text-[clamp(1rem,6.5cqw,1.35rem)] leading-none tracking-[0.14em] whitespace-nowrap ${
              live ? 'enamel-red text-gold-hi' : 'enamel-ink-deep text-silver'
            } engraved`}
            style={{ paddingTop: '0.62rem' }}
          >
            {live ? 'Play now' : 'Coming soon'}
          </span>
        </div>
      </div>
    </div>
  )

  const frameCls = ['frame block aspect-[5/7] w-full @container', metal, className].join(' ')

  if (!live) {
    return (
      <div className={frameCls} aria-disabled="true" style={{ '--fw': '5px' }}>
        {interior}
        <Corners metal="metal-silver" />
      </div>
    )
  }

  return (
    <Link
      to={game.path}
      className={[
        frameCls,
        'transition-[transform,filter] duration-[240ms] ease-[var(--ease-out)]',
        'hover:-translate-y-1 hover:brightness-[1.06] focus-visible:-translate-y-1',
        'active:translate-y-0 active:brightness-100',
      ].join(' ')}
      style={{ '--fw': featured ? '6px' : '5px' }}
    >
      {interior}
    </Link>
  )
}
