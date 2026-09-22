/*
 * The clock every phone at the table is reading. Tabular figures so nothing
 * jitters as it counts, and a thin track beneath that drains as the phase
 * runs down.
 *
 * Under ten seconds the label reads Hurry and the figures pulse. The word and
 * the movement carry the urgency; the colour only agrees with them.
 *
 * `countUp` is for a phase with no limit on it, as Pass & Play allows: the
 * figures climb instead of falling, nothing is ever urgent, and the track goes
 * away, because a bar that drains implies an end that is not coming.
 */
function mmss(total) {
  const s = Math.max(0, Math.round(total))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function TimerDisplay({
  label = 'Discussion',
  secondsLeft,
  total,
  urgentAt = 10,
  countUp = false,
  className = '',
}) {
  const urgent = !countUp && secondsLeft <= urgentAt
  const fraction = total > 0 ? Math.min(1, Math.max(0, secondsLeft / total)) : 0

  return (
    <div
      className={`surface ${urgent ? 'accent-flag' : 'accent-gold'} px-5 pt-3.5 pb-4 text-center ${className}`}
      style={{ '--tint': urgent ? '12%' : '5%' }}
      role="timer"
      aria-label={
        countUp
          ? `${label}, ${mmss(secondsLeft)} so far, no limit`
          : `${label}, ${mmss(secondsLeft)} remaining`
      }
    >
      <p className="eyebrow">{countUp ? `${label} · No limit` : urgent ? `${label} · Hurry` : label}</p>

      <p
        className={`tabular mt-1.5 text-[3.5rem] leading-none font-bold tracking-[-0.03em] ${
          urgent ? 'urgent text-flag' : 'text-text'
        }`}
      >
        {mmss(secondsLeft)}
      </p>

      {!countUp && (
        <div
          className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-white/10"
          aria-hidden="true"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
              urgent ? 'bg-flag' : 'bg-gold'
            }`}
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}
