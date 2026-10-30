import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { dHash } from '../../route'
import { warsawHm } from '../../ui/time'
import type { Entry, Loose, Magnet } from '../calModel'
import { LANES, LANE_NAME, dayLabel, scheduledIn, splitTitleTag, timeLine, type Lane, type WallDay } from '../model'
import { weekendAfter, type PlanItem } from '../planModel'
import { Unpublish } from '../Unpublish'
import { XMarks, type XDays } from '../xDays'
import type { ContentData } from '../useContentData'
import type { Coverage } from './coverage'
import { LinkedInCard } from './LinkedInCard'
import { Menu, Pill, SeatAv, type MenuItem, type Tone } from './ui'
import { postTagsOf, tagsLine } from '../calTags'
import { CalTags } from '../CalTagRow'
import { DIcon } from '../../ui/icons'

// CONTENT > CALENDAR, BRIEF 4 (SPEC-content §2.3; upgrades #2 and #4). The
// parts the Calendar draws when `content.calendar` is on. Calendar.tsx keeps
// every hook, read and write (drag engine, drop + its confirm and stored-day
// receipt, Undo, paging, the spring); these components only draw: coverage per
// seat for next week, a wall of clean cards (posted undimmed with a small ✓
// pill, the hook without its internal tag, no ⇄ squares, Unpublish inside the
// ⋯ menu), a 400 ms hover preview, and the buffer always on screen.

export const DOT_PILL: Record<Entry['dot'], Tone> = { set: 'ok', review: 'info', planned: 'warn', stuck: 'bad', posted: 'posted', queue: 'queue' }
export function dotText(e: Entry): string {
  if (e.dot === 'posted') return `✓ ${warsawHm(e.it.postedAt ?? e.it.at)}`
  if (e.dot === 'set') return 'Scheduled'
  if (e.dot === 'review') return 'In review'
  if (e.dot === 'planned') return e.lane === 'ivan' ? 'Not scheduled' : 'Not on board'
  if (e.dot === 'stuck') return 'Did not go out'
  return 'Queue only'
}
const hookOf = (e: Entry) => splitTitleTag(e.hook).text

export type CardActs = {
  onOpen: (id: string, lane: Lane) => void
  onMove: (id: string, lane: Lane) => void
  /** The card's time was clicked: edit date and time beside it. */
  onTime?: (id: string, lane: Lane) => void
  /** Remove date: back to No date yet (Undo on the receipt). */
  onClear?: (id: string, lane: Lane) => void
  onArm: (id: string) => void
  onChanged: () => void
}

function menuOf(e: Entry, a: CardActs): MenuItem[] {
  const it = e.it
  const items: MenuItem[] = []
  if (e.r) items.push({ key: 'open', label: 'Open', run: () => a.onOpen(it.id, e.lane) })
  if (!e.refuse && e.r) items.push({ key: 'move', label: 'Change date or time', run: () => a.onMove(it.id, e.lane) })
  if (!e.refuse && e.r?.scheduled_at && !e.r.published_at && a.onClear) items.push({ key: 'clear', label: 'Remove date', run: () => a.onClear!(it.id, e.lane) })
  if (it.armable) items.push({ key: 'arm', label: 'Arm it', run: () => a.onArm(it.id) })
  if (it.postedUrl) items.push({ key: 'post', label: 'Open post ↗', href: it.postedUrl, external: true })
  if (it.unpublishId) {
    items.push({ key: 'sep', label: '', sep: true })
    // Today's Unpublish, its confirm word for word: off the thumbnail, into the menu.
    items.push({ key: 'unpublish', label: 'Unpublish', danger: true, node: <Unpublish id={it.unpublishId} onDone={a.onChanged} /> })
  }
  return items
}

const fine = () => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches

