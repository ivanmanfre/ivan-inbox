import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Btn } from './Key'

// THE UNDO TOAST (receipt). One stack for the whole frame.
//
//   const toast = useToast()
//   toast.show({ message: 'Cleared 1,102 notifications.', sub: 'Every one, not only the ones on screen.',
//                action: { label: 'Undo', verb: 'undo', run: () => undoClear(stamp) } })
//
// A receipt with an action stays 8 s, a plain one 5 s. Showing a toast with the
// same `id` replaces the old one. Desktop: under the answer row, right (bottom
// right while the bell is open, where the mock draws the Clear all receipt);
// phone: above the dock.
export type ToastAction = { label: string; verb?: string; run: () => void }
export type ToastInput = { id?: string; message: ReactNode; sub?: ReactNode; action?: ToastAction; ms?: number; tone?: 'plain' | 'failed' }
type Item = ToastInput & { id: string }

type Api = { show: (t: ToastInput) => string; dismiss: (id: string) => void }
const Ctx = createContext<Api | null>(null)

let seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const timers = useRef(new Map<string, number>())
  const dismiss = useCallback((id: string) => {
    setItems(prev => prev.filter(t => t.id !== id))
    const t = timers.current.get(id)
    if (t) { window.clearTimeout(t); timers.current.delete(id) }
  }, [])
  const show = useCallback((t: ToastInput) => {
    const id = t.id ?? `t${++seq}`
    setItems(prev => [...prev.filter(x => x.id !== id), { ...t, id }])
    const old = timers.current.get(id)
    if (old) window.clearTimeout(old)
    timers.current.set(id, window.setTimeout(() => dismiss(id), t.ms ?? (t.action ? 8000 : 5000)))
    return id
  }, [dismiss])
  useEffect(() => {
    const map = timers.current
    return () => { for (const t of map.values()) window.clearTimeout(t) }
  }, [])
  return (
    <Ctx.Provider value={{ show, dismiss }}>
      {children}
      <div className="d-toasts" aria-live="polite">
        {items.map(t => (
          <div key={t.id} className={`d-toast${t.tone === 'failed' ? ' d-toast-failed' : ''}`} role="status">
            <div><span>{t.message}</span>{t.sub != null && <small>{t.sub}</small>}</div>
            {t.action && (
              <Btn verb={t.action.verb} onClick={() => { dismiss(t.id); t.action!.run() }}>{t.action.label}</Btn>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): Api {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToast outside the D Shell')
  return v
}
