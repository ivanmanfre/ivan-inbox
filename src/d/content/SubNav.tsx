import { useState } from 'react'
import { dHash } from '../route'
import { useFrame } from '../shell/frame'
import { Sheet } from '../ui/Sheet'
import type { Lane } from './model'

export type Sub = 'now' | 'ideas' | 'results' | 'strategy' | 'styles' | 'planner' | 'review' | 'inputs' | 'magnets' | 'errors' | 'queue' | 'markets'
export const SUBS: readonly Sub[] = ['ideas', 'now', 'magnets', 'results']
export const SUB_LABEL: Record<Sub, string> = { now: 'Review', ideas: 'Ideas', results: 'Results', strategy: 'Strategy', styles: 'Styles', planner: 'Planner', review: 'Review', inputs: 'Inputs', magnets: 'Lead magnets', errors: 'Errors', queue: 'Publish queue', markets: 'Outliers & Markets' }
export const PLANNING = [
  { sub: 'strategy', section: 'direction', label: 'Strategy' },
  { sub: 'strategy', section: 'this-week', label: 'Content brain' },
  { sub: 'inputs', section: null, label: 'Inputs' },
] as const
export function subOf(s: string | null, query = new URLSearchParams()): Sub {
  if (!s) return query.has('magnet') ? 'magnets' : query.has('draft') || query.has('view') ? 'now' : 'ideas'
  if (s === 'markets') return 'inputs'
  return s === 'ideas' || s === 'results' || s === 'strategy' || s === 'styles' || s === 'inputs' || s === 'magnets' ? s : 'now'
}
/** Old bookmarks keep their row/client identities and reach the corresponding review view. */
export function contentRedirect(sub: string | null, query: URLSearchParams): string | null {
  if (sub === 'now' || sub === 'ideas' || sub === 'results' || sub === 'strategy' || sub === 'styles' || sub === 'inputs' || sub === 'magnets') return null
  const q = new URLSearchParams(query)
  if (sub === 'queue' || sub === 'planner') q.set('view', 'planner')
  if (sub === 'errors') q.set('view', 'posts')
  return dHash('content', subOf(sub, q), q)
}
export type Trio = Record<Lane, number | null | undefined>
export type Gen = Record<Lane, { n: number; stalled: number }>
export function SubNav({ on, attention = false, lane = 'ivan', section }: { on: Sub; attention?: boolean; lane?: Lane; section?: string | null }) {
  const f = useFrame()
  const context = { lane }
  const [more, setMore] = useState(false)
  return <>
    <nav className={`cn-now-tabs ${f.layout === 'phone' ? 'cn-ptabs' : 'cn-sub'}`} aria-label="Content places">
      {SUBS.map(s => <a key={s} href={dHash('content', s, context)} className={s === on ? 'cn-on' : ''} aria-current={s === on ? 'page' : undefined}>
        {SUB_LABEL[s]}{s === 'now' && attention && <i className="cn-attention" aria-label="Needs a tap" />}
      </a>)}
      <span className="cn-grow" />
    </nav>
    <nav className="cn-planning" aria-label="Content planning">
      {PLANNING.map(p => {
        const active = on === p.sub && (p.sub !== 'strategy' || (section ?? 'this-week') === p.section)
        return <a key={p.label} href={dHash('content', p.sub, { ...context, ...(p.section ? { section: p.section } : {}) })} className={active ? 'cn-on' : undefined} aria-current={active ? 'page' : undefined}>{p.label}</a>
      })}
      <span className="cn-grow" />
      <button type="button" className="cn-more-key" aria-label="More in Content" aria-expanded={more} onClick={() => setMore(true)}>⋯</button>
    </nav>
    <Sheet open={more} onClose={() => setMore(false)} title="More in Content"><div className="cn-more">
      {(['styles'] as const).map(s => <a key={s} href={dHash('content', s, context)} onClick={() => setMore(false)}><b>{SUB_LABEL[s]}</b></a>)}
      <a href={dHash('content', 'now', { ...context, view: 'posts' })} onClick={() => setMore(false)}><b>All posts</b><small>Filters, search and bulk actions</small></a>
      <a href="#search" onClick={e => { e.preventDefault(); setMore(false); f.openPalette() }}><b>Search every post</b></a>
    </div></Sheet>
  </>
}
