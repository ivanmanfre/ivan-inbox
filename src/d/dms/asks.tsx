// The two questions a DM verb asks before it writes, as promises:
//   askDiscard(...) -> 'plain' | 'myself' | null   (the two-way discard: Discard / Discard, I'll reply myself)
//   askDate(...)    -> { at, note } | null          (Later: Tomorrow, Next week, the planner's suggested date,
//                                                     or a picked day and time; a dated follow-up also takes a note)
// Drawn with the frame's confirm look (d-confirm / d-key), never a second modal style.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { snoozeTarget } from '../../lib/inbox'
import { PUSH_COPY, fromLocalInput, formatReturn, toLocalInput, type PushVariant } from '../../lib/pushLater'
import { useFrameMaybe } from '../shell/frame'
import { useConfirmKeys } from '../ui/confirm'
import { Key } from '../ui/Key'

export type DiscardAnswer = 'plain' | 'myself' | null
type DiscardQ = { title: string; message: string; myself: boolean; resolve: (a: DiscardAnswer) => void }
export type DateAnswer = { at: string; note: string }
export type DateOpts = {
  /** A dated follow-up: the free-text line the drafter picks up (today's FollowUpStrip note). */
  note?: boolean
  noteInit?: string
  /** The reply planner's one-tap date, where it made one. */
  suggest?: { at: string; why: string } | null
}
type DateQ = { name: string; variant: PushVariant; opts: DateOpts; resolve: (a: DateAnswer | null) => void }

type Api = {
  askDiscard: (o: { title: string; message: string; myself: boolean }) => Promise<DiscardAnswer>
  askDate: (name: string, variant: PushVariant, opts?: DateOpts) => Promise<DateAnswer | null>
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
  const askDate = useCallback((name: string, variant: PushVariant, opts: DateOpts = {}) =>
    new Promise<DateAnswer | null>(resolve => setTq({ name, variant, opts, resolve })), [])
  const endD = useCallback((a: DiscardAnswer) => setDq(q => { q?.resolve(a); return null }), [])
  const endT = useCallback((a: DateAnswer | null) => setTq(q => { q?.resolve(a); return null }), [])
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

const PRESETS = [{ key: '1d', label: 'Tomorrow', days: 1 }, { key: '1w', label: 'Next week', days: 7 }]

function DateBox({ q, done }: { q: DateQ; done: (a: DateAnswer | null) => void }) {
  const f = useFrameMaybe()
  const copy = PUSH_COPY[q.variant]
  const firstName = q.name.split(' ')[0] || q.name
  const [pick, setPick] = useState(() => toLocalInput(new Date(snoozeTarget(7))))
  const [note, setNote] = useState(q.opts.noteInit ?? '')
  useEscape(useCallback(() => done(null), [done]))
  const picked = fromLocalInput(pick)
  const valid = picked !== null && Date.parse(picked) > Date.now()
  const go = (at: string) => done({ at, note: note.trim() })
  const sug = q.opts.suggest && Date.parse(q.opts.suggest.at) > Date.now() ? q.opts.suggest : null
  return (
    <>
      <div className="d-scrim d-scrim-confirm" onClick={() => done(null)} aria-hidden="true" />
      <div className={`d-confirm d-confirm-${f?.layout ?? 'desktop'} dm-ask`} role="dialog" aria-modal="true" aria-label="Later">
        <h3>Later</h3>
        <p>{copy.sub(firstName)}</p>
        <div className="dm-presets">
          {sug && (
            <button type="button" className="dm-preset dm-preset-sug" data-verb="date-suggested" onClick={() => go(sug.at)} title={sug.why || undefined}>
              <b>Suggested</b><small>{formatReturn(sug.at)}</small>
            </button>
          )}
          {PRESETS.map(p => {
            const at = snoozeTarget(p.days)
            return (
              <button key={p.key} type="button" className="dm-preset" data-verb={`date-${p.key}`} onClick={() => go(at)}>
                <b>{p.label}</b><small>{formatReturn(at)}</small>
              </button>
            )
          })}
        </div>
        <label className="dm-pickl">
          <span>Or pick a day and time</span>
          <input type="datetime-local" value={pick} onChange={e => setPick(e.target.value)} />
        </label>
        {q.opts.note && (
          <label className="dm-field dm-later-note"><span>What the follow-up should pick up (optional)</span>
            <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. back mid October, we emailed the model, set the catch-up" />
          </label>
        )}
        <div className="d-confirm-k">
          <Key onClick={() => done(null)} verb="cancel">Cancel</Key>
          <Key primary disabled={!valid} onClick={() => valid && picked && go(picked)} verb="date-pick">{copy.go}</Key>
        </div>
      </div>
    </>
  )
}