/** 400 ms of still hover opens the post as LinkedIn shows it (no edit); leaving closes it in 120 ms. */
function useHoverPreview(enabled: boolean) {
  const [at, setAt] = useState<DOMRect | null>(null)
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = () => { if (t.current) clearTimeout(t.current); t.current = null }
  useEffect(() => clear, [])
  const bind = enabled ? {
    onPointerEnter: (ev: React.PointerEvent<HTMLElement>) => {
      if (ev.pointerType !== 'mouse' || !fine()) return
      const el = ev.currentTarget
      clear(); t.current = setTimeout(() => { if (!document.documentElement.classList.contains('cal-dragging') && !document.documentElement.classList.contains('cal-dropped') && !document.querySelector('.wh-pop')) setAt(el.getBoundingClientRect()) }, 400)
    },
    onPointerMove: (ev: React.PointerEvent<HTMLElement>) => {
      if (at || ev.pointerType !== 'mouse') return
      const el = ev.currentTarget
      clear(); t.current = setTimeout(() => { if (!document.documentElement.classList.contains('cal-dragging') && !document.documentElement.classList.contains('cal-dropped') && !document.querySelector('.wh-pop')) setAt(el.getBoundingClientRect()) }, 400)
    },
    onPointerLeave: () => { clear(); t.current = setTimeout(() => setAt(null), 120) },
    onPointerDown: () => { clear(); setAt(null) },
  } : {}
  return { at, bind }
}

function HoverPreview({ e, at }: { e: Entry; at: DOMRect }) {
  if (!e.r || typeof document === 'undefined') return null
  const w = 360
  const left = at.right + 8 + w <= window.innerWidth - 8 ? at.right + 8 : Math.max(8, at.left - 8 - w)
  const top = Math.max(8, Math.min(at.top - 8, window.innerHeight - 440))
  return createPortal(
    <div className="cv2-hover" role="tooltip" style={{ left, top, width: w }}>
      <div className="cv2-hover-h"><SeatAv lane={e.lane} /><b>{LANE_NAME[e.lane]}</b><span>{timeLine(e.it.postedAt ?? e.it.at, e.lane)}</span><Pill tone={DOT_PILL[e.dot]}>{dotText(e)}</Pill></div>
      <LinkedInCard lane={e.lane} body={(e.r.post_body ?? '').trim() || e.hook} images={e.r.image_urls} type={e.r.type} expandable={false} compact />
    </div>, document.body)
}

/** The wall's card: picture at full colour, the hook (tag stripped), time and one status dot; ⋯ for every other act. */
export function CalCard({ e, a, wide = false }: { e: Entry; a: CardActs; wide?: boolean }) {
  const { at, bind } = useHoverPreview(!!e.r)
  const it = e.it
  const hook = hookOf(e)
  const tags = postTagsOf(e.r, e.lane, e.lm)
  return (
    <div className={`cv2-cc${wide ? ' cv2-cc-wide' : ''}${e.thumb ? '' : ' cv2-cc-text'} dot-${e.dot}`} data-cal-id={it.id} data-cal-lane={e.lane} data-cal-refuse={e.refuse ?? undefined} {...bind}>
      <button type="button" className="cv2-cc-main" data-verb="open" disabled={!e.r} aria-label={`${LANE_NAME[e.lane]} · ${dotText(e)} · ${hook}`}
        onClick={ev => {
          if (!e.r) return
          // The time on the card edits the date and time in place; the rest of the card opens the post.
          if (a.onTime && !e.refuse && (ev.target as HTMLElement).closest('[data-cal-time]')) { ev.stopPropagation(); a.onTime(it.id, e.lane); return }
          a.onOpen(it.id, e.lane)
        }}>
        {e.thumb ? (
          <span className="cv2-cc-pic"><img src={e.thumb} alt="" loading="lazy" draggable={false} />{e.dot === 'posted' && <Pill tone="posted">{dotText(e)}</Pill>}</span>
        ) : e.dot === 'posted' && wide ? <span className="cv2-cc-pic cv2-cc-nopic"><Pill tone="posted">{dotText(e)}</Pill></span> : null}
        <span className="cv2-cc-t">{hook}</span>
        <span className="cv2-cc-m">
          {!(!e.thumb && e.dot === 'posted' && !wide) && <span className={a.onTime && !e.refuse && e.dot !== 'posted' ? 'cv2-cc-time' : undefined} data-cal-time={a.onTime && !e.refuse && e.dot !== 'posted' ? '' : undefined} title={a.onTime && !e.refuse && e.dot !== 'posted' ? 'Change date or time' : timeLine(it.postedAt ?? it.at, e.lane).replace(' ', ' · ')}>{warsawHm(it.postedAt ?? it.at)}</span>}
          {e.brain && <em>Brain</em>}
          {!e.thumb && e.dot === 'posted' && !wide ? <Pill tone="posted">{dotText(e)}</Pill> : <i className={`cv2-dot cv2-dot-${e.dot}`} title={dotText(e)} aria-hidden="true" />}
        </span>
        <CalTags t={tags} compact={!wide} />
      </button>
      <span className="cv2-cc-more" data-cal-nogesture onClick={ev => ev.stopPropagation()}>
        <QuickActs e={e} a={a} wide={wide} />
        <Menu label={`More for ${hook.slice(0, 40)}`} items={menuOf(e, a)} head={<span>{LANE_NAME[e.lane]} · {dotText(e)}</span>} />
      </span>
      {at && <HoverPreview e={e} at={at} />}
    </div>
  )
}

