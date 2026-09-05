import { useCallback, useRef, useState } from 'react'
import { SNOOZE_PRESETS, snoozeTarget } from '../lib/inbox'
import {
  PushCtx, formatReturn, fromLocalInput, toLocalInput, type PendingPush,
} from '../lib/pushLater'

// The context, the hook and the four date helpers moved to src/lib/pushLater.ts
// so the workbench's own provider (src/wb/sheets/PushLater.tsx) can answer the
// SAME hook. Re-exported here because every call site imports them from this
// path. This file is `#exp/stock`'s iOS sheet and nothing else.
export { usePushLater, formatReturn, returnsIn } from '../lib/pushLater'

// "Push this to later" — the third decision on a DM draft.
//
// Ivan, 2026-08-20: "some people just say 'I am travelling', or 'I will be back
// soon'... I would like to have the option to push this for a few days or weeks."
// Until now the card carried two TERMINAL decisions, approve and discard, so
// "later" had to be spelled as "never".
//
// Shaped like ConfirmProvider (same scrim, same sheet, same slide-down) rather
// than a second popup vocabulary — a draft decision should feel like the other
// draft decisions. Resolves to an ISO instant, or null if he backs out.
type Pending = PendingPush

export function PushLaterProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [closing, setClosing] = useState(false)
  const [custom, setCustom] = useState('')
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const ask = useCallback((name: string) => {
    return new Promise<string | null>(resolve => {
      setClosing(false)
      // Seed the custom field with the middle preset so the picker opens on a
      // sane date instead of on 1970 or on right now.
      setCustom(toLocalInput(new Date(snoozeTarget(7))))
      setPending({ name, resolve })
    })
  }, [])

  const settle = useCallback((until: string | null) => {
    setPending(cur => {
      cur?.resolve(until)
      return cur
    })
    setClosing(true)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setPending(null), 180)
  }, [])

  return (
    <PushCtx.Provider value={ask}>
      {children}
      {pending && (
        <div className={`sheet-scrim ${closing ? 'closing' : ''}`} onClick={() => settle(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-card">
              <div className="sheet-title">Push this draft to later</div>
              <div className="sheet-msg">
                It leaves your queue and comes back on the date you pick. Nothing is
                sent and nothing is thrown away. If {pending.name.split(' ')[0]} writes
                back before then, it returns straight away.
              </div>
            </div>
            <div className="push-presets">
              {SNOOZE_PRESETS.map(p => (
                <button
                  key={p.key}
                  type="button"
                  className="push-preset"
                  onClick={() => settle(snoozeTarget(p.days))}
                >
                  <span className="pp-l">{p.label}</span>
                  <span className="pp-s">{formatReturn(snoozeTarget(p.days))}</span>
                </button>
              ))}
            </div>
            <div className="push-custom">
              <input
                type="datetime-local"
                value={custom}
                onChange={e => setCustom(e.target.value)}
                aria-label="Custom return time"
              />
              <button
                type="button"
                className="push-go"
                disabled={fromLocalInput(custom) === null}
                onClick={() => {
                  const iso = fromLocalInput(custom)
                  if (iso) settle(iso)
                }}
              >
                Push
              </button>
            </div>
            <button className="sheet-btn cancel" onClick={() => settle(null)}>Cancel</button>
          </div>
        </div>
      )}
    </PushCtx.Provider>
  )
}
