import { createContext, useCallback, useContext, useRef, useState } from 'react'

// In-app iOS-style action sheet — replaces the native window.confirm popup,
// which looks foreign inside a dark PWA and can't carry an accent/danger colour.

type ConfirmOpts = {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

type Pending = ConfirmOpts & { resolve: (ok: boolean) => void }

const ConfirmCtx = createContext<(opts: ConfirmOpts) => Promise<boolean>>(
  () => Promise.resolve(false),
)

export function useConfirm() {
  return useContext(ConfirmCtx)
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const confirm = useCallback((opts: ConfirmOpts) => {
    return new Promise<boolean>(resolve => {
      setClosing(false)
      setPending({ ...opts, resolve })
    })
  }, [])

  const settle = useCallback((ok: boolean) => {
    setPending(cur => {
      cur?.resolve(ok)
      return cur
    })
    // Play the slide-down before unmounting so it doesn't snap away.
    setClosing(true)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setPending(null), 180)
  }, [])

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {pending && (
        <div className={`sheet-scrim ${closing ? 'closing' : ''}`} onClick={() => settle(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-card">
              <div className="sheet-title">{pending.title}</div>
              {pending.message && <div className="sheet-msg">{pending.message}</div>}
            </div>
            <button
              className={`sheet-btn ${pending.danger ? 'danger' : 'confirm'}`}
              onClick={() => settle(true)}
            >
              {pending.confirmText ?? 'Confirm'}
            </button>
            <button className="sheet-btn cancel" onClick={() => settle(false)}>
              {pending.cancelText ?? 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  )
}
