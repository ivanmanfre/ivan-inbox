import { useVisibleMotion } from '../../ui/useVisibleMotion'
import { useRef } from 'react'
import { docHref } from '../../../wb/sales/Doc'
import { dayKey } from '../../../wb/sales/match'
import { Join, PackLinks } from '../NextCall'
import { PacksOnFile } from '../Fortnight'
import { PACK_LINKS, meetingKind, type CallEvent, type Fortnight, type PackIndex } from '../model'
import { fortnightDays } from './model'
import type { ReactNode } from 'react'

function Plate({ r }: { r: CallEvent }) {
  const ref = useRef<HTMLElement>(null), motion = useVisibleMotion(ref)
  return <section ref={ref} data-motion={motion} className="sl4-next" data-next={r.ev.id} data-live={r.live}>
    <div className="sl4-eyebrow">{r.phase === 'running' ? 'On now' : 'Next call'} <small>{r.rel} · until {r.endWarsaw}</small></div>
    <h2>{r.name}</h2>{r.company && <p>{r.company}</p>}
    <div className="sl4-clocks"><div><b>{r.warsaw}</b><small>Warsaw · {r.day}</small></div><div><b>{r.utc}</b><small>UTC</small></div></div>
    <p className="sl4-facts" data-next-facts>{[r.type, r.source, meetingKind(r.ev.meeting_url)].filter(Boolean).join(' · ')}{r.withAll && <span> · with {r.withAll}</span>}</p>
    <div className="sl4-docs">{r.slug ? PACK_LINKS.map(l => l.kind == null || r.have.has(l.kind) ? <a key={l.doc} data-doc={l.doc} href={docHref(r.slug!, l.doc)} target="_blank" rel="noreferrer">{l.label}{l.doc === 'compare' && ' ↗'}</a> : <span key={l.doc} data-doc-missing={l.doc} title={`The ${l.label} is not published yet`}>{l.label}</span>) : <span>no pack yet</span>}</div>
    <Join r={r} big />
  </section>
}
const GROUPS = [['today', 'Today'], ['later', 'Later this week'], ['next', 'Next week'], ['earlier', 'Earlier this week']] as const
export function Schedule({ f, shown, now, next, idx, packs, tools, filtered, clear, report, packsFailed }: {
  f: Fortnight; shown: Fortnight; now: Date; next: CallEvent | null; idx: PackIndex; packs: number | null; tools: ReactNode; filtered: string; clear: () => void; report: (id: string) => void; packsFailed: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const days = fortnightDays(f, now)
  const booked = Object.values(f).flat().filter(r => !r.past).length
  const total = Object.values(shown).flat().length
  function jump(day: string) {
    const target = box.current?.querySelector<HTMLElement>(`[data-cal-day="${day}"]`)
    target?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    target?.classList.remove('sl4-flash'); void target?.offsetWidth; target?.classList.add('sl4-flash')
  }
  return <div className="sl4-schedule" ref={box}>
    <section className="sl4-strip" data-bx-block><div className="sl4-eyebrow">Next 14 days <small>{booked} booked</small></div>
      <div className="sl4-weekdays">{'MTWTFSS'.split('').map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="sl4-days">{days.map(d => <button type="button" key={d.day} data-day={d.day} data-today={d.today} className={d.weekend ? 'sl4-weekend' : undefined} onClick={() => jump(d.day)} aria-label={`${d.day}, ${d.rows.length} calls${d.rows.length ? `: ${d.rows.map(r => `${r.name} ${r.warsaw}`).join(', ')}` : ''}`}>
        <b>{Number(d.day.slice(-2))}</b><span>{d.rows.slice(0,3).map(r => <i key={r.ev.id} data-past={r.past} />)}</span>
      </button>)}</div>
    </section>
    {next && <Plate r={next} />}
    <div className="sl4-list-head"><small>{total} {total === 1 ? 'call' : 'calls'}{packs != null && ` · ${packs} ${packs === 1 ? 'pack' : 'packs'} matched`}</small>{tools}</div>
    {filtered && <p className="sl4-note" data-filter-line>Showing calls where {filtered}. <button type="button" data-verb="filter-clear" onClick={clear}>Clear</button></p>}
    {GROUPS.map(([key, label]) => shown[key].length || key === 'today' ? <section key={key} data-group={key}>
      <h3 className="sl4-eyebrow">{label}<small>{shown[key].length || ''}</small></h3>
      {!shown[key].length && <p className="sl4-note">No calls today.</p>}
      {shown[key].map(r => <div className="sl4-cal-row" key={r.ev.id} data-cal-id={r.ev.id} data-cal-day={dayKey(r.ev.start_time)} data-slug={r.slug ?? undefined}>
        <div className="sl4-time"><b>{r.warsaw}</b><small>{r.utc} UTC</small></div>
        <div className="sl4-who"><b>{r.name}</b><small>{[r.company, r.day, r.rel].filter(Boolean).join(' · ')}</small></div>
        {r.live && <Join r={r} />}
        <div className="sl4-row-docs">{r.past ? <>{r.reportId && <button type="button" data-verb="open-report" onClick={() => report(r.reportId!)}>report</button>}{r.slug && <a data-doc="card" href={docHref(r.slug,'card')} target="_blank" rel="noreferrer">card ↗</a>}</> : <PackLinks slug={r.slug} have={r.have} />}</div>
      </div>)}
    </section> : null)}
    {!packsFailed && <details className="sl4-archive"><summary>Packs on file ({idx.slugs.length})</summary><PacksOnFile idx={idx} /></details>}
  </div>
}