/**
 * A card's quick acts, shown on hover or keyboard focus (desktop) next to its ⋯ (Ivan 2026-10-15:
 * "different actions to edit the post easily"). The same acts as the ⋯ menu, which keeps them for
 * touch: Change date or time (the editor beside the card), and on the day list's wide card Remove
 * date and Open. Nothing new is written: the calendar's own handlers run.
 */
function QuickActs({ e, a, wide = false }: { e: Entry; a: CardActs; wide?: boolean }) {
  const it = e.it
  if (!e.r || e.refuse) return null
  const date = a.onTime ?? a.onMove
  return (
    <span className="cv2-qa" role="group" aria-label="Quick actions">
      <button type="button" className="cv2-qa-b" data-verb="quick-date" title="Change date or time" aria-label="Change date or time" onClick={ev => { ev.stopPropagation(); date(it.id, e.lane) }}><DIcon name="time" /></button>
      {wide && e.r.scheduled_at && !e.r.published_at && a.onClear && (
        <button type="button" className="cv2-qa-b" data-verb="quick-clear" title="Remove date (back to No date yet)" aria-label="Remove date" onClick={ev => { ev.stopPropagation(); a.onClear!(it.id, e.lane) }}><DIcon name="x" /></button>
      )}
    </span>
  )
}

/**
 * The month cell's card (Ivan 2026-10-15: "I feel like it could be bigger so I can see more of the
 * title, the topic, the tags"). The hook over up to three lines (two when the day holds two posts,
 * one when it holds three), then the time and the tags: On board, format, aim, pillar (CalTags).
 * A small picture sits beside the hook when the post has one. Hover or focus shows Change date and
 * the ⋯ with every other act; 400 ms of still hover shows the post as LinkedIn will.
 */
export function MonthCard({ e, a }: { e: Entry; a: CardActs }) {
  const { at, bind } = useHoverPreview(!!e.r)
  const it = e.it
  const hook = hookOf(e)
  const tags = postTagsOf(e.r, e.lane, e.lm)
  const editTime = !!a.onTime && !e.refuse && e.dot !== 'posted' && !!e.r
  const time = e.dot === 'posted' ? `✓ ${warsawHm(it.postedAt ?? it.at)}` : warsawHm(it.postedAt ?? it.at)
  return (
    <div className={`cv2-mc dot-${e.dot}${e.thumb ? ' cv2-mc-pic' : ''}`} data-cal-id={it.id} data-cal-lane={e.lane} data-cal-refuse={e.refuse ?? undefined} {...bind}>
      <button type="button" className="cv2-mc-main" data-verb="open" disabled={!e.r}
        aria-label={`${LANE_NAME[e.lane]} · ${dotText(e)} · ${hook}${tags ? ` · ${tagsLine(tags)}` : ''}`}
        onClick={ev => {
          ev.stopPropagation()
          if (!e.r) return
          if (editTime && (ev.target as HTMLElement).closest('[data-cal-time]')) { a.onTime!(it.id, e.lane); return }
          a.onOpen(it.id, e.lane)
        }}>
        {e.thumb && <img className="cv2-mc-img" src={e.thumb} alt="" loading="lazy" draggable={false} />}
        <span className="cv2-mc-t">{hook}</span>
        <CalTags t={tags} compact lead={<>
          <span className={`cv2-mc-time${editTime ? ' cv2-cc-time' : ''}`} data-cal-time={editTime ? '' : undefined} title={editTime ? 'Change date or time' : timeLine(it.postedAt ?? it.at, e.lane)}>{time}</span>
          {e.brain && <span className="cv2-tag cv2-tag-lm">Brain</span>}
        </>} />
      </button>
      <i className={`cv2-dot cv2-dot-${e.dot} cv2-mc-dot`} title={dotText(e)} aria-hidden="true" />
      <span className="cv2-mc-acts" data-cal-nogesture onClick={ev => ev.stopPropagation()}>
        <QuickActs e={e} a={a} />
        <Menu label={`More for ${hook.slice(0, 40)}`} items={menuOf(e, a)} head={<span>{LANE_NAME[e.lane]} · {dotText(e)}</span>} />
      </span>
      {at && <HoverPreview e={e} at={at} />}
    </div>
  )
}

