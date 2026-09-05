/* ==========================================================================
   src/wb/chrome/ConfirmSheet.tsx: S19, on the design system.

   The contract is the old provider's, unchanged: `useConfirm()` returns a
   promise, the scrim and Cancel both settle it false, the confirm settles it
   true, and a `danger` flag names the button that removes something for good.
   Both providers answer the SAME context (src/lib/confirm.ts), so no call site
   moved and stock keeps its iOS sheet.

   What changed is the surface. It was a bottom action sheet on every canvas,
   which on the desktop workbench put a phone gesture under a mouse; the ds
   Dialog is the right shape there and the ds Sheet is the right shape on the
   phone, and both already carry the scrim, the escape key, the focus trap and
   the 180ms exit the old file hand-rolled with a setTimeout.

   The close animation (S19-6) is now `AnimatePresence`'s exit rather than a
   `closing` class plus a timer, so the promise settles the instant the reader
   answers and the pending state is dropped when the exit finishes. A reader
   who answers twice in 180ms cannot resolve the same promise twice.
   ========================================================================== */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Dialog, Sheet } from '../../ds'
import { ConfirmCtx, type ConfirmOpts, type PendingConfirm } from '../../lib/confirm'
import './chrome.css'

export { useConfirm } from '../../lib/confirm'

// The phone gets the sheet, every wider canvas the dialog. One media query,
// read once and kept live, because a confirm can be open while the window is
// resized and a sheet stranded at 1440px is a phone control on a desktop.
const MQ_PHONE = '(max-width: 767px)'

function usePhone(): boolean {
  const [phone, setPhone] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(MQ_PHONE).matches)
  useEffect(() => {
    const mq = window.matchMedia(MQ_PHONE)
    const on = () => setPhone(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return phone
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [open, setOpen] = useState(false)
  const phone = usePhone()

  const confirm = useCallback((opts: ConfirmOpts) => {
    return new Promise<boolean>(resolve => {
      setPending({ ...opts, resolve })
      setOpen(true)
    })
  }, [])

  // Settling and closing are one step, and the pending row stays mounted
  // through the exit so the copy does not blank out mid-animation. It is
  // dropped on the next open, which is the only moment it can be replaced.
  const settle = useCallback((ok: boolean) => {
    setPending(cur => { cur?.resolve(ok); return cur })
    setOpen(false)
  }, [])

  const foot = pending ? (
    <>
      <Button variant="quiet" onClick={() => settle(false)}>{pending.cancelText ?? 'Cancel'}</Button>
      <Button
        variant={pending.danger ? 'danger' : 'primary'}
        onClick={() => settle(true)}
      >{pending.confirmText ?? 'Confirm'}</Button>
    </>
  ) : null

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {phone ? (
        <Sheet
          open={open && Boolean(pending)}
          onClose={() => settle(false)}
          title={pending?.title}
          sub={pending?.message}
          grip={false}
          foot={<div className="a-confirm-foot">{foot}</div>}
          className="a-confirm"
        />
      ) : (
        <Dialog
          open={open && Boolean(pending)}
          onClose={() => settle(false)}
          title={pending?.title}
          sub={pending?.message}
          danger={pending?.danger}
          foot={<div className="a-confirm-foot">{foot}</div>}
          className="a-confirm"
        />
      )}
    </ConfirmCtx.Provider>
  )
}
