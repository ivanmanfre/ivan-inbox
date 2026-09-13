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
  type CanonicalTheme, type Theme, type ThemePost, type ThemesState,
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

function CanonicalDimension({ name, rows }: { name: string; rows: CanonicalTheme[] }) {
  if (!rows.length) return null
  const label = name.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
  const friendly = (value: string) => value.replace(/_/g, ' ')
  return <div className="a-th-card" data-dimension={name}>
    <div className="a-th-name">{label}</div>
    <div className="a-ct-sub">Unique own posts at the captured comparison age. Unknown remains a visible category.</div>
    <div className="a-bm-measure-grid">{rows.map((r, i) => {
      const value = r.value ?? r.subject ?? r.purpose ?? r.hook ?? r.format ?? 'unknown'
      return <div className="a-bm-measure-row" key={`${value}-${i}`}><div><strong>{friendly(value)}</strong><span>n={r.n} · impressions n={r.impression_n} · engagement n={r.engagement_n}{r.target_age_days ? ` · ${r.target_age_days}d matched age` : ' · no selected 7/14-day snapshot'}</span></div><div className="a-bm-measure-detail">Median impressions {num(r.median_imp)} · median engagement {num(r.median_eng)}</div></div>
    })}</div>
  </div>
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
      {d.canonical ? <div className="a-th-grid">{Object.entries(d.canonical).map(([name, rows]) => <CanonicalDimension key={name} name={name} rows={rows || []} />)}</div> : <div className="a-th-grid">{d.themes.map(t => <ThemeCard key={t.theme} t={t} />)}</div>}
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
