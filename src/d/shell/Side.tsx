import { ClaudeWorking } from '../claude/Island'
import { PLACES } from '../places'
import { dHash } from '../route'
import { DIcon } from '../ui/icons'
import { SeatCounts } from '../ui/SeatCounts'
import { useClock } from '../ui/useClock'
import { warsawDayTime, warsawHm } from '../ui/time'
import { useFrame } from './frame'
import { useNavModel, type NavItem } from './navModel'
import { openWorkflows, workflowsBadge } from './Workflows'
import { healthNote } from '../counts/glance'
import { useFrameCounts } from '../counts/useFrameCounts'

// The left panel (D shell.js side()), desktop, and the same content as the
// phone's drawer (pshell.js panel()). Brand line with the seat roster, places
// with one number per seat under them, the low nav, and the me/clock footer
// with the last successful sync.

export function NavLineView({ item }: { item: NavItem }) {
  return (
    <>
      {item.failed > 0 && <div className="d-navfail">{item.failed} failed</div>}
      {item.line?.kind === 'seats' && <SeatCounts label={item.line.label} numbers={item.line.numbers} failed={item.line.failed} />}
      {item.line?.kind === 'text' && (
        <div className="d-per"><small>{item.line.label}</small><span className="d-per-t">{item.line.text}</span></div>
      )}
      {item.extra && (
        <div className="d-per d-per-x"><small>{item.extra.label}</small><span className="d-per-t">{item.extra.text}</span></div>
      )}
    </>
  )
}

export function Brand() {
  return (
    <div className="d-brand">
      <div className="d-mark" aria-hidden="true">IM</div>
      <div><b>Ivan's inbox</b><small>Ivan, Rise, Arch</small></div>
    </div>
  )
}

export function MeFooter({ synced }: { synced: number | null }) {
  const now = useClock()
  return (
    <div className="d-me">
      <i aria-hidden="true">IM</i>
      <div>
        <b>Ivan Manfredi</b>
        <small>{warsawDayTime(now)} Warsaw</small>
        <small className="d-sync">{synced ? `synced ${warsawHm(synced)}` : 'not synced yet'}</small>
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

export function Side() {
  const f = useFrame()
  const { items, synced } = useNavModel()
  const main = items.filter(i => PLACES[i.id].nav === 'main')
  const low = items.filter(i => PLACES[i.id].nav === 'low')
  return (
    <aside className="d-side" aria-label="Places">
      <Brand />
      <nav className="d-nav">
        {main.map(i => (
          <div key={i.id} className="d-navi">
            <a href={dHash(i.id)} className={f.route.place === i.id ? 'd-on' : undefined} aria-current={f.route.place === i.id ? 'page' : undefined}>
              <DIcon name={PLACES[i.id].icon} /><span>{i.label}</span>{i.id === 'claude' && <ClaudeWorking />}
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
      <MeFooter synced={synced} />
    </aside>
  )
}
