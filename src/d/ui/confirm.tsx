import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useFrameMaybe } from '../shell/frame'
import { Key } from './Key'

// CONFIRM. Every consequential verb asks once, in plain words, with the
// consequence stated before the press.
//
//   const confirm = useDConfirm()
//   if (!await confirm({ title: 'Clear every notification?', message: '1,102 go, not only the ones on screen.',
//                        confirmText: 'Clear all', verb: 'clear-all' })) return
//
// The confirm key carries `data-verb` (default 'confirm') so a proof can press it.
//
// DANGER (`danger: true`: delete, spam, discard, stop contact, skip...): the confirm key is red,
// the CANCEL key takes the focus, and Enter never confirms (today's ConfirmSheet `danger`).
// A danger action is confirmed by a click or a tap on the red key, never by a stray Enter.
export type ConfirmOpts = { title: ReactNode; message?: ReactNode; confirmText: string; cancelText?: string; verb?: string; danger?: boolean }

type Pending = ConfirmOpts & { resolve: (ok: boolean) => void }
const OpenCtx = createContext(false)
const Ctx = createContext<((o: ConfirmOpts) => Promise<boolean>) | null>(null)

export function DConfirmProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<Pending | null>(null)
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>(resolve => setP({ ...o, resolve })), [])
  const done = useCallback((ok: boolean) => { setP(cur => { cur?.resolve(ok); return null }) }, [])
  return (
    <OpenCtx.Provider value={p !== null}><Ctx.Provider value={ask}>
      {children}
      {p && <ConfirmBox p={p} done={done} />}
    </Ctx.Provider></OpenCtx.Provider>
  )
}

/**
 * The keyboard rules of a confirm box, shared by every D confirm (this one and the DMs page's
 * two-way discard). Escape cancels. On a danger box the cancel key is focused and Enter is
 * swallowed: on the cancel key it cancels, anywhere else it does nothing.
 */
export function useConfirmKeys({ danger, cancel, ok, onCancel }: {
  danger: boolean; cancel: RefObject<HTMLButtonElement | null>; ok: RefObject<HTMLButtonElement | null>; onCancel: () => void
}) {
  useEffect(() => {
    ;(danger ? cancel : ok).current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); return }
      if (danger && e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation()
        if (document.activeElement === cancel.current) onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [danger, cancel, ok, onCancel])
}

function ConfirmBox({ p, done }: { p: Pending; done: (ok: boolean) => void }) {
  const f = useFrameMaybe()
  const ok = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const danger = Boolean(p.danger)
  useConfirmKeys({ danger, cancel, ok, onCancel: useCallback(() => done(false), [done]) })
  return (
    <>
      <div className="d-scrim d-scrim-confirm" onClick={() => done(false)} aria-hidden="true" />
      <div className={`d-confirm d-confirm-${f?.layout ?? 'desktop'}${danger ? ' d-confirm-danger' : ''}`} role="alertdialog" aria-modal="true">
        <h3>{p.title}</h3>
        {p.message != null && <p>{p.message}</p>}
        <div className="d-confirm-k">
          <Key ref={cancel} onClick={() => done(false)} verb="cancel">{p.cancelText ?? 'Cancel'}</Key>
          <Key primary={!danger} danger={danger} ref={ok} onClick={() => done(true)} verb={p.verb ?? 'confirm'}>{p.confirmText}</Key>
        </div>
      </div>
    </>
  )
}

export function useDConfirm(): (o: ConfirmOpts) => Promise<boolean> {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDConfirm outside the D Shell')
  return v
}

/** Presentation lock: navigation must not replace the item under an open confirm. */
export function useDConfirmOpen(): boolean { return useContext(OpenCtx) }
