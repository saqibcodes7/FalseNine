/*
 * A panel is a steel-framed recess with an optional engraved nameplate
 * riding its top edge. It is the only "container" in the system, and it is
 * never nested inside another one.
 */
export default function Panel({
  title,
  metal = 'metal-steel',
  enamel = 'enamel-ink-deep',
  className = '',
  bodyClassName = '',
  children,
}) {
  return (
    <section className={`relative ${title ? 'pt-3' : ''} ${className}`}>
      {title && (
        <h2
          className={[
            'absolute top-0 left-4 z-10',
            'display text-[1.05rem] tracking-[0.14em] text-gold engraved',
            'frame frame-sm metal-gold',
          ].join(' ')}
          style={{ '--fr': '6px', '--fw': '2px' }}
        >
          <span
            className="frame-inner plate enamel-ink block px-3 leading-none"
            style={{ padding: '0.45rem 0.75rem 0.25rem' }}
          >
            {title}
          </span>
        </h2>
      )}

      <div className={`frame ${metal}`} style={{ '--fw': '3px' }}>
        <div className={`frame-inner ${enamel} ${title ? 'pt-6' : 'pt-4'} px-4 pb-4 ${bodyClassName}`}>
          {children}
        </div>
      </div>
    </section>
  )
}
