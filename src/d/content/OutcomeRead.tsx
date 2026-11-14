import { useEffect, useState } from 'react'
import { coverageLine, tooFew, fetchOutcomeLatest, outcomeGroups, outcomeLine, previousLine, type OutcomeLatest, type OutcomeRow } from '../../lib/outcomeRead'
import { readSwr, writeSwr } from '../../lib/swr'
import { Skeleton } from '../ui/states'
import { DAY_MS, LANE_NAME, type Lane } from './model'

// WHAT BRINGS BUYERS (2026-11-14, db/20261114g). The brain was judged on views, which one viral post swamps.
// This shows the 4-weekly pooled read for this account: per source, the buyer-fit people who engaged by day 7,
// the people who wrote to us, and day-7 views. Same look as Best posts (one hairline row each). Groups are
// compared only inside this account. One small RPC; the saved copy paints first.

const day = (iso: string) => new Date(Date.parse(iso)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Warsaw' })
const span = (a: string, b: string) => `${day(a)} to ${day(new Date(Date.parse(b) - DAY_MS).toISOString())}`

function Row({ r, lead }: { r: OutcomeRow; lead?: boolean }) {
  const few = tooFew(r)
  return (
    <li data-outcome-row data-grp={r.grp} data-lead={lead || undefined}>
      <span>{r.posts} post{r.posts === 1 ? '' : 's'}</span>
      <b>{r.label}</b>
      <em>{outcomeLine(r)}{few && !lead ? ' · too few to judge' : ''}</em>
    </li>
  )
}

export function OutcomeRead({ lane }: { lane: Lane }) {
  const key = `content-outcome:${lane}`
  const [st, setSt] = useState<{ lane: Lane; data: OutcomeLatest | null; err: string | null }>(() => ({ lane, data: readSwr<OutcomeLatest>(key)?.payload ?? null, err: null }))
  useEffect(() => {
    let live = true
    setSt({ lane, data: readSwr<OutcomeLatest>(key)?.payload ?? null, err: null })
    fetchOutcomeLatest(lane)
      .then(d => { if (!live) return; setSt({ lane, data: d, err: null }); writeSwr(key, d) })
      .catch(e => { if (live) setSt(s => ({ ...s, err: e instanceof Error ? e.message : 'read failed' })) })
    return () => { live = false }
  }, [lane, key])
  const data = st.lane === lane ? st.data : null
  const read = data?.read ?? null
  const g = read ? outcomeGroups(read.rows) : null
  const prevTotal = data?.prev ? outcomeGroups(data.prev.rows).total : null
  const prevLine = g && data?.prev ? previousLine(g.total, prevTotal, span(data.prev.window_start, data.prev.window_end)) : null
  const gaps = g ? coverageLine(g.total) : null
  // The next window ends 28 days after this one; its read runs on the first Monday 8+ days after that.
  const next = read ? day(new Date(Date.parse(read.window_end) + 36 * DAY_MS).toISOString()) : null
  return (
    <section className="cb-sec" aria-label="What brings buyers" data-outcome-read>
      <h2 className="cb-h"><b>What brings buyers</b><span>{read ? `day 7 after each post · posts from ${span(read.window_start, read.window_end)}` : 'read every 4 weeks'}</span></h2>
      {!data && !st.err ? <Skeleton lines={3} title={false} label="Reading the results" />
        : !read ? <p className="cb-empty">{st.err ? 'Could not read the results.' : `No 4-week read for ${LANE_NAME[lane]} yet.`}</p>
          : !g?.total ? <p className="cb-empty">No {LANE_NAME[lane]} posts in this read.</p>
            : <>
              <ol className="cb-own cb-out">
                <Row r={g.total} lead />
                {g.bySource.map(r => <Row key={`s-${r.grp}`} r={r} />)}
              </ol>
              {g.byTopic.length > 0 && <>
                <p className="cb-sub">Poland or business</p>
                <ol className="cb-own cb-out">{g.byTopic.map(r => <Row key={`t-${r.grp}`} r={r} />)}</ol>
              </>}
              <p className="cb-note" data-outcome-note>
                Buyers are people who fit {lane === 'ivan' ? 'your' : `${LANE_NAME[lane]}’s`} buyer and engaged by day 7. The range is where the real number likely sits. Small groups move a lot from one read to the next.
                {g.total.bookings_linked ? ` Calls linked to these posts: ${g.total.bookings_linked}.` : ' No linked calls recorded.'}
                {gaps ? ` ${gaps}` : ''}{prevLine ? ` ${prevLine}` : ''}{next ? ` Next read about ${next}.` : ''}
              </p>
            </>}
      {st.err && data && <p className="cb-note cb-bad" role="alert">Showing the saved copy. Could not refresh: {st.err}</p>}
    </section>
  )
}
