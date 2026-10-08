import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LANE_DEFAULT_HM, LANE_TZ, hmIn, laneTimeWord, zonedToUtc } from './laneTime'
import { monthLabel, monthWeeks } from '../../lib/calendarItems'
import { clearScheduleDate, setScheduleDateAt } from '../../lib/content'
import { supabase } from '../../lib/supabase'
import { moveConfirmCopy, movePublishesForClient } from '../../wb/content/moveConfirm'
import { dHash } from '../route'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'
import { warsawDay, warsawDayTime } from '../ui/time'
import { useCalGestures } from './calGestures'
import {
  DOT_WORD, PICKS, PICK_KEY, calendarDays, coverOf, lanesOf, looseOf, magnetLane, monthOf, openDay,
  type Entry, type Loose, type Magnet, type Pick,
} from './calModel'
import { DAY_MS, LANE_NAME, dayLabel, timeLine, wallDays, type Lane } from './model'
import type { PlanItem } from './planModel'
import { PhoneWall } from './PhoneWall'
import { Unpublish } from './Unpublish'
import { Wall } from './Wall'
import type { ContentData } from './useContentData'
import './calendar.css'
import { coverageOf } from './v2/coverage'
import { BufferDock, CoverageBar, DayList, WallV2, type CardActs } from './v2/CalendarV2'
import { SeatAv, Seg } from './v2/ui'

// D · CONTENT > CALENDAR. The first tab (Ivan, 30 Sep: "The calendar is the
// calendar... the most important thing"). One client or all of them; this
// month and any month ahead, paged by swipe, arrows, ← → or a trackpad; a
// Month grid with real previews and the two-week Lines wall he liked; the day
// under the grid with every post big; posts without a date and lead magnets
// waiting, in rails you can drag from. Drag (mouse) or hold-and-drag (finger)
// a post onto a day to move it: the same guarded date write as the planner's
// Move, a confirm only when the date makes a client's publisher post it, and
// Undo on every move. A post that must not move says why when lifted.

type View = 'month' | 'lines'
const viewKey = (p: Pick) => `d-cal-view-${p}`
const store = { get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } } }
const PICK_NAME: Record<Pick, string> = { all: 'All', ivan: 'Ivan', risedtc: 'Rise', arch: 'Arch' }
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export type CalendarProps = {
  data: ContentData
  items: Record<Lane, Map<string, PlanItem[]>>
  now: number
  phone: boolean
  pick: Pick
  setPick: (p: Pick) => void
  onOpen: (id: string, lane: Lane) => void
  onMove: (id: string, lane: Lane) => void
  onArm: (id: string) => void
  onDay: (lane: Lane, keys: string[]) => void
  onChanged: () => void
  /** Brief 4 (`content.calendar`): coverage, clean cards, the buffer dock. Every hook and write below is the same either way. */
  v2?: boolean
  /** The main column is wide (tier 1, >= 1000): Lines shows two weeks; narrower shows one. */
  wide?: boolean
  magnetCount?: number
}

