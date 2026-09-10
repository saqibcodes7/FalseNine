import { useState } from 'react'

/*
 * The join code as a five-cell scoreboard: a gold frame, black enamel, one
 * lime Teko character per cell. Sized to be read across a pub table.
 */
export default function JoinCodeDisplay({ code }) {
  const [copied, setCopied] = useState(false)
  const chars = String(code).split('')

  async function copy() {
    const url = `${window.location.origin}/imposter/join?code=${code}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this link and send it to your players:', url)
    }
  }

  return (
    <div className="frame metal-gold" style={{ '--fw': '4px' }}>
      <div className="frame-inner enamel-ink-deep px-4 pt-3 pb-4 text-center">
        <p className="display text-[1.05rem] tracking-[0.22em] text-gold engraved">
          Join code
        </p>

        <p
          className="tabular mt-2 grid grid-cols-5 gap-1.5"
          data-testid="join-code"
          data-code={code}
          aria-label={`Join code ${chars.join(' ')}`}
        >
          {chars.map((ch, i) => (
            <span
              key={i}
              className="display flex h-[3.6rem] items-center justify-center rounded-[5px] bg-ink-0 pt-[0.2em] text-[3rem] leading-none text-lime shadow-[inset_0_2px_6px_oklch(0%_0_0/.7),inset_0_0_0_1px_oklch(30%_.018_250)]"
            >
              {ch}
            </span>
          ))}
        </p>

        <p className="mt-3 text-small text-chalk-1">
          Others enter this on the Join Game screen.
        </p>

        <button
          type="button"
          onClick={copy}
          className="display mt-2 text-[1.1rem] tracking-[0.1em] text-gold engraved underline decoration-gold-lo underline-offset-[5px] transition-colors hover:text-gold-hi"
        >
          {copied ? 'Link copied' : 'Copy invite link'}
        </button>
      </div>
    </div>
  )
}
