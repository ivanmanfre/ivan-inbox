import { useEffect, useRef, useState, type RefObject } from 'react'
import type { BrainStrip, StripRule } from '../../../lib/contentPlan'
import { readDotTip, ruleRow, stockRow } from './planBrain'

// The brain strip's small charts (spec 2026-10-12 R3.1, R4; prototypes final-review/viz/src/build.py). Plain SVG, no
// library. Every colour is a class (plan2.css, Task 9 section) so the Oxygen tokens stay in one place. Every SVG text
// is 12 px or more, every dot has a <title> for the hover, and every chart sits beside a `.pl2-sr` list, so nothing
// is only a picture. Colours never carry the meaning alone: filled / hollow / dashed say it too.

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

// ---- scales (pure) ----

/** A log scale: `lo` maps to 0, `hi` to `w`, clamped. Bad input maps to 0. */
export function logX(v: number, lo: number, hi: number, w: number): number {
  if (!fin(v) || !fin(lo) || !fin(hi) || v <= 0 || lo <= 0 || hi <= lo) return 0
  return clamp01((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * w
}

/** The brain-guess scale: log2 from half as often (0) through average (w / 2) to 2x as often (w), clamped. */
export function ratioX(r: number, w: number): number {
  if (Number.isNaN(r)) return w / 2
  if (r <= 0) return 0
  return clamp01((Math.log2(r) + 1) / 2) * w
}

/** A linear scale from `x0` for the rule effects (percent), clamped to the chart. */
export function effectX(v: number, lo: number, hi: number, x0: number, w: number): number {
  if (!fin(v) || !fin(lo) || !fin(hi) || hi <= lo) return x0
  return x0 + clamp01((v - lo) / (hi - lo)) * w
}

/** The axis of the rule chart: holds zero and every range, in steps of 10, never narrower than -10 to 30. */
export function effectDomain(rs: { lo: number | null; hi: number | null }[]): { lo: number; hi: number } {
  const los = rs.map(r => r.lo).filter(fin), his = rs.map(r => r.hi).filter(fin)
  const lo = Math.min(-10, los.length ? Math.floor(Math.min(...los) / 10) * 10 : -10)
  const hi = Math.max(30, his.length ? Math.ceil(Math.max(...his) / 10) * 10 : 30)
  return { lo, hi }
}

const dayMs = (iso: string) => Date.parse(`${String(iso).slice(0, 10)}T12:00:00Z`)
/** A calendar day on a time axis from `start` to `end`, clamped. A bad date maps to 0. */
export function timeX(day: string, start: string, end: string, w: number): number {
  const d = dayMs(day), a = dayMs(start), b = dayMs(end)
  if (Number.isNaN(d) || Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0
  return clamp01((d - a) / (b - a)) * w
}

/**
 * Rows for dots on one scale so they do not touch (a beeswarm by rows). Dots arrive left to right; each takes the first
 * row whose last dot is at least `gap` away, else a new row (up to `maxLanes`), else the row with the most room.
 */
export function readLanes(xs: number[], gap: number, maxLanes: number): number[] {
  const last: number[] = []
  return xs.map(x0 => {
    const x = fin(x0) ? x0 : 0
    for (let i = 0; i < last.length; i++) if (x - last[i] >= gap) { last[i] = x; return i }
    if (last.length < maxLanes) { last.push(x); return last.length - 1 }
    let best = 0
    for (let i = 1; i < last.length; i++) if (x - last[i] > x - last[best]) best = i
    last[best] = x
    return best
  })
}

/** The width of an element, followed as it resizes. Falls back to `init` where there is no ResizeObserver (tests). */
export function useWidth<T extends HTMLElement>(init: number): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [w, setW] = useState(init)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const read = () => { const n = Math.floor(el.clientWidth); if (n > 0) setW(n) }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

const k = (n: number) => (n >= 1000 ? `${(Math.round(n / 100) / 10).toString().replace(/\.0$/, '')}k` : String(Math.round(n)))
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const addDays = (iso: string, n: number) => { const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// ---- tile 1: one rule as a dot and its range ----

export const RULE_X0 = 7
/** The dot and range of one rule on the shared axis. Filled = we follow it, hollow = testing, dashed = the range crosses zero. */
export function RuleRange({ rule, dom, w }: { rule: StripRule; dom: { lo: number; hi: number }; w: number }) {
  const row = ruleRow(rule)
  const inner = Math.max(10, w - RULE_X0 * 2)
  const has = fin(rule.gain)
  const live = rule.status === 'live'
  const crosses = fin(rule.lo) && fin(rule.hi) && rule.lo < 0 && rule.hi > 0
  const X = (v: number) => effectX(v, dom.lo, dom.hi, RULE_X0, inner)
  return <svg className="pl2-ch pl2-ch-rule" width={w} height={22} viewBox={`0 0 ${w} 22`} aria-hidden="true" focusable="false">
    {has && <g>
      <title>{`${row.name}: ${row.effect}`}</title>
      {fin(rule.lo) && fin(rule.hi) && <line className={`pl2-ch-rng${live ? ' pl2-ch-live' : ''}`} x1={X(rule.lo)} x2={X(rule.hi)} y1={11} y2={11} strokeWidth={2} strokeLinecap="round" strokeDasharray={crosses || rule.unclear ? '2 3' : undefined} />}
      <circle className={`pl2-ch-dot ${live ? 'pl2-ch-fill' : 'pl2-ch-hollow'}`} cx={X(rule.gain as number)} cy={11} r={4.5} strokeWidth={1.75} />
    </g>}
  </svg>
}

/** The axis under the rule rows: 0 and the right end, in percent. */
export function RuleAxis({ dom, w }: { dom: { lo: number; hi: number }; w: number }) {
  const inner = Math.max(10, w - RULE_X0 * 2)
  const z = effectX(0, dom.lo, dom.hi, RULE_X0, inner)
  return <svg className="pl2-ch" width={w} height={18} viewBox={`0 0 ${w} 18`} aria-hidden="true" focusable="false">
    <text className="pl2-ch-t" fontSize={12} x={z} y={13} textAnchor="middle">0</text>
    <text className="pl2-ch-t" fontSize={12} x={w - 1} y={13} textAnchor="end">{`+${dom.hi}%`}</text>
  </svg>
}

// ---- tile 3: the brain's guess for each planned post ----

type ReadItem = BrainStrip['reads']['items'][number]
const LANE_H = 9, MAX_LANES = 8
export function ReadsChart({ items, w }: { items: ReadItem[]; w: number }) {
  const list = (Array.isArray(items) ? items : []).filter(i => i && fin(i.x)).sort((a, b) => a.x - b.x)
  // Real position on the half-as-often to 2x scale; dots that would touch move to another row.
  const lanes = readLanes(list.map(i => ratioX(i.x, w)), LANE_H, MAX_LANES)
  const rows = lanes.length ? Math.max(...lanes) + 1 : 1
  const bandH = Math.max(30, rows * LANE_H + 14)
  const y = (ix: number) => 8 + lanes[ix] * LANE_H + (rows === 1 ? (bandH - 16) / 2 : 0)
  const mid = ratioX(1, w), a = ratioX(0.85, w), b = ratioX(1.15, w)
  // "average" needs room between the two end labels; on a narrow tile the line in the middle says it.
  const roomy = w >= 190
  return <>
    <svg className="pl2-ch pl2-ch-reads" width={w} height={bandH + 22} viewBox={`0 0 ${w} ${bandH + 22}`} aria-hidden="true" focusable="false">
      <rect className="pl2-ch-band" x={0} y={0} width={w} height={bandH} rx={5} />
      <rect className="pl2-ch-avg" x={a} y={0} width={b - a} height={bandH} />
      <line className="pl2-ch-mid" x1={mid} x2={mid} y1={-2} y2={bandH + 2} strokeWidth={1.5} />
      {list.map((i, ix) => <g key={`${ix}:${i.title}`}>
        <title>{readDotTip(i)}</title>
        {fin(i.lo) && fin(i.hi) && <line className="pl2-ch-rng" x1={ratioX(i.lo, w)} x2={ratioX(i.hi, w)} y1={y(ix)} y2={y(ix)} strokeWidth={1} />}
        <circle className={`pl2-ch-dot ${i.proven ? (i.small ? 'pl2-ch-hollow pl2-ch-ink' : 'pl2-ch-fill') : 'pl2-ch-grey'}`} data-proven={i.proven ? 'true' : 'false'} data-small={i.small ? 'true' : undefined}
          cx={ratioX(i.x, w)} cy={y(ix)} r={3.5} strokeWidth={1.5} />
      </g>)}
      <text className="pl2-ch-t" fontSize={12} x={0} y={bandH + 16} textAnchor="start">half as often</text>
      {roomy && <text className="pl2-ch-t" fontSize={12} x={mid} y={bandH + 16} textAnchor="middle">average</text>}
      <text className="pl2-ch-t" fontSize={12} x={w} y={bandH + 16} textAnchor="end">2x as often</text>
    </svg>
    <ul className="pl2-sr" aria-label="Brain guess for each planned post">{list.map((i, ix) => <li key={`${ix}:${i.title}`}>{readDotTip(i)}</li>)}</ul>
  </>
}

// ---- tile 4: views per post over 12 weeks ----

type ViewPost = BrainStrip['views']['posts'][number]
export const VIEWS_DAYS = 84
export function ViewsChart({ posts, median, today, w }: { posts: ViewPost[]; median: number | null; today?: string; w: number }) {
  const ps = (Array.isArray(posts) ? posts : []).filter(p => p && fin(p.v) && p.v > 0 && typeof p.d === 'string')
  const med = fin(median) && median > 0 ? median : null
  const end = today ?? (ps.length ? ps.map(p => p.d.slice(0, 10)).sort().pop()! : '')
  const start = end ? addDays(end, -VIEWS_DAYS) : ''
  const H = 62
  const vmax = Math.max(...ps.map(p => p.v), med ? med * 4 : 10)
  const vmin = Math.max(1, Math.min(...ps.map(p => p.v), med ? med / 4 : 1))
  const hi = vmax <= vmin ? vmin * 10 : vmax
  const lo = vmin
  const Y = (v: number) => H - logX(v, lo, hi, H)
  const top = ps.reduce<ViewPost | null>((m, p) => (!m || p.v > m.v ? p : m), null)
  const viral = (p: ViewPost) => med != null && !p.young && p.v >= 3 * med
  const tip = (p: ViewPost) => `${day(p.d)}: ${p.v.toLocaleString('en-GB')} views${viral(p) ? '. Went viral.' : ''}${p.young ? '. Under 7 days old, still growing.' : ''}`
  const order = [...ps].sort((a, b) => a.v - b.v)
  return <>
    <svg className="pl2-ch pl2-ch-views" width={w} height={H + 24} viewBox={`0 0 ${w} ${H + 24}`} aria-hidden="true" focusable="false" style={{ overflow: 'visible' }}>
      <line className="pl2-ch-base" x1={0} x2={w} y1={H} y2={H} strokeWidth={1} />
      {med != null && <line className="pl2-ch-three" x1={0} x2={w} y1={Y(3 * med)} y2={Y(3 * med)} strokeWidth={1} />}
      {med != null && <line className="pl2-ch-median" x1={0} x2={w} y1={Y(med)} y2={Y(med)} strokeWidth={1} strokeDasharray="3 3" />}
      {end && order.map((p, i) => <circle key={`${i}:${p.d}:${p.v}`} className={`pl2-ch-dot ${p.young ? 'pl2-ch-hollow pl2-ch-ink' : viral(p) ? 'pl2-ch-fill' : 'pl2-ch-grey'}`} data-viral={viral(p) ? 'true' : undefined} data-young={p.young ? 'true' : undefined}
        cx={timeX(p.d, start, end, w - 8) + 4} cy={Y(p.v)} r={3.5} strokeWidth={1.5}><title>{tip(p)}</title></circle>)}
      {end && top && (() => {
        const cx = timeX(top.d, start, end, w - 8) + 4
        const left = cx > w - 56
        return <text className="pl2-ch-t pl2-ch-top" fontSize={12} x={cx + (left ? -8 : 8)} y={Y(top.v) + 4} textAnchor={left ? 'end' : 'start'}>{k(top.v)}</text>
      })()}
      <text className="pl2-ch-t" fontSize={12} x={0} y={H + 18} textAnchor="start">{start ? day(start) : ''}</text>
      <text className="pl2-ch-t" fontSize={12} x={w} y={H + 18} textAnchor="end">today</text>
    </svg>
    <ul className="pl2-sr" aria-label="Views per post, last 12 weeks">{[...ps].sort((a, b) => a.d.localeCompare(b.d)).map((p, i) => <li key={`${i}:${p.d}:${p.v}`}>{tip(p)}</li>)}</ul>
  </>
}

// ---- the idea stock: ideas in stock (bar) against ideas used in 8 weeks (tick) ----

type StockItem = BrainStrip['idea_stock'][number]
export function StockChart({ items, w }: { items: StockItem[]; w: number }) {
  // Fullest first, empty topics last (amber). Each row: the topic and its count on one line, the bar and the used tick under it.
  const rows = (Array.isArray(items) ? items : []).filter(s => s && typeof s.topic === 'string').map(stockRow).sort((a, b) => b.stock - a.stock || b.used - a.used)
  const RH = 42
  const mx = Math.max(1, ...rows.map(r => Math.max(r.stock, r.used)))
  const H = Math.max(RH, rows.length * RH)
  return <>
    <svg className="pl2-ch pl2-ch-stock" width={w} height={H} viewBox={`0 0 ${w} ${H}`} aria-hidden="true" focusable="false">
      {rows.map((r, i) => {
        const y = i * RH
        const tx = Math.min(w - 2, Math.max(0, (r.used / mx) * w))
        return <g key={r.name} data-empty={r.empty ? 'true' : undefined}>
          <title>{r.tip}</title>
          <rect x={0} y={y} width={w} height={RH} fill="transparent" />
          <text className={`pl2-ch-t pl2-ch-name${r.empty ? ' pl2-ch-amber' : ''}`} fontSize={13} x={0} y={y + 15} textAnchor="start">{r.name}</text>
          <text className={`pl2-ch-t pl2-ch-num${r.empty ? ' pl2-ch-amber' : ''}`} fontSize={13} x={w} y={y + 15} textAnchor="end">{r.stock}</text>
          <rect className="pl2-ch-track" x={0} y={y + 24} width={w} height={8} rx={2} />
          {r.stock > 0 && <rect className="pl2-ch-bar" x={0} y={y + 24} width={Math.max(4, (r.stock / mx) * w)} height={8} rx={2} />}
          <rect className="pl2-ch-tick" x={tx - 1} y={y + 21} width={2} height={14} />
        </g>
      })}
    </svg>
    <ul className="pl2-sr" aria-label="Ideas in stock by topic">{rows.map(r => <li key={r.name}>{r.tip}</li>)}</ul>
  </>
}
