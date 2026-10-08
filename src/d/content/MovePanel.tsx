import { useEffect, useMemo, useState } from 'react'
import { ClientRpcError, clearScheduleDate, setScheduleDateAt, type ContentDraft } from '../../lib/content'
import { monthLabel, monthWeeks } from '../../lib/calendarItems'
import { moveConfirmCopy } from '../../wb/content/moveConfirm'
import { Key } from '../ui/Key'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/toast'
import { warsawDay, warsawHm } from '../ui/time'
import { FEED, LANE_NAME, dayLabel, isScheduled, landingDay, titleOf, type Lane } from './model'
import { LANE_DEFAULT_HM, LANE_TZ, LANE_TZ_WORD, hmIn, laneTimeWord, zonedToUtc } from './laneTime'

// MOVE TO ANOTHER DAY. The same write as the calendar drag (operator_set_schedule_date via
// setScheduleDateAt), in a sheet over the page so it opens where you are (2026-10-09: it used to
// draw under the calendar, out of sight). Time first, then a month you can page to any date; with
// `quickCommit` a tap on a day moves it at the time shown, otherwise the tap picks and the key moves.
// Day and time are the lane's own clock (laneTime: RISE in PT, ARCH and Ivan in Warsaw); on Ivan's
// lane a weekend or a taken day moves to the next free weekday. The sheet IS the confirm and says the
// consequence in today's words (moveConfirmCopy); the receipt names the day the database stored and
// carries Undo.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const ym = (key: string) => ({ y: Number(key.slice(0, 4)), m: Number(key.slice(5, 7)) - 1 })

