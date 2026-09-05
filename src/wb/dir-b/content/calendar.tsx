import { useCallback, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ARMING_LABEL, buildCalendarItems, buildCalendarRail, dayKey, dayKeyOf, groupByDay,
  monthLabel, monthWeeks, publishAtForDay, shiftMonth, type CalendarItem,
} from '../../../lib/calendarItems'
import { armingCountWord } from '../../../lib/labels'
import {
  ClientRpcError, setScheduleDateAt, STAGE_LABEL, type ContentDraft,
  type ScheduledQueueRow,
} from '../../../lib/content'
import { scheduleDraft } from '../../../lib/studioActions'
import { useConfirm } from '../../../components/ConfirmSheet'
import { CalPopover } from '../../../exp/v2c/CalPopover'
import { chipDescription, VISIBLE_CHIPS, waitedFor } from '../../../exp/v2c/ContentCalendar'
import { typeLabel } from '../../../exp/v2c/fmt'
import type { OpenDraft } from '../../../exp/v2c/ContentList'
import {
  Badge, Banner, Button, Card, Chip, Icon, IconButton, cx, fadeT, list, pop, rise, spring,
} from '../../../ds'
import { Block } from '../shell'
import './content.css'

// THE CALENDAR, Direction B — one per lane, and the lane tabs are its only
// selector. Copied from `src/exp/v2c/ContentCalendar.tsx`: same fetch, same
// filters, same search, same single write path.
//
// What it is NOT: an arming surface. Exactly one thing here changes a date —
// `setScheduleDateAt`, the gated date-only RPC — and `scheduled_at` is the ONLY
// column it writes. Arming is a separate, deliberate act with its own confirm.
//
// THE DIRECTION B SHAPE: the month is a STACK of day cards on the phone and the
// SAME cards as a 7-across grid on the desktop. One component; `.dirb-days` in
// dir-b.css does the switch, and nothing here reads a viewport — the workbench's
// rule, kept.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Moving = { id: string; title: string; at: string | null; day: string }
/**
 * A chip mid-drag. `day` is where it started, so a drop on its own day is a
 * no-op. A RAIL ROW DRAGS TOO: it has no date and therefore no day it came
 * from, so `day` is `''`, which no day key ever equals.
 */
type Dragging = { id: string; title: string; at: string | null; day: string }