/** A tiny spring on one number, no library: x'' = -k(x - to) - c x'. */
function spring(from: number, to: number, set: (v: number) => void, done: () => void, v0 = 0): () => void {
  let x = from, v = v0, last = performance.now(), raf = 0
  const k = 520, c = 42
  const step = (t: number) => {
    const dt = Math.min(0.032, (t - last) / 1000); last = t
    v += (-k * (x - to) - c * v) * dt
    x += v * dt
    if (Math.abs(x - to) < 0.5 && Math.abs(v) < 20) { set(to); done(); return }
    set(x); raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}

export function Calendar({ data, items, now, phone, pick, setPick, onOpen, onMove, onArm, onDay, onChanged, v2 = false, wide = true }: CalendarProps) {
  const confirm = useDConfirm()
  const toast = useToast()
  // Desktop "All" opens on the lines wall; a single client, and every phone, opens on the month.
  const firstView = (p: Pick): View => (store.get(viewKey(p)) as View | null) ?? (p === 'all' && !phone ? 'lines' : 'month')
  const [view, setViewState] = useState<View>(() => firstView(pick))
  useEffect(() => { setViewState(firstView(pick)) }, [pick]) // eslint-disable-line react-hooks/exhaustive-deps
  const setView = (v: View) => { store.set(viewKey(pick), v); setViewState(v); setOff(0); setSel(null) }
  const choose = (p: Pick) => { store.set(PICK_KEY, p); setPick(p) }
  const [off, setOff] = useState(0)
  const [sel, setSel] = useState<string | null>(null)
  const [moved, setMoved] = useState<Map<string, string>>(() => new Map())
  const [magnets, setMagnets] = useState<Magnet[] | null>(null)
  const reduced = useMemo(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const rows = useMemo(() => ({ ivan: data.seats.ivan.rows, risedtc: data.seats.risedtc.rows, arch: data.seats.arch.rows }), [data.seats])

  // An optimistic day holds only until the re-read agrees (or the row is gone).
  useEffect(() => {
    if (!moved.size) return
    const next = new Map(moved)
    for (const [id, day] of moved) {
      const r = rows.ivan.find(x => x.id === id) ?? rows.risedtc.find(x => x.id === id) ?? rows.arch.find(x => x.id === id)
      const has = r?.scheduled_at ? warsawDay(r.scheduled_at) : ''
      if (!r || has === day) next.delete(id)
    }
    if (next.size !== moved.size) setMoved(next)
  }, [rows, moved])

  useEffect(() => {
    let live = true
    void supabase.from('lm_drafts_v2').select('id, client_id, status, topic, slug, cover_url, covers')
      .in('status', ['review', 'lm_review', 'approved']).order('updated_at', { ascending: false }).limit(60)
      .then(({ data: d, error }) => {
        if (!live) return
        if (error) { setMagnets([]); return }
        setMagnets(((d ?? []) as { id: string; client_id: string | null; status: string; topic: string | null; slug: string | null; cover_url: string | null; covers: unknown }[])
          .flatMap(m => { const lane = magnetLane(m.client_id); const cover = coverOf(m.cover_url, m.covers); return lane && (m.topic || m.slug || cover) ? [{ id: m.id, lane, status: m.status, title: (m.topic || m.slug || 'Lead magnet').slice(0, 90), cover }] : [] }))
      })
    return () => { live = false }
  }, [])

  const days = useMemo(() => calendarDays(items, rows, pick, moved), [items, rows, pick, moved])
  const loose = useMemo(() => looseOf(rows, pick, moved), [rows, pick, moved])
  const lms = useMemo(() => (magnets ?? []).filter(m => lanesOf(pick).includes(m.lane)), [magnets, pick])
  const todayKey = warsawDay(now)

  // ---- the page: a month, or two weeks of lines ---------------------------
  const ym = monthOf(now, off)
  const weeks = useMemo(() => monthWeeks(ym.year, ym.month), [ym.year, ym.month])
  const keys = useMemo(() => weeks.flat(), [weeks])
  const inMonth = useMemo(() => new Set(keys.filter(k => Number(k.slice(5, 7)) - 1 === ym.month)), [keys, ym.month])
  // Brief 4 narrow (Claude open, a small window): one week of five days, paged by the week.
  const week5 = v2 && !wide && !phone
  const lineDays = useMemo(() => (week5 ? wallDays(now + off * 7 * DAY_MS).slice(0, 5) : wallDays(now + off * 14 * DAY_MS)), [now, off, week5])
  const cov = useMemo(() => coverageOf(items, now), [items, now])
  const label = view === 'month' ? monthLabel(ym.year, ym.month) : `${dayLabel(lineDays[0].key)} – ${dayLabel(lineDays[lineDays.length - 1].key)}`
  const day = sel ?? (view === 'month' ? openDay(keys, inMonth, days, todayKey) : (lineDays.some(d => d.key === todayKey) ? todayKey : lineDays[0].key))

  // ---- motion: the track follows the finger, then springs ------------------
  const track = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLElement>(null)
  const anim = useRef<() => void>(() => {})
  const enter = useRef<number | null>(null)
  const setX = (x: number) => { if (track.current) track.current.style.transform = x ? `translate3d(${x}px,0,0)` : '' }
  const page = useCallback((dir: -1 | 1, fromX = 0) => {
    anim.current()
    const w = stage.current?.clientWidth ?? 600
    if (reduced) { setX(0); setOff(o => o + dir); setSel(null); return }
    anim.current = spring(fromX, -dir * w * 0.6, setX, () => { enter.current = dir * w * 0.6; setOff(o => o + dir); setSel(null) })
  }, [reduced])
  useLayoutEffect(() => {
    if (enter.current == null) return
    const from = enter.current
    enter.current = null
    setX(from)
    anim.current = spring(from, 0, setX, () => {})
  }, [off])
  const today = () => { anim.current(); setX(0); setOff(0); setSel(null) }

  const drop = useCallback(async (id: string, laneS: string, to: string) => {
    const lane = laneS as Lane
    const r = rows[lane].find(x => x.id === id)
    if (!r) return
    const prev = r.scheduled_at
    if ((prev ? warsawDay(prev) : null) === to) return
    // The time of day is kept in the lane's own clock (RISE in PT), so a clock change never shifts it.
    const tz = LANE_TZ[lane]
    const when = zonedToUtc(to, prev ? hmIn(prev, tz) : LANE_DEFAULT_HM[lane], tz)
    if (movePublishesForClient(r)) {
      const copy = moveConfirmCopy(r, dayLabel(to), laneTimeWord(when, lane))
      if (!await confirm({ title: copy.title, message: copy.message, confirmText: copy.confirmText, verb: 'confirm' })) return
    }
    setMoved(m => new Map(m).set(id, to))
    setSel(to)
    try {
      const stored = await setScheduleDateAt(id, when)
      const landed = warsawDay(stored)
      if (landed !== to) setMoved(m => new Map(m).set(id, landed))
      toast.show({
        message: `Moved to ${dayLabel(landed)} · ${laneTimeWord(stored, lane)}.`,
        sub: landed !== to ? `${dayLabel(to)} was taken or a weekend, so it landed on ${dayLabel(landed)}.` : LANE_NAME[lane],
        action: { label: 'Undo', verb: 'undo', run: () => { void undo(id, lane, prev) } },
      })
      onChanged()
    } catch (e) {
      setMoved(m => { const n = new Map(m); n.delete(id); return n })
      toast.show({ message: e instanceof Error ? e.message : 'Could not move it.', tone: 'failed' })
    }
  }, [rows, confirm, toast, onChanged]) // eslint-disable-line react-hooks/exhaustive-deps

  const undo = async (id: string, lane: Lane, prev: string | null) => {
    setMoved(m => new Map(m).set(id, prev ? warsawDay(prev) : ''))
    try {
      if (prev) await setScheduleDateAt(id, prev)
      else await clearScheduleDate(id)
      toast.show({ message: prev ? `Put back on ${warsawDayTime(prev)}.` : 'Put back with no date.', sub: LANE_NAME[lane] })
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Could not put it back.', tone: 'failed' })
    }
    onChanged()
  }

  useCalGestures(root, {
    reducedMotion: reduced,
    onDrop: (id, lane, to) => { void drop(id, lane, to) },
    onRefuse: why => toast.show({ id: 'cal-refuse', message: why }),
    onSwipeMove: dx => { anim.current(); setX(dx) },
    onSwipeEnd: (dir, dx) => { if (dir) page(dir, dx); else { anim.current(); anim.current = spring(dx, 0, setX, () => {}) } },
    onEdgePage: dir => page(dir),
  })

  // Keys and a sideways trackpad page too.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); page(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); page(1) }
      else if (e.key === 't' || e.key === 'T') today()
    }
    window.addEventListener('keydown', key)
    const el = stage.current
    let acc = 0, quiet = 0, lock = false
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || lock) return
      acc += e.deltaX
      window.clearTimeout(quiet); quiet = window.setTimeout(() => { acc = 0 }, 220)
      if (Math.abs(acc) > 90) { page(acc > 0 ? 1 : -1); acc = 0; lock = true; window.setTimeout(() => { lock = false }, 650) }
    }
    el?.addEventListener('wheel', wheel, { passive: true })
    return () => { window.removeEventListener('keydown', key); el?.removeEventListener('wheel', wheel) }
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  // Brief 4 keys: M / L switch the view, 1-4 pick the seat (B folds the buffer, in BufferDock). None of them write.
  useEffect(() => {
    if (!v2) return
    const key = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]') || document.querySelector('.d-confirm, .d-sheet, .cv2-menu:not([hidden])')) return
      if (e.key === 'm' || e.key === 'M') setView('month')
      else if (e.key === 'l' || e.key === 'L') setView('lines')
      else if (/^[1-4]$/.test(e.key)) choose(PICKS[Number(e.key) - 1])
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const agenda = days.get(day) ?? []
  const laneBound = pick === 'all' ? undefined : pick

  if (v2) {
    const acts: CardActs = { onOpen, onMove, onArm, onChanged }
    const lanes = lanesOf(pick)
    const nextWeek = new Set(lanes.flatMap(l => (data.seats[l].loadedAt ? cov.seats[l].gaps : [])))
    const riseLine = (pick === 'all' || pick === 'risedtc') ? warsawDay(now + 14 * DAY_MS) : null
    return (
      <section ref={root} className={`cal cv2 cv2-cal${phone ? ' cal-phone' : ''} cal-${view}${week5 ? ' cv2-week5' : ''}`} aria-label="Content calendar" data-cv2="calendar">
        <header className="cv2-bar cv2-cal-bar">
          <Seg label="Client" verb="cal-pick" value={pick} onChange={id => choose(id as Pick)} options={PICKS.map(p => ({ id: p, label: p === 'all' ? 'All' : <><SeatAv lane={p} />{PICK_NAME[p]}</> }))} />
          <Seg label="View" verb="cal-view" size="sm" value={view} onChange={id => setView(id as View)} options={[{ id: 'month', label: 'Month', title: 'M' }, { id: 'lines', label: 'By client', title: 'L' }]} />
          <span className="cv2-grow" />
          <div className="cv2-calnav">
            <button type="button" data-verb="cal-prev" aria-label={view === 'month' ? 'Previous month' : week5 ? 'Previous week' : 'Previous two weeks'} onClick={() => page(-1)}>‹</button>
            <b aria-live="polite">{label}</b>
            <button type="button" data-verb="cal-next" aria-label={view === 'month' ? 'Next month' : week5 ? 'Next week' : 'Next two weeks'} onClick={() => page(1)}>›</button>
            <button type="button" className="cv2-today" data-verb="cal-today" disabled={off === 0} onClick={today}>Today</button>
          </div>
        </header>
        <CoverageBar cov={cov} lanes={lanes} phone={phone} loaded={l => !!data.seats[l].loadedAt} />
        <div className={`cv2-cal-body cv2-cal-${view}`}>
          <div ref={stage} className="cal-stage cv2-stage">
            <div ref={track} className="cal-track">
              {view === 'month' ? (
                <div className="cal-grid cv2-month" role="group" aria-label={`${PICK_NAME[pick]}, ${label}`}>
                  {DOW.map(d => <div key={d} className="cal-wh">{phone ? d[0] : d}</div>)}
                  {keys.map(k => {
                    const on = days.get(k) ?? []
                    const cls = ['cal-day', inMonth.has(k) ? '' : 'out', k === todayKey ? 'today' : '', k === day ? 'sel' : '', k < todayKey ? 'past' : '', !on.length && nextWeek.has(k) ? 'cv2-gapday' : '', k === riseLine ? 'cv2-riseline' : ''].filter(Boolean).join(' ')
                    return (
                      <div key={k} className={cls} data-cal-day={k} data-cal-lane={laneBound} onClick={() => setSel(k)} title={k === riseLine ? `${dayLabel(k)} · Mattan’s two-week line` : dayLabel(k)}>
                        <span className="cal-dn">{Number(k.slice(8))}</span>
                        {on.slice(0, 3).map(e => <Chip key={e.it.id} e={e} phone={phone} onOpen={onOpen} />)}
                        {on.length > 3 && <span className="cal-more">+{on.length - 3}</span>}
                      </div>
                    )
                  })}
                </div>
              ) : phone
                ? <PhoneWall data={data} items={items} days={lineDays} stuck={null} onOpen={onOpen} onMove={onMove} onArm={onArm} now={now} lanes={lanes} />
                : <WallV2 data={data} items={items} days={lineDays} entryOf={(l, k) => (days.get(k) ?? []).filter(e => e.lane === l)} cov={cov} lanes={lanes} now={now} today={todayKey} a={acts} onDay={onDay} />}
            </div>
          </div>
          {(view === 'month' || phone) && (
            <aside className="cv2-side">
              <DayList day={day} isToday={day === todayKey} entries={agenda} reading={!data.seats.ivan.loadedAt} a={acts} />
              {!phone && <BufferDock loose={loose} lms={lms} a={acts} vertical />}
            </aside>
          )}
        </div>
        {(view === 'lines' || phone) && <BufferDock loose={loose} lms={lms} a={acts} />}
      </section>
    )
  }

  return (
    <section ref={root} className={`cal${phone ? ' cal-phone' : ''} cal-${view}`} aria-label="Content calendar">
      <header className="cal-bar">
        <div className="cal-seg" role="tablist" aria-label="Client">
          {PICKS.map(p => <button key={p} type="button" role="tab" aria-selected={p === pick} className={p === pick ? 'on' : ''} onClick={() => choose(p)}>{p !== 'all' && <i className={`cal-c cal-c-${p}`} />}{PICK_NAME[p]}</button>)}
        </div>
        <div className="cal-seg cal-views" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === 'month'} className={view === 'month' ? 'on' : ''} onClick={() => setView('month')}>Month</button>
          <button type="button" role="tab" aria-selected={view === 'lines'} className={view === 'lines' ? 'on' : ''} onClick={() => setView('lines')}>By client</button>
        </div>
        <div className="cal-nav">
          <button type="button" data-verb="cal-prev" aria-label={view === 'month' ? 'Previous month' : 'Previous two weeks'} onClick={() => page(-1)}>‹</button>
          <b aria-live="polite">{label}</b>
          <button type="button" data-verb="cal-next" aria-label={view === 'month' ? 'Next month' : 'Next two weeks'} onClick={() => page(1)}>›</button>
          {off !== 0 && <button type="button" className="cal-today" data-verb="cal-today" onClick={today}>Today</button>}
        </div>
      </header>

      <div className="cal-body">
        <div ref={stage} className="cal-stage">
          <div ref={track} className="cal-track">
            {view === 'month' ? (
              <div className="cal-grid" role="group" aria-label={`${PICK_NAME[pick]}, ${label}`}>
                {DOW.map(d => <div key={d} className="cal-wh">{phone ? d[0] : d}</div>)}
                {keys.map(k => {
                  const on = days.get(k) ?? []
                  const vis = 3
                  const cls = ['cal-day', inMonth.has(k) ? '' : 'out', k === todayKey ? 'today' : '', k === day ? 'sel' : '', k < todayKey ? 'past' : ''].filter(Boolean).join(' ')
                  return (
                    <div key={k} className={cls} data-cal-day={k} data-cal-lane={laneBound} onClick={() => setSel(k)} title={dayLabel(k)}>
                      <span className="cal-dn">{Number(k.slice(8))}</span>
                      {on.slice(0, vis).map(e => <Chip key={e.it.id} e={e} phone={phone} onOpen={onOpen} />)}
                      {on.length > vis && <span className="cal-more">+{on.length - vis}</span>}
                    </div>
                  )
                })}
              </div>
            ) : phone
              ? <PhoneWall data={data} items={items} days={lineDays} stuck={null} onOpen={onOpen} onMove={onMove} onArm={onArm} now={now} lanes={lanesOf(pick)} />
              : <Wall data={data} items={items} days={lineDays} stuck={null} onOpen={onOpen} onMove={onMove} onArm={onArm} onDay={onDay} now={now} lanes={lanesOf(pick)} />}
          </div>
        </div>

        <aside className="cal-side">
          {(view === 'month' || phone) && (
            <section className="cal-agenda" aria-label={`Posts on ${dayLabel(day)}`}>
              <h3>{day === todayKey ? 'Today' : dayLabel(day)}</h3>
              {agenda.length === 0 && <p className="cal-dim">{data.seats.ivan.loadedAt ? 'Nothing on this day. Drag a post here.' : 'Reading…'}</p>}
              {agenda.map(e => <Card key={e.it.id} e={e} onOpen={onOpen} onMove={onMove} onArm={onArm} onChanged={onChanged} />)}
            </section>
          )}
          {loose.length > 0 && (
            <section className="cal-rail" aria-label="No date yet">
              <h3>No date yet <small>hold and drag onto a day</small></h3>
              <div className="cal-strip" data-cal-noswipe>
                {loose.map(l => <LooseTile key={l.id} l={l} onOpen={onOpen} onMove={onMove} />)}
              </div>
            </section>
          )}
          {lms.length > 0 && (
            <section className="cal-rail" aria-label="Lead magnets waiting">
              <h3>Lead magnets waiting</h3>
              <div className="cal-strip" data-cal-noswipe>
                {lms.map(m => (
                  <a key={m.id} className="cal-tile cal-lmtile" href={dHash('content', 'magnets', { lane: m.lane, magnet: m.id })}>
                    {m.cover && <img src={m.cover} alt="" loading="lazy" draggable={false} />}
                    <span className={`cal-tl${m.cover ? '' : ' cal-tl-only'}`}><i className={`cal-c cal-c-${m.lane}`} />{m.title}</span>
                  </a>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </section>
  )
}

function Chip({ e, phone, onOpen }: { e: Entry; phone: boolean; onOpen: (id: string, lane: Lane) => void }) {
  const attrs = { 'data-cal-id': e.it.id, 'data-cal-lane': e.lane, 'data-cal-refuse': e.refuse ?? undefined, title: `${LANE_NAME[e.lane]} · ${DOT_WORD[e.dot]} · ${e.hook}` }
  const cls = `cal-chip cal-l-${e.lane} dot-${e.dot}${e.lm ? ' lm' : ''}`
  const face = <>
    {e.thumb ? <img src={e.thumb} alt="" loading="lazy" draggable={false} /> : null}
    <span className="cal-hook">{e.hook}</span>
    {e.lm && <em className="cal-lm">LM</em>}{e.brain && <em className="cal-brain">Brain</em>}
    <i className="cal-dot" aria-label={DOT_WORD[e.dot]} />
  </>
  if (phone || !e.r) return <span className={cls} {...attrs}>{face}</span>
  return <button type="button" className={cls} {...attrs} data-verb="open" onClick={ev => { ev.stopPropagation(); onOpen(e.it.id, e.lane) }}>{face}</button>
}

function Card({ e, onOpen, onMove, onArm, onChanged }: { e: Entry; onOpen: (id: string, lane: Lane) => void; onMove: (id: string, lane: Lane) => void; onArm: (id: string) => void; onChanged: () => void }) {
  const it = e.it
  return (
    <div className={`cal-card cal-l-${e.lane} dot-${e.dot}`} data-cal-id={it.id} data-cal-lane={e.lane} data-cal-refuse={e.refuse ?? undefined}>
      <button type="button" className={`cal-cardmain${e.thumb ? ' has-img' : ''}`} data-verb="open" disabled={!e.r} onClick={() => e.r && onOpen(it.id, e.lane)}>
        {e.thumb && <img src={e.thumb} alt="" loading="lazy" draggable={false} />}
        <span className="cal-cardt">
          <small><i className={`cal-c cal-c-${e.lane}`} />{LANE_NAME[e.lane]} · {timeLine(it.postedAt ?? it.at, e.lane)} · <span className="cal-dotw">{DOT_WORD[e.dot]}</span>{e.lm && <em className="cal-lm">Lead magnet</em>}</small>
          <b>{e.hook}</b>
        </span>
      </button>
      {(it.postedUrl || it.unpublishId || it.armable || (!e.refuse && e.r)) && (
        <span className="cal-acts">
          {it.postedUrl && <a href={it.postedUrl} target="_blank" rel="noreferrer">Open post</a>}
          {it.unpublishId && <Unpublish id={it.unpublishId} onDone={onChanged} />}
          {it.armable && <button type="button" data-verb="schedule" onClick={() => onArm(it.id)}>Arm it</button>}
          {!e.refuse && e.r && <button type="button" data-verb="move-day" onClick={() => onMove(it.id, e.lane)}>Move</button>}
        </span>
      )}
    </div>
  )
}

function LooseTile({ l, onOpen, onMove }: { l: Loose; onOpen: (id: string, lane: Lane) => void; onMove: (id: string, lane: Lane) => void }) {
  return (
    <div className={`cal-tile cal-l-${l.lane}`} data-cal-id={l.id} data-cal-lane={l.lane}>
      <button type="button" data-verb="open" onClick={() => onOpen(l.id, l.lane)}>
        {l.thumb && <img src={l.thumb} alt="" loading="lazy" draggable={false} />}
        <span className={`cal-tl${l.thumb ? '' : ' cal-tl-only'}`}><i className={`cal-c cal-c-${l.lane}`} />{l.lm && <em className="cal-lm">LM</em>}{l.brain && <em className="cal-brain">Brain</em>}{l.hook}</span>
      </button>
      <button type="button" className="cal-give" data-verb="give-date" onClick={() => onMove(l.id, l.lane)}>Give it a date</button>
    </div>
  )
}
