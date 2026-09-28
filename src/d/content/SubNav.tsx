import { useEffect, useRef, useState } from 'react'
import { dHash } from '../route'
import { useFrame } from '../shell/frame'
import { Sheet } from '../ui/Sheet'
import { LANES, LANE_NAME, type Lane } from './model'

// Every Content place, one row under the answer line (desktop), or Planner /
// Review / Ideas / More + a More sheet (phone). Counts per seat, never added.
export type Sub = 'planner' | 'review' | 'ideas' | 'inputs' | 'magnets' | 'errors' | 'queue' | 'strategy' | 'markets' | 'results' | 'styles'

// 'markets' stays a valid address (old links, ⌘K) but is no longer listed: CB-22 folds the market readout and
// every outlier under Inputs, and subOf() sends 'markets' there.
export const SUBS: readonly Sub[] = ['planner', 'review', 'ideas', 'inputs', 'magnets', 'errors', 'queue', 'strategy', 'results', 'styles']

export const SUB_LABEL: Record<Sub, string> = {
  planner: 'Planner', review: 'Review', ideas: 'Ideas', inputs: 'Inputs', magnets: 'Magnets', errors: 'Errors',
  queue: 'Publish queue', strategy: 'Strategy', markets: 'Outliers & Markets', results: 'Results', styles: 'Styles',
}

const MORE_LINE: Partial<Record<Sub, string>> = {
  magnets: 'lead magnets, list and window',
  errors: 'errors and stuck, every post, filters, bulk',
  queue: 'what goes out on your feed, Unpublish',
  strategy: 'this week, research briefs, client direction',
  inputs: 'top outliers, buyers on your posts, market readout',
  markets: 'Use this, market readout',
  results: 'reach, boosted, benchmark, themes, audience',
  styles: 'looks and templates',
}

export function subOf(s: string | null): Sub {
  if (s === 'markets') return 'inputs'
  return (SUBS as readonly string[]).includes(s ?? '') ? (s as Sub) : 'planner'
}

/** Per seat: a number, null = could not read, undefined = still reading. */
export type Trio = Record<Lane, number | null | undefined>

export function TrioN({ v, tone }: { v: Trio; tone?: 'hot' | 'warn' }) {
  return (
    <span className="cn-trio">
      {LANES.map((l, i) => (
        <span key={l}>{i > 0 && '·'}<i className={v[l] ? (tone === 'hot' ? 'cn-hot' : tone === 'warn' ? 'cn-warn' : '') : ''}>{v[l] === undefined ? '…' : v[l] ?? '?'}</i></span>
      ))}
    </span>
  )
}

type Counts = { review: Trio; ideas: Trio | null; errors: Trio; magnets?: Trio }

/** In flight per seat: generating (or planned) and how many of those stalled past 20 minutes. */
export type Gen = Record<Lane, { n: number; stalled: number }>

function tail(s: Sub, c: Counts) {
  if (s === 'review') return <TrioN v={c.review} tone="hot" />
  if (s === 'ideas' && c.ideas) return <TrioN v={c.ideas} />
  if (s === 'errors') return <TrioN v={c.errors} tone="warn" />
  if (s === 'magnets' && c.magnets) return <TrioN v={c.magnets} tone="hot" />
  return null
}

/** Today's in-flight mark ("generating · N stalled"): opens the Generating tab of the seat that has it. */
export function GenMark({ gen }: { gen: Gen }) {
  const n = LANES.reduce((a, l) => a + (gen[l].n > 0 ? 1 : 0), 0)
  if (!n) return null
  const lane = LANES.find(l => gen[l].stalled > 0) ?? LANES.find(l => gen[l].n > 0) ?? 'ivan'
  const bad = LANES.some(l => gen[l].stalled > 0)
  return (
    <a className={`cn-gen${bad ? ' cn-gen-bad' : ''}`} data-verb="open-generating" href={dHash('content', 'errors', { tab: 'generating', ...(lane === 'ivan' ? {} : { lane }) })}
      title="Drafts handed to generation that have not come back. Opens Generating.">
      generating {LANES.filter(l => gen[l].n > 0).map(l => `${LANE_NAME[l]} ${gen[l].n}${gen[l].stalled ? ` (${gen[l].stalled} stalled)` : ''}`).join(' · ')}
    </a>
  )
}

export function SubNav({ on, counts, gen }: { on: Sub; counts: Counts; gen?: Gen }) {
  const f = useFrame()
  const [more, setMore] = useState(false)
  // Five phone pills (Planner, Review, Ideas, Inputs, More) overflow 390 px: keep the current one in view (the strip only, never the page).
  const strip = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const nav = strip.current, tab = nav?.querySelector<HTMLElement>('a.cn-on')
    if (!nav || !tab) return
    const n = nav.getBoundingClientRect(), t = tab.getBoundingClientRect()
    if (t.left < n.left || t.right > n.right) nav.scrollLeft += (t.left - n.left) - (n.width - t.width) / 2
  }, [on, f.layout])
  if (f.layout === 'phone') {
    const main: Sub[] = ['planner', 'review', 'ideas', 'inputs']
    const inMore = !main.includes(on)
    return (
      <>
        <nav className="cn-ptabs" aria-label="Content places" ref={strip}>
          {main.map(s => (
            <a key={s} href={dHash('content', s === 'planner' ? null : s)} className={s === on ? 'cn-on' : ''}>
              {SUB_LABEL[s]}{s === 'review' && tail(s, counts)}
            </a>
          ))}
          <a href="#more" className={`cn-pmore${inMore ? ' cn-on' : ''}`} aria-label={inMore ? `${SUB_LABEL[on]}, more places` : 'More places'} onClick={e => { e.preventDefault(); setMore(true) }}>
            {inMore ? SUB_LABEL[on] : '⋯'}
          </a>
        </nav>
        <Sheet open={more} onClose={() => setMore(false)} title="More in Content">
          <div className="cn-more">
            {gen && <GenMark gen={gen} />}
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
      {gen && <GenMark gen={gen} />}
      <button type="button" className="cn-find" onClick={f.openPalette}><span>Search</span><kbd>⌘K</kbd></button>
    </nav>
  )
}
