/* ==========================================================================
   The pieces both layouts share: one line per lead magnet, one line per gated
   roster post, and the copy that carries the denominators.

   It is a separate module from `LeadMagnetsView` only because the view picks
   the layout and the layouts need these pieces: importing them back out of the
   view would be a cycle. Nothing here fetches and nothing here does
   arithmetic — every number comes from `lib/leadMagnets` already computed.
   ========================================================================== */
import type { ReactNode } from 'react'
import { num } from '../../../lib/benchmark'
import { dayLabel } from '../../../lib/reach'
import {
  LM_FLOOR_POSTS, activeLms, inWindow, lmRate, perThousand, rankGated, sizeLabel,
  type GatedPost, type GatedRead, type LeadMagnetsRead, type LmRow, type LmWindow,
} from '../../../lib/leadMagnets'

export const EYEBROW_OWN = 'Your lead magnets'
export const EYEBROW_ROSTER = 'Gated posts on the roster'
export const EMPTY_ROSTER = 'No gated post judged on this roster yet.'
export const CALLS_SUMMARY = 'Why calls read as not attributable'
export const FOOT =
  'Comments per 1,000 followers puts a small account with a loud post above a big account with a quiet one. Where the follower count is unknown the line ranks by comments alone.'

export const emptyOwn = (weeks: LmWindow) => `No lead magnet posted in the last ${weeks} weeks.`

