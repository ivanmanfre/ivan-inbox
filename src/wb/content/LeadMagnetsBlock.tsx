/* ==========================================================================
   LEAD MAGNETS. Sits under the drift section in the reach block.

   Two reads, two questions. The first is the lane's own catalog: which lead
   magnet actually moved, and over how many posts, so a rate is never printed
   over a sample too thin to carry one. The second is the roster: which OTHER
   accounts gate an offer behind a comment, ranked by comments per 1,000
   followers so a small account with a loud post outranks a big account with a
   quiet one.

   Every number carries its denominator. A failure of one read never hides the
   other: each block shows Failed with its own retry and the other still
   renders. All arithmetic lives in lib/leadMagnets.
   ========================================================================== */
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../ds'
import { Failed } from './parts'
import { dayLabel, shortTitle } from '../../lib/reach'
import { num } from '../../lib/benchmark'
import type { ContentLane } from '../../lib/content'
import {
  LM_FLOOR_POSTS, LM_TOP, activeLms, fetchGatedPosts, fetchLeadMagnets, lmRate, perThousand, rankGated, sizeLabel,
  type GatedPost, type GatedRead, type LeadMagnetsRead, type LmRow,
} from '../../lib/leadMagnets'
import './reach.css'

const TITLE = 'Lead magnets'
const ROSTER_TITLE = 'Gated posts on the roster'
const FOOT = 'Comments per 1,000 followers puts a small account with a loud post above a big account with a quiet one. Where the follower count is unknown the line ranks by comments alone.'
const TITLE_MAX = 72

