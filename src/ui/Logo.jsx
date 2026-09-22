import logoMarkup from './brand/logo.svg?raw'
import markMarkup from './brand/mark.svg?raw'

/*
 * The brand, inlined so it takes `currentColor`. That is what lets the same
 * drawing be white in the nav bar and gold on a card back. The lime of the
 * original lock-up stays where the brand is painted rather than rendered.
 *
 *   <Logo />         the full lock-up: the 9 over FALSE NINE
 *   <Logo mark />    just the 9, for headers and card backs
 *
 * Both SVGs carry a <title>, so they announce as "False Nine".
 *
 * The wrapper carries the artwork's own aspect ratio, and that is not
 * decoration. Callers size this by height — `h-7`, `h-[38%]` — and leave the
 * width to work itself out from the drawing. When that height is a percentage,
 * asking the browser to shrink-wrap the wrapper around an SVG whose own height
 * is a percentage of the wrapper is circular, and the engines break the circle
 * differently: Blink resolves the percentage and gets a real width, WebCore
 * treats it as indefinite and gives the wrapper a width of zero, leaving the
 * drawing to hang off the right-hand edge. On a 304px card back that put the 9
 * 56px right of centre in Safari and nowhere else.
 *
 * Reading the ratio off the viewBox removes the circle entirely: the wrapper's
 * width comes from its own height, before anything looks at the contents. It
 * also cannot drift, because it is the artwork telling us, not a number typed
 * in here.
 */

/** "540 84 916 1168" -> "916 / 1168". Null if the file has no viewBox. */
function ratioOf(markup) {
  const viewBox = /viewBox\s*=\s*"([^"]+)"/i.exec(markup)?.[1]
  if (!viewBox) return null
  const [, , width, height] = viewBox.trim().split(/[\s,]+/).map(Number)
  return width > 0 && height > 0 ? `${width} / ${height}` : null
}

// Once, at module load. The markup is a build-time import, so this is free.
const RATIO = { full: ratioOf(logoMarkup), mark: ratioOf(markMarkup) }

export default function Logo({ mark = false, className = '', style }) {
  return (
    <span
      className={`inline-block leading-none [&>svg]:mx-auto [&>svg]:block [&>svg]:h-full [&>svg]:w-auto ${className}`}
      style={{ aspectRatio: mark ? RATIO.mark : RATIO.full, ...style }}
      dangerouslySetInnerHTML={{ __html: mark ? markMarkup : logoMarkup }}
    />
  )
}
