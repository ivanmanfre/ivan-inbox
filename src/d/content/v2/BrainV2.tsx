import { useEffect, useMemo, useState } from 'react'
import { fetchPostAudience, type ReachRead } from '../../../lib/reach'
import type { SavedVerdict } from '../../../lib/verdicts'
import { dHash } from '../../route'
import { DirectionLine, NextIdeas, RecentDecisions } from '../ContentBrain'
import type { IdeaBanks } from '../Ideas'
import { DAY_MS, LANES, LANE_NAME, age, splitTitleTag, type Lane } from '../model'
import { dotOf } from '../calModel'
import type { PlanItem } from '../planModel'
import type { WeekRead } from '../useWeek'
import type { Judged } from '../verdictStore'
import type { Week } from '../weekModel'
import { warsawDay } from '../../ui/time'
import { coverageOf } from './coverage'
import { Answer, SeatAv, Seg } from './ui'

// CONTENT BRAIN, BRIEF 4 (SPEC-content §2.4): the performance end of the loop,
// no longer a second review queue. One answer line, a five-tile pipeline
// (ideas → drafts → dated → posted → best post) that links to the tab doing
// that job, three "up next" rows that open Review on the card, then today's
// next post ideas and recent decisions (their writes unchanged). Every draft
// decision happens in Review.

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
  const [own, setOwn] = useState<ReachRead | null>(null)
  useEffect(() => {
    let live = true
    setOwn(null)
    void fetchPostAudience(lane).then(r => { if (live) setOwn(r) }).catch(e => { if (live) setOwn({ kind: 'failed', message: e instanceof Error ? e.message : 'read failed' }) })
    return () => { live = false }
  }, [lane])

  const cov = useMemo(() => coverageOf(items, now), [items, now])
  const drafts = total.perLane[lane]
  const upNext = useMemo(() => [...total.groups.flatMap(g => g.cards)]
    .filter(c => c.lane === lane && !c.strip && (c.judge || c.primary !== 'open'))
    .slice(0, 3), [total, lane])
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
  const seat = cov.seats[lane]
  const live = read.source !== 'none'
  void verdicts; void judged

  const tile = (key: string, label: string, n: React.ReactNode, sub: React.ReactNode, href: string, i: number, wide = false) => (
    <a key={key} className={`cv2-tile2${wide ? ' cv2-tile2-w' : ''}`} href={href} data-verb={`brain-tile-${key}`} style={{ '--i': i } as React.CSSProperties}>
      <span className="cv2-tile2-l">{label}</span>
      <b className="cv2-tile2-n">{n}</b>
      <span className="cv2-tile2-s">{sub}</span>
    </a>
  )

  return (
    <div className="cv2 cv2-brain" data-cv2="brain" data-lane={lane}>
      <div className="cv2-bar">
        <Seg label="Account" verb="brain-lane" value={lane} onChange={id => setLane(id as Lane)}
          options={LANES.map(l => ({ id: l, label: <><SeatAv lane={l} />{LANE_NAME[l]}</>, count: live ? total.perLane[l] : '…' }))} />
        <div className="cv2-dir"><DirectionLine lane={lane} /></div>
      </div>
      <Answer>
        {!live ? 'Reading…' : <>{drafts} draft{drafts === 1 ? '' : 's'} to decide. </>}
        {!reading && <>Next week {Math.min(seat.set, seat.target)} of {seat.target} scheduled{seat.short ? `, ${seat.short} short` : ''}. </>}
        {best && <>Best last 7 days: “{(best.title ?? 'a post').slice(0, 48)}” {best.impressions?.toLocaleString('en-US')} impressions.</>}
      </Answer>
      <nav className="cv2-pipe" aria-label={`${LANE_NAME[lane]} pipeline`}>
        {tile('ideas', 'Ideas', bank.n ?? '…', 'waiting', dHash('content', 'ideas', lane === 'ivan' ? {} : { lane }), 0)}
        {tile('drafts', 'Drafts', live ? drafts : '…', 'to decide', dHash('content', 'now'), 1)}
        {tile('dated', 'Dated 14d', reading ? '…' : dated, reading ? 'reading' : seat.short ? `${seat.short} gap${seat.short === 1 ? '' : 's'} next week` : 'next week covered', dHash('content', 'calendar'), 2)}
        {tile('posted', 'Posted 7d', reading ? '…' : posted, 'went out', dHash('content', 'results', lane === 'ivan' ? {} : { lane }), 3)}
        {tile('best', 'Best post 7d', best?.impressions != null ? best.impressions.toLocaleString('en-US') : own == null ? '…' : '–',
          best ? <>“{(best.title ?? 'Published post').slice(0, 40)}” impressions</> : own?.kind === 'ready' ? 'nothing measured this week' : own ? 'could not read' : 'reading', dHash('content', 'results', lane === 'ivan' ? {} : { lane }), 4, true)}
      </nav>
      <section className="cv2-sec" aria-label="Up next">
        <h2 className="cv2-h">Up next<a href={dHash('content', 'now')}>Review all {drafts} →</a></h2>
        {!live ? <p className="cv2-dim">Reading…</p> : upNext.length === 0 ? <p className="cv2-dim">Nothing of {LANE_NAME[lane]}’s waits for a decision.</p> : (
          <ol className="cv2-next">{upNext.map(c => (
            <li key={c.r.id}>
              <a href={dHash('content', 'now', { focus: c.r.id })} data-verb="brain-up-next">
                <SeatAv lane={c.lane} />
                <b>{splitTitleTag(c.title).text}</b>
                <span className="cv2-dim">{splitTitleTag(c.title).tag ?? (c.judge ? 'Brain draft' : 'Draft')} · {age(c.r.created_at, now)}</span>
                <span className="cv2-grow" /><span className="cv2-open">Open ›</span>
              </a>
            </li>
          ))}</ol>
        )}
      </section>
      <div className="cv2-brain-old">
        <NextIdeas lane={lane} />
        <RecentDecisions lane={lane} verdicts={verdicts} />
      </div>
    </div>
  )
}
