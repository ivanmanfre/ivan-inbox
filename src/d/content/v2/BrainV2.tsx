import { useMemo } from 'react'
import type { SavedVerdict } from '../../../lib/verdicts'
import { dHash } from '../../route'
import { BestPosts, DirectionView, NicheIdeas, RecentDecisions, policyOf, useDirection, directionWords, usePostAudience } from '../ContentBrain'
import type { IdeaBanks } from '../Ideas'
import { DAY_MS, LANES, LANE_NAME, OWNER, age, splitTitleTag, type Lane } from '../model'
import { dotOf } from '../calModel'
import type { PlanItem } from '../planModel'
import type { WeekRead } from '../useWeek'
import type { Judged } from '../verdictStore'
import { awaitsReview, type Week } from '../weekModel'
import { warsawDay } from '../../ui/time'
import { coverageOf } from './coverage'
import { SourceChip, deskModel } from './ReviewDesk'
import { sourceTag } from './sourceTag'
import { Answer, Seg } from './ui'

// CONTENT BRAIN, BRIEF 4 (SPEC-content §2.4): the performance end of the loop, no longer a second review
// queue. Rebuilt 2026-10-15 on Ivan's read of it: the seat tabs "repeat" ("just IVAN RISE ARCH SWISHDM is
// fine"), "Direction i cant even read it", "up next idk what is that", the ideas were famous X accounts
// with no purpose, and "open all sources" jumped to "a weird separated section". Ivan 10-05: "The whole
// thing should be interconnected: the outliers, my own posts, everything".
//   · seat tabs: names only;
//   · direction: the weekly count in plain words, the aim under it, both wrap;
//   · one sentence on what to do next, then five tiles. EACH NUMBER IS ON THE PAGE ONCE: the drafts to
//     decide sit in their tile only (no count on the tab, the heading or the Review link);
//   · "Drafts waiting for you": the first three of Review's own list for this seat, source tag first;
//   · "What's working in your niche": the Outliers page's fit-checked list, platform balanced, every post
//     folded under it; then the seat's best posts and recent decisions.
// Every draft decision still happens in Review.

/** The seat's to-decide drafts in Review's order: the same list (and count) as Review's seat tab and heading. */
export function seatQueue(total: Week, lane: Lane, now: number) {
  return deskModel(total, now).decide.filter(c => c.lane === lane && awaitsReview(c))
}

/** Pure: the one headline sentence. It never repeats a tile's number. */
export function brainHeadline(o: { live: boolean; reading: boolean; short: number | null; decide: number; lane: Lane }): string {
  if (!o.live) return 'Reading…'
  const drafts = o.decide > 0 ? 'Start with the drafts waiting for you.' : `Nothing waits for a decision on ${LANE_NAME[o.lane]}.`
  if (o.reading || o.short == null) return drafts
  if (o.short > 0) return `Next week still needs ${o.short === 1 ? 'one more post' : `${o.short} more posts`} set to go out. ${drafts}`
  return `Next week is set. ${drafts}`
}

