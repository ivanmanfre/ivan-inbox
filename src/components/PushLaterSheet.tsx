import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { SNOOZE_PRESETS, snoozeTarget } from '../lib/inbox'

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
type Pending = { name: string; resolve: (until: string | null) => void }

const PushCtx = createContext<(name: string) => Promise<string | null>>(
  () => Promise.resolve(null),
)

export function usePushLater() {
  return useContext(PushCtx)
}

// `datetime-local` wants "YYYY-MM-DDTHH:mm" in LOCAL time and gives it back the
// same way. Date.toISOString() is UTC, so it is the wrong tool in both
// directions: feeding it in shifts the default by the offset, and reading it
// out as if it were UTC would push a draft to the wrong hour. Both conversions
// go through the local fields.
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function fromLocalInput(v: string): string | null {
  const t = new Date(v)
  if (Number.isNaN(t.getTime())) return null
  return t.toISOString()
}

/** "Tue 26 Aug, 08:00" — the date he will see it, in his own clock. */
export function formatReturn(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'later'
  return d.toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/** "in 6 days" / "tomorrow" / "today" — how long the park has left to run. */
export function returnsIn(iso: string, now: number = Date.now()): string {
  const days = Math.round((Date.parse(iso) - now) / 86_400_000)
  if (Number.isNaN(days)) return ''
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 14) return `in ${days} days`
  if (days < 60) return `in ${Math.round(days / 7)} weeks`
  return `in ${Math.round(days / 30)} months`
}

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
