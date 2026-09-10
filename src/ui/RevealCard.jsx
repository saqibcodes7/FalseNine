import Chip from './Chip'

/*
 * The result of a vote, or of the whole game, landing on the table.
 *
 *   tone 'civilian'  the person voted out was a civilian (black enamel)
 *   tone 'imposter'  they were an imposter (red enamel)
 *   tone 'win'       civilians win (lime enamel)
 *   tone 'steal'     the imposter guessed the player and stole it (red, gold rim)
 *
 * Plays its entrance once. Under reduced motion it simply appears.
 */
const TONES = {
  civilian: { enamel: 'enamel-ink', chip: 'silver', chipText: 'Civilian' },
  imposter: { enamel: 'enamel-red', chip: 'gold', chipText: 'Imposter' },
  win: { enamel: 'enamel-lime', chip: 'gold', chipText: 'Civilians win' },
  steal: { enamel: 'enamel-red', chip: 'gold', chipText: 'Imposter wins' },
}

export default function RevealCard({
  eyebrow = 'Voted out',
  name,
  tone = 'civilian',
  message,
  children,
  className = '',
}) {
  const t = TONES[tone] ?? TONES.civilian
  const onLime = tone === 'win'

  return (
    <div
      className={`frame metal-gold enter w-full ${className}`}
      style={{ '--fw': '6px' }}
      role="status"
      aria-live="polite"
    >
      <div className={`frame-inner ${t.enamel} relative`}>
        <div
          className="absolute inset-3 rounded-[10px] shadow-[inset_0_0_0_1px_oklch(77%_.12_86/.45)]"
          aria-hidden="true"
        />
        <div className="relative flex flex-col items-center gap-3 px-6 pt-7 pb-6 text-center">
          <p
            className={`display text-[1.1rem] tracking-[0.24em] ${
              onLime ? 'text-on-lime raised' : 'text-gold engraved'
            }`}
          >
            {eyebrow}
          </p>

          {name && (
            <p
              className={`display text-[clamp(2.6rem,16cqw,3.75rem)] leading-[0.9] tracking-[0.03em] ${
                onLime ? 'text-on-lime raised' : 'text-gold-hi engraved'
              }`}
            >
              {name}
            </p>
          )}

          <Chip tone={t.chip}>{t.chipText}</Chip>

          {message && (
            <p
              className={`mt-1 max-w-[28ch] text-body leading-snug ${
                onLime ? 'text-on-lime' : 'text-chalk-0'
              }`}
            >
              {message}
            </p>
          )}

          {children}
        </div>
      </div>
    </div>
  )
}
