import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/*
 * A modal layer for Tic-Tac-Toe: the answer sheet and the pass-the-device
 * card. It is drawn outside the app's root, and the root is made inert while
 * it is open, so nothing behind it can be focused, clicked or read out. Focus
 * moves in when it opens, stays inside while it is open (Tab wraps), and goes
 * back where it was when it closes. The page behind does not scroll.
 *
 *   placement 'sheet'   full screen on a phone, so the search box, its results
 *                       and the keyboard all fit; a centred card from md up
 *   placement 'center'  a centred card at every size
 *
 * `onClose` is optional. Without it, Escape and a tap outside do nothing: the
 * pass-the-device card only goes away when the next player presses Ready.
 */
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

export default function Overlay({ labelledBy, onClose, initialFocus, placement = 'sheet', testId, children }) {
  const panel = useRef(null)

  useEffect(() => {
    const previous = document.activeElement
    const body = document.body
    const root = document.getElementById('root')
    const overflow = body.style.overflow
    body.style.overflow = 'hidden'
    if (root) root.inert = true
    const target = initialFocus?.current ?? panel.current?.querySelector('[data-autofocus]') ?? panel.current
    target?.focus({ preventScroll: true })
    return () => {
      body.style.overflow = overflow
      if (root) root.inert = false
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [initialFocus])

  function onKeyDown(event) {
    if (event.key === 'Escape' && onClose) {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !panel.current) return
    const items = [...panel.current.querySelectorAll(FOCUSABLE)]
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const sheet = placement === 'sheet'

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex justify-center ${sheet ? 'items-stretch md:items-center md:p-6' : 'items-center p-5'}`}
      data-testid={testId}
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={[
          'surface enter relative flex w-full flex-col overflow-hidden outline-none',
          sheet
            ? 'h-dvh rounded-none md:h-auto md:max-h-[min(44rem,calc(100dvh-3rem))] md:max-w-md md:rounded-[var(--radius-card)]'
            : 'max-w-sm rounded-[var(--radius-card)]',
        ].join(' ')}
        style={{ backgroundColor: 'var(--color-surface-1)' }}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