/** Next week per seat against the target of 3; gaps read as drop targets on the wall. */
export function CoverageBar({ cov, lanes, loaded, phone = false }: { cov: Coverage; lanes: readonly Lane[]; loaded: (l: Lane) => boolean; phone?: boolean }) {
  return (
    <div className="cv2-cov" role="group" aria-label="Next week, posts set to go out per seat" data-cal-noswipe={phone || undefined}>
      <span className="cv2-cov-l">Next week</span>
      {lanes.map(l => {
        const s = cov.seats[l]
        const ok = s.set >= s.target
        // A seat still reading has no coverage yet: never "0/3 · 3 gaps" off an empty list.
        if (!loaded(l)) return <span key={l} className="cv2-cov-s"><span className="cv2-pill cv2-pill-neutral cv2-cov-p"><span>{LANE_NAME[l]} …</span></span></span>
        return (
          <span key={l} className="cv2-cov-s" title={`${LANE_NAME[l]}: ${s.set} set to go out Mon-Fri next week (target ${s.target})`}>
            <span key={`${ok}`} className={`cv2-pill cv2-pill-${ok ? 'ok' : 'warn'} cv2-cov-p`}>
              <span>{LANE_NAME[l]} <b className="cv2-roll" key={s.set}>{s.set}</b> of {s.target}{ok ? ' ✓' : ` · ${s.short} to fill`}</span>
            </span>
          </span>
        )
      })}
      {!phone && <><span className="cv2-grow" /><span className="cv2-key" aria-label="Key">
        <span><i className="cv2-dot cv2-dot-set" />Scheduled</span><span><i className="cv2-dot cv2-dot-review" />In review</span>
        <span><i className="cv2-dot cv2-dot-planned" />Not scheduled</span><span><b>✓</b> Posted</span></span>
        </>}
    </div>
  )
}

