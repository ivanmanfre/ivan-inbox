import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as RKey } from 'react'
import { createPortal } from 'react-dom'
import { ClientRpcError, clearScheduleDate, setScheduleDateAt, type ContentDraft } from '../../lib/content'
import { monthLabel } from '../../lib/calendarItems'
import { moveConfirmCopy, movePublishesForClient } from '../../wb/content/moveConfirm'
import { useToast } from '../ui/toast'
import { warsawDay, warsawHm } from '../ui/time'
import { LANE_NAME, dayLabel, isScheduled, splitTitleTag, titleOf, type Lane } from './model'
import { LANE_DEFAULT_HM, LANE_TZ, LANE_TZ_WORD, dayIn, hmIn, laneTimeWord, zonedToUtc } from './laneTime'
import './when.css'
import { addDays, hm12, isoDow, monthGrid, parseHm, quickDays, slots, stepHm } from './when'

// WHEN: change a post's date and time in one place (Ivan 2026-10-09: "way way more and better
// experience"). Opens beside the card (WhenPopover) or in a sheet (MovePanel, phone). The time is a
// field you type into ("3pm", "1530", "15:30"; ↑ ↓ step 15 min, ⇧ an hour) with the half-hour list
// under it; the month is Monday-first and pages to any date (← → ↑ ↓ move the day, Enter saves).
// Quick days: +1 day, +1 week, the seat's next gap. Every change previews on the calendar
// (`onPreview`) and nothing is written until Enter or the key; the receipt carries Undo. Same write
// as the drag: operator_set_schedule_date (setScheduleDateAt) / clearScheduleDate. On a client's
// board a date schedules the post: the editor says so in moveConfirmCopy's words and its key reads
// "Schedule to post"; it IS the confirm. The day picked is the day saved; a day that already has a
// post or a weekend says so before saving.
export type WhenProps = {
  r: ContentDraft
  lane: Lane
  seatRows: ContentDraft[]
  /** A day dropped on or asked for. */
  initialDay?: string | null
  focus?: 'time' | 'day'
  /** The seat's next empty weekday (coverage), for the quick key. */
  gap?: string | null
  onClose: () => void
  onDone: () => void
  /** The day and time on screen, so the calendar can light the cell (null = nothing picked). */
  onPreview?: (day: string | null, label: string | null) => void
  /** After a write: the stored day, so the calendar can hold it until the re-read agrees. */
  onMoved?: (id: string, day: string | null) => void
  /** A tap on a day saves at once (the phone sheet, the Review day picker). */
  commitOnPick?: boolean
}

const ymOf = (key: string) => ({ y: Number(key.slice(0, 4)), m: Number(key.slice(5, 7)) - 1 })
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

