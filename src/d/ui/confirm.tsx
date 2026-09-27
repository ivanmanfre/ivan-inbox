import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
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
export type ConfirmOpts = { title: ReactNode; message?: ReactNode; confirmText: string; cancelText?: string; verb?: string }

type Pending = ConfirmOpts & { resolve: (ok: boolean) => void }
const Ctx = createContext<((o: ConfirmOpts) => Promise<boolean>) | null>(null)

export function DConfirmProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<Pending | null>(null)
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>(resolve => setP({ ...o, resolve })), [])
  const done = useCallback((ok: boolean) => { setP(cur => { cur?.resolve(ok); return null }) }, [])
  return (
    <Ctx.Provider value={ask}>
      {children}
      {p && <ConfirmBox p={p} done={done} />}
    </Ctx.Provider>
  )
}

function ConfirmBox({ p, done }: { p: Pending; done: (ok: boolean) => void }) {
  const f = useFrameMaybe()
  const ok = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    ok.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); done(false) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [done])
  return (
    <>
      <div className="d-scrim d-scrim-confirm" onClick={() => done(false)} aria-hidden="true" />
      <div className={`d-confirm d-confirm-${f?.layout ?? 'desktop'}`} role="alertdialog" aria-modal="true">
        <h3>{p.title}</h3>
        {p.message != null && <p>{p.message}</p>}
        <div className="d-confirm-k">
          <Key onClick={() => done(false)} verb="cancel">{p.cancelText ?? 'Cancel'}</Key>
          <Key primary ref={ok} onClick={() => done(true)} verb={p.verb ?? 'confirm'}>{p.confirmText}</Key>
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
