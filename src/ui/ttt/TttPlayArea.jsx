import { useState } from 'react'
import TttBoard from './TttBoard'
import TttAnswerSheet from './TttAnswerSheet'
import Button from '../Button'
import { Alert } from '../Field'

/*
 * The part of a board screen that Online and Pass & Play share: the board,
 * the answer sheet for the square picked, and Pass.
 *
 * `canAct` says whether the person holding the device may move right now.
 * The mode decides that from the server's turn and, in Pass & Play, from
 * whether the next player has pressed Ready. The mode also decides which
 * client the move goes through: `onSubmit` and `onPass` are its own.
 *
 *   onSubmit(cell, footballer)  resolves { ok: true } when the turn was used
 *   onPass()                    (right, wrong or passed), or { ok: false,
 *                               message, stale } when the server refused
 *                               without using it
 *
 * A refusal because the board moved on underneath (`stale`) closes the sheet
 * and says why under the board; any other refusal keeps the sheet open for
 * another try.
 *
 * Each turn gets a fresh one of these (the mode keys it by turn), so nothing
 * typed or picked on one turn survives into the next.
 */
export default function TttPlayArea({ client, axes, cells, winning, playing, canAct, onSubmit, onPass, notice }) {
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState(null)

  const openCell = canAct && selected !== null && !cells[selected] ? selected : null

  async function submit(cell, footballer) {
    const outcome = await onSubmit(cell, footballer)
    if (outcome.ok) setSelected(null)
    else if (outcome.stale) {
      setSelected(null)
      setRefusal(outcome.message)
    }
    return outcome
  }

  async function pass() {
    if (!canAct || busy) return
    setBusy(true)
    setRefusal(null)
    const outcome = await onPass()
    setBusy(false)
    if (!outcome.ok) setRefusal(outcome.message)
  }

  return (
    <div>
      <div className="mx-auto w-full max-w-[34rem]">
        <TttBoard
          axes={axes}
          cells={cells}
          winning={winning}
          interactive={canAct && !busy}
          selectedCell={openCell}
          onSelect={(cell) => {
            setSelected(cell)
            setRefusal(null)
          }}
        />
      </div>

      <div className="mx-auto mt-4 w-full max-w-[34rem] space-y-3">
        {notice}
        {refusal && <Alert>{refusal}</Alert>}
        {playing && (
          <Button variant="secondary" fullWidth disabled={!canAct || busy} onClick={pass} data-testid="pass-turn">
            {busy ? 'Passing…' : 'Pass'}
          </Button>
        )}
      </div>

      {openCell !== null && (
        <TttAnswerSheet
          key={openCell}
          client={client}
          cell={openCell}
          axes={axes}
          onClose={() => setSelected(null)}
          onSubmit={submit}
        />
      )}
    </div>
  )
}
