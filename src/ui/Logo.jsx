import logoMarkup from './brand/logo.svg?raw'
import markMarkup from './brand/mark.svg?raw'

/*
 * The brand, inlined so it takes `currentColor`. That is what lets the same
 * drawing be lime on the home screen and engraved brass on a card back.
 *
 *   <Logo />         the full lock-up: the 9 over FALSE NINE
 *   <Logo mark />    just the 9, for headers and card backs
 *
 * Both SVGs carry a <title>, so they announce as "False Nine".
 */
export default function Logo({ mark = false, className = '', style }) {
  return (
    <span
      className={`inline-block leading-none [&>svg]:block [&>svg]:h-full [&>svg]:w-auto ${className}`}
      style={style}
      dangerouslySetInnerHTML={{ __html: mark ? markMarkup : logoMarkup }}
    />
  )
}
