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
import { SUB_LABEL, SUBS, PLANNING, subOf, type Sub } from '../content/SubNav'

// The left panel, desktop, and the same content as the phone's drawer. Brand,
// the seat names once (Ivan · Rise · Arch) over the count columns, one line per place with its per-seat numbers
// on the right, the low nav, and the me/clock footer (it speaks only when a
// read failed).

/** Under a place: only a failed read, said once. The numbers sit on the place's own line (NavCount). */
export function NavLineView({ item }: { item: NavItem }) {
  return item.failed > 0 ? <div className="d-navfail">{item.failed} failed</div> : null
}

/** On the place's line, right side: one number per seat under the Ivan · Rise · Arch header (never a total), or a short text. */
export function NavCount({ item }: { item: NavItem }) {
  const l = item.line
  if (!l) return null
  if (item.id === 'content') return l.kind === 'seats' && SEATS.some(s => (l.numbers[s] ?? 0) > 0) ? <i className="d-content-attention" aria-label="Content needs a tap" /> : null
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

/** The seat names, once, over the count columns (Ivan asked what "I R A" meant: now the names). */
export function SeatHead() {
  return <div className="d-seathead" aria-hidden="true">{SEATS.map(s => <i key={s}>{SEAT_NAME[s]}</i>)}</div>
}

/** The InboundOnSteroids wordmark (inboundonsteroids.com: INBOUND ON STEROIDS, "ON" heavy in red).
 *  Collapsed, only the ON mark shows (the site's favicon). */
export function Brand() {
  return (
    <div className="d-brand" aria-label="InboundOnSteroids inbox">
      <div className="d-mark d-mark-on" aria-hidden="true">ON</div>
      <div className="d-wordmark" aria-hidden="true"><span>INBOUND</span><span className="on">ON</span><span>STEROIDS</span></div>
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

/** The Workflows key: opens automation health (not the bell), with today's corroborated number.
 *  Hidden on screen since 2026-10-08 (Ivan: "I don't need to see workflows"); the node stays in the
 *  desktop DOM because Brief's native View menu and badge read it through bridge.js. */
export function WorkflowsKey({ onOpen, hidden }: { onOpen?: () => void; hidden?: boolean }) {
  const c = useFrameCounts()
  const badge = workflowsBadge(c)
  const note = c.health.value ? healthNote(c.health.value) : ''
  return (
    <button type="button" data-verb="workflows" hidden={hidden} style={hidden ? { display: "none" } : undefined} title={note || undefined} onClick={() => { onOpen?.(); openWorkflows() }}>
      <DIcon name="workflows" /><span>Workflows</span>{badge && <em className="d-wfn">{badge}</em>}
    </button>
  )
}

// Content opens into its pages in the rail while you are on it, as the old app's rail did (Ivan 09-28:
// "a collapsible navigation bar on the left like we had on the old version"). The rest of Content's
// places stay on the page's own row.
export const RAIL_SUBS: readonly Sub[] = SUBS

function PlaceLink({ i, on, min }: { i: NavItem; on: boolean; min: boolean }) {
  return (
    <a href={dHash(i.id)} className={on ? 'd-on' : undefined} aria-current={on ? 'page' : undefined} title={min ? i.label : undefined}>
      <DIcon name={PLACES[i.id].icon} /><span>{i.label}</span>{i.id === 'claude' && <ClaudeWorking />}<NavCount item={i} />
      {min && i.failed > 0 && <em className="d-side-pip" aria-label={`${i.failed} failed`}>!</em>}
    </a>
  )
}

function ContentGroup({ i, min }: { i: NavItem; min: boolean }) {
  const f = useFrame()
  const here = f.route.place === 'content'
  const sub = here ? subOf(f.route.sub, f.route.query) : null
  const open = here && !min
  return (
    <div className="d-navi">
      <PlaceLink i={i} on={here && !(open && RAIL_SUBS.includes(sub as Sub))} min={min} />
      <NavLineView item={i} />
      {open && (
        <div className="d-navsub">
          {RAIL_SUBS.map(s => {
            const on = sub === s
            return <a key={s} href={dHash('content', s, { lane: f.route.query.get('lane') ?? 'ivan' })} className={on ? 'd-on' : undefined} aria-current={on ? 'page' : undefined}>{SUB_LABEL[s]}</a>
          })}
          {PLANNING.map(p => {
            const on = sub === p.sub && (p.sub !== 'strategy' || (f.route.query.get('section') ?? 'this-week') === p.section)
            return <a key={p.label} href={dHash('content', p.sub, { lane: f.route.query.get('lane') ?? 'ivan', ...(p.section ? { section: p.section } : {}) })} className={on ? 'd-on' : undefined} aria-current={on ? 'page' : undefined}>{p.label}</a>
          })}
        </div>
      )}
    </div>
  )
}

export function Side({ min = false, setMin }: { min?: boolean; setMin?: (m: boolean) => void }) {
  const f = useFrame()
  const { items } = useNavModel()
  const main = items.filter(i => PLACES[i.id].nav === 'main')
  const low = items.filter(i => PLACES[i.id].nav === 'low')
  const fold = min ? 'Expand the panel' : 'Collapse the panel'
  return (
    <aside className={`d-side${min ? ' d-side-min' : ''}`} aria-label="Places">
      <div className="d-side-top">
        <Brand />
        {setMin && (
          <button type="button" className="d-side-fold" data-verb="side-fold" aria-pressed={min}
            aria-label={fold} title={`${fold} (⌘\\)`} onClick={() => setMin(!min)}>
            <DIcon name={min ? 'foldOut' : 'foldIn'} />
          </button>
        )}
      </div>
      {!min && <SeatHead />}
      <nav className="d-nav">
        {main.map(i => i.id === 'content' ? <ContentGroup key={i.id} i={i} min={min} /> : (
          <div key={i.id} className="d-navi">
            <PlaceLink i={i} on={f.route.place === i.id} min={min} />
            <NavLineView item={i} />
          </div>
        ))}
      </nav>
      <nav className="d-nav d-low">
        <WorkflowsKey hidden />
        {low.map(i => (
          <div key={i.id} className="d-navi">
            <a href={dHash(i.id)} className={f.route.place === i.id ? 'd-on' : undefined} aria-current={f.route.place === i.id ? 'page' : undefined} title={min ? i.label : undefined}>
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
