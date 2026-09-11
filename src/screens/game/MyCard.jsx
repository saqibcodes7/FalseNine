import { useState } from 'react'
import RoleCard from '../../ui/RoleCard'

/*
 * Your card, available again after the peek. Face down until tapped, and
 * flipped back with a second tap, since phones get shown around a table.
 */
export default function MyCard({ card, loadCard, busy, className = '' }) {
  const [flipped, setFlipped] = useState(false)

  async function onFlip() {
    if (flipped) return setFlipped(false)
    const row = card ?? (await loadCard())
    if (row) setFlipped(true)
  }

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <RoleCard
        flipped={flipped && Boolean(card)}
        role={card?.role ?? 'civilian'}
        playerName={card?.target_name ?? ''}
        hint={card?.hint_text ?? null}
        onFlip={busy ? undefined : onFlip}
      />
    </div>
  )
}
