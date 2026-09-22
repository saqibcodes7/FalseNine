import Logo from './Logo'

/*
 * The peek. Face down it is a False Nine card back: the ground, one soft
 * light in the game's colour, the 9 in gold. Tap it and it turns over on a
 * real hinge.
 *
 *   role 'civilian' → the footballer's name, large, in gold
 *   role 'imposter' → crimson, IMPOSTER, and the one-word clue if hints are on
 *
 * Nothing about the footballer ever renders on an imposter's card, so there
 * is nothing to find in the DOM either.
 */
export default function RoleCard({
  flipped = false,
  role = 'civilian',
  playerName = '',
  hint = null,
  onFlip,
  className = '',
}) {
  const imposter = role === 'imposter'

  return (
    <button
      type="button"
      onClick={onFlip}
      aria-pressed={flipped}
      aria-label={flipped ? 'Your card, face up' : 'Your card, face down. Tap to reveal.'}
      className={`rolecard block ${className}`}
    >
      <div className="rolecard-inner" data-flipped={flipped ? 'true' : 'false'}>
        {/* ---- back ---- */}
        <div className="rolecard-face rolecard-back rolecard-pattern surface accent-gold">
          <div className="flex h-full flex-col items-center justify-center gap-6 p-7">
            <Logo mark className="h-[38%] text-gold" />
            <p className="eyebrow">Tap to reveal</p>
          </div>
        </div>

        {/* ---- front ---- */}
        <div
          className={`rolecard-face rolecard-front rolecard-pattern surface ${
            imposter ? 'accent-crimson' : 'accent-gold'
          }`}
        >
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            {imposter ? (
              <>
                <p className="eyebrow">You are the</p>
                <p className="display text-[clamp(2.5rem,17cqw,3.5rem)] text-flag">
                  Imposter
                </p>
                {hint ? (
                  // One word, given the room a single word needs to land.
                  <div className="surface-sunken mt-1 w-full px-4 py-3.5 text-center">
                    <p className="eyebrow">Your only clue</p>
                    <p
                      className="display mt-1 text-[clamp(1.35rem,9cqw,1.85rem)] text-balance text-text"
                      data-testid="hint"
                    >
                      {hint}
                    </p>
                  </div>
                ) : (
                  <p className="max-w-[24ch] text-subhead leading-snug text-text-2">
                    You do not know the player. Listen, bluff, survive the vote.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="eyebrow">The player</p>
                <p className="display text-[clamp(1.9rem,12cqw,2.75rem)] text-balance text-gold">
                  {playerName}
                </p>
                <p className="max-w-[24ch] text-subhead leading-snug text-text-2">
                  Everyone else knows too. Except one of you.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}
