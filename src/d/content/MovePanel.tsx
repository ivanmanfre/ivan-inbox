import { useEffect, useMemo, useState } from 'react'
import { ClientRpcError, setScheduleDateAt, type ContentDraft } from '../../lib/content'
import { publishAtForDay } from '../../lib/calendarItems'
import { moveConfirmCopy } from '../../wb/content/moveConfirm'
import { Key } from '../ui/Key'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/toast'
import { warsawDay, warsawDayTime, warsawHm } from '../ui/time'
import { FEED, LANE_NAME, dayLabel, isScheduled, landingDay, pickDays, titleOf, type Lane } from './model'

// MOVE TO ANOTHER DAY. The same write as today's calendar drag
// (operator_set_schedule_date via setScheduleDateAt): the day changes, the
// time of day is kept (publishAtForDay), and the database bumps a weekend or a
// taken day to the next free weekday. The panel IS the confirm and says the
// consequence in today's words (moveConfirmCopy); the receipt names the day the
// database stored, never the day we asked for.
export function MovePanel({ r, lane, first, seatRows, phone, onClose, onDone, onLand, initialPick }: {
  r: ContentDraft; lane: Lane; first: string; seatRows: ContentDraft[]; phone: boolean
  onClose: () => void; onDone: () => void; onLand?: (key: string | null) => void
  /** A day dropped on (drag) or asked for; any date, not only the fourteen shown. */
  initialPick?: string | null
}) {
  const toast = useToast()
  const [pick, setPick] = useState<string | null>(initialPick ?? null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const days = useMemo(() => pickDays(first), [first])
  const taken = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of seatRows) if (x.id !== r.id && x.scheduled_at && isScheduled(x, lane)) m.set(warsawDay(x.scheduled_at), titleOf(x))
    return m
  }, [lane, r.id, seatRows])
  const from = r.scheduled_at ? warsawDay(r.scheduled_at) : null
  const title = r.scheduled_at ? 'Move to another day' : 'Give it a date'
  const time = r.scheduled_at ? warsawHm(r.scheduled_at) : '09:00'
  const land = pick ? landingDay(pick, new Set(taken.keys())) : null
  useEffect(() => { onLand?.(land) }, [land, onLand])
  const copy = moveConfirmCopy(r, land ? dayLabel(land) : 'the day you pick', time)

  const run = async () => {
    if (!pick || busy) return
    setBusy(true); setErr('')
    try {
      const stored = await setScheduleDateAt(r.id, publishAtForDay(r.scheduled_at, pick))
      toast.show({ message: `Moved to ${warsawDayTime(stored)} Warsaw.`, sub: 'That is the day the database stored.' })
      onDone(); onClose()
    } catch (e) {
      setErr(e instanceof ClientRpcError || e instanceof Error ? e.message : 'Could not move it.')
    } finally { setBusy(false) }
  }

  const picker = (
    <>
    <div className="cn-pick" role="listbox" aria-label="Pick a day">
      {days.map(d => {
        const cls = [d.weekend ? 'cn-we' : '', d.key === from ? 'cn-from' : '', pick === d.key && land !== d.key ? 'cn-aim' : '', land === d.key ? 'cn-land' : ''].filter(Boolean).join(' ')
        return (
          <button key={d.key} type="button" role="option" aria-selected={pick === d.key} className={cls} onClick={() => setPick(d.key)}>
            <small>{d.dow}</small><b>{d.n}</b>
            <span>{d.key === from ? 'this post' : taken.get(d.key) ?? (d.weekend ? 'weekend' : '')}</span>
          </button>
        )
      })}
    </div>
    <label className="cn-any">
      <span>Any other date</span>
      <input type="date" data-verb="pick-date" value={pick ?? ''} onChange={e => setPick(e.target.value || null)} />
    </label>
    </>
  )
  const bump = pick && land ? (
    <p className="cn-bump">{land === pick
      ? <b>Lands on {dayLabel(land)}.</b>
      : <><b>{dayLabel(pick)} {taken.has(pick) ? 'already has a post' : 'is a weekend'}, so it lands on {dayLabel(land)}.</b> A weekend moves to the Monday after.</>}
    </p>
  ) : <p className="cn-bump">Pick a day. Its time of day, {time} Warsaw, is kept.</p>
  const keys = (
    <>
      <Key verb="cancel" onClick={onClose} disabled={busy}>Cancel</Key>
      <Key primary verb="move-day" onClick={run} disabled={!pick || busy} sub={land ? `${dayLabel(land)} · ${time}` : 'pick a day'}>{busy ? 'Moving…' : copy.confirmText}</Key>
    </>
  )

  if (phone) {
    return (
      <Sheet open onClose={onClose} title={title} sub={`${titleOf(r)} · ${LANE_NAME[lane]} · ${FEED[lane]} · ${time} kept`}>
        {picker}{bump}
        <p className="cn-bump">{copy.message}</p>
        {err && <p className="cn-say cn-bad" role="alert">{err}</p>}
        <div className="cn-acts">{keys}</div>
      </Sheet>
    )
  }
  return (
    <section className="cn-move" aria-label={title}>
      <div>
        <small className="cn-cap">{r.scheduled_at ? 'Moving' : 'Dating'}, {FEED[lane]}</small>
        <div className="cn-card cn-inert" style={{ height: 'auto' }}>
          <span className="cn-im cn-txt"><span>{(r.post_body ?? '').slice(0, 90)}</span></span>
          <b>{titleOf(r)}</b><small>{r.scheduled_at ? `${dayLabel(warsawDay(r.scheduled_at))} · ${time}` : 'no date yet'}</small>
        </div>
      </div>
      <div>
        <small className="cn-cap">Pick a day · {LANE_NAME[lane]} · its time of day, {time} Warsaw, is kept</small>
        {picker}{bump}
      </div>
      <div>
        <h3>{copy.title}</h3>
        <p>{copy.message}</p>
        {err && <p className="cn-say cn-bad" role="alert">{err}</p>}
        <div className="cn-acts" style={{ padding: '10px 0 6px' }}>{keys}</div>
        <p className="cn-foot" style={{ padding: 0 }}>The receipt names the day the database stored.</p>
      </div>
    </section>
  )
}
