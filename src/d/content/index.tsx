import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import type { PlaceProps } from '../places'
import { dHash } from '../route'
import { useReportFailed } from '../shell/health'
import { AnswerRow } from '../ui/AnswerRow'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'
import { warsawDayTime } from '../ui/time'
import { scheduleGuarded } from './writes'
import { DraftWindow } from './DraftWindow'
import { Ideas, useIdeaBanks } from './Ideas'
import { Skeleton } from '../ui/states'
import { Legacy } from './Legacy'
import { MovePanel } from './MovePanel'
import { PhoneWall } from './PhoneWall'
import { SubNav, contentRedirect, subOf } from './SubNav'
import { Wall } from './Wall'
import { Month } from './Month'
import { DayPanel } from './DayPanel'
import { byDay, seatItems } from './planModel'
import { LANES, LANE_NAME, errorsLanding, titleOf, wallDays, type Lane } from './model'
import { useLanes } from '../../hooks/useLanes'
import type { ContentLane } from '../../lib/content'
import { useContentData } from './useContentData'
import { usePendingDecisions } from './decisions'
import { useWeekRead } from './useWeek'
import { WeekStack } from './WeekStack'
import { SHOWS, buildNow, laneOfRow, windowDays, dayWord, dayDate, type Show } from './weekModel'
import { useMagnetCounts } from './useMagnetCounts'
import { Results } from './Results'
import './content.css'
import './content2.css'
import './content3.css'
import './now.css'

const InputsPage = lazy(() => import('./inputs/Inputs').then(m => ({ default: m.InputsPage })))

const isLane = (s: string | null): s is Lane => s === 'ivan' || s === 'risedtc' || s === 'arch'
const SHOW_KEY = 'd-content-review-show'

