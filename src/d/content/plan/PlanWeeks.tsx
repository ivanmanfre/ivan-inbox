import { useCallback, useId, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { planDay, type BrainStrip, type PlanRead, type PlanWeek } from '../../../lib/contentPlan'
import { useMotionLevel } from '../../../ds/motionLevel'
import { useFrameMaybe } from '../../shell/frame'
import { FlagChip, useEntered, usePulsed } from './PlanList'
import { PlanHoverCard } from './PlanHoverCard'
import { ST_WORD, flagsFor, mixLine, reasonFor, timeLabel, tzOf, weekDays, type Acct, type PlanItem, type Tz } from './planBrain'
import { thumbUrl } from './thumbs'
import { useHoverIntent } from './useHoverIntent'

// PLAN > WEEKS (spec 2026-10-12 §3a, R2.1, R2.2, R3.5; mock v3 `weeks()`). Three week rows, Mon to Fri plus a
// weekend day only when a post sits there. The header carries the name, the range, the fill meter, n of target
// and the week's mix. Today has an ink ring and a red "Today"; past days lose their background; "Free" wells only
// for the week's real open days, on future weekdays. Desktop only: the phone always shows the List.
// A post still waiting for OK from a day before today is never dropped: it leaves its own past column and sits at
// the top of today's column, headed "Waiting since <day>". The meter and the mix count what each row draws.

const STAGGER_MS = 30
const STAGGER_CAP_MS = 400
const NAME: Record<PlanWeek['which'], string> = { this: 'This week', next: 'Next week', after: 'Week after' }

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
/** "12 Oct" */
const dm = (iso: string) => planDay(iso).replace(/^\w+ /, '')
const dayName = (iso: string) => planDay(iso).split(' ')[0]
const dayNum = (iso: string) => String(Number(iso.slice(8, 10)))

const HOVER_MQ = '(hover: hover)'
function subscribeHover(f: () => void) {
  const mq = typeof window !== 'undefined' ? window.matchMedia?.(HOVER_MQ) : undefined
  mq?.addEventListener?.('change', f)
  return () => mq?.removeEventListener?.('change', f)
}
const readHover = () => typeof window !== 'undefined' && !!window.matchMedia?.(HOVER_MQ)?.matches

type CardProps = {
  it: PlanItem; acct: Acct; tz: Tz; strip: BrainStrip | null; late?: string
  describedBy?: string; bind: ReturnType<ReturnType<typeof useHoverIntent>['bind']>; onOpen: (it: PlanItem) => void
}

function Card({ it, acct, tz, strip, late, describedBy, bind, onOpen }: CardProps) {
  // 0: the resized copy, 1: the original after the resized one failed, 2: no picture (the reason line shows).
  const [miss, setMiss] = useState(0)
  const orig = it.brain?.thumb || null
  const small = thumbUrl(orig)
  const thumb = !orig || miss >= 2 ? null : miss === 1 ? orig : small
  const reason = thumb ? null : reasonFor(it, acct)
  const flags = flagsFor(it, strip, acct)
  // A waiting card moved to today already says its day in its header; "No day yet" would contradict it.
  const time = it.suggested ? (late ? '' : 'No day yet') : timeLabel(it, tz)
  return <button type="button" className={`pl2-card pl2-s-${it.st}${it.suggested ? ' pl2-sugg' : ''}${late ? ' pl2-card-late' : ''}`}
    data-plan-key={it.key} data-verb="plan-card" aria-describedby={describedBy} onClick={() => onOpen(it)} {...bind}>
    {late && <span className="pl2-late-l">{late}</span>}
    <span className="pl2-cr">
      <span className="pl2-st"><i className="pl2-dot" aria-hidden="true" />{ST_WORD[it.st]}</span>
      {time && <span className="pl2-time">{time}</span>}
    </span>
    {thumb && <img className="pl2-thumb" src={thumb} alt="" loading="lazy" decoding="async" onError={() => setMiss(m => (m === 0 && small !== orig ? 1 : 2))} />}
    <span className="pl2-ct">{it.title || 'Untitled post'}</span>
    {reason && <span className="pl2-why1">{reason}</span>}
    {flags.length > 0 && <span className="pl2-flags">{flags.map(f => <FlagChip key={f.key} f={f} compact />)}</span>}
  </button>
}

/** `hover` false (the panel is open) keeps the hover card shut; it stays shut on the card focus returns to after. */
export function PlanWeeks({ read, items, today, onOpen, hover = true }: { read: PlanRead; items: PlanItem[]; today: string; onOpen: (it: PlanItem) => void; hover?: boolean }) {
  const f = useFrameMaybe()
  const hoverable = useSyncExternalStore(subscribeHover, readHover, () => false)
  const level = useMotionLevel()
  const entered = useEntered()
  const pulsed = usePulsed()
  const hc = useHoverIntent(hover && f?.layout !== 'phone' && hoverable)
  const hcId = useId()
  const close = hc.close
  const open = useCallback((it: PlanItem) => { close(); onOpen(it) }, [close, onOpen])

  const acct = read.account as Acct
  const tz = tzOf(read)
  const strip = read.brain_strip ?? null
  const xDays = useMemo(() => new Set(Array.isArray(read.x_days) ? read.x_days : []), [read.x_days])
  const weeks = useMemo(() => (Array.isArray(read.weeks) ? read.weeks : []), [read.weeks])
  // Waiting for OK from a day before today: drawn once, at the top of today's column (the week holding today, else
  // the first week's first column), never in their own past column.
  const overdue = useMemo(() => items.filter(i => i.day != null && i.day < today && i.st === 'review'), [items, today])
  const lateKeys = useMemo(() => new Set(overdue.map(i => i.key)), [overdue])
  const idxOf = (start: string) => Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000)
  const todayWeek = Math.max(0, weeks.findIndex(w => { const k = idxOf(w.start); return k >= 0 && k <= 6 }))
  const hoverItem = hc.open ? items.find(i => i.key === hc.open) ?? null : null

  let n = 0
  const delay = () => (level === 'off' ? 0 : Math.min(n++ * STAGGER_MS, STAGGER_CAP_MS))
  const card = (it: PlanItem, late?: string) => <Card key={it.key} it={it} acct={acct} tz={tz} strip={strip} late={late}
    describedBy={hc.open === it.key && hoverItem ? hcId : undefined} bind={hc.bind(it.key)} onOpen={open} />

  return <div className="pl2-wks" data-entered={entered || undefined} data-pulsed={pulsed || undefined}>
    {weeks.map((w, wi) => {
      const end = addDays(w.start, 6)
      const inWeek = items.filter(i => i.day != null && i.day >= w.start && i.day <= end && !lateKeys.has(i.key))
      const undated = items.filter(i => i.week === w.start && i.day == null)
      const days = weekDays(w, inWeek)
      const late = wi === todayWeek ? overdue : []
      const todayIdx = idxOf(w.start)
      if (late.length && todayIdx >= 0 && todayIdx <= 6 && !days.includes(todayIdx)) { days.push(todayIdx); days.sort((a, b) => a - b) }
      const lateDay = late.length ? (todayIdx >= 0 && todayIdx <= 6 ? addDays(w.start, todayIdx) : addDays(w.start, days[0])) : null
      // What this row draws: its dated cards, the waiting ones moved to today, its undated ones.
      const drawn = [...late, ...inWeek, ...undated]
      const count = drawn.length
      const target = Number.isFinite(w.target) ? w.target : 0
      const mix = mixLine(drawn)
      const seg0 = wi * 5
      let free = Number.isFinite(w.open) ? Math.max(0, w.open) : 0
      return <section key={w.start} className="pl2-wk" aria-label={NAME[w.which] ?? 'Week'}>
        <div className="pl2-wk-h">
          <b>{NAME[w.which] ?? 'Week'}</b>
          <span className="pl2-wk-range">{dm(w.start)} to {dm(addDays(w.start, days[days.length - 1]))}</span>
          <span className="pl2-meter" aria-hidden="true">
            {Array.from({ length: Math.max(target, count) }, (_, k) => <i key={k} className={k < count ? 'pl2-on' : undefined}
              style={{ '--pl2-d': `${level === 'off' ? 0 : Math.min((seg0 + k) * STAGGER_MS, STAGGER_CAP_MS)}ms` } as CSSProperties} />)}
          </span>
          <span className="pl2-wk-n">{count} of {target}</span>
          {mix && <span className="pl2-wk-mix">{mix}</span>}
        </div>
        <div className="pl2-grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map(d => {
            const day = addDays(w.start, d)
            const past = day < today
            const isToday = day === today
            const cards = inWeek.filter(i => i.day === day)
            const lateHere = day === lateDay ? late : []
            const well = !past && !isToday && d < 5 && !cards.length && !lateHere.length && free > 0
            if (well) free--
            return <div key={day} className={`pl2-dcol${past ? ' pl2-past' : ''}${isToday ? ' pl2-today' : ''}`} data-day={day}
              style={{ '--pl2-d': `${delay()}ms` } as CSSProperties}>
              <div className="pl2-dh">
                <span>{dayName(day)}{isToday && <> · <em>Today</em></>}</span>
                {xDays.has(day) && <span className="pl2-x" role="img" title="An X post goes out this day" aria-label="An X post goes out this day">X</span>}
                <b>{dayNum(day)}</b>
              </div>
              {(cards.length > 0 || lateHere.length > 0) && <div className="pl2-cards">
                {lateHere.map(it => card(it, `Waiting since ${planDay(it.day!)}`))}
                {cards.map(it => card(it))}
              </div>}
              {well && <div className="pl2-free">Free</div>}
            </div>
          })}
        </div>
        {undated.length > 0 && <div className="pl2-wk-nd">
          <span className="pl2-wk-nd-l">No day yet</span>
          <div className="pl2-cards">{undated.map(it => card(it))}</div>
        </div>}
      </section>
    })}
    {hoverItem && hc.anchor && <PlanHoverCard key={hoverItem.key} id={hcId} item={hoverItem} anchor={hc.anchor} read={read} onClose={close} />}
  </div>
}
