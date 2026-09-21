import { Link } from 'react-router-dom'

/*
 * A game in the collection, built the way the card designs are: key art, the
 * title in two tones, the eyebrow, then a pill. The art is the only picture —
 * the title, the player count and the button are live text in the game's own
 * accent, so none of it has to be re-exported to change.
 *
 *   layout 'featured'  the playable one: big square art and a filled pill
 *   layout 'row'       a game still to come: a thumbnail and its name, at a
 *                      height that lets several sit under the featured card
 *                      without burying it
 *
 * A locked game keeps its shape and loses its colour. It should still look
 * like something worth waiting for, so it is dimmed, never greyed out.
 */
function Art({ game, live, className, sizes }) {
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
          loading={live ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={live ? 'high' : 'auto'}
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

  /* ---- a game still to come: art on the left, name beside it ---- */
  if (layout === 'row') {
    return (
      <div
        className={`surface ${accent} flex items-center gap-4 p-3 ${className}`}
        aria-disabled={live ? undefined : 'true'}
      >
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
        <span className="pill fill-soft shrink-0 px-3 py-1.5 text-caption font-semibold text-text-2">
          Coming soon
        </span>
      </div>
    )
  }

  /* ---- the playable one ---- */
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
