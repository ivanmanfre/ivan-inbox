import { ClaudeWorking } from '../claude/Island'
import { PLACES } from '../places'
import { dHash } from '../route'
import { DIcon } from '../ui/icons'
import { SEATS, SEAT_NAME, type Seat } from '../seats'
import { useClock } from '../ui/useClock'
import { warsawDayTime } from '../ui/time'
import { useFrame } from './frame'
import { useNavModel, type NavItem } from './navModel'
import { openWorkflows, workflowsBadge } from './Workflows'
import { healthNote } from '../counts/glance'
import { useFrameCounts } from '../counts/useFrameCounts'
import { useDInbox } from '../counts/inbox'

// The left panel, desktop, and the same content as the phone's drawer. Brand,
// the seat initials once (I R A), one line per place with its per-seat numbers
// on the right, the low nav, and the me/clock footer (it speaks only when a
// read failed).

/** Under a place: only a failed read, said once. The numbers sit on the place's own line (NavCount). */
export function NavLineView({ item }: { item: NavItem }) {
  return item.failed > 0 ? <div className="d-navfail">{item.failed} failed</div> : null
}

/** On the place's line, right side: one number per seat under the I R A header (never a total), or a short text. */
export function NavCount({ item }: { item: NavItem }) {
  const l = item.line
  if (!l) return null
  if (l.kind === 'text') return <span className="d-nct" title={l.label}>{l.text}</span>
  const cell = (s: Seat) => {
    const n = l.numbers[s]
    return l.failed[s] && n == null ? { t: '?', c: 'd-unk', a: 'could not read' } : n == null ? { t: '…', c: 'd-wait', a: 'reading' } : { t: String(n), c: n > 0 ? 'd-hot' : '', a: String(n) }
  }
  return (
    <span className="d-nc" aria-label={`${l.label}: ${SEATS.map(s => `${SEAT_NAME[s]} ${cell(s).a}`).join(', ')}`}>
      {SEATS.map(s => { const c = cell(s); return <i key={s} className={c.c} title={c.c === 'd-unk' ? 'Could not read this count' : undefined}>{c.t}</i> })}
    </span>
  )
}

/** The seat initials, once, over the count column. */
export function SeatHead() {
  return <div className="d-seathead" aria-hidden="true">{SEATS.map(s => <i key={s} title={SEAT_NAME[s]}>{SEAT_NAME[s][0]}</i>)}</div>
}

export function Brand() {
  return (
    <div className="d-brand">
      <div className="d-mark" aria-hidden="true">IM</div>
      <div><b>Ivan's inbox</b></div>
    </div>
  )
}

export function MeFooter() {
  const now = useClock()
  const c = useFrameCounts()
  const inbox = useDInbox()
  const failed = c.ops.failed || c.bell.failed || c.alerts.failed || c.health.failed
  // Only a failed read speaks here, with Retry (the same resync verb as before).
  const resync = () => { c.refresh(); inbox.refresh() }
  return (
    <div className="d-me">
      <i aria-hidden="true">IM</i>
      <div>
        <b>Ivan Manfredi</b>
        <small>{warsawDayTime(now)}</small>
        {failed && <button type="button" className="d-sync d-sync-fail" data-verb="resync" onClick={resync} title="Read everything again">a read failed · Retry</button>}
      </div>
    </div>
  )
}

/** The Workflows key: opens automation health (not the bell), with today's corroborated number. */
export function WorkflowsKey({ onOpen }: { onOpen?: () => void }) {
  const c = useFrameCounts()
  const badge = workflowsBadge(c)
  const note = c.health.value ? healthNote(c.health.value) : ''
  return (
    <button type="button" data-verb="workflows" title={note || undefined} onClick={() => { onOpen?.(); openWorkflows() }}>
      <DIcon name="workflows" /><span>Workflows</span>{badge && <em className="d-wfn">{badge}</em>}
    </button>
  )
}

export function Side({ min = false, setMin }: { min?: boolean; setMin?: (m: boolean) => void }) {
  const f = useFrame()
  const { items } = useNavModel()
  const main = items.filter(i => PLACES[i.id].nav === 'main')
  const low = items.filter(i => PLACES[i.id].nav === 'low')
  return (
    <aside className={`d-side${min ? ' d-side-min' : ''}`} aria-label="Places">
      <Brand />
      {setMin && (
        <button type="button" className="d-side-fold" data-verb="side-fold" aria-pressed={min}
          aria-label={min ? 'Show the panel' : 'Narrow the panel'} title={min ? 'Show the panel' : 'Narrow the panel'} onClick={() => setMin(!min)}>
          <DIcon name={min ? 'more' : 'back'} />
        </button>
      )}
      {!min && <SeatHead />}
      <nav className="d-nav">
        {main.map(i => (
          <div key={i.id} className="d-navi">
            <a href={dHash(i.id)} className={f.route.place === i.id ? 'd-on' : undefined} aria-current={f.route.place === i.id ? 'page' : undefined} title={min ? i.label : undefined}>
              <DIcon name={PLACES[i.id].icon} /><span>{i.label}</span>{i.id === 'claude' && <ClaudeWorking />}<NavCount item={i} />
              {min && i.failed > 0 && <em className="d-side-pip" aria-label={`${i.failed} failed`}>!</em>}
            </a>
            <NavLineView item={i} />
          </div>
        ))}
      </nav>
      <nav className="d-nav d-low">
        <WorkflowsKey />
        {low.map(i => (
          <div key={i.id} className="d-navi">
            <a href={dHash(i.id)} className={f.route.place === i.id ? 'd-on' : undefined} aria-current={f.route.place === i.id ? 'page' : undefined}>
              <DIcon name={PLACES[i.id].icon} /><span>{i.label}</span>
            </a>
            {i.failed > 0 && <div className="d-navfail">{i.failed} failed</div>}
          </div>
        ))}
      </nav>
      <MeFooter />
    </aside>
  )
}