export function BrainV2({ lane, setLane, read, verdicts, judged, total, items, ideas, now, reading }: {
  lane: Lane
  setLane: (l: Lane) => void
  read: WeekRead
  verdicts: Map<string, SavedVerdict>
  judged: ReadonlyMap<string, Judged>
  /** Review's model across every seat: the same numbers the Review tab shows. */
  total: Week
  items: Record<Lane, Map<string, PlanItem[]>>
  ideas: IdeaBanks
  now: number
  /** The seat reads have not all answered yet. */
  reading: boolean
}) {
  // One read each: the direction feeds its line and the dated target; the own posts feed the tile and Best posts.
  const dir = useDirection(lane)
  const own = usePostAudience(lane)
  const weekly = useMemo(() => directionWords(policyOf(dir)).weekly, [dir])
  const dirSettled = dir.d != null || dir.err != null

  const cov = useMemo(() => coverageOf(items, now, { [lane]: weekly }), [items, now, lane, weekly])
  const queue = useMemo(() => seatQueue(total, lane, now), [total, lane, now])
  const decide = queue.length
  const next3 = queue.slice(0, 3)
  const dated = useMemo(() => {
    let n = 0
    const end = warsawDay(now + 14 * DAY_MS), start = warsawDay(now)
    for (const [k, list] of items[lane]) if (k >= start && k <= end) n += list.filter(it => { const d = dotOf(it); return d === 'set' || d === 'planned' }).length
    return n
  }, [items, lane, now])
  const posted = useMemo(() => {
    let n = 0
    const start = warsawDay(now - 7 * DAY_MS), end = warsawDay(now)
    for (const [k, list] of items[lane]) if (k >= start && k <= end) n += list.filter(it => dotOf(it) === 'posted').length
    return n
  }, [items, lane, now])
  const best = useMemo(() => {
    if (own?.kind !== 'ready') return null
    const since = now - 7 * DAY_MS
    return own.rows.filter(p => p.published_at && Date.parse(p.published_at) >= since && typeof p.impressions === 'number')
      .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))[0] ?? null
  }, [own, now])
  const bank = ideas[lane]
  const live = read.source !== 'none'
  const short = dirSettled && weekly != null ? cov.seats[lane].short : null
  void verdicts; void judged

  const tile = (key: string, label: string, n: React.ReactNode, sub: React.ReactNode, href: string, i: number, wide = false) => (
    <a key={key} className={`cv2-tile2${wide ? ' cv2-tile2-w' : ''}`} href={href} data-verb={`brain-tile-${key}`} style={{ '--i': i } as React.CSSProperties}>
      <span className="cv2-tile2-l">{label}</span>
      <b className="cv2-tile2-n">{n}</b>
      <span className="cv2-tile2-s">{sub}</span>
    </a>
  )
  const seatQ: Record<string, string> = lane === 'ivan' ? {} : { lane }
  const bestRaw = (best?.title ?? 'Published post').trim()
  const bestCut = bestRaw.length > 44 ? `${bestRaw.slice(0, 42).trimEnd()}…` : bestRaw
  // A hook that opens on its own quote mark is not wrapped in a second pair.
  const bestTitle = /^["“]/.test(bestCut) ? bestCut : `“${bestCut}”`

  return (
    <div className="cv2 cv2-brain" data-cv2="brain" data-lane={lane}>
      <div className="cv2-bar">
        <Seg label="Account" verb="brain-lane" value={lane} onChange={id => setLane(id as Lane)}
          options={LANES.map(l => ({ id: l, label: LANE_NAME[l] }))} />
      </div>
      <div className="cv2-dir"><DirectionView lane={lane} st={dir} /></div>
      <Answer>{brainHeadline({ live, reading: reading || !dirSettled, short, decide, lane })}</Answer>
      <nav className="cv2-pipe" aria-label={`${LANE_NAME[lane]} pipeline`}>
        {tile('ideas', 'Ideas waiting', bank.n ?? '…', 'in Ideas', dHash('content', 'ideas', seatQ), 0)}
        {tile('drafts', 'Drafts to decide', live ? decide : '…', 'in Review', dHash('content', 'now', { lane }), 1)}
        {tile('dated', 'Dated, next 14 days', reading ? '…' : dated, reading ? 'reading' : weekly != null ? `of ${weekly * 2} for two weeks` : 'set or planned', dHash('content', 'calendar'), 2)}
        {tile('posted', 'Posted, last 7 days', reading ? '…' : posted, 'went out', dHash('content', 'results', seatQ), 3)}
        {tile('best', 'Best post, last 7 days', best?.impressions != null ? best.impressions.toLocaleString('en-US') : own == null ? '…' : '–',
          best ? <>impressions, {bestTitle}</>
            : own?.kind === 'ready' ? 'nothing measured this week' : own ? (lane === 'swishdm' ? 'not tracked yet' : 'could not read') : 'reading',
          dHash('content', 'results', seatQ), 4, true)}
      </nav>
      <section className="cv2-sec" aria-label="Drafts waiting for you">
        <h2 className="cv2-h">Drafts waiting for you<a href={dHash('content', 'now', { lane })} data-verb="brain-open-review">Open Review →</a></h2>
        {!live ? <p className="cv2-dim">Reading…</p> : next3.length === 0 ? <p className="cv2-dim">Nothing of {LANE_NAME[lane]}’s waits for a decision.</p> : (
          <ol className="cv2-next">{next3.map(c => {
            const t = splitTitleTag(c.title)
            return (
              <li key={c.r.id}>
                <a href={dHash('content', 'now', { focus: c.r.id })} data-verb="brain-draft-waiting">
                  <SourceChip tag={sourceTag(c.r, OWNER[c.lane])} />
                  <b>{t.text}</b>
                  <span className="cv2-dim">{age(c.r.created_at, now)} ago</span>
                  <span className="cv2-grow" /><span className="cv2-open">Open ›</span>
                </a>
              </li>
            )
          })}</ol>
        )}
      </section>
      <div className="cv2-brain-old">
        <NicheIdeas lane={lane} now={now} />
        <BestPosts lane={lane} own={own} now={now} />
        <RecentDecisions lane={lane} verdicts={verdicts} />
      </div>
    </div>
  )
}
