/*
 * A grouped section, the way iOS Settings does it: the heading sits above the
 * card in quiet type, and the card itself is one surface with hairlines
 * between its rows. It is the only container in the system and never nests.
 */
export default function Panel({
  title,
  action,
  accent = 'accent-neutral',
  tint = false,
  className = '',
  bodyClassName = '',
  children,
  ...rest
}) {
  return (
    <section className={className} {...rest}>
      {(title || action) && (
        <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
          {title && (
            <h2 className="text-footnote font-semibold tracking-[0.01em] text-text-2">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}

      <div
        className={`surface ${accent} p-4 ${bodyClassName}`}
        style={tint ? { '--tint': '9%' } : undefined}
      >
        {children}
      </div>
    </section>
  )
}
