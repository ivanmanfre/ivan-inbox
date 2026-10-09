import { useLayoutEffect, useRef, useState } from 'react'
import { dHash } from '../route'
import { useFrame } from '../shell/frame'
import { Sheet } from '../ui/Sheet'
import type { Lane } from './model'

export type Sub = 'calendar' | 'now' | 'ideas' | 'results' | 'strategy' | 'styles' | 'planner' | 'review' | 'inputs' | 'magnets' | 'errors' | 'queue' | 'markets' | 'brain'
// Run 51: Content Brain is the daily entry (drafts waiting, source beside each). Results, Strategy, the old
// Content brain week and Outliers left the daily row; they stay one tap away under More and on the page.
export const SUBS: readonly Sub[] = ['brain', 'calendar', 'ideas', 'now', 'magnets']
export const SUB_LABEL: Record<Sub, string> = { calendar: 'Calendar', now: 'Review', ideas: 'Ideas', results: 'Results', strategy: 'Strategy', styles: 'Styles', planner: 'Planner', review: 'Review', inputs: 'Outliers', magnets: 'Lead magnets', errors: 'Errors', queue: 'Publish queue', markets: 'Outliers & Markets', brain: 'Content Brain' }
export const PLANNING: readonly { sub: Sub; section: string | null; label: string }[] = []
/** The More sheet: every place that left the daily row, under the job it does. */
const MORE: readonly { group: string; items: readonly { label: string; sub: Sub; q?: Record<string, string>; small?: string }[] }[] = [
  { group: 'Browse sources', items: [
    { label: 'Research library', sub: 'strategy', q: { section: 'research' } },
    { label: 'Outliers', sub: 'inputs' },
    { label: 'Markets', sub: 'strategy', q: { section: 'markets' } },
  ] },
  { group: 'History and evidence', items: [
    { label: 'Results', sub: 'results' },
    { label: 'Saved weekly plans', sub: 'strategy', q: { section: 'this-week' } },
    { label: 'Patterns and benchmarks', sub: 'brain', q: { view: 'patterns' } },
    { label: 'Strategy', sub: 'strategy', q: { section: 'direction' }, small: 'Client direction, lead magnets, notes' },
  ] },
  { group: 'More', items: [
    { label: 'Styles', sub: 'styles' },
    { label: 'All posts', sub: 'now', q: { view: 'posts' }, small: 'Filters, search and bulk actions' },
  ] },
]
export function subOf(s: string | null, query = new URLSearchParams()): Sub {
  if (!s) return query.has('magnet') ? 'magnets' : query.has('draft') || query.has('view') ? 'now' : 'calendar'
  if (s === 'markets') return 'inputs'
  if (s === 'planner' || s === 'queue') return 'calendar'
  return s === 'brain' || s === 'calendar' || s === 'ideas' || s === 'results' || s === 'strategy' || s === 'styles' || s === 'inputs' || s === 'magnets' ? s : 'now'
}
/** Old bookmarks keep their row/client identities and reach the corresponding review view. */
export function contentRedirect(sub: string | null, query: URLSearchParams): string | null {
  // The old planner (a tab, then a "Planner →" link inside Review) is the Calendar now.
  if (sub === 'now' && query.get('view') === 'planner') { const q = new URLSearchParams(query); q.delete('view'); q.delete('from'); return dHash('content', 'calendar', q) }
  if (sub === 'brain' || sub === 'calendar' || sub === 'now' || sub === 'ideas' || sub === 'results' || sub === 'strategy' || sub === 'styles' || sub === 'inputs' || sub === 'magnets') return null
  const q = new URLSearchParams(query)
  if (sub === 'errors') q.set('view', 'posts')
  return dHash('content', subOf(sub, q), q)
}
export type Trio = Record<Lane, number | null | undefined>
export type Gen = Record<Lane, { n: number; stalled: number }>
export function SubNav({ on, attention = false, lane = 'ivan', section, v2 = false, counts }: {
  on: Sub; attention?: boolean; lane?: Lane; section?: string | null
  /** Brief 4 frame (SPEC-content §2.0): counts on the tabs, the ⋯ at the end of the tab row, no second row. */
  v2?: boolean
  counts?: Partial<Record<Sub, number | null>>
}) {
  const f = useFrame()
  const context = { lane }
  const [more, setMore] = useState(false)
  const tabs = useRef<HTMLElement>(null)
  // Phone: the tab row scrolls sideways; the open tab is brought into view only when it is off-screen, and then
  // whole (left edge on the row's 20px gutter), so the row never opens on a half-cut tab (never the page: scrollLeft only).
  useLayoutEffect(() => {
    const row = tabs.current, cur = row?.querySelector<HTMLElement>('a.cn-on')
    if (!row || !cur || f.layout !== 'phone') return
    const rowBox = row.getBoundingClientRect()
    const curBox = cur.getBoundingClientRect()
    const more = row.querySelector<HTMLElement>('.cn-more-key')
    const visibleRight = more ? more.getBoundingClientRect().left : rowBox.right
    if (curBox.left >= rowBox.left + 12 && curBox.right <= visibleRight - 8) return
    const previous = cur.previousElementSibling as HTMLElement | null
    const anchor = previous?.matches('a') ? previous : cur
    const left = row.scrollLeft + anchor.getBoundingClientRect().left - rowBox.left - (anchor === cur ? 20 : 0)
    row.scrollTo({ left: Math.max(0, left), behavior: 'instant' })
  }, [on, f.layout])
  const sheet = <Sheet open={more} onClose={() => setMore(false)} title="More in Content"><div className="cn-more">
    {MORE.map(g => <div key={g.group} className="cn-more-g"><span className="cn-more-h">{g.group}</span>
      {g.items.map(i => <a key={i.label} href={dHash('content', i.sub, { ...context, ...(i.q ?? {}) })} onClick={() => setMore(false)}><b>{i.label}</b>{i.small && <small>{i.small}</small>}</a>)}
    </div>)}
    <a href="#search" onClick={e => { e.preventDefault(); setMore(false); f.openPalette() }}><b>Search every post</b></a>
  </div></Sheet>
  if (v2) return <>
    <nav ref={tabs} className={`cn-now-tabs cv2-tabs ${f.layout === 'phone' ? 'cn-ptabs' : 'cn-sub'}`} aria-label="Content places">
      {SUBS.map(s => {
        const n = counts?.[s]
        return <a key={s} href={dHash('content', s, context)} className={s === on ? 'cn-on' : ''} aria-current={s === on ? 'page' : undefined} data-sub={s}>
          {SUB_LABEL[s]}{n !== undefined && <b className="cv2-tabn" aria-label={n == null ? 'counting' : `${n} waiting`}>{n == null ? '…' : n}</b>}
        </a>
      })}
      <span className="cn-grow" />
      <button type="button" className="cn-more-key cv2-tabs-more" data-verb="content-more" aria-label="Sources, history and more" aria-expanded={more} onClick={() => setMore(true)}>⋯</button>
    </nav>
    {sheet}
  </>
  return <>
    <nav className={`cn-now-tabs ${f.layout === 'phone' ? 'cn-ptabs' : 'cn-sub'}`} aria-label="Content places">
      {SUBS.map(s => <a key={s} href={dHash('content', s, context)} className={s === on ? 'cn-on' : ''} aria-current={s === on ? 'page' : undefined}>
        {SUB_LABEL[s]}{(s === 'now' || s === 'brain') && attention && <i className="cn-attention" aria-label="Needs a tap" />}
      </a>)}
      <span className="cn-grow" />
    </nav>
    <nav className="cn-planning" aria-label="Content planning">
      {PLANNING.map(p => {
        const active = on === p.sub && (p.sub !== 'strategy' || (section ?? 'this-week') === p.section)
        return <a key={p.label} href={dHash('content', p.sub, { ...context, ...(p.section ? { section: p.section } : {}) })} className={active ? 'cn-on' : undefined} aria-current={active ? 'page' : undefined}>{p.label}</a>
      })}
      {PLANNING.length === 0 && <button type="button" className="cn-more-text" data-verb="content-more" aria-expanded={more} onClick={() => setMore(true)}>Sources, history and more</button>}
      <span className="cn-grow" />
      <button type="button" className="cn-more-key" aria-label="More in Content" aria-expanded={more} onClick={() => setMore(true)}>⋯</button>
    </nav>
    {sheet}
  </>
}
