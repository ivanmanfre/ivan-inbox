/* ==========================================================================
   WHO THE POSTS REACHED: Strategy > Results, first block, one read per lane.

   Ivan 2026-09-15: "i want to see that for me and every client in strategy
   section" and "we need to backfill with past weeks data... so we can have
   history". It sits FIRST in Results because it is the one block there with a
   reading on every lane today; the matched-age block below it has no supported
   percentile on any lane yet and takes a full phone screen of controls.

   Rules this block keeps:
     · every figure carries its denominator (posts, posts with a split, posts
       that report reach),
     · a failed or empty read renders as Failed with a retry, never as a calm
       empty (every lane has tracked posts on record),
     · a week with posts but no split says so instead of drawing an empty bar,
     · no lime: nothing here is live state.
   All math lives in lib/reach (pure, unit-tested).
   ========================================================================== */
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../ds'
import { Cell, Group, Ledger, relAge } from '../kit'
import { Failed } from './parts'
import {
  INSIGHT_WEEKS, RECENT_WEEKS, dayLabel, fetchPostAudience, reachInsights, reachWinners, reachedOf, shortTitle, splitOf, summarizeReach, topBuckets,
  type PostAudienceRow, type ReachCategory, type ReachFollowers, type ReachGroup, type ReachRead, type ReachWeek,
} from '../../lib/reach'
import { num } from '../../lib/benchmark'
import type { ContentLane } from '../../lib/content'
import { RosterSection } from './RosterBlock'
import { DriftSection } from './DriftBlock'
import './content.css'
import './reach.css'

