import Chip from './Chip'
import Logo from './Logo'

/*
 * The peek card. Face down it is a False Nine card back: gold frame, foil
 * swirl, the 9 engraved in brass. Tap it and it turns over on a real hinge.
 *
 *   role 'civilian' → black enamel, the footballer's name in gold Teko
 *   role 'imposter' → red enamel, IMPOSTER, and the AI hint if there is one
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
      className={`rolecard block w-full max-w-[20rem] touch-manipulation ${className}`}
    >
      <div className="rolecard-inner" data-flipped={flipped ? '' : undefined}>
        {/* ---- back ---- */}
        <div className="rolecard-face frame metal-gold" style={{ '--fw': '6px' }}>
          <div className="frame-inner enamel-ink relative">
            <div className="foil absolute inset-0 opacity-70" aria-hidden="true" />
            <div
              className="absolute inset-3 rounded-[10px] shadow-[inset_0_0_0_1px_oklch(77%_.12_86/.55)]"
              aria-hidden="true"
            />
            <div className="relative flex h-full flex-col items-center justify-center gap-5 p-6">
              <Logo mark className="h-[42%] text-gold engraved drop-shadow-[0_2px_2px_oklch(0%_0_0/.7)]" />
              <p className="display text-[1.15rem] tracking-[0.24em] text-gold-hi engraved">
                Tap to reveal
              </p>
            </div>
          </div>
        </div>

        {/* ---- front ---- */}
        <div className="rolecard-face rolecard-front frame metal-gold" style={{ '--fw': '6px' }}>
          <div className={`frame-inner ${imposter ? 'enamel-red' : 'enamel-ink'} relative`}>
            <div
              className="absolute inset-3 rounded-[10px] shadow-[inset_0_0_0_1px_oklch(77%_.12_86/.45)]"
              aria-hidden="true"
            />
            <div className="relative flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
              {imposter ? (
                <>
                  <Chip tone="gold">You are the</Chip>
                  <p className="display text-[clamp(3rem,22cqw,4.25rem)] leading-[0.9] tracking-[0.04em] text-gold-hi engraved">
                    Imposter
                  </p>
                  {hint ? (
                    <div
                      className="frame frame-sm metal-gold mt-1 w-full"
                      style={{ '--fr': '8px', '--fw': '2px' }}
                    >
                      <div className="frame-inner plate enamel-ink px-3 py-2.5 text-left">
                        <p className="display text-[0.95rem] tracking-[0.18em] text-gold engraved">
                          Your clue
                        </p>
                        <p className="mt-1 text-small leading-snug text-chalk-0">{hint}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="max-w-[22ch] text-small leading-snug text-gold-hi/85">
                      You do not know the player. Listen, bluff, survive the vote.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <Chip tone="gold">The player</Chip>
                  <p className="display text-[clamp(2.4rem,15cqw,3.4rem)] leading-[0.92] tracking-[0.03em] text-gold-hi engraved">
                    {playerName}
                  </p>
                  <p className="max-w-[22ch] text-small leading-snug text-chalk-1">
                    Everyone else knows too. Except one of you.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </button>
  )
}
