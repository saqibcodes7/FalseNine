import Chip from './Chip'

function mmss(total) {
  const s = Math.max(0, Math.round(total))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/*
 * A scoreboard clock. Gold frame, black enamel, lime Teko digits, and a thin
 * brass rail underneath that drains as the phase runs down.
 *
 * Under ten seconds the enamel goes red, HURRY is stamped beside the label,
 * and the digits tick. The word carries the state; the colour reinforces it.
 */
export default function TimerDisplay({
  label = 'Discussion',
  secondsLeft,
  total,
  urgentAt = 10,
  className = '',
}) {
  const urgent = secondsLeft <= urgentAt
  const fraction = total > 0 ? Math.min(1, Math.max(0, secondsLeft / total)) : 0

  return (
    <div
      className={`frame metal-gold ${className}`}
      style={{ '--fw': '4px' }}
      role="timer"
      aria-label={`${label}, ${mmss(secondsLeft)} remaining`}
    >
      <div
        className={`frame-inner ${urgent ? 'enamel-red' : 'enamel-ink-deep'} px-4 pt-3 pb-3 text-center transition-colors duration-300`}
      >
        <div className="flex items-center justify-center gap-2">
          <p className="display text-[1.05rem] tracking-[0.22em] text-gold engraved">
            {label}
          </p>
          {urgent && <Chip tone="lime">Hurry</Chip>}
        </div>

        <p
          className={`display tabular mt-1 text-[4rem] leading-none tracking-[0.04em] ${
            urgent ? 'text-gold-hi timer-tick' : 'text-lime'
          }`}
          style={{ paddingTop: '0.12em' }}
        >
          {mmss(secondsLeft)}
        </p>

        <div
          className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-ink-0 shadow-[inset_0_1px_2px_oklch(0%_0_0/.8)]"
          aria-hidden="true"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
              urgent ? 'bg-gold-hi' : 'bg-gold'
            }`}
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
      </div>
    </div>
  )
}