const FOLD_WEEKS = 12
const CATEGORY_LABEL: Record<ReachCategory, string> = { job_title: 'Job title', seniority: 'Seniority', industry: 'Industry', location: 'Location' }
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`

/** In network (dim) and out of network (bright) as one bar. */
function SplitBar({ outPct, label }: { outPct: number; label: string }) {
  return (
    <span className="a-reach-split" role="img" aria-label={label}>
      <span className="a-reach-split-out" style={{ width: `${Math.max(0, Math.min(100, outPct))}%` }} />
    </span>
  )
}

function PostLine({ p, thisYear }: { p: PostAudienceRow; thisYear: number }) {
  const sp = splitOf(p)
  const reached = reachedOf(p)
  const titles = topBuckets(p.demographics?.job_title, 2)
  const industry = topBuckets(p.demographics?.industry, 1)[0]
  const location = topBuckets(p.demographics?.location, 1)[0]
  const date = p.published_at ? dayLabel(p.published_at.slice(0, 10), thisYear) : 'Date unknown'
  // The trackers store the first 80 characters of the post as its title.
  const raw = p.title?.trim() ?? ''
  const title = !raw ? 'Untitled post' : (p.title?.length ?? 0) >= 80 ? `${raw}…` : raw
  return (
    <li className="a-reach-post">
      {p.post_url
        ? <a className="a-reach-post-t" href={p.post_url} target="_blank" rel="noopener noreferrer">{title}</a>
        : <span className="a-reach-post-t">{title}</span>}
      <span className="a-reach-post-m">
        <span className="a-mono">{date}</span>
        {sp
          ? <span className="a-reach-post-split"><SplitBar outPct={sp.outPct} label={`In network ${sp.inPct}%, out of network ${sp.outPct}%`} /><span className="a-mono">{sp.inPct}% in · {sp.outPct}% out</span></span>
          : <span>No split for this post</span>}
        <span className="a-mono">{reached != null ? `${num(reached)} reached` : 'Reach not reported'}</span>
      </span>
      <span className="a-reach-post-d">
        {titles.length ? `Top job titles ${titles.map(t => `${t.label} ${t.pct}%`).join(' · ')}` : 'No job titles listed'}
        {industry ? ` · Industry ${industry.label} ${industry.pct}%` : ''}
        {location ? ` · Location ${location.label} ${location.pct}%` : ''}
      </span>
    </li>
  )
}

function WeekRow({ w, thisYear }: { w: ReachWeek; thisYear: number }) {
  const label = <span className="a-reach-wk-l"><span>{dayLabel(w.start, thisYear)}</span><span className="a-mono a-dim-2">W{w.week}</span></span>
  if (!w.posts.length) {
    return <li className="a-reach-week a-reach-week-empty">{label}<span className="a-dim-2">No posts</span></li>
  }
  return (
    <li>
      <details className="a-reach-week" data-has-posts="">
        <summary>
          <span className="a-reach-wk-top">
            {label}
            <span className="a-mono a-reach-wk-n">
              {plural(w.posts.length, 'post')} · {w.withReach ? `${num(w.reached)} reached` : 'reach not reported'}
            </span>
          </span>
          <span className="a-reach-wk-bot">
            {w.split
              ? <><SplitBar outPct={w.split.outPct} label={`Out of network ${w.split.outPct}%`} /><span className="a-mono a-reach-wk-pct">{w.split.outPct}% out</span></>
              : <span className="a-reach-wk-nosplit">No split on {w.posts.length === 1 ? 'this post' : 'these posts'}</span>}
            <span className="a-reach-wk-ind">
              {w.topIndustry ? `${w.topIndustry.label} ${w.topIndustry.pct}%` : 'No industry listed'}
            </span>
          </span>
          {w.split && w.withSplit < w.posts.length ? <span className="a-reach-wk-note">Split on {w.withSplit} of {w.posts.length} posts</span> : null}
        </summary>
        <ul className="a-reach-posts">
          {w.posts.map(p => <PostLine key={p.activity_id} p={p} thisYear={thisYear} />)}
        </ul>
      </details>
    </li>
  )
}

/** The readings the history supports, each with its post count. A reading below its floor is left out. */
const groupLine = (gs: ReachGroup[], views: boolean) => gs.map(g =>
  `${g.label} ${num(g.reached)} reached, ${views && g.profileViewsPer100 != null ? `${g.profileViewsPer100} profile views per 100` : `${g.outPct}% out`}`).join(' · ')

function Insights({ rows, now, followers }: { rows: PostAudienceRow[]; now: number; followers: ReachFollowers }) {
  const i = useMemo(() => reachInsights(rows, now, followers?.count ?? null), [rows, now, followers])
  const lines: { key: string; text: string; note: string }[] = []
  if (i.concentration) {
    const c = i.concentration
    lines.push({
      key: 'top',
      text: c.top.pct >= 50
        ? `One post is ${c.top.pct}% of the last ${RECENT_WEEKS} weeks: ${num(c.top.reached)} of ${num(c.reached)} people${c.top.title ? `, "${c.top.title}"` : ''}. The median post reached ${num(c.median)}.`
        : `The top post reached ${num(c.top.reached)} of the ${num(c.reached)} people in the last ${RECENT_WEEKS} weeks (${c.top.pct}%)${c.top.title ? `, "${c.top.title}"` : ''}. The median post reached ${num(c.median)}.`,
      note: `${plural(c.posts, 'post')} with reach`,
    })
  }
  if (i.floor) {
    lines.push({
      key: 'floor',
      text: `The author's own network shows a post to about ${num(i.floor.median)} people${i.floor.ofFollowers != null ? `, ${i.floor.ofFollowers}% of the ${num(i.floor.followers as number)} followers` : ''}, and 9 in 10 posts stay under ${num(i.floor.p90)}. Everything above that came from outside the network.`,
      note: `${plural(i.floor.posts, 'post')} with a split, last ${INSIGHT_WEEKS} weeks${followers ? ` · followers as of ${dayLabel(followers.date, new Date(now).getUTCFullYear())}` : ''}`,
    })
  }
  if (i.outcome) {
    lines.push({
      key: 'outcome',
      text: `Out of network follows reach: posts under 100 people run ${i.outcome.small.outPct}% out, posts over 300 run ${i.outcome.large.outPct}% out. It is a result of a post travelling, not a setting.`,
      note: `${num(i.outcome.small.n)} and ${plural(i.outcome.large.n, 'post')}, all history`,
    })
  }
  if (i.comments) {
    lines.push({
      key: 'comments',
      text: `Posts with at least one comment reached ${num(i.comments.withComments.median)} people at the median, posts with none ${num(i.comments.without.median)}.`,
      note: `${num(i.comments.withComments.n)} and ${plural(i.comments.without.n, 'post')}, all history`,
    })
  }
  if (i.byFunnelClass) {
    lines.push({
      key: 'funnel',
      text: `By funnel class: ${groupLine(i.byFunnelClass, true)}.`,
      note: `${i.byFunnelClass.map(g => `${g.label} ${g.n}`).join(', ')} posts, all history · median per class`,
    })
  }
  if (i.byHookType) {
    lines.push({
      key: 'hook',
      text: `By hook: ${groupLine(i.byHookType, false)}.`,
      note: `${i.byHookType.map(g => `${g.label} ${g.n}`).join(', ')} posts, all history · median per hook`,
    })
  }
  if (!lines.length) return null
  return (
    <div className="a-reach-sec" data-reach-insights={lines.length}>
      <div className="a-eyebrow">What the history says</div>
      <ul className="a-reach-ins">
        {lines.map(l => (
          <li key={l.key} className="a-reach-in" data-insight={l.key}>
            <span className="a-reach-in-t">{l.text}</span>
            <span className="a-mono a-dim-2 a-reach-in-n">{l.note}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const REUSE_STATUS: Record<string, string> = { staged: 'Reuse idea staged', approved: 'Reuse idea approved', drafted: 'Reuse drafted', published: 'Reused', archived: 'Reuse idea archived', rejected: 'Reuse idea rejected' }

function WinnerLine({ p, thisYear }: { p: PostAudienceRow; thisYear: number }) {
  const sp = splitOf(p), reached = reachedOf(p)
  const industry = topBuckets(p.demographics?.industry, 1)[0], location = topBuckets(p.demographics?.location, 1)[0]
  const title = shortTitle(p.title, 72) ?? 'Untitled post'
  const eligible = p.reuse?.eligible_at ? dayLabel(p.reuse.eligible_at.slice(0, 10), thisYear) : null
  const reuse = p.reuse
    ? `${REUSE_STATUS[p.reuse.status] ?? `Reuse idea ${p.reuse.status}`}${eligible && p.reuse.status === 'staged' ? ` · eligible ${eligible}` : ''}`
    : 'No reuse idea'
  return (
    <li className="a-reach-post a-reach-winner" data-reuse={p.reuse?.status ?? 'none'}>
      {p.post_url
        ? <a className="a-reach-post-t" href={p.post_url} target="_blank" rel="noopener noreferrer">{title}</a>
        : <span className="a-reach-post-t">{title}</span>}
      <span className="a-reach-post-m">
        <span className="a-mono">{p.published_at ? dayLabel(p.published_at.slice(0, 10), thisYear) : 'Date unknown'}</span>
        <span className="a-mono">{plural(p.comments ?? 0, 'comment')}</span>
        <span className="a-mono">{reached != null ? `${num(reached)} reached` : 'Reach not reported'}</span>
        {sp ? <span className="a-mono">{sp.outPct}% out</span> : null}
      </span>
      <span className="a-reach-post-d">
        {[industry ? `${industry.label} ${industry.pct}%` : null, location ? `${location.label} ${location.pct}%` : null].filter(Boolean).join(' · ') || 'No buckets listed'}
      </span>
      <span className="a-reach-post-d a-reach-reuse">{reuse}</span>
    </li>
  )
}

/** Rise: the tracker's flagged winners with their reuse status. Other lanes: the most commented posts, labelled as candidates. */
function Winners({ rows, now, thisYear }: { rows: PostAudienceRow[]; now: number; thisYear: number }) {
  const w = useMemo(() => reachWinners(rows, now), [rows, now])
  const flagged = w.mode === 'flagged'
  return (
    <div className="a-reach-sec" data-reach-winners={w.mode} data-winner-count={w.posts.length}>
      <div className="a-eyebrow">{flagged ? 'Winners' : `Most commented · last ${w.weeks} weeks`}</div>
      <div className="a-reach-foot">
        {flagged
          ? 'Flagged by the lane\'s winner rule: comments at three times the trailing 12-week median, at least 6. Impressions never count. A reuse idea opens 90 days after the post.'
          : 'No winner rule runs on this lane. These are candidates to read, not flags: a comment can be a tag or a question.'}
      </div>
      {w.posts.length
        ? <ul className="a-reach-posts a-reach-winners">{w.posts.map(p => <WinnerLine key={p.activity_id} p={p} thisYear={thisYear} />)}</ul>
        : <div className="a-dim-2 a-reach-share-none">{flagged ? 'No winners flagged.' : `No post with a comment in the last ${w.weeks} weeks.`}</div>}
    </div>
  )
}

export function ReachReady({ rows, followers, readAt, now: nowProp, lane }: { rows: PostAudienceRow[]; followers: ReachFollowers; readAt: string; now?: number; lane?: ContentLane }) {
  const [showOlder, setShowOlder] = useState(false)
  const [mountedAt] = useState(() => Date.now())
  const now = nowProp ?? mountedAt
  const s = useMemo(() => summarizeReach(rows, now), [rows, now])
  const thisYear = new Date(now).getUTCFullYear()
  const r = s.recent
  const visible = showOlder ? s.weeks : s.weeks.slice(0, FOLD_WEEKS)
  const hidden = s.weeks.length - visible.length
  return (
    <>
      <div className="a-ct-sub a-reach-lede">
        Last {RECENT_WEEKS} weeks, since {dayLabel(r.from, thisYear)}: {plural(r.posts, 'post')}, {num(r.withSplit)} with a split.
      </div>
      <Ledger>
        <Cell
          label="Out of network"
          value={r.split ? `${r.split.outPct}%` : null}
          emptyText={r.posts ? 'No split' : 'No posts'}
          note={r.split
            ? `In network ${r.split.inPct}% · weighted by members reached over ${plural(r.split.n, 'post')}`
            : r.posts ? `None of the ${plural(r.posts, 'post')} has a split` : `No posts since ${dayLabel(r.from, thisYear)}`}
        >
          {r.split ? <SplitBar outPct={r.split.outPct} label={`In network ${r.split.inPct}%, out of network ${r.split.outPct}%`} /> : null}
        </Cell>
        <Cell
          label="Members reached"
          value={r.withReach ? num(r.reached) : null}
          emptyText={r.posts ? 'Not reported' : 'No posts'}
          note={!r.withReach ? `No post since ${dayLabel(r.from, thisYear)} reports it` : r.withReach === r.posts ? `Summed over ${plural(r.posts, 'post')}` : `Summed over ${num(r.withReach)} of ${plural(r.posts, 'post')}, the rest do not report it`}
        />
      </Ledger>

      <Insights rows={rows} now={now} followers={followers} />
      <Winners rows={rows} now={now} thisYear={thisYear} />
      {lane ? <RosterSection lane={lane} own={rows} now={now} /> : null}
      {lane ? <DriftSection lane={lane} own={rows} now={now} /> : null}

      <div className="a-reach-sec">
        <div className="a-eyebrow">Share of members reached · last {RECENT_WEEKS} weeks</div>
        <div className="a-reach-shares">
          {(Object.keys(CATEGORY_LABEL) as ReachCategory[]).map(k => {
            const sh = r.shares[k]
            return (
              <div className="a-reach-share" key={k}>
                <div className="a-reach-share-h">
                  <span>{CATEGORY_LABEL[k]}</span>
                  <span className="a-mono a-dim-2">{sh ? `${plural(sh.posts, 'post')} · ${num(sh.reached)} reached` : 'no posts list it'}</span>
                </div>
                {sh ? sh.labels.map(l => (
                  <div className="a-reach-share-r" key={l.label}>
                    <span className="a-reach-share-l">{l.label}</span>
                    <span className="a-reach-share-bar"><span style={{ width: `${Math.max(2, Math.min(100, l.pct))}%` }} /></span>
                    <span className="a-mono">{l.pct}%</span>
                  </div>
                )) : <div className="a-dim-2 a-reach-share-none">No {CATEGORY_LABEL[k].toLowerCase()} buckets on the posts in these weeks.</div>}
              </div>
            )
          })}
        </div>
        <div className="a-reach-foot">
          LinkedIn lists only the largest groups per post, so smaller groups are not counted and shares do not add up to 100%.
        </div>
      </div>

      <div className="a-reach-sec">
        <div className="a-eyebrow">Week by week</div>
        <div className="a-reach-foot">
          ISO weeks from Monday, UTC. Out of network is weighted by members reached; the industry is the top one by share. Tap a week for its posts.
          {s.undated ? ` ${plural(s.undated, 'post')} without a publish date ${s.undated === 1 ? 'is' : 'are'} not in any week.` : ''}
        </div>
        <ul className="a-reach-weeks">
          {visible.map(w => <WeekRow key={w.start} w={w} thisYear={thisYear} />)}
        </ul>
        {hidden > 0 || showOlder ? (
          <div className="a-reach-more">
            <Button variant="quiet" onClick={() => setShowOlder(v => !v)}>
              {showOlder ? 'Show fewer weeks' : `Show older weeks (${hidden})`}
            </Button>
          </div>
        ) : null}
      </div>
      <div className="a-reach-foot a-mono">{plural(s.total, 'post')} on record · read {relAge(readAt)}</div>
    </>
  )
}

export function ReachView({ read, onRetry, now, lane }: { read: ReachRead | null; onRetry?: () => void; now?: number; lane?: ContentLane }) {
  let body
  if (!read) body = <div className="a-ct-sub">Reading who the posts reached…</div>
  else if (read.kind === 'ready') body = <ReachReady rows={read.rows} followers={read.followers} readAt={read.readAt} now={now} lane={lane} />
  else body = <Failed what="Who the posts reached" message={read.message} onRetry={onRetry} />
  return (
    <div className="a-reach" data-reach-state={read ? read.kind : 'loading'}>
      <Group className="a-reach-g" label="Who the posts reached" pad>{body}</Group>
    </div>
  )
}

export function ReachBlock({ lane }: { lane: ContentLane }) {
  const [read, setRead] = useState<{ lane: ContentLane; read: ReachRead } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setRead(null)
    fetchPostAudience(lane)
      .then(r => { if (live) setRead({ lane, read: r }) })
      .catch(e => { if (live) setRead({ lane, read: { kind: 'failed', message: e instanceof Error ? e.message : 'Post reach could not be read.' } }) })
    return () => { live = false }
  }, [lane, tick])
  const current = read?.lane === lane ? read.read : null
  return <ReachView read={current} lane={lane} onRetry={() => setTick(t => t + 1)} />
}