export function ContentCalendar({ rows, queue = [], onOpen, refresh }: {
  rows: ContentDraft[]
  queue?: ScheduledQueueRow[]
  onOpen: OpenDraft
  refresh: () => void
}) {
  const today = dayKey(new Date())
  const [anchor, setAnchor] = useState(() => {
    const n = new Date()
    return { year: n.getFullYear(), month: n.getMonth() }
  })
  // WHICH WAY THE MONTH JUST MOVED. It is a render key AND a direction, so the
  // entry runs from scratch on every step and back does not slide the same way
  // as forward.
  const [step, setStep] = useState<{ key: string; dir: 1 | -1 }>(
    () => ({ key: 'first', dir: 1 }))
  const [moving, setMoving] = useState<Moving | null>(null)
  const [drag, setDrag] = useState<Dragging | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const confirm = useConfirm()
  // ONE popover for the whole grid, not one per chip: there is only ever one
  // pointer and one focus ring.
  const [tip, setTip] = useState<{ el: HTMLElement; id: string; text: string } | null>(null)
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // THE OVERFLOW POPOVER. `el` is the "+N" button, which is both the anchor and
  // the thing focus goes back to when the panel closes.
  const [more, setMore] = useState<{ day: string; el: HTMLElement } | null>(null)
  const moreRef = useRef<HTMLElement | null>(null)
  const closeMore = useCallback(() => {
    setMore(m => { moreRef.current = m?.el ?? null; return null })
    queueMicrotask(() => moreRef.current?.focus())
  }, [])

  // 120ms, and the number is doing a job: sweeping a pointer across a week of
  // chips fires mouseenter six or seven times. Focus is not delayed — a keyboard
  // operator arriving on a chip has already committed to it.
  const onTip = useCallback((el: HTMLElement, id: string, text: string) => {
    if (tipTimer.current) clearTimeout(tipTimer.current)
    tipTimer.current = setTimeout(() => setTip({ el, id, text }), 120)
  }, [])
  const offTip = useCallback(() => {
    if (tipTimer.current) clearTimeout(tipTimer.current)
    setTip(null)
  }, [])

  const items = useMemo(() => buildCalendarItems(rows, queue), [rows, queue])
  const rail = useMemo(() => buildCalendarRail(rows), [rows])
  const byDay = useMemo(() => groupByDay(items), [items])
  const weeks = useMemo(() => monthWeeks(anchor.year, anchor.month), [anchor])
  const inMonth = useMemo(() => new Set(weeks.flat()), [weeks])
  const days = useMemo(() => weeks.flat(), [weeks])
  // The walk-queue the draft window steps through with j/k: the month's chips in
  // time order. Queue-source chips are absent BY THE FILTER, not by accident:
  // they have no draft row, so there is nothing for the window to open.
  const walk = useMemo(() => {
    const ids = items.filter(i => i.source === 'draft' && inMonth.has(i.day)).map(i => i.id)
    const byId = new Map(rows.map(r => [r.id, r]))
    return ids.map(id => byId.get(id)).filter((r): r is ContentDraft => !!r)
  }, [items, inMonth, rows])

  const monthItems = useMemo(() => items.filter(i => inMonth.has(i.day)), [items, inMonth])
  // 🔴 SPLIT IN WORDS. One number counting a review row carrying a date beside a
  // row a publisher actually holds is the lie in figure form.
  const monthArmed = monthItems.filter(i => i.arming === 'armed').length
  const monthPlanned = monthItems.filter(i => i.arming === 'planned').length
  const monthOut = monthItems.filter(i => i.arming === 'out').length

  const startMove = (id: string, title: string, at: string | null) => {
    setErr(null); setDone(null)
    setMoving({ id, title, at, day: at ? (dayKeyOf(at) ?? today) : today })
  }

  // ONE write path for both gestures. The date picker and the drag land on the
  // same RPC with the same confirm.
  const move = async (id: string, at: string | null, day: string): Promise<boolean> => {
    const ok = await confirm({
      title: 'Move this post?',
      message: `Moves to ${longDay(day)}. Status and board visibility stay as they are.`,
      confirmText: 'Move it',
    })
    if (!ok) return false
    setBusy(true); setErr(null)
    try {
      const to = await setScheduleDateAt(id, publishAtForDay(at, day))
      setDone(`Moved to ${dayKeyOf(to) ?? day}.`)
      refresh()
      return true
    } catch (e) {
      setErr(e instanceof ClientRpcError || e instanceof Error ? e.message : 'The move failed.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    if (!moving) return
    setDone(null)
    if (await move(moving.id, moving.at, moving.day)) setMoving(null)
  }

  // ARMING, on the chip, and it is the ONE write on this surface with a public
  // consequence. It keeps its confirm, always, and the confirm names the day AND
  // the time it will fire. It writes status='scheduled' + scheduled_at, which is
  // NOT what the date move writes.
  const arm = async (it: CalendarItem) => {
    setErr(null); setDone(null)
    const ok = await confirm({
      title: 'Put this post on LinkedIn?',
      message: `The publisher reads status='scheduled' and posts it at ${absStamp(it.at)}. `
        + 'This is not an internal mark: it arms the bridge that publishes.',
      confirmText: 'Arm it',
    })
    if (!ok) return
    setBusy(true)
    try {
      await scheduleDraft(it.id, it.at)
      setDone(`Armed for ${absStamp(it.at)}.`)
      refresh()
    } catch (e) {
      setErr(e instanceof ClientRpcError || e instanceof Error ? e.message : 'Arming failed.')
    } finally {
      setBusy(false)
    }
  }

  // DROP. Guarded three ways before it can write: something must be in flight,
  // the target day must differ from where the chip started, and the row must
  // still be movable. A drop on the day it came from is a cancelled drag.
  const drop = async (day: string) => {
    const d = drag
    setDrag(null); setOver(null)
    if (!d || d.day === day) return
    setErr(null); setDone(null)
    await move(d.id, d.at, day)
  }

  return (
    <div className="dirb-cal">
      <div className="dirb-spread dirb-row-wrap dirb-cal-bar">
        <div className="dirb-row">
          <IconButton
            icon="back" label="Previous month" size="sm"
            onClick={() => { setStep(s2 => ({ key: `${s2.key}<`, dir: -1 })); setAnchor(a => shiftMonth(a.year, a.month, -1)) }}
          />
          <span className="ds-t-page">{monthLabel(anchor.year, anchor.month)}</span>
          <IconButton
            icon="forward" label="Next month" size="sm"
            onClick={() => { setStep(s2 => ({ key: `${s2.key}>`, dir: 1 })); setAnchor(a => shiftMonth(a.year, a.month, 1)) }}
          />
          <Button
            size="sm" variant="quiet"
            onClick={() => { const n = new Date(); setAnchor({ year: n.getFullYear(), month: n.getMonth() }) }}
          >Today</Button>
        </div>
        {/* TWO NUMBERS AT REST, AND BOTH OF THEM IN WORDS A READER ALREADY HAS.
            The words come from src/lib/labels.ts and are not written here.
            `scheduled` and `posted` are always drawn, including at zero, because
            a month with nothing armed is exactly the thing those figures exist
            to say out loud. `planned` is a DISCREPANCY, not a third metric, so
            it earns a slot only when it exists and it is marked as attention
            rather than counted as coverage. */}
        <div className="dirb-row-wrap">
          <span title="A publisher holds it: the draft is at Scheduled, or the chip is a row in the publish queue.">
            <Chip count={monthArmed}>{armingCountWord('armed')}</Chip>
          </span>
          <Chip tone="quiet" count={monthOut}>{armingCountWord('out')}</Chip>
          {monthPlanned > 0 && (
            <span title="These carry a date and nothing is set to publish them. A post still waiting on a review will not go out on the day it is drawn on.">
              <Chip tone="attention" count={monthPlanned}>{armingCountWord('planned')}</Chip>
            </span>
          )}
        </div>
      </div>

      <div className="dirb-cal-body">
        {/* The weekday header belongs to the GRID canvas only: on the phone the
            day-of-week eyebrow rides on each card instead. */}
        <div className="dirb-days dirb-cal-head dirb-desk-only" aria-hidden>
          {WEEKDAYS.map(w => <span className="ds-t-eyebrow dirb-dim" key={w}>{w}</span>)}
        </div>
        {/* ONE SPRING FOR THE MONTH CHANGE. The grid is re-keyed by the step, so
            it enters from the side the step came from; nothing animates width or
            height, only transform and opacity. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            className="dirb-days" key={step.key}
            initial={{ opacity: 0, x: step.dir * 16 }}
            animate={{ opacity: 1, x: 0, transition: spring }}
            exit={{ opacity: 0, transition: fadeT }}
          >
            {days.map(k => {
              const day = byDay.get(k) ?? []
              const outside = !k.startsWith(monthPrefix(anchor.year, anchor.month))
              // A day lights up only while a chip that could actually land there
              // is over it — its own day never does, so the highlight never
              // promises a write that drop() will refuse.
              const target = !!drag && drag.day !== k
              return (
                <div
                  key={k}
                  className={cx('dirb-daycard', target && over === k && 'dirb-daycard-over')}
                  data-today={k === today}
                  data-outside={outside}
                  data-empty={day.length === 0}
                  onDragOver={target ? (e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== k) setOver(k) }) : undefined}
                  onDragLeave={target ? (() => setOver(o => (o === k ? null : o))) : undefined}
                  onDrop={target ? (e => { e.preventDefault(); void drop(k) }) : undefined}
                >
                  <div className="dirb-daycard-head">
                    <span className="ds-t-eyebrow dirb-dow">{longDay(k)}</span>
                    <span className="ds-t-figure dirb-figure">{Number(k.slice(8))}</span>
                  </div>
                  <div className="dirb-daycard-items">
                    {day.map(it => (
                      <CalChip
                        key={it.id} it={it}
                        tipOpen={tip?.id === `cal-tip-${it.id}`}
                        onTip={onTip} offTip={offTip}
                        dragging={drag?.id === it.id}
                        busy={busy}
                        onOpen={() => onOpen(it.id, it.title, walk)}
                        onMove={() => startMove(it.id, it.title, it.at)}
                        onArm={() => { void arm(it) }}
                        onDragStart={() => setDrag({ id: it.id, title: it.title, at: it.at, day: k })}
                        onDragEnd={() => { setDrag(null); setOver(null) }}
                      />
                    ))}
                  </div>
                  {/* THE OVERFLOW. Every chip is in the DOM above; the GRID caps
                      how many are painted (content.css) and this is the rest of
                      them. The cap is CSS, not JS, because on the phone the same
                      cards are a stack with no height to run out of and the cap
                      is switched off there — so the count is always the truth
                      about the day rather than the truth about a viewport. */}
                  {day.length > VISIBLE_CHIPS && (
                    <button
                      type="button" className="dirb-more dirb-desk-only"
                      aria-expanded={more?.day === k}
                      aria-haspopup="dialog"
                      onClick={e => {
                        const el = e.currentTarget
                        setMore(m => (m?.day === k ? null : { day: k, el }))
                      }}
                    >
                      +{day.length - VISIBLE_CHIPS} more
                    </button>
                  )}
                </div>
              )
            })}
          </motion.div>
        </AnimatePresence>

        {/* THE RAIL. Ordered oldest first, every row prints how long it has been
            waiting, and every row here has a working control by construction:
            the rail's own predicate IS canMoveDate. */}
        <Block label="No date yet" tail={<Badge variant="ring">{rail.length}</Badge>}>
          {rail.length === 0 ? (
            <div className="ds-t-meta dirb-dim">Nothing is waiting for a date.</div>
          ) : (
            <>
              <div className="ds-t-meta dirb-dim">Oldest first. Drag one onto a day.</div>
              <motion.div className="dirb-cards" variants={list} initial="hidden" animate="show">
                <AnimatePresence initial={false}>
                  {rail.map(r => (
                    <motion.div key={r.id} variants={rise} layout transition={spring}>
                    <div
                      className={cx('dirb-lift', drag?.id === r.id && 'dirb-dragging')}
                      draggable={r.movable}
                      onDragStart={r.movable ? (e => {
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', r.id)
                        // day '' is not a day key, so drop() treats every cell as
                        // a real target rather than as the day it came from.
                        setDrag({ id: r.id, title: r.title, at: null, day: '' })
                      }) : undefined}
                      onDragEnd={r.movable ? (() => { setDrag(null); setOver(null) }) : undefined}
                    >
                      <Card
                        title={r.title}
                        onClick={() => onOpen(r.id, r.title, rows.filter(x => rail.some(y => y.id === x.id)))}
                        sub={
                          <span className="dirb-row-wrap">
                            {typeLabel(r.type)}
                            <span title={`Created ${absDay(r.createdAt)}`}>{waitedFor(r.createdAt)}</span>
                          </span>
                        }
                        tail={r.movable
                          ? (
                            <span onClick={e => e.stopPropagation()}>
                              <Button size="sm" variant="outline" onClick={() => startMove(r.id, r.title, null)}>
                                Give it a date
                              </Button>
                            </span>
                          )
                          : undefined}
                      />
                    </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            </>
          )}
        </Block>
      </div>

      <AnimatePresence initial={false}>
        {moving && (
          <motion.div
            key="move" variants={rise} initial="hidden" animate="show" exit="exit"
            role="group" aria-label="Move to another day" className="dirb-inset dirb-col"
          >
            <div className="ds-t-title">Move <b>{moving.title}</b></div>
            <div className="dirb-row-wrap">
              <input
                type="date" className="ds-input dirb-date" value={moving.day}
                aria-label="Move to another day"
                onChange={e => setMoving(m => (m ? { ...m, day: e.target.value } : m))}
              />
              <Button variant="primary" busy={busy} disabled={busy || !moving.day} onClick={commit}>
                {busy ? 'Moving…' : 'Move'}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setMoving(null)}>Cancel</Button>
            </div>
            <div className="ds-t-meta dirb-dim">
              Only the date changes — status and board visibility stay as they are.
              {moving.at ? ' Its time of day is kept.' : ' It has no time yet, so it goes out at 09:00.'}
            </div>
            {err && <div className="dirb-err">{err}</div>}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {!moving && err && (
          <motion.div key="err" variants={fadeVariants} initial="hidden" animate="show" exit="exit">
            <Banner tone="urgent" icon="alert">{err}</Banner>
          </motion.div>
        )}
        {done && (
          <motion.div key="done" variants={fadeVariants} initial="hidden" animate="show" exit="exit">
            <Banner tone="clear" icon="check">{done}</Banner>
          </motion.div>
        )}
      </AnimatePresence>

      {/* THE CHIP DESCRIPTION. Suppressed while a drag is in flight: a panel
          following the pointer during a drop is a panel in the way of the thing
          being aimed at. */}
      {tip && !drag && (
        <CalPopover
          id={tip.id} role="tooltip"
          anchorEl={tip.el}
          avoidEl={tip.el.closest('.dirb-daycard') as HTMLElement | null}
          onDismiss={offTip}
        >
          <motion.div className="ds-t-meta" variants={pop} initial="hidden" animate="show">{tip.text}</motion.div>
        </CalPopover>
      )}

      {/* THE DAY PANEL, anchored to the "+N" button and told not to cover the
          CELL. It lists the whole day, not just the hidden tail: a panel that
          leaves posts one and two behind itself is a panel you have to close to
          finish reading. */}
      {more && (
        <CalPopover
          id="cal-day-panel" role="dialog"
          label={`Everything on ${longDay(more.day)}`}
          anchorEl={more.el}
          avoidEl={more.el.closest('.dirb-daycard') as HTMLElement | null}
          onDismiss={closeMore}
        >
          <motion.div variants={pop} initial="hidden" animate="show" className="dirb-col">
            <div className="ds-t-eyebrow">{longDay(more.day)}</div>
            <div className="dirb-col">
              {(byDay.get(more.day) ?? []).map(it => (
                <button
                  key={it.id} type="button" className="dirb-poprow"
                  data-st={it.stage} data-src={it.source}
                  disabled={it.source === 'queue'}
                  onClick={() => { closeMore(); onOpen(it.id, it.title, walk) }}
                >
                  <span className="ds-t-mono">{hhmm(it.stage === 'published' ? (it.postedAt ?? it.at) : it.at)}</span>
                  <span className="dirb-grow dirb-truncate">{it.title}</span>
                  <span className="ds-t-meta dirb-dim">{STAGE_LABEL[it.stage]}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </CalPopover>
      )}
    </div>
  )
}

/**
 * A CHIP. Two lines: line one is the clock — the time this post is set for, or,
 * once it is out, the time it ACTUALLY went out — and line two is the title.
 *
 * DRAG. A movable chip is `draggable` and drops onto any other day, which is the
 * same write the move button opens. The button STAYS: HTML5 drag does not exist
 * on touch, and it is also the only keyboard route to a move.
 *
 * A QUEUE CHIP IS A DIFFERENT ANIMAL. It comes from scheduled_posts, has no
 * draft row, and therefore has nothing to open and no id the date RPC would
 * accept — so its face is a plain span, not a button that would look clickable
 * and do nothing.
 */
function CalChip({ it, dragging, busy, tipOpen, onTip, offTip, onOpen, onMove, onArm, onDragStart, onDragEnd }: {
  it: CalendarItem
  dragging: boolean
  busy: boolean
  /** True while THIS chip is the one the popover is describing. */
  tipOpen: boolean
  onTip: (el: HTMLElement, id: string, text: string) => void
  offTip: () => void
  onOpen: () => void
  onMove: () => void
  onArm: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const fromQueue = it.source === 'queue'
  // `postedAt` wins when it exists, because on a published row the question is
  // never "when was it meant to go", it is "when did it go".
  const posted = it.stage === 'published' ? it.postedAt : null
  const clock = hhmm(posted ?? it.at)
  // ARMED OR PLANNED, IN A WORD, kept in the markup and withdrawn by CSS at grid
  // size only: at that width the word costs half the room the TITLE needs. The
  // sentence in the popover carries it on every canvas.
  const armWord = it.arming === 'out' ? null : ARMING_LABEL[it.arming]
  const tip = chipDescription(it)
  const tipId = `cal-tip-${it.id}`
  // ONE SPREAD, ON WHATEVER THE FACE TURNS OUT TO BE. `tabIndex` is on the span
  // deliberately: a queue chip has nothing to click, so it is not a button, but
  // it DOES carry the one sentence explaining why it is inert.
  const tipProps = {
    'aria-describedby': tipOpen ? tipId : undefined,
    ...(fromQueue ? { tabIndex: 0 } : null),
    onMouseEnter: (e: { currentTarget: HTMLElement }) => onTip(e.currentTarget, tipId, tip),
    onMouseLeave: offTip,
    onFocus: (e: { currentTarget: HTMLElement }) => onTip(e.currentTarget, tipId, tip),
    onBlur: offTip,
  }
  const face = (
    <>
      <span className="dirb-chip-h ds-t-meta">
        {posted && <Icon name="check" size={16} />}
        <span className="ds-t-mono">{clock}</span>
        {armWord && <span className="dirb-chip-arm dirb-dim">{armWord}</span>}
        {fromQueue && <Icon name="forward" size={16} />}
        {it.plannedAt && <Icon name="alert" size={16} />}
      </span>
      <span className="dirb-chip-n dirb-clamp2">{it.title}</span>
    </>
  )
  return (
    <div
      className={cx('dirb-calchip', !it.movable && 'dirb-calchip-lock', dragging && 'dirb-dragging',
        fromQueue && 'dirb-calchip-queue')}
      data-st={it.stage}
      data-src={it.source}
      // 🔴 SEPARATE FROM data-st: `review` is one status and two meanings on this
      // grid (undated it is a queue row, dated it is a false promise), so the
      // fact a restyle needs to reach is the arming state, not the stage.
      data-arm={it.arming}
      draggable={it.movable}
      onDragStart={it.movable ? (e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.id); onDragStart() }) : undefined}
      onDragEnd={it.movable ? onDragEnd : undefined}
    >
      <div className="dirb-row">
        {/* 🔴 NO `title` ATTRIBUTE ANYWHERE ON THIS CHIP, and its absence is the
            fix. `tipProps` opens a real popover on hover AND on focus, anchored
            to this chip's own rect, positioned so it never covers the card it
            describes, dismissible with Escape, and wired with aria-describedby
            rather than a tooltip nobody but a mouse can reach. */}
        {fromQueue ? (
          <span className="dirb-calchip-t dirb-grow" {...tipProps}>{face}</span>
        ) : (
          <button type="button" className="dirb-calchip-t dirb-grow" onClick={onOpen} {...tipProps}>{face}</button>
        )}
        {it.movable && (
          <IconButton
            icon="swap" size="sm"
            label={`Move ${it.title} to another day`}
            title="Move to another day"
            onClick={onMove}
          />
        )}
      </div>
      {/* THE ARM STEP, and it exists only on the rows that need it: a planned
          chip on Ivan's lane. It confirms every time, and the confirm names the
          day and the time. */}
      {it.armable && (
        <Button
          size="sm" variant="outline" disabled={busy} onClick={onArm}
          title={`Hand this to the publisher for ${absStamp(it.at)}. It confirms first.`}
          aria-label={`Arm ${it.title} for ${absStamp(it.at)}`}
        >
          Arm it
        </Button>
      )}
    </div>
  )
}

const fadeVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: fadeT },
  exit: { opacity: 0, transition: fadeT },
}

function monthPrefix(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

function hhmm(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '--:--'
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function longDay(k: string): string {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function absDay(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'an unreadable date'
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The full stamp an arming confirm has to name: the day AND the time it fires. */
function absStamp(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  return new Date(t).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
