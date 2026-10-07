import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useSkin } from '../../ds/useSkin'
import { TodayNotes } from '../lanes/TodayNotes'
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
import { SubNav, contentRedirect, subOf } from './SubNav'
import { Calendar } from './Calendar'
import { isPick, savedPick, type Pick } from './calModel'
import { DayPanel } from './DayPanel'
import { byDay, seatItems } from './planModel'
import { LANES, LANE_NAME, errorsLanding, titleOf, wallDays, type Lane } from './model'
import { useLanes } from '../../hooks/useLanes'
import type { ContentLane } from '../../lib/content'
import { useContentData } from './useContentData'
import { usePendingDecisions } from './decisions'
import { useWeekRead } from './useWeek'
import { useVerdicts } from './useVerdicts'
import { useJudged } from './verdictStore'
import { WeekStack } from './WeekStack'
import { SHOWS, buildNow, laneOfRow, windowDays, dayWord, dayDate, type Show } from './weekModel'
import { useMagnetCounts } from './useMagnetCounts'
import { Results } from './Results'
import { ContentBrain, waitsForReview } from './ContentBrain'
import { useContentFlags } from './v2/flags'
import { useMainTier } from './v2/useMainTier'
import { ReviewDesk } from './v2/ReviewDesk'
import { BrainV2 } from './v2/BrainV2'
import { MagnetsV2 } from './v2/MagnetsV2'
import './v2/cv2.css'
import './content.css'
import './content2.css'
import './content3.css'
import './now.css'

const BrainArea = lazy(() => import('./BrainArea').then(m => ({ default: m.BrainArea })))
const InputsPage = lazy(() => import('./inputs/Inputs').then(m => ({ default: m.InputsPage })))

const isLane = (s: string | null): s is Lane => s === 'ivan' || s === 'risedtc' || s === 'arch'
const SHOW_KEY = 'd-content-review-show'

