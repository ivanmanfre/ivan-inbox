import { useCallback, useMemo, useState } from 'react'
import type { PlaceProps } from '../places'
import { dHash } from '../route'
import { useReportFailed } from '../shell/health'
import { AnswerRow, N } from '../ui/AnswerRow'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'
import { warsawDayTime, warsawHm } from '../ui/time'
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
import { Month } from './Month'
import { DayPanel } from './DayPanel'
import { byDay, seatItems } from './planModel'
import { LANES, dayLabel, errorRows, errorRowsWithBlocks, errorsLanding, generatingOf, nextFreeWeekday, scheduledIn, titleOf, wallDays, waitingRows, weekWord, type Lane } from './model'
import { useLanes } from '../../hooks/useLanes'
import type { ContentLane } from '../../lib/content'
import { useContentData } from './useContentData'
import { useMagnetCounts } from './useMagnetCounts'
import { SUB_LABEL } from './SubNav'
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
  const registry = useLanes()
  // Today's views take any lane the registry lists (a 4th client included); D's own wall reads the three seats.
  const legacyLane = ((): ContentLane => {
    const l = route.query.get('lane')
    return l && (isLane(l) || registry.lanes.some(x => x.client_id === l)) ? (l as ContentLane) : 'ivan'
  })()
  const [listQueue, setListQueue] = useState<{ id: string; ids: string[] } | null>(null)
  const banks = useIdeaBanks()
  const magnetsN = useMagnetCounts()
  const confirm = useDConfirm()
  const toast = useToast()
  const [week, setWeek] = useState<0 | 1 | null>(null)
  const [moveLand, setMoveLand] = useState<string | null>(null)
  const [dayOpen, setDayOpen] = useState<{ lane: Lane; keys: string[] } | null>(null)
  // Two weeks (the wall) or the month (today's calendar), remembered.
  const [plan, setPlanState] = useState<'weeks' | 'month'>(() => { try { return localStorage.getItem('d-content-plan') === 'month' ? 'month' : 'weeks' } catch { return 'weeks' } })
  const setPlan = (v: 'weeks' | 'month') => { setPlanState(v); try { localStorage.setItem('d-content-plan', v) } catch { /* private mode */ } }
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
  const openFromList = useCallback((id: string, l: ContentLane, ids: string[]) => {
    setListQueue({ id, ids })
    navigate(dHash('content', 'errors', { draft: id, lane: l }))
  }, [navigate])
  const clearMagnet = useCallback(() => {
    const p = new URLSearchParams(route.query); p.delete('magnet')
    navigate(dHash('content', route.sub, p))
  }, [navigate, route.query, route.sub])
  const setLane = useCallback((l: Lane) => go(draft ? { draft, lane: l } : { lane: l }), [draft, go])

  const days = useMemo(() => wallDays(now), [now])
  const items = useMemo(() => Object.fromEntries(LANES.map(l => [l, byDay(seatItems(data.seats[l].rows, l, data.queueRows, now))])) as Record<Lane, ReturnType<typeof byDay>>, [data.seats, data.queueRows, now])
  const wk1 = days.slice(0, 5)
  const waiting = useMemo(() => Object.fromEntries(LANES.map(l => [l, waitingRows(data.seats[l].rows, now)])) as Record<Lane, ReturnType<typeof waitingRows>>, [data.seats, now])
  const trio = (f: (l: Lane) => number): Trio => Object.fromEntries(LANES.map(l => [l, data.seats[l].error ? null : !data.seats[l].loadedAt ? undefined : f(l)])) as Trio
  const reviewN = trio(l => waiting[l].fresh.length)
  const errorsN = trio(l => errorRowsWithBlocks(data.seats[l].rows, l, now, data.blocks).length)
  const gen = Object.fromEntries(LANES.map(l => [l, generatingOf(data.seats[l].rows, l, now)])) as Record<Lane, { n: number; stalled: number }>
  const ideasN = Object.fromEntries(LANES.map(l => [l, banks[l].error ? null : banks[l].n ?? undefined])) as Trio
  useReportFailed('content', data.failed + LANES.filter(l => banks[l].error).length)

  const n = (l: Lane) => (data.seats[l].error || !data.seats[l].loadedAt ? null : scheduledIn(data.seats[l].rows, l, wk1))
  const blocked = data.verdict?.find(p => p.errors)?.text ?? null
  const ivanStuck = errorRows(data.seats.ivan.rows, 'ivan', now).filter(r => r.status === 'scheduled').length
  const stuck = blocked ? 'a post is blocked, see Errors' : ivanStuck ? `${ivanStuck} post${ivanStuck === 1 ? '' : 's'} never went out` : null

  const reading = sub === 'ideas' ? LANES.some(l => ideasN[l] === undefined) : LANES.some(l => !data.seats[l].loadedAt && !data.seats[l].error)
  const stalledLine = LANES.filter(l => gen[l].stalled).map(l => `${gen[l].stalled} ${l === 'ivan' ? 'of yours' : `of ${l === 'arch' ? 'Arch’s' : 'Rise’s'}`} stalled in generation`).join(', ')
  // Each place answers its own question; the planner's sentence stays on the planner.
  const native = sub === 'planner' || sub === 'review' || sub === 'ideas'
  const title = !native ? (
    sub === 'errors' ? <>Errors and stuck: <N v={errorsN.ivan} /> yours, <N v={errorsN.risedtc} /> Rise, <N v={errorsN.arch} /> Arch.</>
      : sub === 'magnets' ? <>Lead magnets in review: <N v={magnetsN.ivan} /> yours, <N v={magnetsN.risedtc} /> Rise, <N v={magnetsN.arch} /> Arch.</>
        : <>{SUB_LABEL[sub]}</>
  ) : reading ? <>Reading {sub === 'ideas' ? 'the idea banks' : 'the posts of all three seats'}…</> : sub === 'ideas'
    ? <>Ideas to decide: <N v={ideasN.ivan} /> yours, <N v={ideasN.risedtc} /> Mattan’s, <N v={ideasN.arch} /> Davorin’s.</>
    : <>{weekWord(now)}: <N v={n('ivan')} /> yours, <N v={n('risedtc')} /> Rise, <N v={n('arch')} /> Arch posts scheduled.</>
  // One headline; a second line only for posts stuck in generation (work that needs Ivan).
  // A lint-blocked post is said once, in Ivan's seat column and the Errors count.
  const subLine = sub === 'queue' ? 'Your feed only.' : stalledLine || null

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
  const inErrors = sub === 'errors'
  const queueIds = useMemo(() => {
    if (!openLane) return []
    // Opened from a list (Errors / every post): walk THAT list, as today's window walks its section.
    if (inErrors) {
      if (listQueue && listQueue.ids.includes(draft as string)) return listQueue.ids
      return errorRowsWithBlocks(data.seats[openLane].rows, openLane, now, data.blocks).map(r => r.id)
    }
    // Opened from the wall or the month: walk that seat's dated posts in firing order.
    if (q.get('from') === 'plan') {
      return [...items[openLane].values()].flat().filter(it => it.source === 'draft').sort((a, b) => (a.at < b.at ? -1 : 1)).map(it => it.id)
    }
    const w = waiting[openLane]
    // The walk is the fresh queue (what the frame counts); an older draft opened from the fold walks both.
    return (w.older.some(r => r.id === draft) ? [...w.fresh, ...w.older] : w.fresh).map(r => r.id)
  }, [data.blocks, data.seats, draft, inErrors, items, listQueue, now, openLane, q, waiting])
  const titles = useMemo(() => {
    const t: Record<string, string> = {}
    if (openLane) for (const r of data.seats[openLane].rows) if (queueIds.includes(r.id)) t[r.id] = titleOf(r)
    return t
  }, [data.seats, openLane, queueIds])
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
    <DraftWindow id={draft} lane={openLane} queue={queueIds} onPick={id => (q.get('from') === 'plan' ? go({ draft: id, lane: openLane, from: 'plan' }) : openDraft(id, openLane))} onClose={close}
      refresh={data.seats[openLane].refresh} days={days} armed={data.armed} armedFailed={data.armedFailed} titles={titles} />
  ) : null
  const queue = (
    <Queue lane={qLane} setLane={setLane} seat={data.seats[qLane]} fresh={waiting[qLane].fresh} older={waiting[qLane].older}
      counts={reviewN} openId={draft} onOpen={id => openDraft(id, qLane)} now={now} />
  )
  const openFromPlan = (id: string, l: Lane) => go({ draft: id, lane: l, from: 'plan' }, sub === 'review' ? 'review' : null)
  const onMove = (id: string, l: Lane, day?: string) => go({ move: id, lane: l, ...(day ? { day } : {}) }, null)
  const wallProps = { data, items, stuck, onOpen: openFromPlan, onMove, onArm: armIt, onDay: (l: Lane, keys: string[]) => setDayOpen({ lane: l, keys }), now }
  const move = moveRow ? (
    <MovePanel key={`${moveRow.id}:${q.get('day') ?? ''}`} r={moveRow} lane={moveLane} first={days[0].key} seatRows={data.seats[moveLane].rows} phone={phone} initialPick={q.get('day')}
      onClose={() => go(moveLane === 'ivan' ? {} : { lane: moveLane }, null)} onDone={data.refreshAll} onLand={setMoveLand} />
  ) : null
  const dayPanel = dayOpen ? (
    <DayPanel lane={dayOpen.lane} keys={dayOpen.keys} items={items[dayOpen.lane]} onClose={() => setDayOpen(null)} onOpen={openFromPlan} onMove={onMove} onArm={armIt} />
  ) : null
  const planSwitch = (
    <span className="cn-planv" role="tablist" aria-label="Planner view">
      <button type="button" role="tab" aria-selected={plan === 'weeks'} className={plan === 'weeks' ? 'cn-on' : ''} onClick={() => setPlan('weeks')}>Two weeks</button>
      <button type="button" role="tab" aria-selected={plan === 'month'} className={plan === 'month' ? 'cn-on' : ''} onClick={() => setPlan('month')} data-verb="month">Month</button>
    </span>
  )
  const month = <Month lane={qLane} setLane={setLane} items={items[qLane]} rows={data.seats[qLane].rows} onOpen={openFromPlan} onMove={onMove} onArm={armIt} onDay={wallProps.onDay} now={now} />

  const laneCounts = Object.fromEntries(LANES.filter(l => typeof reviewN[l] === 'number').map(l => [l, reviewN[l] as number])) as Partial<Record<ContentLane, number>>
  const wantGen = q.get('tab') === 'generating' ? 'generating' : 'errors'
  const land = isLane(legacyLane) ? errorsLanding(data.seats[legacyLane].rows, legacyLane, now, data.blocks, wantGen) : (wantGen === 'generating' ? 'internal_generating' : 'internal_error')
  const legacy = (
    <Legacy sub={sub} lane={legacyLane} setLane={l => go({ lane: l })} openDraft={openFromList} openId={inErrors ? draft : null}
      magnet={q.get('magnet')} clearMagnet={clearMagnet} phone={phone} laneCounts={laneCounts} land={land} />
  )
  const errWindow = inErrors && draft && openLane ? (
    <DraftWindow id={draft} lane={openLane} queue={queueIds} onPick={id => navigate(dHash('content', 'errors', { draft: id, lane: openLane }))}
      onClose={() => navigate(dHash('content', 'errors', openLane === 'ivan' ? {} : { lane: openLane }))}
      refresh={data.seats[openLane].refresh} days={days} armed={data.armed} armedFailed={data.armedFailed} titles={titles} />
  ) : null

  let body: React.ReactNode
  if (sub === 'ideas') body = <Ideas banks={banks} phone={phone} />
  else if (errWindow) body = phone ? errWindow : <div className="cn-split cn-open"><div className="cn-left cn-left-legacy">{legacy}</div>{errWindow}</div>
  else if (sub !== 'planner' && sub !== 'review') body = legacy
  else if (phone && window_) body = window_
  else if (phone) {
    body = <>{sub === 'planner' && <div className="cn-wk cn-wk-p">{planSwitch}</div>}{sub === 'planner' && (plan === 'month' ? month : <PhoneWall {...wallProps} days={days} />)}<div className="cn-left">{queue}</div>{move}</>
  } else {
    body = (
      <div className={`cn-split${window_ ? ' cn-open' : ''}`}>
        <div className="cn-left">
          {sub === 'planner' && (
            <>
              <div className="cn-wk">
                {planSwitch}
                {plan === 'weeks' && (draft ? [0, 1].map(i => (
                  <button key={i} type="button" className={wkIdx === i ? 'cn-on' : ''} onClick={() => setWeek(i as 0 | 1)}>Week of {days[i * 5].dm}</button>
                )) : <button type="button" className="cn-on">Weeks of {days[0].dm} and {days[5].dm}</button>)}
              </div>
              {plan === 'month' ? month : <Wall {...wallProps} days={shownDays} ghost={moveGhost ?? ghost} lift={moveRow?.id ?? null} />}
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
      {!(phone && (window_ || errWindow) && (sub === 'planner' || sub === 'review' || sub === 'errors')) && <SubNav on={sub} counts={{ review: reviewN, ideas: ideasN, errors: errorsN, magnets: magnetsN }} gen={gen} />}
      {body}
      {dayPanel}
    </div>
  )
}
