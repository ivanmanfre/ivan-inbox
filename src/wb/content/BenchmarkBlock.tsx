/* ==========================================================================
   AUDIENCE BENCHMARK — this lane against the accounts we watch.

   Ivan, 2026-09-11, after seeing the proposals as a wall of text: "i want
   something better and usable". The shape is the one he pointed at (a
   benchmark dashboard: tiles, format, timing, account table, top posts), on
   our own data, one lane at a time. It sits ABOVE the proposals so the
   numbers come before the sentences written from them.

   Read-only. One RPC, one render. Nothing here writes; the proposals block
   below stays the only writer on this screen.

   HOOKS. Every hook is declared at the top of its component, before any
   branch. A hook placed after an early return blanked every DM conversation
   in this app for about an hour on 2026-09-09.
   ========================================================================== */
import { useEffect, useState } from 'react'
import { Badge } from '../../ds'
import { Group } from '../kit'
import { CalmEmpty, Failed } from './parts'
import {
  DAYS, HEAT_FLOOR, ROLE_EXPLAINER, ROLE_LABEL, fetchBenchmark, formatRows, heatIndex, heatScale,
  num, peakLine, ratioLine, shortDate, subLine,
  type Benchmark, type BenchmarkState, type BenchPost,
} from '../../lib/benchmark'
import type { ContentLane } from '../../lib/content'
import './content.css'

function RoleChip({ role }: { role: string }) {
  const label = ROLE_LABEL[role] ?? role
  return <span className={`a-bm-role a-bm-role-${role}`}>{label}</span>
}

function Tiles({ b, lane }: { b: Benchmark; lane: ContentLane }) {
  const t = b.tiles
  const y = t.you
  const ratio = ratioLine(t.their_median, y.median)
  const f = t.top_format ? b.formats[t.top_format] : null
  return (
    <div className="a-bm-tiles">
      <div className="a-bm-tile">
        <span className="a-eyebrow">Their typical post</span>
        <span className="a-bm-v">{num(t.their_smart)}</span>
        <span className="a-bm-d">median {num(t.their_median)} · {b.window.posts90} posts</span>
      </div>
      <div className="a-bm-tile">
        <span className="a-eyebrow">{lane === 'ivan' ? 'Your typical post' : 'Their own typical post'}</span>
        <span className="a-bm-v">{num(y.smart)}{ratio ? <small>{ratio}</small> : null}</span>
        <span className="a-bm-d">
          median {num(y.median)} · {y.n} posts{y.imp_median ? ` · median ${num(y.imp_median)} impressions` : ''}
        </span>
      </div>
      <div className="a-bm-tile">
        <span className="a-eyebrow">Posting pace</span>
        <span className="a-bm-v">{y.per_wk}<small>per week</small></span>
        <span className="a-bm-d">roster accounts average {t.roster_pace ?? '–'} / wk</span>
      </div>
      <div className="a-bm-tile">
        <span className="a-eyebrow">Format that lands for them</span>
        <span className="a-bm-v a-bm-cap">{t.top_format ?? '–'}</span>
        <span className="a-bm-d">{f ? `typical ${num(f.theirs)} on ${f.n} posts` : 'fewer than 5 posts in any format'}</span>
      </div>
    </div>
  )
}

