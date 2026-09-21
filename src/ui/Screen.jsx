import { Link } from 'react-router-dom'
import Backdrop from './Backdrop'
import Logo from './Logo'

/*
 * Every screen is the same three bands: a slim nav bar, a large title, then
 * the content. The nav bar holds a back chevron on the left, the mark in the
 * middle and whatever the screen wants to say about itself on the right.
 *
 * `accent` tints the lights behind the page, so the Imposter flow sits in
 * crimson the whole way through without any screen having to say so twice.
 */
export default function Screen({
  title,
  subtitle,
  back,
  backLabel = 'Back',
  status,
  accent = 'accent-crimson',
  width = 'md',
  children,
}) {
  const maxWidth = width === 'lg' ? 'max-w-3xl' : 'max-w-md'

  return (
    <div className="min-h-dvh">
      <Backdrop accent={accent} />

      <div
        className={`mx-auto w-full ${maxWidth} px-5 pb-16`}
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        <div className="mb-4 grid h-12 grid-cols-[1fr_auto_1fr] items-center">
          {back ? (
            <Link
              to={back}
              className="-ml-2 inline-flex h-11 items-center gap-0.5 justify-self-start pr-3 pl-2 text-callout font-medium text-gold transition-colors hover:text-gold-soft"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 12 20"
                className="h-[17px] w-[11px]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 2 2 10l8 8" />
              </svg>
              {backLabel}
            </Link>
          ) : (
            <span />
          )}

          <Link
            to="/"
            aria-label="False Nine home"
            className="text-text-2 transition-colors hover:text-text"
          >
            <Logo mark className="h-7" />
          </Link>

          <div className="justify-self-end">{status}</div>
        </div>

        {title && (
          <header className="mb-6">
            <h1 className="display text-large text-balance text-text">{title}</h1>
            {subtitle && (
              <p className="mt-2 max-w-[42ch] text-callout leading-relaxed text-text-2">
                {subtitle}
              </p>
            )}
          </header>
        )}

        {children}
      </div>
    </div>
  )
}