const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`

/** Catalog titles and judge-written offers carry an em dash ("Score — Where the hours go"). This
    surface never prints one, so it reads as a comma. Nothing else about the string changes. */
const plain = (s: string) => s.replace(/\s*—\s*/g, ', ')

const CTA_LABEL: Record<string, string> = { comment_gate: 'a comment gate', dm_gate: 'a DM gate', link: 'a link' }

/** "posted 12 Aug", "12 Aug to 3 Sep", or null when the row carries no post date. */
function dateSpan(row: LmRow, thisYear: number): string | null {
  if (!row.first_post) return null
  const first = dayLabel(row.first_post.slice(0, 10), thisYear)
  const last = row.last_post ? dayLabel(row.last_post.slice(0, 10), thisYear) : first
  return first === last ? `posted ${first}` : `${first} to ${last}`
}

function LmLine({ row, since, thisYear }: { row: LmRow; since: string; thisYear: number }) {
  const rate = lmRate(row)
  const span = dateSpan(row, thisYear)
  const text = [
    row.posts > 0 ? `${plural(row.posts, 'post')}, ${plural(row.comments, 'comment')}` : 'no post in the window',
    plural(row.gate_dms, 'gate DM'),
    plural(row.cta_clicks, 'CTA click'),
    row.calls === null ? 'calls not attributable' : plural(row.calls, 'call'),
  ].join(', ')
  const note = rate
    ? `${rate.text} · ${rate.note}`
    : `${plural(row.posts, 'post')} since ${since}, under the ${LM_FLOOR_POSTS}-post floor, so no rate yet`
  return (
    <li className="a-reach-in" data-lm-slug={row.slug} data-lm-rate={rate ? 1 : 0}>
      <span className="a-reach-in-t">
        {shortTitle(plain(row.title), TITLE_MAX) ?? row.slug}: {text}.
        <span className="a-mono a-dim-2 a-lm-tag">{row.status}</span>
        {row.keyword ? <span className="a-mono a-dim-2 a-lm-tag">comment {plain(row.keyword)}</span> : null}
      </span>
      <span className="a-mono a-dim-2 a-reach-in-n">{span ? `${note} · ${span}` : note}</span>
    </li>
  )
}

function GatedLine({ p }: { p: GatedPost }) {
  const rate = p.per_1k != null ? perThousand(p.comments, p.follower_count) : null
  const label = CTA_LABEL[p.cta_kind] ?? plain(p.cta_kind)
  const what = p.gate_keyword ? `comment "${plain(p.gate_keyword)}"` : label
  const offer = p.offer ? ` for ${plain(p.offer)}` : ', offer not named'
  const note = rate != null
    ? `${plural(p.comments, 'comment')} of ${sizeLabel(p)} · ${rate} per 1k followers`
    : `${plural(p.comments, 'comment')}, ${sizeLabel(p)}, so no rate`
  return (
    <li className="a-reach-in" data-lm-gate={p.cta_kind} data-lm-sized={p.follower_count != null ? 1 : 0}>
      <span className="a-reach-in-t">
        {p.post_ref
          ? <a href={p.post_ref} target="_blank" rel="noopener noreferrer">{plain(p.author)}</a>
          : plain(p.author)}: {what}{offer}.
      </span>
      <span className="a-mono a-dim-2 a-reach-in-n">{note}</span>
    </li>
  )
}

function Fold({ hidden, open, onToggle, noun }: { hidden: number; open: boolean; onToggle: () => void; noun: string }) {
  if (hidden <= 0) return null
  return (
    <div className="a-reach-more">
      <Button variant="quiet" onClick={onToggle}>{open ? `Show fewer ${noun}` : `Show ${num(hidden)} more`}</Button>
    </div>
  )
}

export function LeadMagnetsView({ lm, gated, now, onRetryLm, onRetryGated }: {
  lm: LeadMagnetsRead | null
  gated: GatedRead | null
  now: number
  onRetryLm?: () => void
  onRetryGated?: () => void
}) {
  const [openOwn, setOpenOwn] = useState(false)
  const [openRoster, setOpenRoster] = useState(false)
  const thisYear = new Date(now).getUTCFullYear()
  const own = useMemo(() => (lm?.kind === 'ready' ? activeLms(lm.lms) : []), [lm])
  const ranked = useMemo(() => (gated?.kind === 'ready' ? rankGated(gated.posts) : []), [gated])

  if (!lm || !gated) {
    return (
      <div className="a-reach-sec" data-reach-lm="loading">
        <div className="a-eyebrow">{TITLE}</div>
        <div className="a-ct-sub">Reading the lead magnets…</div>
      </div>
    )
  }
  if (lm.kind !== 'ready' && gated.kind !== 'ready') {
    return (
      <div className="a-reach-sec" data-reach-lm={lm.kind}>
        <div className="a-eyebrow">{TITLE}</div>
        <Failed what="The lead magnets read" message={lm.message} onRetry={onRetryLm} />
      </div>
    )
  }

  const lmSince = lm.kind === 'ready' ? dayLabel(lm.since.slice(0, 10), thisYear) : ''
  const ownVisible = openOwn ? own : own.slice(0, LM_TOP)
  const rosterVisible = openRoster ? ranked : ranked.slice(0, LM_TOP)
  const sized = ranked.filter(p => p.follower_count != null).length

  // A half that failed carries no count: `0` would read as a fact, and it is an unread one.
  return (
    <div className="a-reach-sec" data-reach-lm="ready" data-lm-own={lm.kind === 'ready' ? own.length : undefined} data-lm-gated={gated.kind === 'ready' ? ranked.length : undefined}>
      <div className="a-eyebrow">{TITLE}</div>
      {lm.kind === 'ready' ? (
        <>
          <div className="a-ct-sub">
            {own.length
              ? `${num(own.length)} of ${plural(lm.lms.length, 'lead magnet')} show a post or a click since ${lmSince}.`
              : `No post or click on ${lm.lms.length ? `the ${plural(lm.lms.length, 'lead magnet')} in this lane's catalog` : 'a lead magnet in this lane'} since ${lmSince}.`}
          </div>
          {own.length ? (
            <ul className="a-reach-ins">
              {ownVisible.map(r => <LmLine key={r.slug} row={r} since={lmSince} thisYear={thisYear} />)}
            </ul>
          ) : null}
          <Fold hidden={Math.max(0, own.length - LM_TOP)} open={openOwn} onToggle={() => setOpenOwn(v => !v)} noun="lead magnets" />
          {own.length && lm.calls_note ? <div className="a-reach-foot">{plain(lm.calls_note)}</div> : null}
        </>
      ) : (
        <Failed what="The lead magnets read" message={lm.message} onRetry={onRetryLm} />
      )}

      <div className="a-eyebrow">{ROSTER_TITLE}</div>
      {gated.kind === 'ready' ? (
        <>
          <div className="a-ct-sub">
            {gated.gated
              ? `${num(gated.gated)} gated of the ${plural(gated.judged, 'loudest roster post')} judged since ${dayLabel(gated.since.slice(0, 10), thisYear)}. ${num(sized)} of ${num(gated.gated)} ${sized === 1 ? 'carries' : 'carry'} a follower count, so the rank mixes sized and unsized lines.`
              : `No gated offer in the ${plural(gated.judged, 'loudest roster post')} judged since ${dayLabel(gated.since.slice(0, 10), thisYear)}.`}
          </div>
          {ranked.length ? (
            <ul className="a-reach-ins">
              {rosterVisible.map(p => <GatedLine key={p.post_ref} p={p} />)}
            </ul>
          ) : null}
          <Fold hidden={Math.max(0, ranked.length - LM_TOP)} open={openRoster} onToggle={() => setOpenRoster(v => !v)} noun="posts" />
          <div className="a-reach-foot">{FOOT}</div>
        </>
      ) : (
        <Failed what="The gated posts read" message={gated.message} onRetry={onRetryGated} />
      )}
    </div>
  )
}

export function LeadMagnetsSection({ lane, now }: { lane: ContentLane; now: number }) {
  const [read, setRead] = useState<{ lane: ContentLane; lm: LeadMagnetsRead; gated: GatedRead } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setRead(null)
    Promise.all([
      fetchLeadMagnets(lane).catch((e: unknown): LeadMagnetsRead => ({ kind: 'failed', message: e instanceof Error ? e.message : 'The lead magnets could not be read.' })),
      fetchGatedPosts(lane).catch((e: unknown): GatedRead => ({ kind: 'failed', message: e instanceof Error ? e.message : 'The gated posts could not be read.' })),
    ])
      .then(([lm, gated]) => { if (live) setRead({ lane, lm, gated }) })
    return () => { live = false }
  }, [lane, tick])
  const current = read?.lane === lane ? read : null
  const retry = () => setTick(t => t + 1)
  return <LeadMagnetsView lm={current?.lm ?? null} gated={current?.gated ?? null} now={now} onRetryLm={retry} onRetryGated={retry} />
}
