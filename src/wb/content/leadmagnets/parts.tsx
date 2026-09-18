/* ==========================================================================
   The pieces both layouts share: one line per lead magnet, one line per gated
   roster post, and the copy that carries the denominators.

   It is a separate module from `LeadMagnetsView` only because the view picks
   the layout and the layouts need these pieces: importing them back out of the
   view would be a cycle. Nothing here fetches and nothing here does
   arithmetic — every number comes from `lib/leadMagnets` already computed.
   ========================================================================== */
import type { ReactNode } from 'react'
import { Button } from '../../../ds'
import { num } from '../../../lib/benchmark'
import { dayLabel, sinceMonday } from '../../../lib/reach'
import {
  LM_FLOOR_POSTS, activeLms, attributionLine, inWindow, lmRate, perThousand, rankGated, sizeLabel,
  type GatedPost, type GatedRead, type LeadMagnetsRead, type LmRow, type LmWindow,
} from '../../../lib/leadMagnets'

export const EYEBROW_OWN = 'Your lead magnets'
export const EYEBROW_ROSTER = 'Gated posts on the roster'
export const EMPTY_ROSTER = 'No gated post judged on this roster yet.'
export const CALLS_SUMMARY = 'Why calls read as not attributable'
/* Two sentences and 124 characters, because the first draft ran to four lines at 390
   and the rewrite to four again. Measured at 390: three lines. */
export const FOOT =
  'Comments per 1,000 followers puts a small account with a loud post over a big quiet one. Unsized lines rank by comments alone.'

/** The catalog, not the window, is what is empty here: the window filters posts, never rows. */
export const emptyOwn = (since: string, thisYear: number) =>
  `No lead magnet shows a post or a click since ${dayLabel(since, thisYear)}.`