export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`

/** "18 of 72 lead magnets show a post or a click since 17 Jun" — the ruling's line, agreeing with a catalog of one. */
export function activeLine(active: number, total: number, since: string, thisYear: number): string {
  const noun = total === 1 ? 'lead magnet shows' : 'lead magnets show'
  return `${num(active)} of ${num(total)} ${noun} a post or a click since ${dayLabel(since, thisYear)}`
}

/** The roster's own denominators: what carries a size, and what the ranking was drawn from. */
export const rosterLine = (sized: number, shown: number, judged: number) =>
  `${num(sized)} of ${num(shown)} carry a follower count, of the ${num(judged)} loudest roster posts judged.`

const KIND_LABEL: Record<string, string> = { comment_gate: 'comment gate', dm_gate: 'DM gate', link: 'link' }
export const kindLabel = (k: string) => KIND_LABEL[k] ?? k.replace(/_/g, ' ')
export const keywordLabel = (k: string | null) => k && k.trim() ? k : 'no keyword'

/** Null reads as "not attributable", never as zero: `calls_note` on the read says why. */
export const callsPhrase = (row: LmRow) => row.calls == null ? 'Calls not attributable' : `${plural(row.calls, 'call')} booked`

export const lmFigures = (row: LmRow) => [
  plural(row.posts, 'post'),
  plural(row.comments, 'comment'),
  plural(row.gate_dms, 'gate DM'),
  plural(row.cta_clicks, 'CTA click'),
]

/** First and last post, or the fact that no post carries the keyword yet. */
export function lmDates(row: LmRow, thisYear: number): string {
  if (!row.first_post || !row.last_post) return 'No post carries this keyword yet'
  return row.first_post.slice(0, 10) === row.last_post.slice(0, 10)
    ? `Posted ${dayLabel(row.first_post, thisYear)}`
    : `First post ${dayLabel(row.first_post, thisYear)}, last ${dayLabel(row.last_post, thisYear)}`
}

/** The rate with its denominator, or the floor said in words, then calls and dates. */
export function lmNote(row: LmRow, thisYear: number): string {
  const rate = lmRate(row)
  const floor = row.posts > 0 && row.posts < LM_FLOOR_POSTS
    ? `${plural(row.posts, 'post')}, under the ${LM_FLOOR_POSTS}-post floor, so no rate yet`
    : null
  return [rate ? `${rate.text}, ${rate.note}` : null, floor, callsPhrase(row), lmDates(row, thisYear)]
    .filter(Boolean).join('. ') + '.'
}

/** What a layout renders for the lane's own lead magnets in the open window.
    `posted` is the rows with a post inside the window; `undated` is the rows
    that carry clicks and no post at all, so they sit in no window and are
    counted in words instead of being dropped silently. */
export type OwnView = {
  since: string
  total: number
  active: number
  posted: LmRow[]
  undated: number
  outside: number
  callsNote?: string
}

export type LmReady = Extract<LeadMagnetsRead, { kind: 'ready' }>
export type GatedReady = Extract<GatedRead, { kind: 'ready' }>

export function selectOwn(read: LmReady, weeks: LmWindow, now: number): OwnView {
  const active = activeLms(read.lms)
  const posted = active.filter(r => inWindow(r.last_post, weeks, now))
  return {
    since: read.since,
    total: read.lms.length,
    active: active.length,
    posted,
    undated: active.filter(r => !r.last_post).length,
    outside: active.filter(r => r.last_post && !inWindow(r.last_post, weeks, now)).length,
    ...(read.calls_note ? { callsNote: read.calls_note } : {}),
  }
}

export type RosterView = {
  judged: number
  roster: GatedPost[]
  sized: number
  best: GatedPost | null
}

export function selectRoster(read: GatedReady, weeks: LmWindow, now: number): RosterView {
  const roster = rankGated(read.posts.filter(p => inWindow(p.posted_at, weeks, now)))
  return {
    judged: read.judged,
    roster,
    sized: roster.filter(p => p.follower_count != null && p.follower_count > 0).length,
    best: roster.find(p => p.per_1k !== null) ?? null,
  }
}

/** The sentence a section shows when the window, not the lane, is what is empty. */
export function ownSub(own: OwnView, thisYear: number): string {
  const parts = [`${activeLine(own.active, own.total, own.since, thisYear)}.`]
  if (own.outside) parts.push(`${num(own.outside)} posted before this window.`)
  if (own.undated) {
    parts.push(own.undated === 1
      ? '1 lead magnet carries clicks with no post, so it sits in no window.'
      : `${num(own.undated)} lead magnets carry clicks with no post, so they sit in no window.`)
  }
  return parts.join(' ')
}

export function Figs({ items }: { items: string[] }) {
  return <span className="a-lm-figs">{items.map(f => <span className="a-lm-f" key={f}>{f}</span>)}</span>
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="a-lm-tag">{children}</span>
}

/** One lead magnet as a row: title, its keyword and status, the four counts, then the note. */
export function LmLine({ row, thisYear }: { row: LmRow; thisYear: number }) {
  return (
    <li>
      <div className="a-lm-r" data-lm-slug={row.slug}>
        <span className="a-lm-t">
          {row.title || row.keyword || row.slug}
          <Tag>{keywordLabel(row.keyword)} · {row.status}</Tag>
        </span>
        <Figs items={lmFigures(row)} />
        <span className="a-lm-note">{lmNote(row, thisYear)}</span>
      </div>
    </li>
  )
}

/** One lead magnet as a card: the keyword leads, the title explains it. */
export function LmCard({ row, thisYear }: { row: LmRow; thisYear: number }) {
  return (
    <div className="a-lm-card" data-lm-slug={row.slug}>
      <div className="a-lm-card-h">
        <span>{keywordLabel(row.keyword)}</span>
        <span className="a-mono a-dim-2">{row.status}</span>
      </div>
      <div className="a-lm-t">{row.title || row.slug}</div>
      <Figs items={lmFigures(row)} />
      <div className="a-lm-note">{lmNote(row, thisYear)}</div>
    </div>
  )
}

/** Comments, then the size, then the rate. A post with no size shows no rate: the sub line above says how many carry one. */
export function gatedFigures(p: GatedPost): string[] {
  const per = perThousand(p.comments, p.follower_count)
  return [plural(p.comments, 'comment'), sizeLabel(p), ...(per === null ? [] : [`${per.toFixed(1)} per 1k`])]
}

export function GatedLine({ p, thisYear }: { p: GatedPost; thisYear: number }) {
  const who = p.post_ref
    ? <a className="a-lm-t" href={p.post_ref} target="_blank" rel="noopener noreferrer">{p.author}</a>
    : <span>{p.author}</span>
  return (
    <li>
      <div className="a-lm-r" data-lm-author={p.author}>
        <span className="a-lm-t">{who}<Tag>{keywordLabel(p.gate_keyword)} · {kindLabel(p.cta_kind)}</Tag></span>
        <Figs items={gatedFigures(p)} />
        <span className="a-lm-note">
          {p.offer}. Posted {dayLabel(p.posted_at, thisYear)}, {num(p.likes)} likes, {num(p.reposts)} reposts.
        </span>
      </div>
    </li>
  )
}

/** The same line, denser, with the offer and the rest of the numbers one tap away. */
export function GatedDetail({ p, thisYear }: { p: GatedPost; thisYear: number }) {
  return (
    <li>
      <details className="a-lm-d" data-lm-author={p.author}>
        <summary>
          <span className="a-lm-t">{p.author}<Tag>{keywordLabel(p.gate_keyword)} · {kindLabel(p.cta_kind)}</Tag></span>
          <Figs items={gatedFigures(p)} />
        </summary>
        <div className="a-lm-dd">
          <span className="a-lm-note">{p.offer}</span>
          <Figs items={[`${num(p.likes)} likes`, `${num(p.reposts)} reposts`, kindLabel(p.cta_kind), `judged ${Math.round(p.confidence * 100)}% sure`]} />
          <span className="a-lm-note">
            Posted {dayLabel(p.posted_at, thisYear)}.{' '}
            {p.follower_count != null && p.follower_count > 0
              ? `Follower count from ${p.followers_source ?? 'an unnamed source'}.`
              : 'No follower count on this author, so no rate.'}
          </span>
          {p.post_ref ? (
            <span className="a-lm-note">
              <a className="a-lm-t" href={p.post_ref} target="_blank" rel="noopener noreferrer">Open the post</a>
            </span>
          ) : null}
        </div>
      </details>
    </li>
  )
}

/** The engine's own sentence about `calls`, collapsed. It is never rewritten here: it travels on the read. */
export function CallsNote({ note }: { note?: string }) {
  if (!note) return null
  return (
    <details className="a-lm-d a-lm-why">
      <summary><span className="a-lm-note">{CALLS_SUMMARY}</span></summary>
      <div className="a-lm-dd"><span className="a-lm-note">{note}</span></div>
    </details>
  )
}
