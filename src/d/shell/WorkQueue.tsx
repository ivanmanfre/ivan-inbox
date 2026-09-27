import { useEffect, useMemo, useState } from 'react'
import { useToday } from '../../hooks/useToday'
import { focusSummary, laneName } from '../../lib/focus'
import { fetchOpsDrafts, type OpsDraft } from '../../lib/ops'
import { ago, todayLoad, todayPlate, countsFromBrief } from '../../lib/today'
import {
  buildOpsItems, buildReplyItems, fetchContentErrorPile, fetchContentReviewPile, fetchStagedIdeaPile,
  foldQueue, pileItems, rankQueue, type QueueItem,
} from '../../lib/workQueue'
import { useDInbox } from '../counts/inbox'
import { dHash } from '../route'
import { SEAT_NAME, seatOf } from '../seats'
import { Btn } from '../ui/Key'
import { Failed, Skeleton } from '../ui/states'
import { RETRY_MS, useStalled, withTimeout } from '../ui/timeout'
import { warsawHm } from '../ui/time'
import { cleanLine } from './feedShape'

// ---------------------------------------------------------------------------
// WAITING ON YOU, at the top of the bell: what today's Today screen carried
// that no D place did (the Today SCREEN itself stays rejected). Same reads,
// same rules:
//   - the headline count: today's Masthead (get-morning-brief via useToday:
//     urgent + to approve + going out, New today / Carried over / Oldest, and
//     its Synced or Cached stamp);
//   - the focus line with the supply alarm ("… X lane is out of leads",
//     lib/focus supplyAlarmLane over the brief's pipeline + governor);
//   - the cross-lane Work queue (lib/workQueue: owed replies, ops cards,
//     content review / error piles, staged ideas, ranked), with the
//     "N people wrote and were never opened here" alarm first and the rows
//     older than two weeks behind a fold.
// Read only. A row opens the D place that holds it.
// ---------------------------------------------------------------------------

const FIRST = 3

type Piles = { review: Awaited<ReturnType<typeof fetchContentReviewPile>>; errors: Awaited<ReturnType<typeof fetchContentErrorPile>>; ideas: Awaited<ReturnType<typeof fetchStagedIdeaPile>> }

function useQueueReads() {
  const [ops, setOps] = useState<OpsDraft[] | null>(null)
  const [piles, setPiles] = useState<Piles | null>(null)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setFailed(false)
    // 12 s at most, then the failed line with Retry; a failure re-reads quietly after RETRY_MS.
    let again: number | undefined
    withTimeout(Promise.all([fetchOpsDrafts(), fetchContentReviewPile(), fetchContentErrorPile(), fetchStagedIdeaPile()]))
      .then(([o, review, errors, ideas]) => { if (alive) { setOps(o); setPiles({ review, errors, ideas }) } })
      .catch(e => {
        console.warn('[d] work queue read failed', e)
        if (!alive) return
        setFailed(true)
        again = window.setTimeout(() => { if (alive) setTick(t => t + 1) }, RETRY_MS)
      })
    return () => { alive = false; window.clearTimeout(again) }
  }, [tick])
  return { ops, piles, failed, retry: () => setTick(t => t + 1) }
}

/** Where a queue row opens in D. */
export function queueHash(i: QueueItem): string {
  if (i.kind === 'reply' && i.openId) return dHash('dms', null, { thread: i.openId })
  if (i.kind === 'ops') return dHash('ops')
  const lane = seatOf(i.lane) ?? 'ivan'
  const sub = i.kind === 'contentError' ? 'errors' : i.kind === 'ideas' ? 'ideas' : 'review'
  return dHash('content', sub, lane === 'ivan' ? undefined : { lane })
}

const OWNER: Record<string, string> = {
  ops: 'approved or discarded in Ops', ideas: 'reviewed in Content, Ideas', contentReview: 'promoted or skipped in Content', contentError: 'fixed or skipped in Content, Errors',
}

function QueueRow({ i, go }: { i: QueueItem; go: (h: string) => void }) {
  const seat = seatOf(i.lane)
  return (
    <button type="button" className={`d-wq-r${i.tier === 0 ? ' d-wq-hot' : ''}`} data-queue-kind={i.kind} onClick={() => go(queueHash(i))}>
      <span className="d-wq-m">
        <b>{i.n && i.n > 1 ? `${i.n} ` : ''}{cleanLine(i.title)}{i.tier === 0 && <em> · never opened</em>}{seat && seat !== 'ivan' && <u> · {SEAT_NAME[seat]}</u>}</b>
        {i.sub && <small>{cleanLine(i.sub).slice(0, 140)}</small>}
        {i.kind !== 'reply' && <small className="d-wq-own">{OWNER[i.kind]}</small>}
      </span>
      <time>{ago(i.waitingSince)}</time>
    </button>
  )
}

