import { useState } from 'react'
import { dHash } from '../route'
import { useFrame } from '../shell/frame'
import { Sheet } from '../ui/Sheet'
import { LANES, type Lane } from './model'

// Every Content place, one row under the answer line (desktop), or Planner /
// Review / Ideas / More + a More sheet (phone). Counts per seat, never added.
export type Sub = 'planner' | 'review' | 'ideas' | 'magnets' | 'errors' | 'queue' | 'strategy' | 'markets' | 'results' | 'styles'

export const SUBS: readonly Sub[] = ['planner', 'review', 'ideas', 'magnets', 'errors', 'queue', 'strategy', 'markets', 'results', 'styles']

export const SUB_LABEL: Record<Sub, string> = {
  planner: 'Planner', review: 'Review', ideas: 'Ideas', magnets: 'Magnets', errors: 'Errors',
  queue: 'Publish queue', strategy: 'Strategy', markets: 'Outliers & Markets', results: 'Results', styles: 'Styles',
}

const MORE_LINE: Partial<Record<Sub, string>> = {
  magnets: 'lead magnets, list and window',
  errors: 'errors and stuck, every post, filters, bulk',
  queue: 'what goes out on your feed, Unpublish',
  strategy: 'this week, research briefs, client direction',
  markets: 'Use this, market readout',
  results: 'reach, boosted, benchmark, themes, audience',
  styles: 'looks and templates',
}

export function subOf(s: string | null): Sub {
  return (SUBS as readonly string[]).includes(s ?? '') ? (s as Sub) : 'planner'
}

export type Trio = Record<Lane, number | null>

export function TrioN({ v, tone }: { v: Trio; tone?: 'hot' | 'warn' }) {
  return (
    <span className="cn-trio">
      {LANES.map((l, i) => (
        <span key={l}>{i > 0 && '·'}<i className={v[l] ? (tone === 'hot' ? 'cn-hot' : tone === 'warn' ? 'cn-warn' : '') : ''}>{v[l] ?? '?'}</i></span>
      ))}
    </span>
  )
}

type Counts = { review: Trio; ideas: Trio | null; errors: Trio }

function tail(s: Sub, c: Counts) {
  if (s === 'review') return <TrioN v={c.review} tone="hot" />
  if (s === 'ideas' && c.ideas) return <TrioN v={c.ideas} />
  if (s === 'errors') return <TrioN v={c.errors} tone="warn" />
  return null
}

export function SubNav({ on, counts }: { on: Sub; counts: Counts }) {
  const f = useFrame()
  const [more, setMore] = useState(false)
  if (f.layout === 'phone') {
    const main: Sub[] = ['planner', 'review', 'ideas']
    const inMore = !main.includes(on)
    return (
      <>
        <nav className="cn-ptabs" aria-label="Content places">
          {main.map(s => (
            <a key={s} href={dHash('content', s === 'planner' ? null : s)} className={s === on ? 'cn-on' : ''}>
              {SUB_LABEL[s]}{s === 'review' && tail(s, counts)}
            </a>
          ))}
          <a href="#more" className={inMore ? 'cn-on' : ''} onClick={e => { e.preventDefault(); setMore(true) }}>
            {inMore ? SUB_LABEL[on] : 'More'}
          </a>
        </nav>
        <Sheet open={more} onClose={() => setMore(false)} title="More in Content">
          <div className="cn-more">
            <a href="#search" onClick={e => { e.preventDefault(); setMore(false); f.openPalette() }}>
              <div><b>Search every post</b><small>opens Commands</small></div>
            </a>
            {SUBS.filter(s => !main.includes(s)).map(s => (
              <a key={s} href={dHash('content', s)} onClick={() => setMore(false)}>
                <div><b>{SUB_LABEL[s]}</b><small>{MORE_LINE[s]}</small></div>{tail(s, counts)}
              </a>
            ))}
          </div>
        </Sheet>
      </>
    )
  }
  return (
    <nav className="cn-sub" aria-label="Content places">
      {SUBS.map(s => (
        <a key={s} href={dHash('content', s === 'planner' ? null : s)} className={s === on ? 'cn-on' : ''} aria-current={s === on ? 'page' : undefined}>
          {SUB_LABEL[s]}{tail(s, counts)}
        </a>
      ))}
      <span className="cn-grow" />
      <button type="button" className="cn-find" onClick={f.openPalette}><span>Search</span><kbd>⌘K</kbd></button>
    </nav>
  )
}