function Formats({ b }: { b: Benchmark }) {
  const rows = formatRows(b.formats)
  const you = b.tiles.you.smart
  return (
    <div className="a-bm-panel">
      <div className="a-bm-h">Engagement by format</div>
      <div className="a-ct-sub">Typical post per format, theirs. The lane's own typical post, all formats, is {num(you)}.</div>
      <div className="a-bm-bars">
        {rows.map(r => (
          <div key={r.media} className="a-bm-bar-row">
            <div className="a-bm-bar-lbl"><span className="a-bm-cap">{r.media}</span><span className="a-dim"> · {r.n}</span></div>
            <div className="a-bm-bar-track"><div className="a-bm-bar" style={{ width: `${r.pct}%` }} /></div>
            <div className="a-bm-bar-val a-mono">{num(r.theirs)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Heat({ b }: { b: Benchmark }) {
  const idx = heatIndex(b.heat)
  const scale = heatScale(b.heat)
  return (
    <div className="a-bm-panel">
      <div className="a-bm-h">When their posts land</div>
      <div className="a-ct-sub">Average engagement by day and hour, UTC, last 12 months. Cells under {HEAT_FLOOR} posts are blank. {peakLine(b.heat)}</div>
      <div className="a-bm-heat-scroll">
        <div className="a-bm-heat" role="img" aria-label="Engagement by weekday and hour">
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={`h${h}`} className="a-bm-heat-hl">{h % 3 === 0 ? h : ''}</div>
          ))}
          {DAYS.map((d, di) => (
            <div key={d} className="a-bm-heat-rowc">
              <div className="a-bm-heat-dl">{d}</div>
              {Array.from({ length: 24 }, (_, h) => {
                const c = idx.get(`${di}-${h}`)
                const p = scale(c)
                const title = c ? `${d} ${h}:00 · ${num(c.avg)} avg on ${c.n} post${c.n === 1 ? '' : 's'}` : `${d} ${h}:00 · no posts`
                return (
                  <div
                    key={h}
                    className="a-bm-cell"
                    data-on={p > 0 ? '1' : '0'}
                    style={p > 0 ? { opacity: 0.25 + 0.75 * p } : undefined}
                    title={title}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Accounts({ b, lane }: { b: Benchmark; lane: ContentLane }) {
  const y = b.tiles.you
  return (
    <div className="a-bm-panel">
      <div className="a-bm-h">Account by account, last {b.days} days</div>
      <div className="a-ct-sub">Sorted by typical post. The lane's own row is highlighted. {ROLE_EXPLAINER}</div>
      <div className="a-bm-tscroll">
        <table className="a-bm-table">
          <thead>
            <tr>
              <th>Account</th><th>Role</th><th className="a-bm-num">Posts / wk</th><th className="a-bm-num">Median</th>
              <th className="a-bm-num">Typical</th><th>Mostly</th><th>Best post, {b.days} d</th>
            </tr>
          </thead>
          <tbody>
            <tr className="a-bm-you">
              <td>{lane === 'ivan' ? 'You' : 'This lane'}</td>
              <td><span className="a-bm-role">own posts</span></td>
              <td className="a-bm-num">{y.per_wk}</td>
              <td className="a-bm-num">{num(y.median)}</td>
              <td className="a-bm-num">{num(y.smart)}</td>
              <td />
              <td className="a-dim">{y.n} posts with metrics</td>
            </tr>
            {b.accounts.map(a => (
              <tr key={a.who}>
                <td>{a.who}</td>
                <td><RoleChip role={a.role} /></td>
                <td className="a-bm-num">{a.per_wk}</td>
                <td className="a-bm-num">{num(a.median)}</td>
                <td className="a-bm-num">{num(a.smart)}</td>
                <td className="a-bm-cap">{a.media}</td>
                <td>
                  {a.best?.url
                    ? <a href={a.best.url} target="_blank" rel="noreferrer">{num(a.best.eng)} · {a.best.text}</a>
                    : <span>{a.best ? `${num(a.best.eng)} · ${a.best.text}` : '–'}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Post({ p }: { p: BenchPost }) {
  return (
    <div className="a-bm-post">
      <div className="a-bm-post-who">
        <span>{p.who} <RoleChip role={p.role} /></span>
        <span className="a-mono a-dim">{shortDate(p.at)} · {p.media}</span>
      </div>
      <div className="a-bm-post-eng">
        {num(p.eng)} <small>{num(p.likes)} reactions · {num(p.comments)} comments</small>
      </div>
      <div className="a-bm-post-txt">{p.text}</div>
      {p.angle
        ? <div className="a-bm-post-angle"><b>Angle for this lane.</b> {p.angle}</div>
        : p.why ? <div className="a-bm-post-angle"><b>Why it worked.</b> {p.why}</div> : null}
      {p.url ? <a className="a-ct-sub" href={p.url} target="_blank" rel="noreferrer">open post</a> : null}
    </div>
  )
}

function TopPosts({ b }: { b: Benchmark }) {
  return (
    <div className="a-bm-panel">
      <div className="a-bm-h">Their posts worth studying</div>
      <div className="a-ct-sub">Top of the last {b.days} days, at most three per account. Where an angle was already written, it sits under the post.</div>
      <div className="a-bm-posts">
        {b.top.map(p => <Post key={p.url ?? `${p.who}-${p.at}`} p={p} />)}
      </div>
    </div>
  )
}

/** Exported so the suite can render the block from a fixture without a fetch. */
export function BenchmarkView({ lane, state, onRetry }: {
  lane: ContentLane
  state: BenchmarkState
  onRetry?: () => void
}) {
  const label = 'Against the accounts we watch'
  if (state.kind === 'loading') {
    return (
      <Group className="a-bm-g" label={label} pad>
        <div className="a-ct-sub">Reading…</div>
      </Group>
    )
  }
  if (state.kind === 'failed') {
    return (
      <Group className="a-bm-g" label={label} pad>
        <Failed what="the benchmark" message={state.message} onRetry={onRetry} />
      </Group>
    )
  }
  if (state.kind === 'empty') {
    return (
      <Group className="a-bm-g" label={label} pad>
        <CalmEmpty line={state.reason} />
      </Group>
    )
  }
  const b = state.data
  return (
    <Group
      className="a-bm-g"
      label={label}
      tail={<Badge tone="neutral" variant="ring">{subLine(b)}</Badge>}
      pad
    >
      <Tiles b={b} lane={lane} />
      <div className="a-bm-two">
        <Formats b={b} />
        <Heat b={b} />
      </div>
      <Accounts b={b} lane={lane} />
      <TopPosts b={b} />
      <div className="a-ct-sub a-bm-foot">
        Engagement = reactions + comments, the only counts every source gives us. "Typical" = mean with the top and bottom 5% cut, so one viral post cannot move it. The lane's own numbers come from the post tracker; a post with no refreshed metrics is left out.
      </div>
    </Group>
  )
}

export function BenchmarkBlock({ lane }: { lane: ContentLane }) {
  // ---- hooks, all of them, before any branch ------------------------------
  const [state, setState] = useState<BenchmarkState>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setState({ kind: 'loading' })
    fetchBenchmark(lane).then(s => { if (live) setState(s) })
    return () => { live = false }
  }, [lane, tick])
  return <BenchmarkView lane={lane} state={state} onRetry={() => setTick(t => t + 1)} />
}