/** The Lines wall: seats down the side, a week (narrow) or two (wide) across; the day engine is today's. */
export function WallV2({ data, items, days, entryOf, cov, lanes, now, today, a, onDay, xDays }: {
  xDays?: XDays
  data: ContentData
  items: Record<Lane, Map<string, PlanItem[]>>
  days: WallDay[]
  entryOf: (lane: Lane, key: string) => Entry[]
  cov: Coverage
  lanes: readonly Lane[]
  now: number
  today: string
  a: CardActs
  onDay: (lane: Lane, keys: string[]) => void
}) {
  const ten = days.length > 7 || (days.length > 5 && !days.some(d => d.dow === 'Sat'))
  // Weekends are days you can post on (2026-10-09): a slimmer Sat/Sun column, a 6px gap between weeks.
  const weekends = days.some(d => d.dow === 'Sat' || d.dow === 'Sun')
  const isWe = (d: WallDay) => d.dow === 'Sat' || d.dow === 'Sun'
  const newWeek = (i: number) => i > 0 && days[i].dow === 'Mon'
  const style = { gridTemplateColumns: ['96px', ...days.flatMap((d, i) => [...(newWeek(i) ? ['6px'] : []), isWe(d) ? 'minmax(0,.62fr)' : 'minmax(0,1fr)'])].join(' ') } as CSSProperties
  const gap = (i: number) => (newWeek(i) ? <div className="cv2-wall-gap" aria-hidden="true" /> : null)
  void ten
  void now
  return (
    <div className="cv2-wall" style={style} role="group" aria-label="Posts by seat and day">
      <div className="cv2-wh" />
      {days.map((d, i) => <Fragment key={d.key}>{gap(i)}<div className={`cv2-wh${d.key === today ? ' cv2-tod' : ''}${isWe(d) ? ' cv2-we' : ''}`} data-cal-day={d.key}>{d.key === today ? <><em>Today</em> {d.n}</> : <><b>{d.dow}</b> {d.n}</>}<XMarks items={xDays?.get(d.key)} time={false} /></div></Fragment>)}
      {lanes.map(lane => {
        const s = data.seats[lane]
        const gaps = new Set(s.loadedAt ? cov.seats[lane].gaps : [])
        return (
          <Fragment key={lane}>
            <div className="cv2-plate">
              <SeatAv lane={lane} size={28} />
              <b>{LANE_NAME[lane]}</b>
              <small>{s.error ? 'could not read' : !s.loadedAt ? '…' : `${scheduledIn(s.rows, lane, days)} ${ten ? 'in 2 weeks' : 'this week'}`}</small>
            </div>
            {days.map((d, i) => {
              const on = entryOf(lane, d.key)
              const we = d.dow === 'Fri' && !weekends ? weekendAfter(d.key) : null
              const weN = we ? we.reduce((n, k) => n + (items[lane].get(k)?.length ?? 0), 0) : 0
              const cls = ['cv2-cell', isWe(d) ? 'cv2-we' : '', d.key === today ? 'cv2-tod' : '', !on.length && gaps.has(d.key) ? 'cv2-gapcell' : '', d.key < today ? 'cv2-past' : ''].filter(Boolean).join(' ')
              return (
                <Fragment key={d.key}>
                  {gap(i)}
                  <div className={cls} data-cal-day={d.key} data-cal-lane={lane}>
                    {on[0] ? <CalCard e={on[0]} a={a} /> : gaps.has(d.key) ? <span className="cv2-gapword">gap</span> : null}
                    {(on.length > 1 || weN > 0) && (
                      <span className="cv2-cellk">
                        {on.length > 1 && <button type="button" data-verb="day" onClick={() => onDay(lane, [d.key])}>+{on.length - 1} more</button>}
                        {weN > 0 && we && <button type="button" onClick={() => onDay(lane, we)}>Sat/Sun {weN}</button>}
                      </span>
                    )}
                  </div>
                </Fragment>
              )
            })}
          </Fragment>
        )
      })}
    </div>
  )
}

const BUFFER_KEY = 'd-cal-buffer'

