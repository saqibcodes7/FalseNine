import Chip from './Chip'

/*
 * The result of a vote, or of the whole game, landing on the table. One
 * surface in the tone of what happened, a chip that names it in words, and
 * the sentence underneath.
 *
 * Plays its entrance once. Under reduced motion it simply appears.
 */
const TONES = {
  civilian: { accent: 'accent-neutral', chip: 'neutral', chipText: 'Civilian', ink: 'text-text' },
  imposter: { accent: 'accent-crimson', chip: 'flag', chipText: 'Imposter', ink: 'text-flag' },
  win: { accent: 'accent-go', chip: 'go', chipText: 'Civilians win', ink: 'text-go' },
  steal: { accent: 'accent-crimson', chip: 'flag', chipText: 'Imposter wins', ink: 'text-flag' },
  // For a card that states a fact rather than a result. Pass & Play ends on
  // one of these, because the phone deals and times but never declares a
  // winner: that is the table's to argue about.
  answer: { accent: 'accent-gold', chip: 'gold', chipText: 'The answer', ink: 'text-gold' },
}

export default function RevealCard({
  eyebrow = 'Voted out',
  name,
  tone = 'civilian',
  chipText,
  message,
  children,
  className = '',
}) {
  const t = TONES[tone] ?? TONES.civilian
  const label = chipText ?? t.chipText

  return (
    <div
      className={`surface enter @container ${t.accent} px-6 pt-7 pb-6 text-center ${className}`}
      style={{ '--tint': '14%' }}
      role="status"
      aria-live="polite"
    >
      <div className="glow absolute -top-8 left-1/2 h-40 w-[70%] -translate-x-1/2 opacity-40" />

      <div className="relative flex flex-col items-center gap-3">
        <p className="eyebrow">{eyebrow}</p>

        {name && (
          <p className={`display text-[clamp(2.25rem,14cqw,3rem)] text-balance ${t.ink}`}>
            {name}
          </p>
        )}

        {label && <Chip tone={t.chip}>{label}</Chip>}

        {message && (
          <p className="mt-1 max-w-[30ch] text-subhead leading-snug text-text-2">{message}</p>
        )}

        {children}
      </div>
    </div>
  )
}
