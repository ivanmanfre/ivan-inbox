/* ==========================================================================
   LEAD MAGNETS. Sits under the drift section in the reach block.

   Two reads, two questions. The first is the lane's own catalog: which lead
   magnet actually moved, and over how many posts, so a rate is never printed
   over a sample too thin to carry one. The second is the roster: which OTHER
   accounts gate an offer behind a comment, ranked by comments per 1,000
   followers so a small account with a loud post outranks a big account with a
   quiet one.

   Every number carries its denominator. The two reads are independent all the
   way down: each has its own state slot, its own Failed banner and its own
   retry, and retrying one never blanks the other. All arithmetic lives in
   lib/leadMagnets.
   ========================================================================== */
import { useEffect, useId, useMemo, useState } from 'react'
import { Button } from '../../ds'
import { Failed, VerdictStrip } from './parts'
import { dayLabel, shortTitle } from '../../lib/reach'
import { num } from '../../lib/benchmark'
import type { ContentLane } from '../../lib/content'
import {
  LM_FLOOR_POSTS, LM_TOP, activeLms, attributionLine, fetchGatedPosts, fetchLeadMagnets, lmRate, perThousand, rankGated, sizeLabel,
  type GatedPost, type GatedRead, type LeadMagnetsRead, type LmRow,
} from '../../lib/leadMagnets'
import './reach.css'

const TITLE = 'Lead magnets'
/** Same words as the dedicated view's disclosure: one surface should not name it differently. */
const CALLS_SUMMARY = 'Why calls read as not attributable'
const ROSTER_TITLE = 'Gated posts on the roster'
const FOOT = 'Comments per 1,000 followers puts a small account with a loud post above a big account with a quiet one. Where the follower count is unknown the line ranks by comments alone.'
const TITLE_MAX = 72