/** Posts with no date (and lead magnets waiting), always on screen under the wall: drag a tile onto a gap. */
export function BufferDock({ loose, lms, a, vertical = false, startOpen = true }: { loose: Loose[]; lms: Magnet[]; a: CardActs; vertical?: boolean; startOpen?: boolean }) {
  // `startOpen` only until Ivan folds or opens it himself (a short window starts it folded, 2026-10-15).
  const [open, setOpenState] = useState(() => { try { const v = localStorage.getItem(BUFFER_KEY); return v == null ? startOpen : v !== '0' } catch { return startOpen } })
  const setOpen = (v: boolean) => { setOpenState(v); try { localStorage.setItem(BUFFER_KEY, v ? '1' : '0') } catch { /* private mode */ } }
  const [tab, setTab] = useState<'loose' | 'lms'>('loose')
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return
      if (e.key === 'b' || e.key === 'B') setOpenState(o => { try { localStorage.setItem(BUFFER_KEY, o ? '0' : '1') } catch { /* private mode */ } return !o })
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  if (!loose.length && !lms.length) return null
  // Lead magnet POSTS sit with the lead magnet pages, so the tab counts every lead magnet on screen (Ivan
  // 2026-10-30 saw "Lead magnets 1" beside two lead magnet posts under No date yet).
  const posts = loose.filter(l => !l.lm)
  const lmPosts = loose.filter(l => l.lm)
  const lmN = lmPosts.length + lms.length
  const list = tab === 'lms' && lmN ? 'lms' : 'loose'
  const tile = (l: Loose) => {
    const tags = postTagsOf(l.r, l.lane, l.lm)
    const hook = splitTitleTag(l.hook).text
    return (
      <div key={l.id} className={`cv2-tile${l.thumb ? '' : ' cv2-tile-text'}`} data-cal-id={l.id} data-cal-lane={l.lane}>
        <button type="button" className="cv2-tile-main" data-verb="open" aria-label={`${hook}${tags ? ` · ${tagsLine(tags)}` : ''}`} onClick={() => a.onOpen(l.id, l.lane)}>
          {l.thumb && <img src={l.thumb} alt="" loading="lazy" draggable={false} />}
          <span className="cv2-tile-t"><i className={`cv2-seatdot cv2-seatdot-${l.lane}`} aria-hidden="true" />{hook}</span>
        </button>
        <span className="cv2-tile-foot">
          <CalTags t={tags} compact={!vertical} lead={l.brain ? <span className="cv2-tag cv2-tag-lm">Brain</span> : undefined} />
          <button type="button" className="cv2-tile-give" data-verb="give-date" onClick={() => a.onMove(l.id, l.lane)}>Give it a date</button>
        </span>
      </div>
    )
  }
  return (
    <section className={`cv2-buf${open ? '' : ' cv2-buf-closed'}${vertical ? ' cv2-buf-v' : ''}`} aria-label="Buffer: posts with no date yet">
      <div className="cv2-buf-h">
        <button type="button" className={list === 'loose' ? 'on' : ''} aria-pressed={list === 'loose'} data-verb="buffer-loose" onClick={() => { setTab('loose'); setOpen(true) }}>No date yet<b className="cv2-n">{posts.length}</b></button>
        {lmN > 0 && <button type="button" className={list === 'lms' ? 'on' : ''} aria-pressed={list === 'lms'} data-verb="buffer-lms" onClick={() => { setTab('lms'); setOpen(true) }}>Lead magnets<b className="cv2-n">{lmN}</b></button>}
        <span className="cv2-grow" />
        <button type="button" className="cv2-buf-t" aria-expanded={open} aria-label={open ? 'Fold the buffer (B)' : 'Open the buffer (B)'} data-verb="buffer-toggle" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'}</button>
      </div>
      {open && (
        // Keyed by the list shown, so switching No date yet / Lead magnets (or opening it) plays the short enter.
        <div key={list} className="cv2-buf-strip" data-cal-noswipe>
          {list === 'loose' ? posts.map(tile) : <>{lmPosts.map(tile)}{lms.map(m => (
            <a key={m.id} className="cv2-tile cv2-tile-lm" href={dHash('content', 'magnets', { lane: m.lane, magnet: m.id })}>
              {m.cover ? <img src={m.cover} alt="" loading="lazy" draggable={false} /> : <span className="cv2-tile-nopic" aria-hidden="true">LM</span>}
              <span className="cv2-tile-t"><i className={`cv2-seatdot cv2-seatdot-${m.lane}`} aria-hidden="true" />{m.title}</span>
            </a>
          ))}</>}
        </div>
      )}
    </section>
  )
}

/** Month view's day list: one wide card per post, the ⋯ carries every act. */
export function DayList({ day, isToday, entries, reading, a }: { day: string; isToday: boolean; entries: Entry[]; reading: boolean; a: CardActs }) {
  return (
    <section className="cv2-day" aria-label={`Posts on ${dayLabel(day)}`} key={day}>
      <h3>{isToday ? `${dayLabel(day)} · Today` : dayLabel(day)}</h3>
      {entries.length === 0 && <p className="cv2-dim">{reading ? 'Reading…' : 'Nothing on this day. Drag a post here.'}</p>}
      {entries.map(e => <CalCard key={e.it.id} e={e} a={a} wide />)}
    </section>
  )
}

export { LANES }
