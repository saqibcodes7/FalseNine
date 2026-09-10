import { Link } from 'react-router-dom'
import Backdrop from './Backdrop'
import Logo from './Logo'

/*
 * The page frame every game screen sits in.
 *
 * Header row: a back link on the left, the 9 in the middle, a status slot on
 * the right. Below it the screen title in engraved Teko and a one-line
 * subtitle. Narrow by default; this is a phone game.
 */
export default function Screen({
  title,
  subtitle,
  back,
  backLabel = 'Back',
  status,
  width = 'md',
  children,
}) {
  const maxWidth = width === 'lg' ? 'max-w-3xl' : 'max-w-md'

  return (
    <div className="min-h-dvh">
      <Backdrop />
      <div
        className={`mx-auto w-full ${maxWidth} px-5 pb-16`}
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <div className="mb-5 grid h-11 grid-cols-[1fr_auto_1fr] items-center">
          {back ? (
            <Link
              to={back}
              className="display inline-flex items-center gap-1.5 justify-self-start text-[1.15rem] tracking-[0.08em] text-gold engraved transition-colors hover:text-gold-hi"
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 2 4 7l5 5" />
              </svg>
              <span className="pt-[0.15em]">{backLabel}</span>
            </Link>
          ) : (
            <span />
          )}

          <Link to="/" aria-label="False Nine home" className="text-gold hover:text-gold-hi">
            <Logo mark className="h-8" />
          </Link>

          <div className="justify-self-end">{status}</div>
        </div>

        {title && (
          <header className="mb-6">
            <h1 className="display text-headline text-chalk-0 engraved">{title}</h1>
            {subtitle && (
              <p className="mt-1.5 max-w-[38ch] text-[15px] leading-relaxed text-chalk-1">
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