export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`

/** "18 of 72 lead magnets show a post or a click since 17 Jun" — the ruling's line, agreeing with a catalog of one. */
export function activeLine(active: number, total: number, since: string, thisYear: number): string {
  const noun = total === 1 ? 'lead magnet shows' : 'lead magnets show'
  return `${num(active)} of ${num(total)} ${noun} a post or a click since ${dayLabel(since, thisYear)}`
}

/** THE THREE COUNTS NEVER TRAVEL ALONE. The window count, the whole read, and the
    set the judge drew from are three different numbers and a reader who sees one
    of them cannot derive the others: `33 gated posts since 29 Jun, 35 over 91
    days, from the 58 loudest roster posts judged.` The window's start is the
    ISO-week Monday `lib/reach` computes, printed rather than described. */
export const gatedCounts = (r: RosterView, thisYear: number) =>
  `${plural(r.roster.length, 'gated post')} since ${dayLabel(r.from, thisYear)}, ${plural(r.all, 'post')} over ${num(r.days)} days, from the ${num(r.judged)} loudest roster posts judged.`

/** What the order in front of the reader actually is, stated the way the reach section states a floor. */
export function rankLine(sized: number, shown: number): string {
  if (shown === 0) return ''
  if (sized === 0) return 'No line carries a follower count, so the rank is by comments alone.'
  const carry = sized === 1 ? 'carries' : 'carry'
  if (sized === shown) return `${num(sized)} of ${num(shown)} ${carry} a follower count, so the rank is by comments per 1k followers.`
  return `${num(sized)} of ${num(shown)} ${carry} a follower count, so sized lines rank by comments per 1k followers and unsized lines follow by comments.`
}

/** Catalog titles and judge-written offers carry an em or en dash ("Score — Where the hours go"),
    and the house rule is that neither reaches the screen. The sibling surface
    (`src/wb/content/LeadMagnetsBlock.tsx`) states it out the same way: CHANGE ONE, CHANGE BOTH. */
export const plain = (s: string) => s.replace(/\s*[—–]\s*/g, ', ')

const KIND_LABEL: Record<string, string> = { comment_gate: 'comment gate', dm_gate: 'DM gate', link: 'link' }
export const kindLabel = (k: string) => KIND_LABEL[k] ?? k.replace(/_/g, ' ')
export const keywordLabel = (k: string | null) => k && k.trim() ? k : 'no keyword'

/** A number or nothing. A null is NOT said on the row: it would repeat on every line to
    report the same missing ledger, and the disclosure under the list says it once. */
export const callsPhrase = (row: LmRow) => row.calls == null ? null : plural(row.calls, 'call')

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

/** The rate with its denominator, or the floor said in words, then the window fact,
    then calls when there is a number, then the dates. The rate and the counts are the
    RPC's aggregates since its own `since`, which is why the note prints the dates. */
export function lmNote(row: LmRow, thisYear: number, weeks: LmWindow, postedInWindow: boolean): string {
  const rate = lmRate(row)
  const floor = row.posts > 0 && row.posts < LM_FLOOR_POSTS
    ? `${plural(row.posts, 'post')}, under the ${LM_FLOOR_POSTS}-post floor, so no rate yet`
    : null
  const window = row.posts > 0 && !postedInWindow ? `No post in the last ${weeks} weeks` : null
  return [rate ? `${rate.text}, ${rate.note}` : null, floor, window, callsPhrase(row), lmDates(row, thisYear)]
    .filter(Boolean).join('. ') + '.'
}

/** EVERY ROW WITH ACTIVITY IS RENDERED. The window filters POSTS, never catalog
    rows: a lead magnet with 29 CTA clicks and no post this window is the row most
    worth reading, and the first build hid it. `posted` says whether that row's
    last post falls in the open window, which the note then states. */
export type OwnRow = { row: LmRow; posted: boolean }
export type OwnView = {
  since: string
  total: number
  rows: OwnRow[]
  postedInWindow: number
  clicks: number
  callsNote?: string
  /** db/086: "2 of 74 posts since 19 Jun are linked to a lead magnet." Absent on an older RPC, and on a
      lane that published nothing in the read's own window. Built once in `selectOwn` so both
      layouts print the same sentence. */
  attribution?: string
}

export type LmReady = Extract<LeadMagnetsRead, { kind: 'ready' }>
export type GatedReady = Extract<GatedRead, { kind: 'ready' }>

export function selectOwn(read: LmReady, weeks: LmWindow, now: number): OwnView {
  const rows = activeLms(read.lms).map(row => ({ row, posted: inWindow(row.last_post, weeks, now) }))
  return {
    since: read.since,
    total: read.lms.length,
    rows,
    postedInWindow: rows.filter(r => r.posted).length,
    clicks: rows.reduce((a, r) => a + r.row.cta_clicks, 0),
    ...(read.calls_note ? { callsNote: read.calls_note } : {}),
    ...(attributionLine(read) ? { attribution: attributionLine(read) as string } : {}),
  }
}

export type RosterView = {
  judged: number
  /** Every gated post the read carries, windowed or not. */
  all: number
  /** Days the read itself covers, from its own `since` to now. */
  days: number
  /** The open window's first day, the ISO-week Monday. */
  from: string
  roster: GatedPost[]
  sized: number
  best: GatedPost | null
}

export function selectRoster(read: GatedReady, weeks: LmWindow, now: number): RosterView {
  const roster = rankGated(read.posts.filter(p => inWindow(p.posted_at, weeks, now)))
  return {
    judged: read.judged,
    all: read.posts.length,
    days: Math.max(0, Math.round((now - Date.parse(read.since)) / 86400e3)),
    from: sinceMonday(now, weeks),
    roster,
    sized: roster.filter(p => p.follower_count != null && p.follower_count > 0).length,
    best: roster.find(p => p.per_1k !== null) ?? null,
  }
}

/** What the lane's catalog shows, and how much of it posted inside the open window. */
export function ownSub(own: OwnView, thisYear: number, weeks: LmWindow): string {
  const posted = own.postedInWindow === 1
    ? `1 posted in the last ${weeks} weeks`
    : `${num(own.postedInWindow)} posted in the last ${weeks} weeks`
  return `${activeLine(own.rows.length, own.total, own.since, thisYear)}, ${posted}.`
}

/** THE ONE FOLD CONTROL. Both lists use it, so the label always names what is
    hidden ("Show 25 more roster posts", not "Show 25 more") and the control
    reports its own state to a screen reader rather than only to the eye. */
export function Fold({ hidden, noun, open, onToggle }: { hidden: number; noun: string; open: boolean; onToggle: () => void }) {
  if (hidden <= 0 && !open) return null
  return (
    <div className="a-lm-more">
      <Button variant="quiet" aria-expanded={open} onClick={onToggle}>
        {open ? `Show fewer ${noun}` : `Show ${num(hidden)} more ${noun}`}
      </Button>
    </div>
  )
}

export function Figs({ items }: { items: string[] }) {
  return <span className="a-lm-figs">{items.map(f => <span className="a-lm-f" key={f}>{f}</span>)}</span>
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="a-lm-tag">{children}</span>
}

/** One lead magnet as a row: title, its keyword and status, the four counts, then the note. */
export function LmLine({ row, posted, weeks, thisYear }: { row: LmRow; posted: boolean; weeks: LmWindow; thisYear: number }) {
  return (
    <li>
      <div className="a-lm-r" data-lm-slug={row.slug} data-lm-posted={posted ? '' : undefined}>
        <span className="a-lm-t">
          {plain(row.title || row.keyword || row.slug)}
          <Tag>{keywordLabel(row.keyword)} · {row.status}</Tag>
        </span>
        <Figs items={lmFigures(row)} />
        <span className="a-lm-note">{lmNote(row, thisYear, weeks, posted)}</span>
      </div>
    </li>
  )
}

/** One lead magnet as a card: the keyword leads, the title explains it. */
export function LmCard({ row, posted, weeks, thisYear }: { row: LmRow; posted: boolean; weeks: LmWindow; thisYear: number }) {
  return (
    <div className="a-lm-card" data-lm-slug={row.slug} data-lm-posted={posted ? '' : undefined}>
      {/* The keyword leads only when there IS one: 57 of Ivan's 72 catalog rows carry
          none, and a grid of cards all headed "no keyword" says nothing 14 times. The
          title under it is the identity either way. */}
      <div className="a-lm-card-h">
        <span>{row.keyword ?? ''}</span>
        <span className="a-mono a-dim-2">{row.status}</span>
      </div>
      <div className="a-lm-t">{plain(row.title || row.slug)}</div>
      <Figs items={lmFigures(row)} />
      <div className="a-lm-note">{lmNote(row, thisYear, weeks, posted)}</div>
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
    ? <a className="a-lm-t" href={p.post_ref} target="_blank" rel="noopener noreferrer">{plain(p.author)}</a>
    : <span>{plain(p.author)}</span>
  return (
    <li>
      <div className="a-lm-r" data-lm-author={p.author}>
        <span className="a-lm-t">{who}<Tag>{keywordLabel(p.gate_keyword)} · {kindLabel(p.cta_kind)}</Tag></span>
        <Figs items={gatedFigures(p)} />
        <span className="a-lm-note">
          {plain(p.offer)}. Posted {dayLabel(p.posted_at, thisYear)}, {num(p.likes)} likes, {num(p.reposts)} reposts.
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
          <span className="a-lm-t">{plain(p.author)}<Tag>{keywordLabel(p.gate_keyword)} · {kindLabel(p.cta_kind)}</Tag></span>
          <Figs items={gatedFigures(p)} />
        </summary>
        <div className="a-lm-dd">
          <span className="a-lm-note">{plain(p.offer)}</span>
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
