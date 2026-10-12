import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { fetchPlan, type PlanRead, type PlanWarning } from '../../../lib/contentPlan'
import { useMotionLevel } from '../../../ds/motionLevel'
import { dHash } from '../../route'
import { useFrameMaybe } from '../../shell/frame'
import { Count } from '../../ui/Count'
import { Failed, Skeleton } from '../../ui/states'
import { LANES, LANE_NAME, type Lane } from '../model'
import { Seg, SeatAv } from '../v2/ui'
import { BrainStrip, IdeaStockPopover } from './BrainStrip'
import { PlanList, useEntered } from './PlanList'
import { PlanPanel } from './PlanPanel'
import { PlanWeeks } from './PlanWeeks'
import { answerOf, itemsOf, lateRun, tzOf, upcoming, warningOf, type PlanItem } from './planBrain'
import './plan2.css'

// CONTENT > PLAN, Oxygen (spec 2026-10-12 §3, R2.1, R4; skin section `content.plan`). The head (seat switch,
// Weeks | List on the desktop, the planner line only when it is late), one answer line, the warnings with their
// fix links, then the plan. Read only: nothing here dates, moves or publishes a post.
// Weeks is the desktop default (PlanWeeks, with the hover card); List is the desktop option and the phone's only
// view. A card or "Why, in full" opens PlanPanel (the seven questions; its Move day is the tab's one write, and a
// move re-reads the plan with the panel kept open). Closing it puts focus back on the card that opened it.
// BrainStrip (Task 9) sits between the warnings and the view. A client seat's "Out of ideas" chip opens the idea stock
// popover under the warnings (Ivan keeps the text only: his ideas carry no topic).

type View = 'weeks' | 'list'
const VIEW_KEY = 'pl2-view'
const STAGGER_MS = 30
const STAGGER_CAP_MS = 400

function savedView(): View {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'weeks' } catch { return 'weeks' }
}

/** "Mon 12 Oct, 07:20 Warsaw" in the account's own zone. */
function ranAt(read: PlanRead): string {
  const t = Date.parse(read.last_run?.ran_at ?? '')
  if (Number.isNaN(t)) return ''
  const tz = tzOf(read)
  try {
    const d = new Date(t)
    const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz.name }).replace(',', '')
    const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz.name })
    return `${day}, ${hm} ${tz.label}`
  } catch { return '' }
}

/** A warning's fix link: Ideas, Lead magnets, or the failed draft in Review. No photo library page exists yet. */
function fixHref(sub: string, lane: Lane, items: PlanItem[]): string {
  if (sub === 'now') {
    const failed = items.find(i => i.st === 'failed' && i.draftId)
    return failed ? dHash('content', 'now', { draft: failed.draftId!, lane }) : dHash('content', 'now', { lane })
  }
  return dHash('content', sub, { lane })
}

type WarnRow = { w: PlanWarning; x: ReturnType<typeof warningOf> }

/** The warnings with their fix links. Keyed by account, so the entry fade plays once per seat. A client seat's "Out of ideas" text opens the idea stock. */
function Warnings({ rows, lane, items, still, stock, stockOpen, onStock }: { rows: WarnRow[]; lane: Lane; items: PlanItem[]; still: boolean; stock: boolean; stockOpen: boolean; onStock: (el: HTMLElement) => void }) {
  const entered = useEntered()
  return <ul className="pl2-warns" aria-label="Warnings" data-entered={entered || undefined}>
    {rows.map(({ w, x }, i) => <li key={`${w.code}:${i}`} className="pl2-warn" data-code={w.code}
      style={{ '--pl2-d': `${still ? 0 : Math.min(i * STAGGER_MS, STAGGER_CAP_MS)}ms` } as CSSProperties}>
      {stock && w.code === 'empty_topic_area'
        ? <button type="button" className="pl2-warn-b" data-verb="plan-stock" data-stock-trigger aria-haspopup="dialog" aria-expanded={stockOpen} onClick={e => onStock(e.currentTarget)}>{x.text}</button>
        : <span>{x.text}</span>}
      {x.link && <a href={fixHref(x.link.sub, lane, items)} data-verb={`plan-fix-${w.code}`}>{x.link.label}</a>}
    </li>)}
  </ul>
}

