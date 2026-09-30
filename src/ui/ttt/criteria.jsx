import { criterionSentence } from './format'

/*
 * The small icon for each kind of criterion, and a criterion written out as
 * a line of text. What each kind means is spelled out in ./format.js.
 */
export function CriterionIcon({ type, className = 'h-3 w-3' }) {
  const common = { className, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  if (type === 'CLUB') {
    return (
      <svg viewBox="0 0 16 16" {...common}>
        <path d="M8 1.8 2.8 3.6v4.1c0 3.1 2.2 5.4 5.2 6.5 3-1.1 5.2-3.4 5.2-6.5V3.6Z" />
      </svg>
    )
  }
  if (type === 'NATIONALITY') {
    return (
      <svg viewBox="0 0 16 16" {...common}>
        <path d="M3.2 14.2V2.2M3.2 2.8c3.2-1.6 5.4 1.6 9.6 0v6.6c-4.2 1.6-6.4-1.6-9.6 0" />
      </svg>
    )
  }
  if (type === 'TROPHY') {
    return (
      <svg viewBox="0 0 16 16" {...common}>
        <path d="M4.6 2.2h6.8v3.4a3.4 3.4 0 0 1-6.8 0ZM4.6 3.4H2.4a2.2 2.2 0 0 0 2.4 2.6M11.4 3.4h2.2a2.2 2.2 0 0 1-2.4 2.6M8 9v2.6M5.4 13.8h5.2M6.2 11.6h3.6v2.2H6.2Z" />
      </svg>
    )
  }
  return null
}

/** A criterion as a line of text with its kind: for the answer sheet. */
export function CriterionLine({ axis, className = '' }) {
  return (
    <span className={`flex items-start gap-2 ${className}`}>
      <span className="mt-[3px] text-text-3">
        <CriterionIcon type={axis?.category_type} className="h-3.5 w-3.5" />
      </span>
      <span>{criterionSentence(axis)}</span>
    </span>
  )
}
