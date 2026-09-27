import type { ReactNode } from 'react'
import { Join, PackLinks } from './NextCall'
import type { CallEvent, Fortnight as F, PackIndex } from './model'
import { throughLabel } from './model'

// THE FORTNIGHT, by Warsaw day: Today (always drawn, "No calls today" is an
// answer), Later this week, Next week, Earlier this week (newest first). A row:
// both clocks, who, day · when, the pack links, a small Join while the call
// can still be joined, and "report" on a past call that has one.

const GROUPS: Array<[keyof F, string]> = [['today', 'Today'], ['later', 'Later this week'], ['next', 'Next week'], ['earlier', 'Earlier this week']]

function Row({ r, onReport }: { r: CallEvent; onReport: (id: string) => void }) {
  return (
    <div className={`sl-fr${r.past ? ' sl-past' : ''}`} data-cal-id={r.ev.id} data-slug={r.slug ?? undefined}>
      <div className="sl-ft"><em>{r.warsaw}</em><small>{r.utc} UTC</small></div>
      <div className="sl-fm">
        <div className="sl-fw"><b>{r.name}</b>{r.company && <span>{r.company}</span>}</div>
        <div className="sl-fs">{[r.day, r.rel, r.with && `with ${r.with}`].filter(Boolean).join(' · ')}</div>
      </div>
      <Join r={r} />
      <div className="sl-fl"><PackLinks slug={r.slug} have={r.have} report={Boolean(r.reportId)} onReport={() => r.reportId && onReport(r.reportId)} /></div>
    </div>
  )
}

export function FortnightList({ f, from, onReport, packs, tools, filtered, onClear }: {
  f: F; from: Date; onReport: (id: string) => void
  /** Packs matched to a call in this window (today's head count, packsInWindow). */
  packs?: number | null
  /** The Filter key, right of the count line. */
  tools?: ReactNode
  /** What the filter keeps, in words; '' = no filter. */
  filtered?: string
  onClear?: () => void
}) {
  const total = f.today.length + f.later.length + f.next.length + f.earlier.length
  return (
    <>
      <div className="sl-cnt">
        <span>Week of {throughLabel(from)} · {total} {total === 1 ? 'call' : 'calls'}{packs != null && ` · ${packs} ${packs === 1 ? 'pack' : 'packs'}`}</span>
        {tools}
      </div>
      {filtered && <div className="sl-quiet sl-fltl" data-filter-line>Showing calls where {filtered}. <button type="button" className="sl-pl" data-verb="filter-clear" onClick={onClear}>Clear</button></div>}
      {GROUPS.map(([k, label]) => {
        const list = f[k]
        if (list.length === 0 && k !== 'today') return null
        return (
          <section key={k} className="sl-grp" data-group={k}>
            <div className="sl-sec"><span>{label}</span><span>{list.length || ''}</span></div>
            {list.length === 0 ? <div className="sl-quiet">No calls today.</div> : list.map(r => <Row key={r.ev.id} r={r} onReport={onReport} />)}
          </section>
        )
      })}
      {filtered && total === 0 && <div className="sl-quiet">No call in the fortnight matches this filter.</div>}
    </>
  )
}

export function PacksOnFile({ idx }: { idx: PackIndex }) {
  const rows = idx.slugs.map(s => ({ s, m: idx.meta[s], at: idx.at[s] ?? '' })).sort((a, b) => b.at.localeCompare(a.at))
  const title = (s: string) => s.split('-').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
  return (
    <section className="sl-grp" aria-label="Packs on file">
      <div className="sl-sec"><span>Packs on file · links open a new tab</span><span>{rows.length}</span></div>
      {rows.length === 0 && <div className="sl-quiet">No packs published yet.</div>}
      {rows.map(({ s, m }) => (
        <div className="sl-pf" key={s} data-slug={s}>
          <div className="sl-pfn"><b>{m.name || title(s)}</b>{m.company && <span>{m.company}</span>}{m.when && <small>{m.when.split('·')[0].trim()}</small>}</div>
          <PackLinks slug={s} have={idx.have[s] ?? new Set()} noCompare />
        </div>
      ))}
    </section>
  )
}
