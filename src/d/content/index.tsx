import { useCallback, useMemo, useState } from 'react'
import type { PlaceProps } from '../places'
import { dHash } from '../route'
import { useReportFailed } from '../shell/health'
import { AnswerRow, N } from '../ui/AnswerRow'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'
import { warsawDay, warsawDayTime, warsawHm } from '../ui/time'
import { localDay } from '../../lib/content'
import { scheduleGuarded } from './writes'
import { DraftWindow } from './DraftWindow'
import { Ideas, useIdeaBanks } from './Ideas'
import { Legacy } from './Legacy'
import { MovePanel } from './MovePanel'
import { PhoneWall } from './PhoneWall'
import { Queue } from './Queue'
import { SubNav, subOf, type Trio } from './SubNav'
import { Wall, type Ghost } from './Wall'
import { LANES, dayLabel, errorRows, nextFreeWeekday, scheduledIn, titleOf, wallDays, waitingRows, weekWord, type Lane } from './model'
import { useContentData } from './useContentData'
import './content.css'
import './content2.css'
import './content3.css'

// D · CONTENT. C's wall planner is the home (seats down, ten weekdays across),
// the review queue under it, a post opens in the draft window docked right
// (phone: the page becomes the draft). Ideas has three seat channels. Every
// other Content place hangs off the sub-nav, and those are today's views.
const isLane = (s: string | null): s is Lane => s === 'ivan' || s === 'risedtc' || s === 'arch'