export default function ContentPage({ layout, route, navigate }: PlaceProps) {
  const sub = subOf(route.sub, route.query)
  const q = route.query
  const view = q.get('view') ?? (route.sub === 'planner' || route.sub === 'queue' ? 'planner' : route.sub === 'errors' ? 'posts' : route.sub === 'magnets' ? 'magnets' : null)
  const onNow = sub === 'now'
  const planner = onNow && view === 'planner'
  const allPosts = onNow && view === 'posts'
  const magnetView = onNow && (view === 'magnets' || !!q.get('magnet'))
  const [now] = useState(() => Date.now())
  const weekRead = useWeekRead(onNow, now)
  const [fullOn, setFullOn] = useState(!onNow)
  useEffect(() => {
    if (fullOn) return
    if (!onNow || weekRead.settled) { setFullOn(true); return }
    const t = setTimeout(() => setFullOn(true), 2500)
    return () => clearTimeout(t)
  }, [fullOn, onNow, weekRead.settled])
  useEffect(() => {
    const target = contentRedirect(route.sub, route.query)
    if (target) navigate(target)
  }, [navigate, route.sub, route.query])
  const data = useContentData(fullOn)
  const pending = usePendingDecisions()
  const banks = useIdeaBanks(sub === 'ideas', isLane(q.get('lane')) ? q.get('lane') as Lane : 'ivan')
  const magnets = useMagnetCounts()
  const registry = useLanes()
  const qLane: Lane = isLane(q.get('lane')) ? q.get('lane') as Lane : 'ivan'
  const legacyLane = q.get('lane') && registry.lanes.some(l => l.client_id === q.get('lane')) ? q.get('lane') as ContentLane : qLane
  const [show, setShowState] = useState<Show>(() => { try { const s = localStorage.getItem(SHOW_KEY) as Show; return SHOWS.includes(s) ? s : 'all' } catch { return 'all' } })
  const setShow = (s: Show) => { setShowState(s); try { localStorage.setItem(SHOW_KEY, s) } catch { /* private mode */ } }
  const [plan, setPlanState] = useState<'weeks' | 'month'>(() => { try { return localStorage.getItem('d-content-plan') === 'month' ? 'month' : 'weeks' } catch { return 'weeks' } })
  const setPlan = (v: 'weeks' | 'month') => { setPlanState(v); try { localStorage.setItem('d-content-plan', v) } catch { /* private mode */ } }
  const [listIds, setListIds] = useState<string[]>([])
  const [dayOpen, setDayOpen] = useState<{ lane: Lane; keys: string[] } | null>(null)
  const phone = layout === 'phone'
  const draft = q.get('draft')
  const moveId = q.get('move')
  const go = useCallback((params: Record<string, string>, target = sub) => navigate(dHash('content', target, params)), [navigate, sub])
  const context = () => ({ ...(view ? { view } : {}), ...(q.get('section') ? { section: q.get('section')! } : {}), ...(qLane !== 'ivan' ? { lane: qLane } : {}) })
  const close = () => go(context())
  const setLane = (lane: Lane) => go({ ...context(), lane, ...(draft ? { draft } : {}) })
  const openDraft = (id: string, lane: Lane) => go({ ...context(), draft: id, lane }, 'now')
  const openFromPlan = (id: string, lane: Lane) => go({ draft: id, lane, view: 'planner', from: 'plan' }, 'now')
  const openFromList = (id: string, lane: ContentLane, ids: string[]) => { setListIds(ids); go({ draft: id, lane, view: 'posts' }, 'now') }
  const days = useMemo(() => wallDays(now), [now])
  const items = useMemo(() => Object.fromEntries(LANES.map(l => [l, byDay(seatItems(data.seats[l].rows, l, data.queueRows, now))])) as Record<Lane, ReturnType<typeof byDay>>, [data.seats, data.queueRows, now])
  // Use the fast saved week until a full seat read has arrived; it never overrides a newer live seat.
  const rows = useMemo(() => LANES.flatMap(l => data.seats[l].loadedAt ? data.seats[l].rows : weekRead.rows.filter(r => laneOfRow(r) === l)), [data.seats, weekRead.rows])
  const nowModel = useMemo(() => buildNow(rows, { now, show, pending, blocks: data.blocks }), [rows, now, show, pending, data.blocks])
  const allNow = useMemo(() => buildNow(rows, { now, pending, blocks: data.blocks }), [rows, now, pending, data.blocks])
  const reading = LANES.some(l => !data.seats[l].loadedAt && !data.seats[l].error) || LANES.some(l => magnets[l] === undefined)
  const magnetLanes = LANES.filter(l => (magnets[l] ?? 0) > 0)
  const needs = allNow.ids.length + magnetLanes.reduce((n, l) => n + (magnets[l] ?? 0), 0)
  const failed = data.failed + (sub === 'ideas' ? LANES.filter(l => banks[l].error).length : 0)
  useReportFailed('content', failed)
  const refresh = useCallback(() => { weekRead.refresh(); data.refreshAll() }, [weekRead.refresh, data.refreshAll])
  const confirm = useDConfirm()
  const toast = useToast()
  const armIt = async (id: string) => {
    const r = data.seats.ivan.rows.find(x => x.id === id)
    if (!r?.scheduled_at) return
    const at = new Date(r.scheduled_at)
    if (!await confirm({ title: 'Put this post on LinkedIn?', message: `The publisher posts this on ${warsawDayTime(at)} Warsaw.`, confirmText: 'Schedule it', verb: 'confirm' })) return
    try { await scheduleGuarded(id, at.toISOString()); toast.show({ message: `Armed for ${warsawDayTime(at)} Warsaw.` }); refresh() }
    catch (e) { toast.show({ message: e instanceof Error ? e.message : 'Could not arm it.', tone: 'failed' }) }
  }
  const onMove = (id: string, lane: Lane, day?: string) => go({ move: id, lane, view: 'planner', ...(day ? { day } : {}) }, 'now')
  const wallProps = { data, items, stuck: null, onOpen: openFromPlan, onMove, onArm: armIt, onDay: (lane: Lane, keys: string[]) => setDayOpen({ lane, keys }), now }
  const queueIds = allPosts ? listIds : planner ? [...items[qLane].values()].flat().filter(i => i.source === 'draft').sort((a, b) => a.at.localeCompare(b.at)).map(i => i.id) : nowModel.ids
  const titles = Object.fromEntries(rows.filter(r => queueIds.includes(r.id)).map(r => [r.id, titleOf(r)]))
  const window_ = draft ? <DraftWindow id={draft} lane={qLane} queue={queueIds} onPick={id => planner ? openFromPlan(id, qLane) : openDraft(id, nowModel.lanes.get(id) ?? qLane)} onClose={close} refresh={refresh} days={days} armed={data.armed} armedFailed={data.armedFailed} titles={titles} /> : null
  const moveRow = moveId ? data.seats[qLane].rows.find(r => r.id === moveId) : null
  const move = moveRow ? <MovePanel key={`${moveId}:${q.get('day') ?? ''}`} r={moveRow} lane={qLane} first={days[0].key} seatRows={data.seats[qLane].rows} phone={phone} quickCommit initialPick={q.get('day')} onClose={close} onDone={refresh} /> : null
  const clearMagnet = () => { const p = new URLSearchParams(q); p.delete('magnet'); navigate(dHash('content', sub, p)) }
  const legacy = (s: 'errors' | 'magnets' | 'queue' | 'strategy' | 'styles' | 'results') => <Legacy sub={s} lane={legacyLane} setLane={l => go({ ...context(), lane: l })} openDraft={openFromList} openId={draft} magnet={q.get('magnet')} clearMagnet={clearMagnet} phone={phone} land={view === 'posts' && !q.get('tab') ? (qLane === 'ivan' ? 'all' : 'internal_review') : errorsLanding(data.seats[qLane].rows, qLane, now, data.blocks, q.get('tab') === 'generating' ? 'generating' : 'errors')} />
  const plannerBody = <>
    <div className="cn-now-tools"><a href={dHash('content', 'now')}>← Review</a><span className="cn-planv" role="tablist" aria-label="Planner view"><button type="button" role="tab" aria-selected={plan === 'weeks'} onClick={() => setPlan('weeks')}>Two weeks</button><button type="button" role="tab" data-verb="month" aria-selected={plan === 'month'} onClick={() => setPlan('month')}>Month</button></span></div>
    {plan === 'month' ? <Month lane={qLane} setLane={setLane} items={items[qLane]} rows={data.seats[qLane].rows} onOpen={openFromPlan} onMove={onMove} onArm={armIt} onDay={wallProps.onDay} onChanged={refresh} now={now} phone={phone} /> : phone ? <PhoneWall {...wallProps} days={days} /> : <Wall {...wallProps} days={days} />}
    {move}
  </>
  const stackRead = LANES.every(l => !!data.seats[l].loadedAt) ? { ...weekRead, source: 'live' as const, rows, settled: true, error: null } : weekRead
  const nowBody = <>
    <div className="cn-now-tools"><a href={dHash('content', 'now', { view: 'planner' })}>Planner →</a><a href={dHash('content', 'now', { view: 'posts' })}>All posts</a></div>
    {data.failed > 0 && <p className="cn-now-failed" role="alert">Could not read every client. <button type="button" onClick={refresh}>Retry</button></p>}
    {magnetLanes.length > 0 && <div className="cn-magnet-summary" aria-label="Lead magnets awaiting review"><span>Lead magnets to review</span>{magnetLanes.map(l => <a key={l} href={dHash('content', 'magnets', { lane: l })}>{LANE_NAME[l]} · {magnets[l]} →</a>)}</div>}
    <WeekStack week={nowModel} read={stackRead} show={show} setShow={setShow} now={now} openId={draft} onOpen={openDraft} onChanged={refresh} firstDay={days[0].key} seatRows={l => rows.filter(r => laneOfRow(r) === l)} nowView />
    <section className="cn-week-strip" aria-label="Upcoming week"><div className="cn-week-strip-head"><b>This week</b><a href={dHash('content', 'now', { view: 'planner' })}>Full planner →</a></div><div className="cn-week-strip-days">{windowDays(now, 5).map(key => {
      const n = LANES.reduce((v, l) => v + (items[l].get(key)?.length ?? 0), 0)
      return <a key={key} href={dHash('content', 'now', { view: 'planner', day: key })}><b>{dayWord(key, now)}</b><small>{dayDate(key).replace(/^\w+ /, '')}</small><span>{reading ? '…' : `${n} post${n === 1 ? '' : 's'}`}</span></a>
    })}</div></section>
  </>
  let body: React.ReactNode
  if (sub === 'ideas') body = <Ideas banks={banks} phone={phone} lane={qLane} onLaneChange={lane => go({ lane }, 'ideas')} />
  else if (sub === 'results') body = view === 'analytics' ? legacy('results') : <Results lane={qLane} setLane={setLane} />
  else if (sub === 'inputs') body = <Suspense fallback={<Skeleton lines={5} label="Reading outliers" />}><InputsPage lane={qLane} setLane={setLane} phone={phone} query={q} /></Suspense>
  else if (sub === 'magnets') body = legacy('magnets')
  else if (sub === 'strategy' || sub === 'styles') body = legacy(sub)
  else {
    const left = planner ? plannerBody : magnetView ? <><div className="cn-now-tools"><a href={dHash('content', 'now')}>← Review</a></div>{legacy('magnets')}</> : allPosts ? <><div className="cn-now-tools"><a href={dHash('content', 'now')}>← Review</a></div>{legacy('errors')}</> : nowBody
    body = phone && window_ ? window_ : <div className={`cn-split${window_ ? ' cn-open' : ''}`}><div className={`cn-left${allPosts ? ' cn-left-legacy' : ''}`}>{left}</div>{window_}</div>
  }
  const title = sub === 'ideas' ? 'Best ideas for your next post' : sub === 'results' ? 'What worked' : sub === 'strategy' ? (q.get('section') === 'direction' ? 'Strategy' : q.get('section') === 'this-week' ? 'Content brain' : 'Strategy') : sub === 'inputs' ? 'Outliers' : sub === 'magnets' ? 'Lead magnets' : sub === 'styles' ? 'Styles' : planner ? 'Planner' : allPosts ? 'All posts' : magnetView ? 'Lead magnets' : 'Review'
  return <div className="cn"><AnswerRow title={title} /><SubNav on={sub} attention={needs > 0} lane={qLane} section={q.get('section')} />{body}
    {dayOpen && <DayPanel lane={dayOpen.lane} keys={dayOpen.keys} items={items[dayOpen.lane]} onClose={() => setDayOpen(null)} onOpen={openFromPlan} onMove={onMove} onArm={armIt} onChanged={refresh} />}
  </div>
}