export function PlanV2({ lane, setLane }: { lane: Lane; setLane: (l: Lane) => void }) {
  const f = useFrameMaybe()
  const phone = f?.layout === 'phone'
  const level = useMotionLevel()
  const [read, setRead] = useState<PlanRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [view, setViewState] = useState<View>(savedView)
  const [open, setOpen] = useState<PlanItem | null>(null)
  const [now] = useState(() => new Date())
  const opener = useRef<string | null>(null)
  const [stockOpen, setStockOpen] = useState(false)
  const stockTrigger = useRef<HTMLElement | null>(null)
  const retry = useCallback(() => setTick(t => t + 1), [])
  const openItem = useCallback((it: PlanItem) => { opener.current = it.key; setOpen(it) }, [])
  const closePanel = useCallback(() => setOpen(null), [])
  const toggleStock = useCallback((el?: HTMLElement | null) => { stockTrigger.current = el ?? stockTrigger.current; setStockOpen(o => !o) }, [])
  const closeStock = useCallback(() => {
    const a = document.activeElement
    setStockOpen(false)
    if (!a || a === document.body || a.closest('.pl2-pop')) stockTrigger.current?.focus()
  }, [])
  const setView = useCallback((v: string) => {
    const next: View = v === 'list' ? 'list' : 'weeks'
    setViewState(next)
    try { localStorage.setItem(VIEW_KEY, next) } catch { /* private mode */ }
  }, [])
  // A seat switch closes the panel; a re-read (Retry, a move) keeps it open on the fresh data.
  useEffect(() => { setOpen(null); opener.current = null; setStockOpen(false); stockTrigger.current = null }, [lane])
  // The panel closed: focus goes back to the card (or row) that opened it. Its hover card stays shut (the hover
  // hook is quiet until the pointer moves or a Tab / arrow key moves on).
  useEffect(() => {
    if (open || !opener.current) return
    const k = opener.current
    opener.current = null
    const el = [...document.querySelectorAll<HTMLElement>('[data-plan-key]')].find(e => e.getAttribute('data-plan-key') === k)
    const target = el && (el.matches('button') ? el : el.querySelector<HTMLElement>('button'))
    target?.focus()
  }, [open])
  useEffect(() => {
    let live = true
    const c = new AbortController()
    setError(null)
    setRead(r => (r?.account === lane ? r : null))
    void fetchPlan(lane, c.signal)
      .then(r => { if (live && r.account === lane) setRead(r) })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'The plan could not load.') })
    return () => { live = false; c.abort() }
  }, [lane, tick])
  // A read from another seat never paints under this one.
  const r = read?.account === lane ? read : null
  const all = useMemo(() => (r ? itemsOf(r) : []), [r])
  const items = useMemo(() => (r ? upcoming(all, r.today) : []), [r, all])
  const answer = useMemo(() => (r ? answerOf(r) : null), [r])
  // The open item as the latest read has it (a move re-reads the plan); the clicked copy if it left the plan.
  const shown = useMemo(() => (open ? all.find(i => i.key === open.key) ?? open : null), [open, all])
  const hasStock = !!(r && Array.isArray(r.brain_strip?.idea_stock) && r.brain_strip!.idea_stock.length)
  const warnings = useMemo(() => (r ? (Array.isArray(r.warnings) ? r.warnings : []).map(w => ({ w, x: warningOf(w) })).filter(v => v.x.text) : []), [r])

  const seats = <Seg label="Account" value={lane} onChange={id => setLane(id as Lane)} verb="plan-seat"
    options={LANES.map(l => ({ id: l, label: <><SeatAv lane={l} />{LANE_NAME[l]}</> }))} />
  const late = r && lateRun(r, now) ? (ranAt(r) ? `The planner has not run since ${ranAt(r)}.` : 'The planner has not run yet.') : null

  // Weeks gets every item of the three weeks (past days of this week keep their posts); List starts from today.
  const body = !r ? null
    : view === 'weeks' && !phone ? <PlanWeeks key={`weeks:${r.account}`} read={r} items={all} today={r.today} onOpen={openItem} hover={!open} />
      : <PlanList key={`list:${r.account}`} read={r} items={items} phone={phone} onOpen={openItem} />

  return <div className={`cv2 pl2${phone ? ' pl2-phone' : ''}`} data-motion={level} data-open={open?.key}>
    <div className="pl2-head">
      {seats}
      {!phone && <Seg label="View" size="sm" value={view} onChange={setView} verb="plan-view" options={[{ id: 'weeks', label: 'Weeks' }, { id: 'list', label: 'List' }]} />}
      {late && <span className="pl2-late">{late}</span>}
    </div>
    {error ? <Failed what="the plan" detail={error} onRetry={retry} />
      : !r || !answer ? <Skeleton lines={6} label="Reading the plan" />
        : <>
          <div className="pl2-ans">
            <h2 aria-label={answer.title}>
              {answer.need > 0
                ? <><span className="pl2-need"><Count value={answer.need} /></span> {answer.need > 1 ? 'posts wait' : 'post waits'} for your OK</>
                : answer.title}
            </h2>
            {answer.parts.length > 0 && <p className="pl2-parts">{answer.parts.join(' · ')}</p>}
          </div>
          {(warnings.length > 0 || stockOpen) && <div className="pl2-warnw">
            {warnings.length > 0 && <Warnings key={`warn:${r.account}`} rows={warnings} lane={lane} items={all} still={level === 'off'}
              stock={lane !== 'ivan' && hasStock} stockOpen={stockOpen} onStock={toggleStock} />}
            {stockOpen && <IdeaStockPopover strip={r.brain_strip} onClose={closeStock} />}
          </div>}
          <BrainStrip key={`strip:${r.account}`} strip={r.brain_strip} acct={lane} today={r.today} onIdeaStock={() => toggleStock(null)} onChanged={retry} />
          {body}
          {shown && <PlanPanel key={shown.key} item={shown} read={r} lane={lane} onClose={closePanel} onChanged={retry} />}
        </>}
  </div>
}
