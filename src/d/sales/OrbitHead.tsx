import { useState } from 'react'
import type { OrbitHeadProps } from '../../orbit/Orbit'
import { shortLaneLabel } from '../../orbit/filters'
import { AnswerRow } from '../ui/AnswerRow'
import { Btn } from '../ui/Key'
import { Sheet } from '../ui/Sheet'
import { useStalled } from '../ui/timeout'
import { warsawHm } from '../ui/time'

// ORBIT'S HEAD IN D (final gate 09-27: four pill rows, a clipped campaign row,
// no headline, a lime dot for status). D's answer row: "Orbit · <tenant> ·
// <range>" and one summary line (the four numbers, and "read HH:MM" in words).
// Under it ONE mono filter line: tenant · range · filter · lane as text keys,
// the current one marked. Tenant and range pick in place; filter and lane open
// a sheet (a long campaign list is never a row that clips). Reads only: the
// four writes live in today's person/post panels, untouched.

const TENANTS = [['ivan', 'Ivan'], ['arch', 'Arch'], ['risedtc', 'Rise']] as const
const RANGES = [['7d', '7d'], ['30d', '30d'], ['90d', '90d'], ['all', 'all'], ['custom', 'custom']] as const
const RANGE_WORDS: Record<string, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'all time' }

export function rangeWords(f: OrbitHeadProps['filters']): string {
  if (f.preset === 'custom' && f.from && f.to) return `${f.from} to ${f.to}`
  return RANGE_WORDS[f.preset] ?? '30 days'
}

/** The filters that are on, in words ("none" when nothing narrows the view). */
export function filterWords(f: OrbitHeadProps['filters']): string {
  const on = [
    f.contentOnly && 'content only', f.movedFirst && 'moved first',
    f.neverReached.has('icp_unasked') && 'ICP never asked', f.neverReached.has('judged_out') && 'judged out',
    f.neverReached.has('unjudged') && 'not yet judged', f.icpMin === 7 && 'ICP 7+', f.q.trim() && `"${f.q.trim()}"`,
  ].filter(Boolean) as string[]
  return on.length === 0 ? 'none' : on.length <= 2 ? on.join(', ') : `${on.length} on`
}

export function laneWords(h: Pick<OrbitHeadProps, 'filters' | 'laneChips'>): string {
  const n = h.filters.lanes.size
  if (n === 0) return 'all'
  if (n === 1) { const l = h.laneChips.find(x => h.filters.lanes.has(x.id)); return l ? shortLaneLabel(l.name, 22) : '1 lane' }
  return `${n} lanes`
}

function Pick({ on, onClick, children, verb }: { on: boolean; onClick: () => void; children: string; verb?: string }) {
  return <button type="button" className={`ob-k${on ? ' ob-on' : ''}`} aria-pressed={on} data-verb={verb} onClick={onClick}>{children}</button>
}

function Toggle({ on, label, n, onClick, hint }: { on: boolean; label: string; n?: number; onClick: () => void; hint?: string }) {
  return (
    <button type="button" className={`ob-t${on ? ' ob-on' : ''}`} aria-pressed={on} onClick={onClick}>
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
      {n != null && <em>{n.toLocaleString('en-US')}</em>}
      <i>{on ? 'on' : 'off'}</i>
    </button>
  )
}

