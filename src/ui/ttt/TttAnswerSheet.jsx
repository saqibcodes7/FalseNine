import { useId, useRef, useState } from 'react'
import Overlay from './Overlay'
import FootballerSearch from './FootballerSearch'
import Button from '../Button'
import { Alert } from '../Field'
import { CriterionLine } from './criteria'
import { colOf, rowOf } from '../../lib/tttBoard'

/*
 * Answering a square: the two criteria it asks for, the search, and one
 * button to submit the footballer picked.
 *
 * `onSubmit(cell, footballer)` resolves to { ok: true } once the server has
 * taken the answer (right or wrong, the turn is used and the sheet closes),
 * or { ok: false, message } when it refused without using the turn: the
 * square went, the footballer has already been used, and so on. Then the
 * sheet stays open for the same player, says why, and waits for another pick.
 *
 * Whether the answer was right is the server's business. Nothing here knows.
 */
export default function TttAnswerSheet({ client, cell, axes, onClose, onSubmit }) {
  const titleId = useId()
  const inputRef = useRef(null)
  const [picked, setPicked] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  const rowAxis = axes.rows[rowOf(cell)]
  const colAxis = axes.cols[colOf(cell)]

  async function submit() {
    if (!picked || pending) return
    setPending(true)
    setError(null)
    const outcome = await onSubmit(cell, picked)
    if (!outcome.ok) {
      setPending(false)
      setPicked(null)
      setError(outcome.message)
      // The box was disabled while checking, which drops focus; put it back.
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0)
    }
  }

  return (
    <Overlay labelledBy={titleId} onClose={pending ? undefined : onClose} initialFocus={inputRef} testId="answer-sheet">
      <div className="flex items-start gap-3 px-5 pt-5 pb-4" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="eyebrow">
            Name a footballer who
          </h2>
          <div className="mt-3 space-y-1.5 text-callout leading-snug font-semibold text-text" data-testid="answer-criteria">
            <CriterionLine axis={rowAxis} />
            <CriterionLine axis={colAxis} />
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          aria-label="Close"
          className="pressable -mt-1 -mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-text-2 hover:text-text disabled:text-text-4"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" />
          </svg>
        </button>
      </div>

      <div className="hairline" aria-hidden="true" />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-4">
        <FootballerSearch
          client={client}
          selected={picked}
          disabled={pending}
          inputRef={inputRef}
          onSelect={(row) => {
            setPicked(row)
            setError(null)
          }}
          onType={() => {
            setPicked(null)
            setError(null)
          }}
        />
      </div>

      <div className="hairline" aria-hidden="true" />
      <div className="px-5 pt-3" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        {error && <Alert>{error}</Alert>}
        <Button size="lg" fullWidth className="mt-2" disabled={!picked || pending} onClick={submit} data-testid="submit-answer">
          {pending ? 'Checking…' : picked ? `Submit ${picked.known_as}` : 'Pick a footballer'}
        </Button>
      </div>
    </Overlay>
  )
}
