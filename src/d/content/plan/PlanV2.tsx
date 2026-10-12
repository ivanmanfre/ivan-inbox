import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { fetchPlan, type PlanRead, type PlanWarning } from '../../../lib/contentPlan'
import { useMotionLevel } from '../../../ds/motionLevel'
import { dHash } from '../../route'
import { useFrameMaybe } from '../../shell/frame'
import { Count } from '../../ui/Count'
import { Failed, Skeleton } from '../../ui/states'
import { LANES, LANE_NAME, type Lane } from '../model'
import { Seg, SeatAv } from '../v2/ui'
import { PlanList, useEntered } from './PlanList'
import { PlanWeeks } from './PlanWeeks'
import { answerOf, itemsOf, lateRun, tzOf, upcoming, warningOf, type PlanItem } from './planBrain'
import './plan2.css'

// CONTENT > PLAN, Oxygen (spec 2026-10-12 §3, R2.1, R4; skin section `content.plan`). The head (seat switch,
// Weeks | List on the desktop, the planner line only when it is late), one answer line, the warnings with their
// fix links, then the plan. Read only: nothing here dates, moves or publishes a post.
// Weeks is the desktop default (PlanWeeks, with the hover card); List is the desktop option and the phone's only
// view. Slots for the later parts: PlanPanel (Task 8) opens on `open`, BrainStrip (Task 9) sits between the
// warnings and the view.

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

/** The warnings with their fix links. Keyed by account, so the entry fade plays once per seat. */
function Warnings({ rows, lane, items, still }: { rows: WarnRow[]; lane: Lane; items: PlanItem[]; still: boolean }) {
  const entered = useEntered()
  return <ul className="pl2-warns" aria-label="Warnings" data-entered={entered || undefined}>
    {rows.map(({ w, x }, i) => <li key={`${w.code}:${i}`} className="pl2-warn" data-code={w.code}
      style={{ '--pl2-d': `${still ? 0 : Math.min(i * STAGGER_MS, STAGGER_CAP_MS)}ms` } as CSSProperties}>
      <span>{x.text}</span>
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
  const retry = useCallback(() => setTick(t => t + 1), [])
  const setView = useCallback((v: string) => {
    const next: View = v === 'list' ? 'list' : 'weeks'
    setViewState(next)
    try { localStorage.setItem(VIEW_KEY, next) } catch { /* private mode */ }
  }, [])
  useEffect(() => {
    let live = true
    const c = new AbortController()
    setError(null)
    setOpen(null)
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
  const warnings = useMemo(() => (r ? (Array.isArray(r.warnings) ? r.warnings : []).map(w => ({ w, x: warningOf(w) })).filter(v => v.x.text) : []), [r])

  const seats = <Seg label="Account" value={lane} onChange={id => setLane(id as Lane)} verb="plan-seat"
    options={LANES.map(l => ({ id: l, label: <><SeatAv lane={l} />{LANE_NAME[l]}</> }))} />
  const late = r && lateRun(r, now) ? (ranAt(r) ? `The planner has not run since ${ranAt(r)}.` : 'The planner has not run yet.') : null

  // Weeks gets every item of the three weeks (past days of this week keep their posts); List starts from today.
  const body = !r ? null
    : view === 'weeks' && !phone ? <PlanWeeks key={`weeks:${r.account}`} read={r} items={all} today={r.today} onOpen={setOpen} hover={!open} />
      : <PlanList key={`list:${r.account}`} read={r} items={items} phone={phone} onOpen={setOpen} />

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
          {warnings.length > 0 && <Warnings key={`warn:${r.account}`} rows={warnings} lane={lane} items={all} still={level === 'off'} />}
          {/* Slot (Task 9): <BrainStrip strip={r.brain_strip} acct={lane} /> */}
          {body}
          {/* Slot (Task 8): {open && <PlanPanel it={open} read={r} onClose={() => setOpen(null)} />} */}
        </>}
  </div>
}
