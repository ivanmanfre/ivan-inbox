/* ==========================================================================
   OWN-POST THEMES — read for the tail, not the median (Ivan 2026-09-12).

   One card per theme, biggest post first: the best post with its outlier
   ratio, the median beside it, the mix of angles, and who engaged with their
   fit. Read-only; one RPC; nothing here writes.

   HOOKS. Every hook is declared at the top of its component, before any
   branch (the 2026-09-09 blank-conversations incident).
   ========================================================================== */
import { useEffect, useState } from 'react'
import { Badge } from '../../ds'
import { Group } from '../kit'
import { CalmEmpty, Failed } from './parts'
import {
  angleLabel, angleMix, fetchThemes, fitLine, num, outlierRatio, themeLabel,
  type Theme, type ThemePost, type ThemesState,
} from '../../lib/themes'
import type { ContentLane } from '../../lib/content'
import './content.css'

function PostLine({ p }: { p: ThemePost }) {
  return (
    <div className="a-th-post">
      <div className="a-th-post-top">
        <span className="a-mono">{num(p.imp)} imp · {num(p.eng)} eng</span>
        <span className="a-dim a-mono">{String(p.at).slice(0, 10)} · {angleLabel(p.angle)}</span>
      </div>
      <div className="a-th-post-txt">{p.text}</div>
      <div className="a-ct-sub">
        {fitLine(p.people, p.fit)}
        {p.url ? <> · <a href={p.url} target="_blank" rel="noreferrer">open</a></> : null}
      </div>
    </div>
  )
}

function ThemeCard({ t }: { t: Theme }) {
  const best = t.posts[0]
  const ratio = outlierRatio(t.best_imp, t.median_imp)
  return (
    <div className="a-th-card" data-theme={t.theme}>
      <div className="a-th-head">
        <div>
          <div className="a-th-name">{themeLabel(t.theme)}</div>
          <div className="a-ct-sub">{t.n} post{t.n === 1 ? '' : 's'} · median {num(t.median_imp)} imp · {fitLine(t.people, t.fit)}</div>
        </div>
        <div className="a-th-best">
          <span className="a-th-best-v">{num(t.best_imp)}</span>
          <span className="a-ct-sub">best{ratio ? ` · ${ratio}` : ''}</span>
        </div>
      </div>
      {t.angles ? <div className="a-ct-sub a-th-angles">{angleMix(t.angles)}</div> : null}
      {best ? <div className="a-th-posts">{t.posts.map((p, i) => <PostLine key={p.url ?? i} p={p} />)}</div> : null}
    </div>
  )
}

/** Exported so the suite can render from a fixture without a fetch. */
export function ThemesView({ state, onRetry }: { state: ThemesState; onRetry?: () => void }) {
  const label = 'Your posts by theme'
  if (state.kind === 'loading') {
    return <Group className="a-th-g" label={label} pad><div className="a-ct-sub">Reading…</div></Group>
  }
  if (state.kind === 'failed') {
    return <Group className="a-th-g" label={label} pad><Failed what="the themes" message={state.message} onRetry={onRetry} /></Group>
  }
  if (state.kind === 'empty') {
    return <Group className="a-th-g" label={label} pad><CalmEmpty line={state.reason} /></Group>
  }
  const d = state.data
  return (
    <Group
      className="a-th-g"
      label={label}
      tail={<Badge tone="neutral" variant="ring">{d.posts_total} posts · {d.days} days{d.untagged ? ` · ${d.untagged} not yet read` : ''}</Badge>}
      pad
    >
      <div className="a-ct-sub a-th-intro">
        Sorted by the biggest post in each theme. "Fit" counts engagers our scorer rated 7 or more, so a big post
        reads as a buyer bet or a reach bet. Angle is the move the post makes; the theme is what it is about.
      </div>
      <div className="a-th-grid">
        {d.themes.map(t => <ThemeCard key={t.theme} t={t} />)}
      </div>
    </Group>
  )
}

export function ThemesBlock({ lane }: { lane: ContentLane }) {
  // ---- hooks, all of them, before any branch ------------------------------
  const [state, setState] = useState<ThemesState>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setState({ kind: 'loading' })
    fetchThemes(lane).then(s => { if (live) setState(s) })
    return () => { live = false }
  }, [lane, tick])
  return <ThemesView state={state} onRetry={() => setTick(t => t + 1)} />
}