export default function ContentPage({ layout, route, navigate }: PlaceProps) {
  const data = useContentData()
  const banks = useIdeaBanks()
  const confirm = useDConfirm()
  const toast = useToast()
  const [week, setWeek] = useState<0 | 1 | null>(null)
  const [moveLand, setMoveLand] = useState<string | null>(null)
  const sub = subOf(route.sub)
  const q = route.query
  const draft = q.get('draft')
  const moveId = q.get('move')
  const qLane: Lane = isLane(q.get('lane')) ? (q.get('lane') as Lane) : 'ivan'
  const phone = layout === 'phone'
  const [now] = useState(() => Date.now())

  const go = useCallback((params: Record<string, string>, s: string | null = route.sub) => navigate(dHash('content', s, params)), [navigate, route.sub])
  const openDraft = useCallback((id: string, lane: Lane) => go({ draft: id, lane }, sub === 'review' ? 'review' : null), [go, sub])
  const close = useCallback(() => go(qLane === 'ivan' ? {} : { lane: qLane }), [go, qLane])
  const setLane = useCallback((l: Lane) => go(draft ? { draft, lane: l } : { lane: l }), [draft, go])

  const days = useMemo(() => wallDays(now), [now])
  const wk1 = days.slice(0, 5)
  const waiting = useMemo(() => Object.fromEntries(LANES.map(l => [l, waitingRows(data.seats[l].rows, now)])) as Record<Lane, ReturnType<typeof waitingRows>>, [data.seats, now])
  const trio = (f: (l: Lane) => number): Trio => Object.fromEntries(LANES.map(l => [l, data.seats[l].error ? null : !data.seats[l].loadedAt ? undefined : f(l)])) as Trio
  const reviewN = trio(l => waiting[l].fresh.length)
  const errorsN = trio(l => errorRows(data.seats[l].rows, l, now).length)
  const ideasN = Object.fromEntries(LANES.map(l => [l, banks[l].error ? null : banks[l].n ?? undefined])) as Trio
  useReportFailed('content', data.failed + LANES.filter(l => banks[l].error).length)

  const n = (l: Lane) => (data.seats[l].error || !data.seats[l].loadedAt ? null : scheduledIn(data.seats[l].rows, l, wk1))
  const archReview = data.seats.arch.rows.filter(r => r.status === 'review' && r.board_visible === true && r.scheduled_at && wk1.some(d => d.key === warsawDay(r.scheduled_at as string))).length
  const blocked = data.verdict?.find(p => p.errors)?.text ?? null
  const ivanStuck = errorRows(data.seats.ivan.rows, 'ivan', now).filter(r => r.status === 'scheduled').length
  const stuck = blocked ? 'a post is blocked, see Errors' : ivanStuck ? `${ivanStuck} post${ivanStuck === 1 ? '' : 's'} never went out` : null

  const reading = sub === 'ideas' ? LANES.some(l => ideasN[l] === undefined) : LANES.some(l => !data.seats[l].loadedAt && !data.seats[l].error)
  const title = reading ? <>Reading {sub === 'ideas' ? 'the idea banks' : 'the posts of all three seats'}…</> : sub === 'ideas'
    ? <>Ideas to decide: <N v={ideasN.ivan} /> yours, <N v={ideasN.risedtc} /> Mattan’s, <N v={ideasN.arch} /> Davorin’s.</>
    : <>{weekWord(now)}: <N v={n('ivan')} /> yours, <N v={n('risedtc')} /> Rise, <N v={n('arch')} /> Arch posts scheduled.</>
  const subLine = sub === 'ideas' ? 'Approving an idea starts a draft. Nothing here reaches a client.'
    : [archReview ? `Arch’s ${archReview} ${archReview === 1 ? 'is' : 'are'} in review on Davorin’s board.` : null, blocked].filter(Boolean).join(' ') || null

  const armIt = useCallback(async (id: string) => {
    const r = data.seats.ivan.rows.find(x => x.id === id)
    if (!r?.scheduled_at) return
    const at = new Date(r.scheduled_at)
    const ok = await confirm({
      title: 'Put this post on LinkedIn?',
      message: `The publisher posts this on ${at.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} at ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}. This is not an internal mark, it goes out on LinkedIn.`,
      confirmText: 'Schedule it', verb: 'confirm',
    })
    if (!ok) return
    try { await scheduleGuarded(id, at.toISOString()); toast.show({ message: `Armed for ${warsawDayTime(at)} Warsaw.` }); data.refreshAll() }
    catch (e) { toast.show({ message: e instanceof Error ? e.message : 'Could not arm it.', tone: 'failed' }) }
  }, [confirm, data, toast])

  const openLane = draft ? qLane : null
  const queueIds = useMemo(() => {
    if (!openLane) return []
    const w = waiting[openLane]
    // The walk is the fresh queue (what the frame counts); an older draft opened from the fold walks both.
    return (w.older.some(r => r.id === draft) ? [...w.fresh, ...w.older] : w.fresh).map(r => r.id)
  }, [draft, openLane, waiting])
  const slot = data.armed ? nextFreeWeekday(data.armed, now) : null
  const openRow = draft && openLane ? data.seats[openLane].rows.find(r => r.id === draft) : null
  const ghost: Ghost | null = draft && openLane === 'ivan' && slot && openRow?.status !== 'scheduled'
    ? { lane: 'ivan', key: localDay(slot.at), title: openRow ? titleOf(openRow) : 'This post', time: `${String(slot.at.getHours()).padStart(2, '0')}:${String(slot.at.getMinutes()).padStart(2, '0')}`, label: 'Lands here' }
    : null
  const wkIdx: 0 | 1 = week ?? (ghost && days.slice(5).some(d => d.key === ghost.key) ? 1 : 0)
  const shownDays = draft && !phone ? days.slice(wkIdx * 5, wkIdx * 5 + 5) : days
  const moveLane = isLane(q.get('lane')) ? (q.get('lane') as Lane) : 'ivan'
  const moveRow = moveId ? data.seats[moveLane].rows.find(r => r.id === moveId) ?? null : null

  const moveGhost: Ghost | null = moveRow && moveLand
    ? { lane: moveLane, key: moveLand, title: titleOf(moveRow), time: moveRow.scheduled_at ? warsawHm(moveRow.scheduled_at) : '09:00', label: `Lands ${dayLabel(moveLand)}` }
    : null
  const window_ = draft && openLane ? (
    <DraftWindow id={draft} lane={openLane} queue={queueIds} onPick={id => openDraft(id, openLane)} onClose={close}
      refresh={data.seats[openLane].refresh} days={days} armed={data.armed} armedFailed={data.armedFailed} />
  ) : null
  const queue = (
    <Queue lane={qLane} setLane={setLane} seat={data.seats[qLane]} fresh={waiting[qLane].fresh} older={waiting[qLane].older}
      counts={reviewN} openId={draft} onOpen={id => openDraft(id, qLane)} now={now} />
  )
  const wallProps = { data, stuck, onOpen: openDraft, onMove: (id: string, l: Lane) => go({ move: id, lane: l }, null), onArm: armIt, now }
  const move = moveRow ? (
    <MovePanel r={moveRow} lane={moveLane} first={days[0].key} seatRows={data.seats[moveLane].rows} phone={phone}
      onClose={() => go(moveLane === 'ivan' ? {} : { lane: moveLane }, null)} onDone={data.refreshAll} onLand={setMoveLand} />
  ) : null

  let body: React.ReactNode
  if (sub === 'ideas') body = <Ideas banks={banks} phone={phone} />
  else if (sub !== 'planner' && sub !== 'review') {
    body = <Legacy sub={sub} lane={qLane} setLane={setLane} openDraft={(id, l) => navigate(dHash('content', null, { draft: id, lane: l }))} magnet={q.get('magnet')} phone={phone} />
  } else if (phone && window_) body = window_
  else if (phone) {
    body = <>{sub === 'planner' && <PhoneWall {...wallProps} days={days} />}<div className="cn-left">{queue}</div>{move}</>
  } else {
    body = (
      <div className={`cn-split${window_ ? ' cn-open' : ''}`}>
        <div className="cn-left">
          {sub === 'planner' && (
            <>
              <div className="cn-wk">
                {draft ? [0, 1].map(i => (
                  <button key={i} type="button" className={wkIdx === i ? 'cn-on' : ''} onClick={() => setWeek(i as 0 | 1)}>Week of {days[i * 5].dm}</button>
                )) : <button type="button" className="cn-on">Weeks of {days[0].dm} and {days[5].dm}</button>}
                <em>{draft ? 'Both weeks side by side when no post is open' : 'Tap a post to open it; Move puts it on another day'}</em>
              </div>
              <Wall {...wallProps} days={shownDays} ghost={moveGhost ?? ghost} lift={moveRow?.id ?? null} />
            </>
          )}
          {move ?? queue}
        </div>
        {window_}
      </div>
    )
  }

  return (
    <div className="cn">
      <AnswerRow title={title} sub={subLine} />
      {!(phone && window_ && (sub === 'planner' || sub === 'review')) && <SubNav on={sub} counts={{ review: reviewN, ideas: ideasN, errors: errorsN }} />}
      {body}
    </div>
  )
}
