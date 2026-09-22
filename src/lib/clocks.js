/**
 * The clock settings a host can pick, shared by the online lobby and Pass &
 * Play so the two modes offer the same choices.
 *
 * Zero means no limit. It sits at the bottom of each list because that is
 * where a host reaches for it: wind the clock all the way down and it turns
 * off, the way an alarm does.
 *
 * These are lists rather than a min/max/step, because stepping arithmetically
 * from 60 by 30 would land on 30, and 30 is not a length the database accepts
 * for a discussion. A list can skip the gap between "the shortest real clock"
 * and "no clock at all" without ever stopping somewhere invalid.
 */

export const NO_LIMIT = 0

/** 0, then 60s to 5 minutes. Mirrors sessions_discussion_range. */
export const DISCUSSION_STEPS = [NO_LIMIT, 60, 90, 120, 150, 180, 210, 240, 270, 300]

/** 0, then 30s to 3 minutes. Mirrors sessions_voting_range. */
export const VOTING_STEPS = [NO_LIMIT, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180]

/** "3:00", or "No limit" for zero. */
export function formatClock(seconds) {
  if (!seconds) return 'No limit'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Whether a phase length means "no deadline at all". */
export function isUnlimited(seconds) {
  return !seconds
}