export default function ContentPage({ layout, route, navigate }: PlaceProps) {
  const lanesV4 = useSkin('lanes')
  const sub = subOf(route.sub, route.query)
  const q = route.query
  // Brief 4 (SPEC-content): the frame flag and one flag per sub-tab; every hook below runs either way.
  const cv2 = useContentFlags()
  const tier = useMainTier(cv2.frame)
  const wide = tier === 't1'
  const view = q.get('view') ?? (route.sub === 'errors' ? 'posts' : route.sub === 'magnets' ? 'magnets' : null)
  const onNow = sub === 'now'
  // Run 51: Content Brain reads the same fast week (every draft in review) Review paints from.
  const onBrain = sub === 'brain' && view !== 'patterns'
  const onCal = sub === 'calendar'
  const allPosts = onNow && view === 'posts'
  const magnetView = onNow && (view === 'magnets' || !!q.get('magnet'))
  const [now] = useState(() => Date.now())
  const weekRead = useWeekRead(onNow || onBrain, now)
  const [fullOn, setFullOn] = useState(!onNow && !onBrain)
  // Content Brain needs only the fast week until a draft is opened (the open post's date controls read the full
  // seats): the three 1,000-row lane reads are the heaviest thing this page could ask of a small database.
  // Brief 4 Brain shows dated / posted counts, which need the seat reads.
  const lean = onBrain && !q.get('draft') && !cv2.brain
  useEffect(() => {
    if (fullOn || lean) return
    if ((!onNow && !onBrain) || weekRead.settled) { setFullOn(true); return }
    const t = setTimeout(() => setFullOn(true), 2500)
    return () => clearTimeout(t)
  }, [fullOn, lean, onNow, onBrain, weekRead.settled])
  useEffect(() => {
    const target = contentRedirect(route.sub, route.query)
    if (target) navigate(target)
  }, [navigate, route.sub, route.query])
  const data = useContentData(fullOn)
  const pending = usePendingDecisions()
  const [bankCounts, setBankCounts] = useState(false)
  useEffect(() => {
    if (!cv2.ideas || sub !== 'ideas' || bankCounts) return
    const t = setTimeout(() => setBankCounts(true), 1500)
    return () => clearTimeout(t)
  }, [cv2.ideas, sub, bankCounts])
  const banks = useIdeaBanks(sub === 'ideas' || (cv2.brain && onBrain), bankCounts ? undefined : isLane(q.get('lane')) ? q.get('lane') as Lane : 'ivan')
  const magnets = useMagnetCounts()
  const registry = useLanes()
  const qLane: Lane = isLane(q.get('lane')) ? q.get('lane') as Lane : 'ivan'
  const legacyLane = q.get('lane') && registry.lanes.some(l => l.client_id === q.get('lane')) ? q.get('lane') as ContentLane : qLane
  const [show, setShowState] = useState<Show>(() => { try { const s = localStorage.getItem(SHOW_KEY) as Show; return SHOWS.includes(s) ? s : 'all' } catch { return 'all' } })
  const setShow = (s: Show) => { setShowState(s); try { localStorage.setItem(SHOW_KEY, s) } catch { /* private mode */ } }
  // The calendar's client switch is its own (remembered) state, never ?lane=: opening a Rise post from "All" must not flip the calendar to Rise.
  const [pick, setPick] = useState<Pick>(() => (isPick(q.get('who')) ? q.get('who') as Pick : savedPick()))
  const focusAsk = cv2.review && onNow ? q.get('focus') : null
  useEffect(() => { if (focusAsk && show !== 'all') setShowState('all') }, [focusAsk]) // eslint-disable-line react-hooks/exhaustive-deps
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
  const openFromBrain = (id: string, lane: Lane) => go({ draft: id, lane }, 'brain')
  const openFromPlan = (id: string, lane: Lane) => go({ draft: id, lane }, 'calendar')
  const openFromList = (id: string, lane: ContentLane, ids: string[]) => { setListIds(ids); go({ draft: id, lane, view: 'posts' }, 'now') }
  const days = useMemo(() => wallDays(now), [now])
  const items = useMemo(() => Object.fromEntries(LANES.map(l => [l, byDay(seatItems(data.seats[l].rows, l, data.queueRows, now))])) as Record<Lane, ReturnType<typeof byDay>>, [data.seats, data.queueRows, now])
  // Use the fast saved week until a full seat read has arrived; it never overrides a newer live seat.
  const rows = useMemo(() => LANES.flatMap(l => data.seats[l].loadedAt ? data.seats[l].rows : weekRead.rows.filter(r => laneOfRow(r) === l)), [data.seats, weekRead.rows])
  // Approve / Drop (run 39): saved verdicts from the database + this session's taps. A dropped draft leaves the list,
  // an approved one stays with a flag, an open strip holds its card's place and is not counted as work.
  const saved = useVerdicts()
  const judged = useJudged()
  const verdicts = useMemo(() => new Map([...saved.map].map(([id, v]) => [id, v.verdict])), [saved.map])
  const nowModel = useMemo(() => buildNow(rows, { now, show, pending, blocks: data.blocks, verdicts, judged }), [rows, now, show, pending, data.blocks, verdicts, judged])
  const allNow = useMemo(() => buildNow(rows, { now, pending, blocks: data.blocks, verdicts, judged }), [rows, now, pending, data.blocks, verdicts, judged])
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
  const onMove = (id: string, lane: Lane, day?: string) => go({ move: id, lane, ...(day ? { day } : {}) }, 'calendar')
  const wallProps = { data, items, stuck: null, onOpen: openFromPlan, onMove, onArm: armIt, onDay: (lane: Lane, keys: string[]) => setDayOpen({ lane, keys }), now }
  const brainIds = onBrain ? rows.filter(r => waitsForReview(r) && laneOfRow(r) === qLane && !verdicts.has(r.id)).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(r => r.id) : []
  const queueIds = onBrain ? brainIds : allPosts ? listIds : onCal ? [...items[qLane].values()].flat().filter(i => i.source === 'draft').sort((a, b) => a.at.localeCompare(b.at)).map(i => i.id) : nowModel.ids
  const titles = Object.fromEntries(rows.filter(r => queueIds.includes(r.id)).map(r => [r.id, titleOf(r)]))
  const window_ = draft ? <DraftWindow id={draft} lane={qLane} queue={queueIds} onPick={id => onCal ? openFromPlan(id, qLane) : onBrain ? openFromBrain(id, qLane) : openDraft(id, nowModel.lanes.get(id) ?? qLane)} onClose={close} refresh={refresh} days={days} armed={data.armed} armedFailed={data.armedFailed} titles={titles} startInEdit={cv2.review && q.get('edit') === '1'} /> : null
  const moveRow = moveId ? data.seats[qLane].rows.find(r => r.id === moveId) : null
  const move = moveRow ? <MovePanel key={`${moveId}:${q.get('day') ?? ''}`} r={moveRow} lane={qLane} first={days[0].key} seatRows={data.seats[qLane].rows} phone={phone} quickCommit initialPick={q.get('day')} onClose={close} onDone={refresh} /> : null
  const clearMagnet = () => { const p = new URLSearchParams(q); p.delete('magnet'); navigate(dHash('content', sub, p)) }
  const legacy = (s: 'errors' | 'magnets' | 'queue' | 'strategy' | 'styles' | 'results') => <Legacy sub={s} lane={legacyLane} setLane={l => go({ ...context(), lane: l })} openDraft={openFromList} openId={draft} magnet={q.get('magnet')} clearMagnet={clearMagnet} phone={phone} land={view === 'posts' && !q.get('tab') ? (qLane === 'ivan' ? 'all' : 'internal_review') : errorsLanding(data.seats[qLane].rows, qLane, now, data.blocks, q.get('tab') === 'generating' ? 'generating' : 'errors')} />
  const calendarBody = <>
    <Calendar data={data} items={items} now={now} phone={phone} pick={pick} setPick={setPick} onOpen={openFromPlan} onMove={onMove} onArm={armIt} onDay={wallProps.onDay} onChanged={refresh} v2={cv2.calendar} wide={wide} magnetCount={magnetLanes.reduce((n, l) => n + (magnets[l] ?? 0), 0)} />
    {move}
  </>
  const stackRead = LANES.every(l => !!data.seats[l].loadedAt) ? { ...weekRead, source: 'live' as const, rows, settled: true, error: null } : weekRead
  const nowBody = <>
    {lanesV4 && <TodayNotes />}
    <div className="cn-now-tools"><a href={dHash('content', 'calendar')}>Calendar →</a><a href={dHash('content', 'now', { view: 'posts' })}>All posts</a></div>
    {data.failed > 0 && <p className="cn-now-failed" role="alert">Could not read every client. <button type="button" onClick={refresh}>Retry</button></p>}
    {magnetLanes.length > 0 && <div className="cn-magnet-summary" aria-label="Lead magnets awaiting review"><span>Lead magnets to review</span>{magnetLanes.map(l => <a key={l} href={dHash('content', 'magnets', { lane: l })}>{LANE_NAME[l]} · {magnets[l]} →</a>)}</div>}
    <WeekStack week={nowModel} read={stackRead} show={show} setShow={setShow} now={now} openId={draft} onOpen={openDraft} onChanged={refresh} firstDay={days[0].key} seatRows={l => rows.filter(r => laneOfRow(r) === l)} nowView />
    <section className="cn-week-strip" aria-label="Upcoming week"><div className="cn-week-strip-head"><b>This week</b><a href={dHash('content', 'calendar')}>Calendar →</a></div><div className="cn-week-strip-days">{windowDays(now, 5).map(key => {
      const n = LANES.reduce((v, l) => v + (items[l].get(key)?.length ?? 0), 0)
      return <a key={key} href={dHash('content', 'calendar')}><b>{dayWord(key, now)}</b><small>{dayDate(key).replace(/^\w+ /, '')}</small><span>{reading ? '…' : `${n} post${n === 1 ? '' : 's'}`}</span></a>
    })}</div></section>
  </>
  const deskBody = <>
    {data.failed > 0 && <div className="cv2-banner cv2-banner-bad" role="alert"><span>Could not read every client.</span><button type="button" onClick={refresh}>Retry</button></div>}
    <ReviewDesk week={nowModel} total={allNow} read={stackRead} show={show} setShow={setShow} now={now} openId={draft} focusId={q.get('focus')}
      onOpen={openDraft} onEdit={(id, lane) => go({ ...context(), draft: id, lane, edit: '1' }, 'now')} onChanged={refresh}
      firstDay={days[0].key} seatRows={l => rows.filter(r => laneOfRow(r) === l)} rows={rows} armed={data.armed} armedFailed={data.armedFailed} />
  </>
  let body: React.ReactNode
  // Brief 4 sub-tabs sit in the page's one scrolling column (the 24 edge), like Review and Calendar.
  const column = (n: React.ReactNode) => <div className="cn-split"><div className="cn-left" data-d-scroll>{n}</div></div>
  if (sub === 'ideas') body = cv2.ideas ? column(<Ideas banks={banks} phone={phone} lane={qLane} onLaneChange={lane => go({ lane }, 'ideas')} v2 />) : <Ideas banks={banks} phone={phone} lane={qLane} onLaneChange={lane => go({ lane }, 'ideas')} />
  else if (sub === 'brain' && !onBrain) body = <Suspense fallback={<Skeleton lines={5} label="Reading the brain area" />}><div className="cn-now-tools"><a href={dHash('content', 'brain', qLane === 'ivan' ? {} : { lane: qLane })}>← Content Brain</a></div><BrainArea lane={qLane} setLane={setLane} phone={phone} query={q} /></Suspense>
  else if (onBrain) {
    const brainBody = cv2.brain
      ? <BrainV2 lane={qLane} setLane={l => go({ lane: l }, 'brain')} read={stackRead} verdicts={saved.map} judged={judged} total={allNow} items={items} ideas={banks} now={now} reading={reading} />
      : <ContentBrain lane={qLane} setLane={l => go({ lane: l }, 'brain')} read={stackRead} verdicts={saved.map} openId={draft} onOpen={openFromBrain} onChanged={refresh} />
    body = phone && window_ ? window_ : <div className={`cn-split${window_ ? ' cn-open' : ''}`}><div className="cn-left">{brainBody}</div>{window_}</div>
  }
  else if (sub === 'results') body = view === 'analytics' ? legacy('results') : <Results lane={qLane} setLane={setLane} />
  else if (sub === 'inputs') body = <Suspense fallback={<Skeleton lines={5} label="Reading outliers" />}><InputsPage lane={qLane} setLane={setLane} phone={phone} query={q} /></Suspense>
  else if (sub === 'magnets') body = cv2.lms ? column(<MagnetsV2 lane={qLane} setLane={l => go({ lane: l }, 'magnets')} phone={phone} magnet={q.get('magnet')} clearMagnet={clearMagnet} counts={magnets} />) : legacy('magnets')
  else if (sub === 'strategy' || sub === 'styles') body = legacy(sub)
  else if (onCal) body = phone && window_ ? window_ : <div className={`cn-split cn-cal-split${window_ ? ' cn-open' : ''}`}><div className="cn-left">{calendarBody}</div>{window_}</div>
  else {
    const desk = cv2.review && !magnetView && !allPosts
    const left = magnetView ? <><div className="cn-now-tools"><a href={dHash('content', 'now')}>← Review</a></div>{legacy('magnets')}</> : allPosts ? <><div className="cn-now-tools"><a href={dHash('content', 'now')}>← Review</a></div>{legacy('errors')}</> : desk ? deskBody : nowBody
    body = phone && window_ ? window_ : <div className={`cn-split${window_ ? ' cn-open' : ''}${desk ? ' cv2-split' : ''}`} data-wide={desk ? (wide ? 'yes' : 'no') : undefined}><div className={`cn-left${allPosts ? ' cn-left-legacy' : ''}`}>{left}</div>{window_}</div>
  }
  const title = sub === 'brain' ? (onBrain ? 'Content Brain' : 'Patterns and benchmarks') : sub === 'ideas' ? 'Best ideas for your next post' : sub === 'results' ? 'What worked' : sub === 'strategy' ? (q.get('section') === 'direction' ? 'Strategy' : q.get('section') === 'this-week' ? 'Content brain' : 'Strategy') : sub === 'inputs' ? 'Outliers' : sub === 'magnets' ? 'Lead magnets' : sub === 'styles' ? 'Styles' : onCal ? 'Calendar' : allPosts ? 'All posts' : magnetView ? 'Lead magnets' : 'Review'
  return <div className={`cn${cv2.frame ? ' cv2-frame' : ''}`} data-cv2-sub={cv2.frame ? sub : undefined}><AnswerRow title={title} /><SubNav on={sub} attention={needs > 0} lane={qLane} section={q.get('section')} v2={cv2.frame} counts={{ now: reading && !weekRead.settled ? null : allNow.ids.length, magnets: LANES.some(l => magnets[l] === undefined) ? null : LANES.reduce((n, l) => n + (magnets[l] ?? 0), 0) }} />{body}
    {dayOpen && <DayPanel lane={dayOpen.lane} keys={dayOpen.keys} items={items[dayOpen.lane]} onClose={() => setDayOpen(null)} onOpen={openFromPlan} onMove={onMove} onArm={armIt} onChanged={refresh} />}
  </div>
}
