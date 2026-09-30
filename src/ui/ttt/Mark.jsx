/*
 * X and O. The shape carries the meaning and the colour only backs it up
 * (X gold, O teal), so a claimed square reads the same in monochrome.
 * Decorative by default: whatever sits next to it says "X" or "O" in words.
 */
export default function Mark({ mark, className = 'h-6 w-6', label }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }

  if (mark === 'X') {
    return (
      <svg viewBox="0 0 24 24" className={`${className} text-gold`} fill="none" {...a11y}>
        <path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      </svg>
    )
  }
  if (mark === 'O') {
    return (
      <svg viewBox="0 0 24 24" className={`${className} text-teal-soft`} fill="none" {...a11y}>
        <circle cx="12" cy="12" r="7.4" stroke="currentColor" strokeWidth="3.2" />
      </svg>
    )
  }
  return null
}
