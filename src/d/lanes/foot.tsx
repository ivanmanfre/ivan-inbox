/* The foot bar's monitor sentence (in words, never a status dot) and the
   range keys on the 14-days band (7d / 30d / 90d, a view choice, not a write). */
import { monitorLiveness } from '../../lib/campaignControl'
import { ago, hm, RANGES, type Range } from './model'
import type { LanesData } from './useLanesData'

export function monitorLine(d: LanesData, now: number): string {
  const p = d.cc.value
  if (!p) return d.cc.failed ? 'Monitor could not be read' : 'Reading the monitor…'
  const live = monitorLiveness(p, now)
  const word = live === 'fresh' ? 'fresh' : live === 'stale' ? 'stale, every seat unverified' : 'unknown'
  return `Monitor ${word} · as of ${hm(p.as_of)} Warsaw · last tick ${ago(p.monitor.last_tick_at, now)} · invites, DMs and InMail are counted apart and never added`
}

/** The foot's short form: the full line stays in the tooltip. */
export function monitorShort(d: LanesData, now: number): string {
  const p = d.cc.value
  if (!p) return d.cc.failed ? 'Monitor ?' : ''
  const live = monitorLiveness(p, now)
  return live === 'fresh' ? `Monitor ${hm(p.as_of)}` : live === 'stale' ? 'Monitor stale' : 'Monitor unknown'
}

export function RangeKeys({ range, setRange, onCustom }: { range: Range; setRange: (r: Range) => void; onCustom?: () => void }) {
  return (
    <div className="dl-rk" role="group" aria-label="Window for the totals">
      {RANGES.map(r => <button key={r} type="button" className={`dl-rkey${r === range ? ' dl-on' : ''}`} aria-pressed={r === range} data-range={r} onClick={() => setRange(r)}>{r}</button>)}
      {onCustom && <button type="button" className="dl-rkey" data-range="custom" onClick={onCustom}>Custom</button>}
    </div>
  )
}

