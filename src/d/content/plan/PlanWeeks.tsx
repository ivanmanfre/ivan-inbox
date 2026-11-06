import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { setScheduleDateAt } from '../../../lib/content'
import { moveSlotWeek, planDay, type BrainStrip, type PlanRead, type PlanWeek } from '../../../lib/contentPlan'
import { useToast } from '../../ui/toast'
import { useCalGestures } from '../calGestures'
import { dayIn, hmIn } from '../laneTime'
import { useMotionLevel } from '../../../ds/motionLevel'
import { useFrameMaybe } from '../../shell/frame'
import { FlagChip, useEntered, usePulsed } from './PlanList'
import { PlanHoverCard } from './PlanHoverCard'
import { dropLabel, dropPlan, moveError, refuseWhy } from './planDrag'
import { ACCT_NAME, ST_WORD, flagsFor, mixLine, reasonFor, timeLabel, tzOf, weekDays, type Acct, type PlanItem, type Tz } from './planBrain'
import { thumbUrl } from './thumbs'
import { useHoverIntent } from './useHoverIntent'
import type { ContentDraft } from '../../../lib/content'
import type { PolandRead } from '../../../lib/poland'
import { zonedToUtc } from '../laneTime'
import { hmText, spacedFrom, type SlotHm } from '../model'
import { slotWords, type Reserved } from '../weekVerbs'
import { warsawDay } from '../../ui/time'
import { POLAND_TARGET, mixWords, weekMix } from './poland'

// PLAN > WEEKS (spec 2026-10-12 §3a, R2.1, R2.2, R3.5; mock v3 `weeks()`). Three week rows, Mon to Fri plus a
// weekend day only when a post sits there. The header carries the name, the range, the fill meter, n of target
// and the week's mix. Today has an ink ring and a red "Today"; past days lose their background; "Free" wells only
// for the week's real open days, on future weekdays. Desktop only: the phone always shows the List.
// A post still waiting for OK from a day before today is never dropped: it leaves its own past column and sits at
// the top of today's column, headed "Waiting since <day>". The meter and the mix count what each row draws.
// DRAG (Ivan 2026-11-04): a card drags to another day with the Calendar's pointer engine (calGestures). A post
// keeps its time of day; a planned slot moves to the dropped day's week (planDrag). The card lands at once, the
// plan re-reads, and the receipt has Undo. Today and later days take a drop; past days do not.

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
  refuse: string | null; describedBy?: string; bind: ReturnType<ReturnType<typeof useHoverIntent>['bind']>; onOpen: (it: PlanItem) => void
}

function Card({ it, acct, tz, strip, late, refuse, describedBy, bind, onOpen }: CardProps) {
  // 0: the resized copy, 1: the original after the resized one failed, 2: no picture (the reason line shows).
  const [miss, setMiss] = useState(0)
  const orig = it.brain?.thumb || null
  const small = thumbUrl(orig)
  const thumb = !orig || miss >= 2 ? null : miss === 1 ? orig : small
  const reason = thumb ? null : reasonFor(it, acct)
  const flags = flagsFor(it, strip, acct)
  // A waiting card moved to today already says its day in its header; "No day yet" would contradict it.
  const time = it.suggested ? (late ? '' : 'Suggested day') : timeLabel(it, tz)
  return <button type="button" className={`pl2-card pl2-s-${it.st}${it.suggested ? ' pl2-sugg' : ''}${late ? ' pl2-card-late' : ''}`}
    data-plan-key={it.key} data-verb="plan-card" data-cal-id={it.key} data-cal-lane={acct} data-cal-refuse={refuse ?? undefined} aria-describedby={describedBy} onClick={() => onOpen(it)} {...bind}>
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

/** Ivan's seat: the Poland split per week and the Poland drafts a short week can take (review 2026-11-06 #31). */
export type PolandMeter = {
  /** null: still reading. */
  reads: ReadonlyMap<string, PolandRead> | null
  failed: boolean
  /** Best first (polandPicks). */
  picks: readonly ContentDraft[]
  hm: SlotHm
  /** Held "Approve + schedule" taps (weekVerbs): their slots are taken and a held Poland one counts. */
  reserved: ReadonlyMap<string, Reserved>
  /** One tap: approve and schedule the draft at that instant (held for Undo). */
  onTake: (r: ContentDraft, at: Date) => void
}

/** The dashed card in a short week's free day: the best Poland draft waiting in Review, one tap to approve it there. */
function PolandGap({ r, at, onTake }: { r: ContentDraft; at: Date; onTake: (r: ContentDraft, at: Date) => void }) {
  const title = (r.title ?? '').replace(/^\[[^\]]*\]\s*/, '').trim() || (r.post_body ?? '').split('\n').find(l => l.trim())?.trim() || 'Untitled post'
  return <div className="pl2-gap" data-gap-draft={r.id}>
    <span className="pl2-gap-l">Poland · waiting in Review</span>
    <span className="pl2-gap-t">{title}</span>
    <button type="button" className="pl2-gap-k" data-verb="plan-poland-take" onClick={() => onTake(r, at)}>Approve + schedule {slotWords(at).replace(/^\w+ \d+ \w+ · /, '')}</button>
  </div>
}