export function MovePanel({ r, lane, seatRows, onClose, onDone, onLand, initialPick, quickCommit = false }: {
  quickCommit?: boolean
  r: ContentDraft; lane: Lane; first?: string; seatRows: ContentDraft[]; phone?: boolean
  onClose: () => void; onDone: () => void; onLand?: (key: string | null) => void
  /** A day dropped on (drag) or asked for; any date. */
  initialPick?: string | null
}) {
  const toast = useToast()
  const tz = LANE_TZ[lane]
  const today = warsawDay(Date.now())
  const from = r.scheduled_at ? warsawDay(r.scheduled_at) : null
  const fromHm = r.scheduled_at ? hmIn(r.scheduled_at, tz) : null
  const [pick, setPick] = useState<string | null>(initialPick ?? from)
  const [hm, setHm] = useState(fromHm ?? LANE_DEFAULT_HM[lane])
  const [month, setMonth] = useState(() => ym(initialPick ?? from ?? today))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const weeks = useMemo(() => monthWeeks(month.y, month.m), [month])
  const taken = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of seatRows) if (x.id !== r.id && x.scheduled_at && isScheduled(x, lane)) m.set(warsawDay(x.scheduled_at), titleOf(x))
    return m
  }, [lane, r.id, seatRows])
  const title = r.scheduled_at ? 'Move to another day' : 'Give it a date'
  const at = (day: string) => zonedToUtc(day, hm, tz)
  const landOf = (day: string | null) => (day ? (lane === 'ivan' ? landingDay(day, new Set(taken.keys())) : day) : null)
  const land = landOf(pick)
  useEffect(() => { onLand?.(land) }, [land, onLand])
  const copy = moveConfirmCopy(r, land ? dayLabel(land) : 'the day you pick', land ? laneTimeWord(at(land), lane) : `${hm} ${LANE_TZ_WORD[lane]}`)
  const unchanged = !!r.scheduled_at && !!land && Date.parse(at(land)) === Date.parse(r.scheduled_at)

  const undo = async (prev: string | null) => {
    try {
      if (prev) await setScheduleDateAt(r.id, prev)
      else await clearScheduleDate(r.id)
      toast.show({ message: prev ? `Put back on ${dayLabel(warsawDay(prev))} · ${laneTimeWord(prev, lane)}.` : 'Put back with no date.', sub: LANE_NAME[lane] })
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Could not put it back.', tone: 'failed' })
    }
    onDone()
  }

  const run = async (day: string | null = pick) => {
    const to = landOf(day)
    if (!to || busy) return
    if (r.scheduled_at && Date.parse(at(to)) === Date.parse(r.scheduled_at)) { onClose(); return }
    const prev = r.scheduled_at
    setBusy(true); setErr('')
    try {
      const stored = await setScheduleDateAt(r.id, at(to))
      toast.show({
        message: `Set for ${dayLabel(warsawDay(stored))} · ${laneTimeWord(stored, lane)}${lane === 'risedtc' ? ` (${warsawHm(stored)} Warsaw)` : ''}.`,
        sub: 'That is the time the database stored.',
        action: { label: 'Undo', verb: 'undo', run: () => { void undo(prev) } },
      })
      onDone(); onClose()
    } catch (e) {
      setErr(e instanceof ClientRpcError || e instanceof Error ? e.message : 'Could not move it.')
    } finally { setBusy(false) }
  }

  // Enter moves (the time field included); Escape is the sheet's.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !e.metaKey && !e.ctrlKey && pick && !unchanged) { e.preventDefault(); void run() } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  const page = (d: -1 | 1) => setMonth(({ y, m }) => { const n = m + d; return { y: y + Math.floor(n / 12), m: ((n % 12) + 12) % 12 } })
  const usual = LANE_DEFAULT_HM[lane]
  const times = [...new Set([fromHm, usual].filter((x): x is string => !!x))]

  return (
    <Sheet open onClose={onClose} title={title} sub={`${titleOf(r)} · ${LANE_NAME[lane]} · ${FEED[lane]}`} className="cn-movesheet">
      <div className="cn-mv">
        <p className="cn-mv-now">{r.scheduled_at ? <>Now: <b>{dayLabel(from!)} · {laneTimeWord(r.scheduled_at, lane)}</b></> : 'No date yet'}</p>

        <div className="cn-mv-time">
          <label>
            <span>Time, {LANE_TZ_WORD[lane]}</span>
            <input type="time" data-verb="pick-time" value={hm} step={300} disabled={busy} onChange={e => { if (e.target.value) setHm(e.target.value) }} />
          </label>
          {times.map(t => (
            <button key={t} type="button" className={hm === t ? 'on' : ''} aria-pressed={hm === t} disabled={busy} onClick={() => setHm(t)}>
              {t}<small>{t === fromHm ? 'current' : 'usual'}</small>
            </button>
          ))}
        </div>

        <div className="cn-mv-month">
          <div className="cn-mv-mh">
            <button type="button" data-verb="move-prev-month" aria-label="Previous month" onClick={() => page(-1)}>‹</button>
            <b>{monthLabel(month.y, month.m)}</b>
            <button type="button" data-verb="move-next-month" aria-label="Next month" onClick={() => page(1)}>›</button>
          </div>
          <div className="cn-mv-grid" role="listbox" aria-label="Pick a day">
            {DOW.map(d => <i key={d} aria-hidden="true">{d.slice(0, 2)}</i>)}
            {weeks.flat().map(k => {
              const out = ym(k).m !== month.m
              const past = k < today
              const we = [0, 6].includes(new Date(`${k}T12:00:00`).getDay())
              const t = taken.get(k)
              const cls = [out ? 'out' : '', past ? 'past' : '', we ? 'we' : '', k === today ? 'tod' : '', k === from ? 'from' : '', pick === k ? 'pick' : '', land === k && pick !== k ? 'land' : '', t ? 'taken' : ''].filter(Boolean).join(' ')
              return (
                <button key={k} type="button" role="option" aria-selected={pick === k} className={cls} disabled={busy || past} data-day={k}
                  title={k === from ? 'This post' : t ? `Has: ${t}` : dayLabel(k)}
                  onClick={() => { setPick(k); if (quickCommit) void run(k) }} onDoubleClick={() => void run(k)}>
                  {Number(k.slice(8))}{t && <em aria-hidden="true" />}
                </button>
              )
            })}
          </div>
        </div>

        <p className="cn-bump">{!pick || !land ? (quickCommit ? 'Set the time, then tap a day.' : 'Pick a day.')
          : land === pick ? <b>{dayLabel(land)} at {laneTimeWord(at(land), lane)}{lane === 'risedtc' ? ` (${warsawHm(at(land))} Warsaw)` : ''}</b>
          : <><b>{dayLabel(pick)} {taken.has(pick) ? 'already has a post' : 'is a weekend'}, so it lands on {dayLabel(land)}.</b></>}
        </p>
        <p className="cn-mv-say">{copy.message}</p>
        {err && <p className="cn-say cn-bad" role="alert">{err}</p>}
        <div className="cn-acts">
          <Key verb="cancel" onClick={onClose} disabled={busy}>Cancel</Key>
          <Key primary verb="move-day" onClick={() => { void run() }} disabled={!pick || busy || unchanged} sub={land ? `${dayLabel(land)} · ${laneTimeWord(at(land), lane)}` : 'pick a day'}>{busy ? 'Moving…' : copy.confirmText}</Key>
        </div>
      </div>
    </Sheet>
  )
}
