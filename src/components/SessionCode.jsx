import { useState } from 'react'

/**
 * The join code, sized to be read out across a table. Copy falls back to a
 * selectable field when the Clipboard API is missing, which is most non-HTTPS
 * contexts — including the LAN address you will use to test on a real phone.
 */
export default function SessionCode({ code }) {
  const [copied, setCopied] = useState(false)

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
    <div className="rounded-tile border border-pitch-700 bg-pitch-900 p-5 text-center">
      <p className="text-xs font-semibold tracking-[0.18em] text-chalk-600 uppercase">
        Join code
      </p>

      <p className="tabular mt-2 text-5xl leading-none font-black text-lime-400 sm:text-6xl">
        {code}
      </p>

      <p className="mt-3 text-sm text-chalk-400">
        Others enter this on the Join Game screen.
      </p>

      <button
        type="button"
        onClick={copy}
        className="mt-4 text-sm font-semibold text-chalk-400 underline decoration-pitch-600 underline-offset-4 transition-colors hover:text-lime-400 hover:decoration-lime-400"
      >
        {copied ? 'Link copied' : 'Copy invite link'}
      </button>
    </div>
  )
}
