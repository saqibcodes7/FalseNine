import { Link } from 'react-router-dom'

/*
 * A game in the collection, built the way the card designs are: key art, the
 * title in two tones, the eyebrow, then a pill. The art is the only picture —
 * the title, the player count and the button are live text in the game's own
 * accent, so none of it has to be re-exported to change.
 *
 *   layout 'featured'  the headline game: big square art and a filled pill
 *   layout 'row'       a thumbnail and its name, at a height that lets several
 *                      sit under the featured card without burying it. A live
 *                      row is a link with a small Play pill; a game still to
 *                      come keeps the "Coming soon" badge and is not a link.
 *
 * Layout and status are separate: whether a card is big or small has nothing
 * to do with whether it can be played. A featured card that is not live yet
 * falls back to a row, so it can never render as a link to nowhere.
 *
 * A locked game keeps its shape and loses its colour. It should still look
 * like something worth waiting for, so it is dimmed, never greyed out.
 */
function Art({ game, live, eager = false, className, sizes }) {
  return (
    <div className={`art ${live ? '' : 'art-locked'} ${className}`}>
      <picture>
        <source srcSet={`/assets/art/${game.art}.webp`} type="image/webp" />
        <img
          src={`/assets/art/${game.art}.png`}
          alt=""
          width="720"
          height="736"
          sizes={sizes}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={eager ? 'high' : 'auto'}
        />
      </picture>
    </div>
  )
}

function Title({ game, live, className }) {
  return (
    <h2 className={`display text-balance ${className}`}>
      <span className="text-text">{game.lead}</span>{' '}
      <span className={live ? 'text-gold' : 'text-text-3'}>{game.tail}</span>
    </h2>
  )
}

export default function GameCard({ game, layout = 'row', className = '' }) {
  const live = game.status === 'live'
  const accent = live ? game.accent : 'accent-neutral'

  /* ---- a row: art on the left, name beside it ---- */
  if (layout === 'row' || !live) {
    const body = (
      <>
        <Art
          game={game}
          live={live}
          className="h-[4.75rem] w-[4.75rem] shrink-0 rounded-[15px]"
          sizes="76px"
        />
        <div className="min-w-0 flex-1">
          <Title game={game} live={live} className="text-callout leading-tight" />
          <p className="mt-1 text-footnote text-text-3">{game.players}</p>
        </div>
      </>
    )

    if (!live) {
      return (
        <div
          className={`surface ${accent} flex items-center gap-4 p-3 ${className}`}
          aria-disabled="true"
        >
          {body}
          <span className="pill fill-soft shrink-0 px-3 py-1.5 text-caption font-semibold text-text-2">
            Coming soon
          </span>
        </div>
      )
    }

    return (
      <Link
        to={game.path}
        className={[
          'surface pressable flex items-center gap-4 p-3 text-left',
          accent,
          'transition-[transform,box-shadow] duration-[var(--dur-state)] ease-[var(--ease-out)]',
          'hover:-translate-y-0.5 focus-visible:-translate-y-0.5 active:translate-y-0',
          className,
        ].join(' ')}
        style={{ '--tint': '9%' }}
        aria-label={`${game.name}. ${game.players}. Play now.`}
      >
        {body}
        <span
          className="pill fill-accent inline-flex shrink-0 items-center gap-1.5 px-3.5 py-1.5 text-caption font-semibold"
          aria-hidden="true"
        >
          <svg viewBox="0 0 12 14" className="h-[10px] w-[10px]" fill="currentColor">
            <path d="M11.2 6.13a1 1 0 0 1 0 1.74l-9.7 5.6A1 1 0 0 1 0 12.6V1.4A1 1 0 0 1 1.5.53l9.7 5.6Z" />
          </svg>
          Play
        </span>
      </Link>
    )
  }

  /* ---- the featured one ---- */
  return (
    <Link
      to={game.path}
      className={[
        'surface pressable block overflow-hidden rounded-[var(--radius-card)] text-left',
        accent,
        'transition-[transform,box-shadow] duration-[var(--dur-state)] ease-[var(--ease-out)]',
        'hover:-translate-y-0.5 focus-visible:-translate-y-0.5 active:translate-y-0',
        className,
      ].join(' ')}
      style={{ '--tint': '11%' }}
      aria-label={`${game.name}. ${game.players}. Play now.`}
    >
      <div className="relative">
        <Art
          game={game}
          live={live}
          eager
          className="aspect-square rounded-t-[calc(var(--radius-card)-1px)] md:aspect-[5/4]"
          sizes="(min-width: 768px) 420px, 100vw"
        />
        <span className="absolute top-3 right-3 z-10 rounded-full bg-black/45 px-2.5 py-1 text-caption font-semibold text-text/90">
          {game.players}
        </span>
      </div>

      <div className="p-5 pt-4">
        <Title game={game} live={live} className="text-title1" />
        <p className="eyebrow mt-2.5">{game.eyebrow}</p>
        <p className="mt-3 text-subhead leading-snug text-text-2">{game.tagline}</p>

        <span
          className="pill fill-accent mt-5 flex h-[3.25rem] items-center justify-center gap-2 text-body font-semibold"
          aria-hidden="true"
        >
          <svg viewBox="0 0 12 14" className="h-[13px] w-[13px]" fill="currentColor">
            <path d="M11.2 6.13a1 1 0 0 1 0 1.74l-9.7 5.6A1 1 0 0 1 0 12.6V1.4A1 1 0 0 1 1.5.53l9.7 5.6Z" />
          </svg>
          Play now
        </span>
      </div>
    </Link>
  )
}
