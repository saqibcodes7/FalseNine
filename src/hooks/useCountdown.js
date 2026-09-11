import { useEffect, useRef, useState } from 'react'
import { secondsUntil } from '../lib/game'

/**
 * Counts down to a server deadline and calls `onExpire` when it passes.
 *
 * The deadline is the server's, and `clockOffset` (from useLobby) corrects
 * for this phone's clock, so every phone at the table reads the same number
 * and reaches zero at the same moment. When that happens the phone asks the
 * server to move the game on; the server checks its own clock before doing
 * anything, so an early phone is harmlessly ignored and a late one is caught
 * by the retry.
 */
export function useCountdown(endsAt, clockOffset, onExpire) {
  const [secondsLeft, setSecondsLeft] = useState(() => secondsUntil(endsAt, clockOffset))
  const fired = useRef(null)
  const expire = useRef(onExpire)
  expire.current = onExpire

  useEffect(() => {
    if (!endsAt) return undefined
    fired.current = null

    const tick = () => {
      const left = secondsUntil(endsAt, clockOffset)
      setSecondsLeft(left)
      if (left === 0 && fired.current !== endsAt) {
        fired.current = endsAt
        expire.current?.()
      }
    }

    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [endsAt, clockOffset])

  // If the phase is still open a couple of seconds after the deadline, the
  // first nudge was lost (or every phone was asleep). Keep nudging gently.
  useEffect(() => {
    if (!endsAt || secondsLeft > 0) return undefined
    const id = setInterval(() => expire.current?.(), 2500)
    return () => clearInterval(id)
  }, [endsAt, secondsLeft])

  return secondsLeft
}
