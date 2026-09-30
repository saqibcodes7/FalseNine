import { useId } from 'react'
import Overlay from './Overlay'
import Button from '../Button'
import Mark from './Mark'

/*
 * Pass & Play: hand the device over. Shown whenever the turn has passed to
 * the other person and they have not said they are holding it yet. Nothing
 * on the board can be touched until they press Ready.
 *
 * `feedback` is what happened on the turn just played, as the server
 * recorded it ("Incorrect. Turn passes."), never why.
 */
export default function TttHandoff({ name, mark, feedback, onReady }) {
  const titleId = useId()
  return (
    <Overlay labelledBy={titleId} placement="center" testId="handoff">
      <div className="p-6 text-center">
        {feedback && (
          <p
            className={`mb-5 text-callout font-semibold ${feedback.tone === 'flag' ? 'text-flag' : feedback.tone === 'go' ? 'text-go' : 'text-text-2'}`}
            data-testid="handoff-feedback"
          >
            {feedback.text}
          </p>
        )}
        <p className="eyebrow">Pass the device</p>
        <h2 id={titleId} className="display mt-3 text-title1 text-balance text-text" data-testid="handoff-name">
          Pass to {name}
        </h2>
        <p className="mt-3 flex items-center justify-center gap-2 text-callout text-text-2">
          <Mark mark={mark} className="h-5 w-5" />
          <span data-testid="handoff-mark">You&apos;re {mark}</span>
        </p>
        <Button size="lg" fullWidth className="mt-6" onClick={onReady} data-autofocus data-testid="handoff-ready">
          Ready
        </Button>
      </div>
    </Overlay>
  )
}