const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`

/** A rate with its thousands separator and exactly one decimal. `num()` rounds to a whole number,
    which would turn 13.3 per 1k into 13, so a rate cannot go through it. */
const rate1 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Catalog titles and judge-written offers carry an em or en dash ("Score — Where the hours go").
    This surface never prints one, so it reads as a comma. Nothing else about the string changes. */
const plain = (s: string) => s.replace(/\s*[—–]\s*/g, ', ')

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
    // A null `calls` is explained once, by the RPC's own note under the list.
    ...(row.calls !== null ? [plural(row.calls, 'call')] : []),
  ].join(', ')
  const note = rate
    ? `${rate.text} · ${rate.note}`
    : row.posts === 0
      ? 'no post in the window, so no rate'
      : `${plural(row.posts, 'post')} since ${since}, under the ${LM_FLOOR_POSTS}-post floor, so no rate yet`
  return (
    <li className="a-reach-in" data-lm-slug={row.slug} data-lm-rate={rate ? 1 : 0}>
      <span className="a-reach-in-t">
        {shortTitle(plain(row.title), TITLE_MAX) ?? row.slug}: {text}.
        {/* `a-reach-lm-*`, not `a-lm-*`: the dedicated Lead magnets view owns `.a-lm-tag`
            in `leadmagnets.css` and the two sheets load on the same screen. */}
        <span className="a-reach-lm-tags">
          <span className="a-mono a-dim-2 a-reach-lm-tag">{row.status}</span>
          {row.keyword ? <span className="a-mono a-dim-2 a-reach-lm-tag">comment {plain(row.keyword)}</span> : null}
        </span>
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
    ? `${plural(p.comments, 'comment')} of ${sizeLabel(p)} · ${rate1(rate)} per 1k followers`
    : `${plural(p.comments, 'comment')}, ${sizeLabel(p)}, so no rate`
  return (
    <li className="a-reach-in" data-lm-gate={p.cta_kind} data-lm-sized={p.follower_count != null && p.follower_count > 0 ? 1 : 0}>
      <span className="a-reach-in-t">
        {p.post_ref
          ? <a href={p.post_ref} target="_blank" rel="noopener noreferrer">{plain(p.author)}</a>
          : plain(p.author)}: {what}{offer}.
      </span>
      <span className="a-mono a-dim-2 a-reach-in-n">{note}</span>
    </li>
  )
}

function Fold({ hidden, open, onToggle, noun, controls }: {
  hidden: number; open: boolean; onToggle: () => void; noun: string; controls: string
}) {
  if (hidden <= 0) return null
  return (
    <div className="a-reach-more">
      <Button variant="quiet" onClick={onToggle} aria-expanded={open} aria-controls={controls}>
        {open ? `Show fewer ${noun}` : `Show ${num(hidden)} more ${noun}`}
      </Button>
    </div>
  )
}

/** "7 of 35 carry a follower count, so ..." — the tail names what the rank actually did, because
    with none sized it is a comment ranking and with all sized it is a rate ranking. */
function sizedLine(sized: number, shown: number): string {
  const tail = sized === 0
    ? 'so the rank is by comments alone'
    : sized === shown
      ? 'so the rank is by comments per 1k followers'
      : 'so the rank mixes sized and unsized lines'
  return `${num(sized)} of ${num(shown)} ${sized === 1 ? 'carries' : 'carry'} a follower count, ${tail}.`
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
  const uid = useId()
  const ownListId = `${uid}-own`
  const rosterListId = `${uid}-roster`
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
    // Two reads, two failures, two retries. Denied only when both said denied.
    return (
      <div className="a-reach-sec" data-reach-lm={lm.kind === 'denied' && gated.kind === 'denied' ? 'denied' : 'failed'}>
        <div className="a-eyebrow">{TITLE}</div>
        <Failed what="The lead magnets read" message={lm.message} onRetry={onRetryLm} />
        <Failed what="The gated posts read" message={gated.message} onRetry={onRetryGated} />
      </div>
    )
  }

  const lmSince = lm.kind === 'ready' ? dayLabel(lm.since.slice(0, 10), thisYear) : ''
  const ownVisible = openOwn ? own : own.slice(0, LM_TOP)
  const rosterVisible = openRoster ? ranked : ranked.slice(0, LM_TOP)
  // `sizeLabel` reads 0 followers as unknown, so the count must agree: a zero is not a size.
  const sized = ranked.filter(p => p.follower_count != null && p.follower_count > 0).length

  // A half that failed carries no count: `0` would read as a fact, and it is an unread one.
  return (
    <div className="a-reach-sec" data-reach-lm="ready" data-lm-own={lm.kind === 'ready' ? own.length : undefined} data-lm-gated={gated.kind === 'ready' ? ranked.length : undefined}>
      <VerdictStrip gated={gated} lm={lm} />
      <div className="a-eyebrow">{TITLE}</div>
      {lm.kind === 'ready' ? (
        <>
          <div className="a-ct-sub">
            {own.length
              ? `${num(own.length)} of ${plural(lm.lms.length, 'lead magnet')} show a post or a click since ${lmSince}.`
              : `No post or click on ${lm.lms.length ? `the ${plural(lm.lms.length, 'lead magnet')} in this lane's catalog` : 'a lead magnet in this lane'} since ${lmSince}.`}
          </div>
          {/* db/086: the other half of the same window, read from the lane's own posts rather than
              from the catalog. Quiet sub line, no line at all on an older RPC. */}
          {attributionLine(lm) ? <div className="a-reach-foot" data-lm-attribution="1">{attributionLine(lm)}</div> : null}
          {own.length ? (
            <ul className="a-reach-ins" id={ownListId}>
              {ownVisible.map(r => <LmLine key={r.slug} row={r} since={lmSince} thisYear={thisYear} />)}
            </ul>
          ) : null}
          <Fold hidden={Math.max(0, own.length - LM_TOP)} open={openOwn} onToggle={() => setOpenOwn(v => !v)} noun="lead magnets" controls={ownListId} />
          {/* The engine's own sentence names tables ("lm_attribution holds no production row"),
              which is reference, not reading. It sits behind the same disclosure the dedicated
              view uses, and only when there is a list for it to explain. */}
          {own.length && lm.calls_note ? (
            <details className="a-reach-why">
              <summary><span className="a-reach-foot">{CALLS_SUMMARY}</span></summary>
              <div className="a-reach-foot a-reach-why-body">{plain(lm.calls_note)}</div>
            </details>
          ) : null}
        </>
      ) : (
        <Failed what="The lead magnets read" message={lm.message} onRetry={onRetryLm} />
      )}

      <div className="a-eyebrow">{ROSTER_TITLE}</div>
      {gated.kind === 'ready' ? (
        <>
          <div className="a-ct-sub">
            {ranked.length
              ? [
                `${num(gated.gated)} gated of the ${plural(gated.judged, 'loudest roster post')} judged since ${dayLabel(gated.since.slice(0, 10), thisYear)}.`,
                // The list is the only count the reader can check, so say so when it is shorter.
                ranked.length === gated.gated ? null : `${num(ranked.length)} of ${num(gated.gated)} shown.`,
                sizedLine(sized, ranked.length),
              ].filter(Boolean).join(' ')
              : `No gated offer in the ${plural(gated.judged, 'loudest roster post')} judged since ${dayLabel(gated.since.slice(0, 10), thisYear)}.`}
          </div>
          {ranked.length ? (
            <ul className="a-reach-ins" id={rosterListId}>
              {rosterVisible.map((p, i) => <GatedLine key={`${p.post_ref || p.author_url || p.author}-${i}`} p={p} />)}
            </ul>
          ) : null}
          <Fold hidden={Math.max(0, ranked.length - LM_TOP)} open={openRoster} onToggle={() => setOpenRoster(v => !v)} noun="gated posts" controls={rosterListId} />
          <div className="a-reach-foot">{FOOT}</div>
        </>
      ) : (
        <Failed what="The gated posts read" message={gated.message} onRetry={onRetryGated} />
      )}
    </div>
  )
}

export function LeadMagnetsSection({ lane, now }: { lane: ContentLane; now: number }) {
  const [lm, setLm] = useState<{ lane: ContentLane; read: LeadMagnetsRead } | null>(null)
  const [gated, setGated] = useState<{ lane: ContentLane; read: GatedRead } | null>(null)
  const [lmTick, setLmTick] = useState(0)
  const [gatedTick, setGatedTick] = useState(0)

  // Each read owns its slot and its tick. A retry re-runs only its own effect, and it clears only
  // its own slot on a lane change, so the half that already loaded stays on screen throughout.
  useEffect(() => {
    let live = true
    setLm(prev => (prev && prev.lane === lane ? prev : null))
    fetchLeadMagnets(lane)
      .catch((e: unknown): LeadMagnetsRead => ({ kind: 'failed', message: e instanceof Error ? e.message : 'The lead magnets could not be read.' }))
      .then(read => { if (live) setLm({ lane, read }) })
    return () => { live = false }
  }, [lane, lmTick])

  useEffect(() => {
    let live = true
    setGated(prev => (prev && prev.lane === lane ? prev : null))
    fetchGatedPosts(lane)
      .catch((e: unknown): GatedRead => ({ kind: 'failed', message: e instanceof Error ? e.message : 'The gated posts could not be read.' }))
      .then(read => { if (live) setGated({ lane, read }) })
    return () => { live = false }
  }, [lane, gatedTick])

  // Keyed by lane: an open fold belongs to the lane whose rows it opened, so a lane switch starts folded.
  return (
    <LeadMagnetsView
      key={lane}
      lm={lm?.lane === lane ? lm.read : null}
      gated={gated?.lane === lane ? gated.read : null}
      now={now}
      onRetryLm={() => setLmTick(t => t + 1)}
      onRetryGated={() => setGatedTick(t => t + 1)}
    />
  )
}