/** `hover` false (the panel is open) keeps the hover card shut; it stays shut on the card focus returns to after. */
export function PlanWeeks({ read, items: given, today, onOpen, onChanged, hover = true, poland = null }: { read: PlanRead; items: PlanItem[]; today: string; onOpen: (it: PlanItem) => void; onChanged?: () => void; hover?: boolean; poland?: PolandMeter | null }) {
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
  const toast = useToast()
  const root = useRef<HTMLDivElement>(null)
  // A dropped card sits where it was dropped until the re-read lands (key -> day, or week for a planned slot).
  const [moved, setMoved] = useState<Map<string, { day: string | null; week: string }>>(() => new Map())
  useEffect(() => { setMoved(new Map()) }, [read])
  const items = useMemo(() => (moved.size ? given.map(i => { const m = moved.get(i.key); return m ? { ...i, ...m } : i }) : given), [given, moved])
  const byKey = useMemo(() => new Map(items.map(i => [i.key, i])), [items])
  const reread = () => onChanged?.()

  const drop = async (key: string, day: string) => {
    const it = byKey.get(key)
    if (!it) return
    const p = dropPlan(it, acct, tz, day, today)
    if (p.kind === 'none') { if (p.why) toast.show({ id: 'pl2-drop', message: p.why }); return }
    const hold = (v: { day: string | null; week: string } | null) => setMoved(m => { const n = new Map(m); if (v) n.set(key, v); else n.delete(key); return n })
    if (p.kind === 'post') {
      const landed = dayIn(p.when, tz.name)
      hold({ day: landed, week: it.week })
      try {
        const stored = await setScheduleDateAt(p.draftId, p.when)
        const at = `${planDay(dayIn(stored, tz.name))} · ${hmIn(stored, tz.name)} ${tz.label}`
        toast.show({
          id: 'pl2-drop', message: `Moved to ${at}.`,
          sub: dayIn(stored, tz.name) !== landed ? 'The database stored a different day.' : hmIn(p.when, tz.name) !== hmIn(p.prev, tz.name) ? 'Its time already went by today, so it posts in an hour.' : ACCT_NAME[acct],
          action: {
            label: 'Undo', verb: 'plan-drag-undo', run: () => {
              void setScheduleDateAt(p.draftId, p.prev)
                .then(() => toast.show({ id: 'pl2-drop', message: `Put back on ${planDay(dayIn(p.prev, tz.name))} · ${hmIn(p.prev, tz.name)} ${tz.label}.`, sub: ACCT_NAME[acct] }))
                .catch(e => toast.show({ id: 'pl2-drop', message: moveError(e), tone: 'failed' }))
                .finally(reread)
            },
          },
        })
        reread()
      } catch (e) {
        hold(null)
        toast.show({ id: 'pl2-drop', message: moveError(e), tone: 'failed' })
      }
      return
    }
    hold({ day: null, week: p.week })
    try {
      const r = await moveSlotWeek(p.slotId, p.week)
      const back = r.from_week || p.from
      toast.show({
        id: 'pl2-drop', message: `Moved to the week of ${planDay(r.to_week || p.week).replace(/^\w+ /, '')}.`, sub: 'It gets its day when you approve it.',
        action: {
          label: 'Undo', verb: 'plan-drag-undo', run: () => {
            void moveSlotWeek(p.slotId, back)
              .then(() => toast.show({ id: 'pl2-drop', message: `Put back in the week of ${planDay(back).replace(/^\w+ /, '')}.`, sub: ACCT_NAME[acct] }))
              .catch(e => toast.show({ id: 'pl2-drop', message: moveError(e), tone: 'failed' }))
              .finally(reread)
          },
        },
      })
      reread()
    } catch (e) {
      hold(null)
      toast.show({ id: 'pl2-drop', message: moveError(e), tone: 'failed' })
    }
  }

  useCalGestures(root, {
    reducedMotion: level === 'off',
    labelFor: (key, _lane, day) => { const it = byKey.get(key); return it ? dropLabel(it, acct, tz, day, today) : null },
    onDrop: (key, _lane, day) => { void drop(key, day) },
    onRefuse: why => toast.show({ id: 'pl2-drop', message: why }),
    onMiss: () => toast.show({ id: 'pl2-drop', message: 'Not moved. Let go over today or a later day.' }),
    onSwipeMove: () => {},
    onSwipeEnd: () => {},
    onEdgePage: () => {},
  })
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
  const card = (it: PlanItem, late?: string) => <Card key={it.key} it={it} acct={acct} tz={tz} strip={strip} late={late} refuse={refuseWhy(it, acct)}
    describedBy={hc.open === it.key && hoverItem ? hcId : undefined} bind={hc.bind(it.key)} onOpen={open} />

  // Each short week takes its own pick, best first, so one draft is never offered twice. Held picks are not offered.
  const left = poland ? poland.picks.filter(p => !poland.reserved.has(p.id)) : []
  // Every dated instant the gap must keep 24 h from (the database's spacing rule): the plan's posts and held slots.
  const busy = poland ? [...items.map(i => i.at).filter((x): x is string => !!x), ...[...poland.reserved.values()].map(r => r.at)] : []
  const heldDays = new Set(poland ? [...poland.reserved.values()].map(r => warsawDay(r.at)) : [])

  return <div ref={root} className="pl2-wks" data-entered={entered || undefined} data-pulsed={pulsed || undefined}>
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
      const pm0 = poland?.reads ? weekMix(drawn, poland.reads, target) : null
      // A held Poland tap in this week already counts (its card is not on the plan until the re-read).
      const drawnIds = new Set(drawn.map(i => i.draftId))
      const heldPoland = poland ? [...poland.reserved.entries()].filter(([id, r]) => r.poland && !drawnIds.has(id) && warsawDay(r.at) >= w.start && warsawDay(r.at) <= end).length : 0
      const pm = pm0 ? { ...pm0, poland: pm0.poland + heldPoland } : null
      let gapsWanted = pm ? Math.max(0, POLAND_TARGET - pm.poland) : 0
      return <section key={w.start} className="pl2-wk" aria-label={NAME[w.which] ?? 'Week'}>
        <div className="pl2-wk-h">
          <b>{NAME[w.which] ?? 'Week'}</b>
          <span className="pl2-wk-range">{dm(w.start)} to {dm(addDays(w.start, days[days.length - 1]))}</span>
          <span className="pl2-meter" aria-hidden="true">
            {Array.from({ length: Math.max(target, count) }, (_, k) => <i key={k} className={k < count ? 'pl2-on' : undefined}
              style={{ '--pl2-d': `${level === 'off' ? 0 : Math.min((seg0 + k) * STAGGER_MS, STAGGER_CAP_MS)}ms` } as CSSProperties} />)}
          </span>
          <span className="pl2-wk-n">{count > target ? `${count} posts, plan says ${target}` : `${count} of ${target}`}</span>
          {mix && <span className="pl2-wk-mix">{mix}</span>}
          {poland && <span className={`pl2-wk-pol${pm && pm.poland < POLAND_TARGET ? ' pl2-wk-short' : ''}`} data-poland={pm ? pm.poland : undefined}>
            {pm ? mixWords(pm) : poland.failed ? 'Poland split could not be read' : 'Reading the Poland split…'}</span>}
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
            // A free day in a week short of Poland posts holds the best waiting Poland draft, at the seat's own time.
            const candAt = well && poland ? Date.parse(zonedToUtc(day, hmText(poland.hm), 'Europe/Warsaw')) : NaN
            const fits = Number.isFinite(candAt) && !heldDays.has(day) && spacedFrom(busy, candAt)
            const gap = fits && gapsWanted > 0 && left.length ? left.shift()! : null
            if (gap) gapsWanted--
            const gapAt = gap ? new Date(candAt) : null
            return <div key={day} className={`pl2-dcol${past ? ' pl2-past' : ''}${isToday ? ' pl2-today' : ''}`} data-day={day} data-cal-day={past ? undefined : day}
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
              {gap && gapAt ? <PolandGap r={gap} at={gapAt} onTake={poland!.onTake} /> : well && <div className="pl2-free">Free</div>}
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