export function OrbitHead(h: OrbitHeadProps) {
  const [sheet, setSheet] = useState<'filter' | 'lane' | null>(null)
  // The first read never sits on "Reading…": 12 s, then it says so and retries quietly.
  const stalled = useStalled(h.loading && !h.hasGraph, h.retry)
  const f = h.filters
  const tenant = TENANTS.find(t => t[0] === f.tenant)?.[1] ?? 'Ivan'
  const status = h.loading ? 'reading…' : h.error ? 'the graph could not be read' : h.loadedAt ? `read ${warsawHm(h.loadedAt)}` : 'not read yet'
  const s = h.stats
  // No graph read yet = no numbers (never "0 people" while reading or after a failed read).
  const sub = !h.hasGraph
    ? (h.error ? 'The graph could not be read. No number is shown until it is.' : stalled ? 'No answer from the graph in 12 s. Still trying.' : 'Reading the graph…')
    : `${s.people.toLocaleString('en-US')} people, ${s.reached.toLocaleString('en-US')} reached, ${s.replied.toLocaleString('en-US')} replied, ${s.booked.toLocaleString('en-US')} booked · ${status}`
  const nr = (b: 'icp_unasked' | 'judged_out' | 'unjudged') => () => h.setFilters(x => {
    const next = new Set(x.neverReached)
    if (next.has(b)) next.delete(b); else next.add(b)
    return { ...x, neverReached: next }
  })
  return (
    <div className="ob-head" data-orbit-head>
      <AnswerRow title={<>Orbit · {tenant} · {rangeWords(f)}</>} sub={sub} />
      <div className="ob-line" role="toolbar" aria-label="Orbit filters">
        <span className="ob-g"><small>tenant</small>{TENANTS.map(([id, label]) => <Pick key={id} on={f.tenant === id} onClick={() => h.setTenant(id)}>{label}</Pick>)}</span>
        <span className="ob-g"><small>range</small>{RANGES.map(([id, label]) => <Pick key={id} on={f.preset === id} onClick={() => h.setPreset(id)}>{label}</Pick>)}</span>
        <span className="ob-g"><small>filter</small><button type="button" className={`ob-k ob-open${filterWords(f) !== 'none' ? ' ob-on' : ''}`} aria-expanded={sheet === 'filter'} data-verb="orbit-filter" onClick={() => setSheet('filter')}>{filterWords(f)} ›</button></span>
        <span className="ob-g"><small>lane</small><button type="button" className={`ob-k ob-open${f.lanes.size ? ' ob-on' : ''}`} aria-expanded={sheet === 'lane'} data-verb="orbit-lane" onClick={() => setSheet('lane')}>{laneWords(h)} ›</button></span>
        <span className="ob-g">{!h.hasGraph && (h.error || stalled)
          ? <button type="button" className="ob-k ob-on" data-verb="retry" onClick={h.retry}>retry</button>
          : <button type="button" className="ob-k" data-verb="refresh" onClick={h.refresh}>refresh</button>}</span>
      </div>
      {h.custom.open && (
        <div className="ob-custom">
          <small>from</small><input type="date" value={h.custom.from} max={h.custom.to || undefined} onChange={e => h.custom.setFrom(e.target.value)} aria-label="From" />
          <small>to</small><input type="date" value={h.custom.to} min={h.custom.from || undefined} onChange={e => h.custom.setTo(e.target.value)} aria-label="To" />
          <Btn primary disabled={!h.custom.from || !h.custom.to} onClick={h.custom.apply}>Apply</Btn>
          <Btn onClick={h.custom.cancel}>Cancel</Btn>
        </div>
      )}
      <Sheet open={sheet === 'filter'} onClose={() => setSheet(null)} title="Filter the people" sub="Counts are for the current tenant, range and lanes."
        foot={<><Btn disabled={filterWords(f) === 'none'} onClick={() => h.setFilters(x => ({ ...x, contentOnly: false, movedFirst: false, neverReached: new Set(), icpMin: null, q: '' }))}>Clear</Btn><Btn primary onClick={() => setSheet(null)}>Done</Btn></>}>
        <div className="ob-list">
          <label className="ob-q"><small>search</small><input value={f.q} placeholder="Name, company, headline" onChange={e => h.setFilters(x => ({ ...x, q: e.target.value }))} /></label>
          <Toggle on={f.contentOnly} label="Content only" hint="Never in a campaign" onClick={() => h.setFilters(x => ({ ...x, contentOnly: !x.contentOnly }))} />
          <Toggle on={f.movedFirst} label="Moved first" hint="They engaged before we did" onClick={() => h.setFilters(x => ({ ...x, movedFirst: !x.movedFirst }))} />
          <Toggle on={f.neverReached.has('icp_unasked')} label="ICP never asked" hint="A fit nobody has approached" n={h.nrCounts.icpUnasked} onClick={nr('icp_unasked')} />
          <Toggle on={f.neverReached.has('judged_out')} label="Judged out" n={h.nrCounts.judgedOut} onClick={nr('judged_out')} />
          <Toggle on={f.neverReached.has('unjudged')} label="Not yet judged" n={h.nrCounts.unjudged} onClick={nr('unjudged')} />
          <Toggle on={f.icpMin === 7} label="ICP 7 or more" onClick={() => h.setFilters(x => ({ ...x, icpMin: x.icpMin === 7 ? null : 7 }))} />
        </div>
      </Sheet>
      <Sheet open={sheet === 'lane'} onClose={() => setSheet(null)} title="Lanes" sub={h.laneChips.length ? `${h.laneChips.length} campaigns for ${tenant}. None picked = every lane.` : 'No campaigns in this window.'}
        foot={<><Btn disabled={f.lanes.size === 0} onClick={() => h.setFilters(x => ({ ...x, lanes: new Set() }))}>Every lane</Btn><Btn primary onClick={() => setSheet(null)}>Done</Btn></>}>
        <div className="ob-list">
          {h.laneChips.map(l => <Toggle key={l.id} on={f.lanes.has(l.id)} label={l.name} hint={l.active ? undefined : 'not running'} n={l.n} onClick={() => h.toggleLane(l.id)} />)}
        </div>
      </Sheet>
    </div>
  )
}