export function WorkQueue({ go }: { go: (hash: string) => void }) {
  const inbox = useDInbox()
  const t = useToday()
  const q = useQueueReads()
  const [older, setOlder] = useState(false)
  // The bell is for what just happened: the queue shows its first three, the rest one tap away.
  const [all, setAll] = useState(false)
  const now = Date.now()
  const items = useMemo(() => (q.ops && q.piles ? rankQueue([
    ...buildReplyItems(inbox.threads, now),
    ...buildOpsItems(q.ops, now),
    ...pileItems(q.piles.review, 'contentReview', now),
    ...pileItems(q.piles.errors, 'contentError', now),
    ...pileItems(q.piles.ideas, 'ideas', now),
  ]) : null), [inbox.threads, q.ops, q.piles]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = t.brief ? countsFromBrief(t.brief, 'all') : t.counts
  const load = todayLoad(counts)
  const plate = todayPlate(t.brief, 'all')
  const synced = t.brief?.generated_at ?? t.counts?.generated_at ?? t.cachedAt ?? null
  const stale = t.fromCache || t.degraded || (t.error != null && t.brief != null)
  // The brief never sits on "Reading…": 12 s, then it says so (and keeps trying quietly).
  const briefStalled = useStalled(!counts && !t.error, () => void t.refresh())
  const focus = q.ops ? focusSummary({ threads: inbox.threads, opsDrafts: q.ops, pipeline: t.health?.pipeline ?? [], governor: t.health?.governor ?? [] }) : null

  const never = (items ?? []).filter(i => i.tier === 0).length
  const fold = items ? foldQueue(items) : null
  // ONE number for "waiting on you" (final gate: 30 / 2 / 22 disagreed): the rows
  // of the list below, counted once. The morning brief's own tally is a
  // different unit and is labelled as the brief's.
  const n = items?.length ?? null
  const briefLine = !counts
    ? (t.error ? 'Morning brief: could not be read.' : briefStalled ? 'Morning brief: no answer in 12 s, still trying.' : 'Morning brief: reading…')
    : `Morning brief: ${load.urgent} urgent, ${load.approvals} to approve, ${load.going} going out today.`
  return (
    <section className="d-wq" data-work-queue>
      <div className="d-fday"><span>Waiting on you</span><span>every lane</span></div>
      <div className="d-wq-plate" data-plate>
        <b data-waiting-n>{n ?? (q.failed ? '?' : '…')}</b>
        <span>
          {n == null ? (q.failed ? 'The list could not be read.' : 'Reading the list…') : `${n === 1 ? 'thing' : 'things'} waiting on you, listed below, oldest first.`}
          <small data-brief-line>{briefLine}{t.brief && ` New today ${plate.newCount} · Carried over ${plate.carriedCount}${plate.oldest ? ` · Oldest ${plate.oldest}` : ''}`}</small>
          <small className={stale ? 'd-wq-stale' : undefined}>{synced ? `${stale ? 'Cached' : 'Synced'} ${warsawHm(synced)} · ${ago(synced)}${t.refreshing ? ' · refreshing…' : ''}` : briefStalled || t.error ? 'Not synced yet' : 'Syncing…'}</small>
          {(briefStalled || (t.error && !t.brief)) && <Btn verb="retry" onClick={() => void t.refresh()}>Retry</Btn>}
        </span>
      </div>
      {t.authError && <p className="d-wq-focus d-wq-alarm">Signed out: this is the last brief saved on this device. Sign in again from Settings.</p>}
      {!t.authError && t.degraded && <p className="d-wq-focus">Counts only: this session is not allowed the full brief. Sign in again to see the rows.</p>}
      {!t.authError && !t.degraded && t.error && t.brief && <p className="d-wq-focus">Could not refresh; this is the last brief on this device.</p>}
      {focus?.alarmLane && <p className="d-wq-focus d-wq-alarm" data-focus-line>{laneName(focus.alarmLane)} is out of leads.</p>}
      {q.failed && !items && <Failed what="the work queue" onRetry={q.retry} />}
      {!q.failed && !items && <Skeleton lines={3} title={false} label="Reading the work queue" />}
      {items && items.length === 0 && <p className="d-wq-none">Nothing crossing every lane is waiting on you right now.</p>}
      {never > 0 && <p className="d-wq-never" data-never-opened>{never} {never === 1 ? 'person' : 'people'} wrote and {never === 1 ? 'was' : 'were'} never opened here.</p>}
      {fold?.live.slice(0, all ? undefined : FIRST).map(i => <QueueRow key={i.id} i={i} go={go} />)}
      {fold && fold.live.length > FIRST && (
        <button type="button" className="d-wq-fold" aria-expanded={all} data-verb="expand" onClick={() => setAll(a => !a)}>
          {all ? 'Show the first three' : `Show all ${fold.live.length} from the last two weeks`}
        </button>
      )}
      {fold && fold.older.length > 0 && (all || fold.live.length <= FIRST) && (
        <button type="button" className="d-wq-fold" aria-expanded={older} onClick={() => setOlder(o => !o)}>
          {fold.older.length} older than two weeks · {older ? 'Hide' : 'Still waiting. Show them'}
        </button>
      )}
      {older && fold?.older.map(i => <QueueRow key={i.id} i={i} go={go} />)}
    </section>
  )
}
