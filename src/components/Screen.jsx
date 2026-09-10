import { Link } from 'react-router-dom'

/**
 * The page frame every screen sits in. One max-width, one set of gutters, one
 * place to change them. Narrow by default because this is a phone game.
 */
export default function Screen({
  title,
  subtitle,
  back,
  backLabel = 'Back',
  action,
  width = 'md',
  children,
}) {
  const maxWidth = width === 'lg' ? 'max-w-3xl' : 'max-w-md'

  return (
    <div className="min-h-dvh bg-pitch-950">
      <div className={`mx-auto w-full ${maxWidth} px-5 pt-6 pb-16`}>
        {(back || action) && (
          <div className="mb-6 flex items-center justify-between gap-3">
            {back ? (
              <Link
                to={back}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-chalk-400 transition-colors hover:text-lime-400"
              >
                <span aria-hidden="true">&larr;</span>
                {backLabel}
              </Link>
            ) : (
              <span />
            )}
            {action}
          </div>
        )}

        {title && (
          <header className="mb-7">
            <h1 className="text-3xl leading-tight font-black tracking-tight text-chalk-100 sm:text-4xl">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-2 text-[15px] leading-relaxed text-chalk-400">
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