export function WhenEditor({ r, lane, seatRows, initialDay, focus = 'day', gap = null, onClose, onDone, onPreview, onMoved, commitOnPick = false }: WhenProps) {
  const toast = useToast()
  const tz = LANE_TZ[lane]
  const today = dayIn(new Date().toISOString(), tz)
  const from = r.scheduled_at ? dayIn(r.scheduled_at, tz) : null
  const fromHm = r.scheduled_at ? hmIn(r.scheduled_at, tz) : null
  const usual = LANE_DEFAULT_HM[lane]
  const [day, setDay] = useState<string | null>(initialDay ?? from)
  const [hm, setHm] = useState(fromHm ?? usual)
  const [typed, setTyped] = useState(fromHm ?? usual)
  const [bad, setBad] = useState(false)
  const [month, setMonth] = useState(() => ymOf(initialDay ?? from ?? today))
  const [list, setList] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const timeEl = useRef<HTMLInputElement>(null)
  const gridEl = useRef<HTMLDivElement>(null)
  const listEl = useRef<HTMLDivElement>(null)

  const taken = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of seatRows) if (x.id !== r.id && x.scheduled_at && isScheduled(x, lane)) m.set(dayIn(x.scheduled_at, tz), splitTitleTag(titleOf(x)).text)
    return m
  }, [lane, r.id, seatRows, tz])
  // The day picked is the day saved (the database stores exactly that; the drag does the same).
  const landOf = (d: string | null) => d
  const land = landOf(day)
  const at = (d: string) => zonedToUtc(d, hm, tz)
  const whenWord = land ? `${dayLabel(land)} · ${laneTimeWord(at(land), lane)}` : null
  const unchanged = !!r.scheduled_at && !!land && Date.parse(at(land)) === Date.parse(r.scheduled_at)
  const client = movePublishesForClient(r)
  const copy = moveConfirmCopy(r, land ? dayLabel(land) : 'the day you pick', land ? laneTimeWord(at(land), lane) : `${hm} ${LANE_TZ_WORD[lane]}`)
  const quick = quickDays({ from, today, gap })
  const weeks = useMemo(() => monthGrid(month.y, month.m), [month])
  const times = useMemo(() => slots([fromHm, usual, hm].filter((x): x is string => !!x)), [fromHm, usual, hm])

  useEffect(() => { onPreview?.(land, whenWord) }, [land, whenWord]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onPreview?.(null, null), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (focus === 'time') { timeEl.current?.focus(); timeEl.current?.select() }
      else gridEl.current?.querySelector<HTMLElement>('[aria-selected="true"]:not(:disabled), button.tod')?.focus({ preventScroll: true })
    }, 30)
    return () => window.clearTimeout(t)
  }, [focus])
  useLayoutEffect(() => {
    if (!list) return
    listEl.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'center' })
  }, [list])

  const showMonthOf = (d: string) => setMonth(ymOf(d))
  const pickDay = (d: string) => { if (d < today) return; setDay(d); showMonthOf(d) }
  const setTime = (v: string) => { setHm(v); setTyped(v); setBad(false) }
  const readTyped = (): string | null => {
    const v = parseHm(typed)
    if (!v) { setBad(true); return null }
    setTime(v); return v
  }

  const undo = async (prev: string | null) => {
    onMoved?.(r.id, prev ? warsawDay(prev) : '')
    try {
      if (prev) await setScheduleDateAt(r.id, prev)
      else await clearScheduleDate(r.id)
      toast.show({ id: `when-${r.id}`, message: prev ? `Put back on ${dayLabel(dayIn(prev, tz))} · ${laneTimeWord(prev, lane)}.` : 'Put back with no date.', sub: LANE_NAME[lane] })
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Could not put it back.', tone: 'failed' })
    }
    onDone()
  }

  const save = async (d: string | null = day, time: string | null = hm) => {
    const to = landOf(d)
    if (!to || !time || busy) return
    const when = zonedToUtc(to, time, tz)
    if (r.scheduled_at && Date.parse(when) === Date.parse(r.scheduled_at)) { onClose(); return }
    const prev = r.scheduled_at
    setBusy(true); setErr('')
    try {
      const stored = await setScheduleDateAt(r.id, when)
      onMoved?.(r.id, warsawDay(stored))
      toast.show({
        id: `when-${r.id}`,
        message: `${prev ? 'Moved to' : 'Set for'} ${dayLabel(dayIn(stored, tz))} · ${laneTimeWord(stored, lane)}${lane === 'risedtc' ? ` (${warsawHm(stored)} Warsaw)` : ''}`,
        sub: `${LANE_NAME[lane]} · the time the database stored`,
        action: { label: 'Undo', verb: 'undo', run: () => { void undo(prev) } },
      })
      onDone(); onClose()
    } catch (e) {
      setErr(e instanceof ClientRpcError || e instanceof Error ? e.message : 'Could not move it.')
    } finally { setBusy(false) }
  }

  const removeDate = async () => {
    if (busy || !r.scheduled_at) return
    const prev = r.scheduled_at
    setBusy(true); setErr('')
    try {
      await clearScheduleDate(r.id)
      onMoved?.(r.id, '')
      toast.show({ id: `when-${r.id}`, message: 'Date removed.', sub: 'It waits under No date yet.', action: { label: 'Undo', verb: 'undo', run: () => { void undo(prev) } } })
      onDone(); onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove the date.')
    } finally { setBusy(false) }
  }

  const timeKeys = (e: RKey<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const base = parseHm(typed) ?? hm
      setTime(stepHm(base, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 60 : 15)))
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation()
      const v = readTyped()
      if (v && day) void save(day, v)
      setList(false)
    } else if (e.key === 'Escape' && list) { e.preventDefault(); e.stopPropagation(); setList(false) }
    else if (e.key === 'Tab') setList(false)
  }
  const gridKeys = (e: RKey<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (step) {
      e.preventDefault()
      const next = addDays(day ?? today, step)
      if (next < today) return
      pickDay(next)
      requestAnimationFrame(() => gridEl.current?.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus({ preventScroll: true }))
    } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void save() }
    else if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); page(e.key === 'PageDown' ? 1 : -1) }
  }
  const page = (d: -1 | 1) => setMonth(({ y, m }) => { const n = m + d; return { y: y + Math.floor(n / 12), m: ((n % 12) + 12) % 12 } })

  return (
    <div className="wh" data-when onKeyDown={e => {
      if (e.key === 'Escape' && !list) { e.stopPropagation(); onClose(); return }
      // Enter saves from anywhere in the editor (a quick day, a chip, the month), except Cancel and Remove date.
      const t = e.target as HTMLElement
      if (e.key === 'Enter' && !e.defaultPrevented && !t.closest('[data-verb="cancel"],[data-verb="remove-date"],[data-verb="move-day"]')) { e.preventDefault(); const q = t.closest<HTMLElement>('[data-quick-day]')?.dataset.quickDay; if (q) pickDay(q); void save(q ?? day) }
    }}>
      <div className="wh-when" aria-live="polite">
        <b>{whenWord ?? 'Pick a day'}</b>
        {land && taken.has(land) && <small className="wh-warn">Also on this day: {taken.get(land)}</small>}
        {land && !taken.has(land) && isoDow(land) > 4 && <small className="wh-warn">A weekend day</small>}
        {!land && r.scheduled_at && <small>Now {dayLabel(from!)} · {laneTimeWord(r.scheduled_at, lane)}</small>}
        {land && land === day && lane === 'risedtc' && <small>{warsawHm(at(land))} Warsaw</small>}
        {land && land === day && lane !== 'risedtc' && r.scheduled_at && !unchanged && <small>was {dayLabel(from!)} · {fromHm}</small>}
      </div>

      <div className="wh-time">
        <div className={`wh-tf${bad ? ' bad' : ''}`}>
          <input ref={timeEl} data-verb="pick-time" aria-label={`Time, ${LANE_TZ_WORD[lane]}`} value={typed} disabled={busy} inputMode="numeric" autoComplete="off" spellCheck={false}
            onChange={e => { setTyped(e.target.value); setBad(false); setList(false); const v = parseHm(e.target.value); if (v && /\d{3,4}|[:.h]\d{2}|[ap]m?$/i.test(e.target.value.trim())) setHm(v) }}
            onMouseDown={() => setList(l => !l)} onBlur={() => { window.setTimeout(() => setList(false), 120); if (!readTyped()) setTyped(hm) }} onKeyDown={timeKeys} />
          <span>{lane === 'risedtc' ? `${hm12(hm)} PT` : LANE_TZ_WORD[lane]}</span>
          <span className="wh-steps">
            <button type="button" tabIndex={-1} aria-label="15 minutes later" onMouseDown={e => e.preventDefault()} onClick={() => setTime(stepHm(hm, 15))}>▴</button>
            <button type="button" tabIndex={-1} aria-label="15 minutes earlier" onMouseDown={e => e.preventDefault()} onClick={() => setTime(stepHm(hm, -15))}>▾</button>
          </span>
          {list && (
            <div ref={listEl} className="wh-list" role="listbox" aria-label="Times">
              {times.map(t => (
                <button key={t} type="button" role="option" aria-selected={t === hm} onMouseDown={e => e.preventDefault()} onClick={() => { setTime(t); setList(false) }}>
                  <span>{lane === 'risedtc' ? hm12(t) : t}</span>{t === fromHm ? <small>current</small> : t === usual ? <small>usual</small> : null}
                </button>
              ))}
            </div>
          )}
        </div>
        {[fromHm, usual].filter((x, i, a): x is string => !!x && a.indexOf(x) === i && x !== hm).map(t => (
          <button key={t} type="button" className="wh-chip" disabled={busy} onClick={() => setTime(t)}>{lane === 'risedtc' ? hm12(t) : t}<small>{t === fromHm ? 'current' : 'usual'}</small></button>
        ))}
      </div>

      <div className="wh-quick">
        {quick.map(q => <button key={q.key} type="button" className={`wh-chip${day === q.day ? ' on' : ''}`} disabled={busy} data-verb={`when-${q.key}`} data-quick-day={q.day} onClick={() => pickDay(q.day)}>{q.label}<small>{dayLabel(q.day)}</small></button>)}
      </div>

      <div className="wh-cal">
        <div className="wh-mh">
          <button type="button" data-verb="move-prev-month" aria-label="Previous month" onClick={() => page(-1)}>‹</button>
          <b>{monthLabel(month.y, month.m)}</b>
          <button type="button" data-verb="move-next-month" aria-label="Next month" onClick={() => page(1)}>›</button>
        </div>
        <div ref={gridEl} className="wh-grid" role="listbox" aria-label="Pick a day" onKeyDown={gridKeys}>
          {DOW.map(d => <i key={d} aria-hidden="true">{d}</i>)}
          {weeks.flat().map(k => {
            const out = ymOf(k).m !== month.m
            const past = k < today
            const t = taken.get(k)
            const cls = [out ? 'out' : '', past ? 'past' : '', isoDow(k) > 4 ? 'we' : '', k === today ? 'tod' : '', k === from ? 'from' : '', day === k ? 'pick' : '', land === k && day !== k ? 'land' : '', gap === k ? 'gap' : ''].filter(Boolean).join(' ')
            return (
              <button key={k} type="button" role="option" aria-selected={day === k} tabIndex={day === k || (!day && k === today) ? 0 : -1} className={cls} disabled={busy || past} data-day={k}
                title={k === from ? 'Where it is now' : t ? `Has: ${t}` : gap === k ? 'Empty weekday' : dayLabel(k)}
                onClick={() => { pickDay(k); if (commitOnPick) void save(k) }} onDoubleClick={() => { pickDay(k); void save(k) }}>
                {Number(k.slice(8))}{t && <em aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      </div>

      {client && land && <p className="wh-say">{copy.message}</p>}
      {err && <p className="wh-say wh-bad" role="alert">{err}</p>}
      <div className="wh-foot">
        {r.scheduled_at && !r.published_at && <button type="button" className="wh-link" data-verb="remove-date" disabled={busy} onClick={() => { void removeDate() }}>Remove date</button>}
        <span className="wh-grow" />
        <button type="button" className="wh-cancel" data-verb="cancel" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="wh-go" data-verb="move-day" disabled={!land || busy || unchanged} onClick={() => { void save() }}>
          {busy ? 'Saving…' : client ? copy.confirmText : r.scheduled_at ? 'Move' : 'Set date'}<kbd>↵</kbd>
        </button>
      </div>
    </div>
  )
}

/** The editor in a small card beside what you clicked (desktop calendar). Outside click or Escape closes it. */
export function WhenPopover({ anchor, onClose, ...p }: WhenProps & { anchor: DOMRect }) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, g = 10
    let left = anchor.right + g
    if (left + w > vw - 8) left = anchor.left - g - w
    if (left < 8) left = Math.max(8, Math.min(vw - w - 8, anchor.left + anchor.width / 2 - w / 2))
    const top = Math.max(8, Math.min(vh - h - 8, anchor.top - 12))
    setPos({ left, top })
  }, [anchor])
  useEffect(() => {
    const off = (e: PointerEvent) => {
      const t = e.target as Element
      if (box.current?.contains(t) || t.closest?.('.d-toast,.d-confirm')) return
      onClose()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.d-confirm') && !box.current?.contains(e.target as Node)) onClose() }
    document.addEventListener('pointerdown', off, true)
    window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', off, true); window.removeEventListener('keydown', esc) }
  }, [onClose])
  return createPortal(
    <div ref={box} className="wh-pop" role="dialog" aria-label={`Date and time · ${LANE_NAME[p.lane]}`} style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }} data-on={pos ? '' : undefined}>
      <div className="wh-pop-h"><i className={`cv2-seatdot cv2-seatdot-${p.lane}`} aria-hidden="true" /><span>{splitTitleTag(titleOf(p.r)).text}</span><button type="button" aria-label="Close" onClick={onClose}>×</button></div>
      <WhenEditor {...p} onClose={onClose} />
    </div>, document.body)
}
