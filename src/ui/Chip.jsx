/*
 * A small stamped plate with a word on it. Chips carry state in TEXT — "host",
 * "you", "coming soon", "imposter" — so nothing about a player or a card is
 * communicated by colour alone.
 */
const TONES = {
  gold: 'metal-gold enamel-ink',
  lime: 'metal-steel enamel-lime',
  silver: 'metal-silver enamel-ink-deep',
  red: 'metal-steel enamel-red',
  steel: 'metal-steel enamel-ink-deep',
}

export default function Chip({ tone = 'steel', className = '', children, ...rest }) {
  const cls = TONES[tone] ?? TONES.steel
  const raised = tone === 'lime'
  return (
    <span
      className={`frame frame-sm inline-block shrink-0 align-middle ${cls} ${className}`}
      style={{ '--fr': '5px', '--fw': '1.5px', boxShadow: '0 1px 0 var(--m-lo)' }}
      {...rest}
    >
      <span
        className={`frame-inner plate display block text-[0.95rem] leading-none tracking-[0.16em] ${
          raised ? 'raised' : 'engraved'
        }`}
        style={{ padding: '0.36rem 0.55rem 0.2rem' }}
      >
        {children}
      </span>
    </span>
  )
}
