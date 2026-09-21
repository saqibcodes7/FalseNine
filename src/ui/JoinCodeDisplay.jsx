import { useState } from 'react'

/*
 * The join code, set as five cells so it can be read out across a table and
 * typed in without ambiguity. Tabular figures, gold, one recess per letter.
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
    <div className="surface accent-gold p-4 text-center" style={{ '--tint': '7%' }}>
      <p className="eyebrow">Join code</p>

      <p
        className="tabular mt-3 grid grid-cols-5 gap-1.5"
        data-testid="join-code"
        data-code={code}
        aria-label={`Join code ${chars.join(' ')}`}
      >
        {chars.map((ch, i) => (
          <span
            key={i}
            className="surface-sunken flex h-[3.4rem] items-center justify-center text-[1.9rem] font-bold text-gold"
          >
            {ch}
          </span>
        ))}
      </p>

      <p className="mt-3 text-footnote text-text-3">
        Others enter this on the Join Game screen.
      </p>

      <button
        type="button"
        onClick={copy}
        className="pressable mt-1.5 inline-flex h-11 items-center px-3 text-subhead font-semibold text-gold transition-colors hover:text-gold-soft"
      >
        {copied ? 'Link copied' : 'Copy invite link'}
      </button>
    </div>
  )
}
