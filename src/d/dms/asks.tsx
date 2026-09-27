// The two questions a DM verb asks before it writes, as promises:
//   askDiscard(...) -> 'plain' | 'myself' | null   (the two-way discard: Discard / Discard, I'll reply myself)
//   askDate(...)    -> ISO string | null            (Later and Follow up on a date: presets + a picked time)
// Drawn with the frame's confirm look (d-confirm / d-key), never a second modal style.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { SNOOZE_PRESETS, snoozeTarget } from '../../lib/inbox'
import { PUSH_COPY, fromLocalInput, formatReturn, toLocalInput, type PushVariant } from '../../lib/pushLater'
import { useFrameMaybe } from '../shell/frame'
import { useConfirmKeys } from '../ui/confirm'
import { Key } from '../ui/Key'

export type DiscardAnswer = 'plain' | 'myself' | null
type DiscardQ = { title: string; message: string; myself: boolean; resolve: (a: DiscardAnswer) => void }
type DateQ = { name: string; variant: PushVariant; resolve: (at: string | null) => void }

type Api = {
  askDiscard: (o: { title: string; message: string; myself: boolean }) => Promise<DiscardAnswer>
  askDate: (name: string, variant: PushVariant) => Promise<string | null>
}
const Ctx = createContext<Api | null>(null)

export function useAsks(): Api {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAsks outside DmAsks')
  return v
}

export function DmAsks({ children }: { children: ReactNode }) {
  const [dq, setDq] = useState<DiscardQ | null>(null)
  const [tq, setTq] = useState<DateQ | null>(null)
  const askDiscard = useCallback((o: { title: string; message: string; myself: boolean }) =>
    new Promise<DiscardAnswer>(resolve => setDq({ ...o, resolve })), [])
  const askDate = useCallback((name: string, variant: PushVariant) =>
    new Promise<string | null>(resolve => setTq({ name, variant, resolve })), [])
  const endD = useCallback((a: DiscardAnswer) => setDq(q => { q?.resolve(a); return null }), [])
  const endT = useCallback((a: string | null) => setTq(q => { q?.resolve(a); return null }), [])
  return (
    <Ctx.Provider value={{ askDiscard, askDate }}>
      {children}
      {dq && <DiscardBox q={dq} done={endD} />}
      {tq && <DateBox q={tq} done={endT} />}
    </Ctx.Provider>
  )
}

function useEscape(fn: () => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); fn() } }
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
  }, [fn])
}

function DiscardBox({ q, done }: { q: DiscardQ; done: (a: DiscardAnswer) => void }) {
  const f = useFrameMaybe()
  const ok = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  // A discard is a danger confirm (today's ConfirmSheet danger): red key, Cancel focused, Enter never discards.
  useConfirmKeys({ danger: true, cancel, ok, onCancel: useCallback(() => done(null), [done]) })
  return (
    <>
      <div className="d-scrim d-scrim-confirm" onClick={() => done(null)} aria-hidden="true" />
      <div className={`d-confirm d-confirm-${f?.layout ?? 'desktop'} d-confirm-danger dm-ask`} role="alertdialog" aria-modal="true">
        <h3>{q.title}</h3>
        <p>{q.message}</p>
        <div className="d-confirm-k">
          <Key ref={cancel} onClick={() => done(null)} verb="cancel">Cancel</Key>
          <Key ref={ok} danger onClick={() => done('plain')} verb="discard-confirm">Discard</Key>
        </div>
        {q.myself && (
          <div className="d-confirm-k">
            <Key onClick={() => done('myself')} verb="discard-myself" sub="the reply stays owed">Discard, I'll reply myself</Key>
          </div>
        )}
      </div>
    </>
  )
}

function DateBox({ q, done }: { q: DateQ; done: (at: string | null) => void }) {
  const f = useFrameMaybe()
  const copy = PUSH_COPY[q.variant]
  const firstName = q.name.split(' ')[0] || q.name
  const [pick, setPick] = useState(() => toLocalInput(new Date(snoozeTarget(7))))
  useEscape(useCallback(() => done(null), [done]))
  const picked = fromLocalInput(pick)
  const valid = picked !== null && Date.parse(picked) > Date.now()
  return (
    <>
      <div className="d-scrim d-scrim-confirm" onClick={() => done(null)} aria-hidden="true" />
      <div className={`d-confirm d-confirm-${f?.layout ?? 'desktop'} dm-ask`} role="dialog" aria-modal="true" aria-label={copy.title}>
        <h3>{copy.title}</h3>
        <p>{copy.sub(firstName)}</p>
        <div className="dm-presets">
          {SNOOZE_PRESETS.map(p => {
            const at = snoozeTarget(p.days)
            return (
              <button key={p.key} type="button" className="dm-preset" data-verb={`date-${p.key}`} onClick={() => done(at)}>
                <b>{p.label}</b><small>{formatReturn(at)}</small>
              </button>
            )
          })}
        </div>
        <label className="dm-pickl">
          <span>Or a day and time</span>
          <input type="datetime-local" value={pick} onChange={e => setPick(e.target.value)} />
        </label>
        <div className="d-confirm-k">
          <Key onClick={() => done(null)} verb="cancel">Cancel</Key>
          <Key primary disabled={!valid} onClick={() => valid && done(picked)} verb="date-pick">{copy.go}</Key>
        </div>
      </div>
    </>
  )
}
