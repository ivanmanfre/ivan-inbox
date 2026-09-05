/* ==========================================================================
   THE CALENDAR — one per lane, and the lane switch is its only selector.

   Copied from `src/exp/v2c/ContentCalendar.tsx` and `src/exp/v2c/CalPopover.tsx`.

   What it is: the month, drawn out of the rows the list already has. Same
   fetch, same filters, same search — a chip and a row are the same draft, so
   there is no second source that can disagree with the queue about what is
   scheduled.

   What it is NOT: an arming surface. Exactly one thing here writes a date,
   `setScheduleDateAt`, and `scheduled_at` is the ONLY column it writes. Status
   and board visibility are left exactly as they were. Arming is a separate,
   deliberate act with its own confirm, on the chips that can take it.

   ONE DOM, TWO READINGS. At >=1000px it is a real month grid with a hairline
   lattice; below that the same nodes are a dense agenda with a sticky day
   header per day. Nothing here reads a viewport: the switch is one media
   query, exactly as the old sheet did it.
   ========================================================================== */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ARMING_LABEL, buildCalendarItems, buildCalendarRail, dayKey, dayKeyOf, groupByDay,
  monthLabel, monthWeeks, publishAtForDay, shiftMonth, type CalendarItem,
} from '../../lib/calendarItems'
import { armingCountWord } from '../../lib/labels'
import {
  ClientRpcError, setScheduleDateAt, STAGE_LABEL, type ContentDraft,
  type ScheduledQueueRow,
} from '../../lib/content'
import { scheduleDraft } from '../../lib/studioActions'
import { useConfirm } from '../chrome/ConfirmSheet'
import { place } from '../../exp/v2c/CalPopover'
import { typeLabel } from '../../exp/v2c/fmt'
import {
  Banner, Button, DayHeader, Dialog, Icon, IconButton, Input, Popover,
} from '../../ds'
import { Group, Row, Rows, Sep } from '../kit'
import type { OpenDraft } from './row'
import './content.css'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * How many chips a month cell paints before the rest collapse into "+N".
 *
 * It is a NUMBER OF ROWS, not a height budget, which is FullCalendar's
 * `dayMaxEventRows` semantics exactly: two posts render as two chips, three
 * render as two chips and a "+1". It is exported so the sheet's nth-child rule
 * and this file cannot drift apart silently.
 */
export const VISIBLE_CHIPS = 2

type Moving = { id: string; title: string; at: string | null; day: string }
/**
 * A chip mid-drag. `day` is where it started, so a drop on its own day is a
 * no-op. A RAIL ROW DRAGS TOO and has no day it came from, so its `day` is
 * `''`, which no day key ever equals and every drop is therefore a real move.
 */
type Dragging = { id: string; title: string; at: string | null; day: string }

export function ContentCalendar({ rows, queue = [], onOpen, refresh }: {
  rows: ContentDraft[]
  /** The PUBLISH QUEUE, optional because it is Ivan's by construction: the
      table has no client column, so a client lane passes nothing. Queue rows
      the drafts already account for are deduped away; what survives is the set
      of posts that go out with no draft row behind them. */
  queue?: ScheduledQueueRow[]
  onOpen: OpenDraft
  refresh: () => void
}) {
  const today = dayKey(new Date())
  const [anchor, setAnchor] = useState(() => {
    const n = new Date()
    return { year: n.getFullYear(), month: n.getMonth() }
  })
  // WHICH WAY THE MONTH JUST MOVED. A render key AND a direction: React
  // replaces the grid node when the key changes, so the entry runs from scratch
  // on every step, and the direction says which side it comes in from.
  const [step, setStep] = useState<{ key: string; dir: 1 | -1 }>(
    () => ({ key: 'first', dir: 1 }))
  const [moving, setMoving] = useState<Moving | null>(null)
  const [drag, setDrag] = useState<Dragging | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const confirm = useConfirm()
  // THE CHIP DESCRIPTION. One panel for the whole grid, not one per chip:
  // there is only ever one pointer and one focus ring.
  const [tip, setTip] = useState<{ el: HTMLElement; id: string; text: string } | null>(null)
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // THE OVERFLOW PANEL. `el` is the "+N more" button, which is both the anchor
  // and the thing focus goes back to when the panel closes. `day` is the key,
  // so the panel reads the SAME map the grid drew from.
  const [more, setMore] = useState<{ day: string; el: HTMLElement } | null>(null)
  const moreRef = useRef<HTMLElement | null>(null)
  const closeMore = useCallback(() => {
    setMore(m => { moreRef.current = m?.el ?? null; return null })
    // Focus goes back to the control that opened the panel, or a keyboard
    // operator is dropped at the top of the document.
    queueMicrotask(() => moreRef.current?.focus())
  }, [])

  // THE DAY PANEL'S TWO KEYBOARD FACTS, and neither is free on the primitive:
  // Escape closes exactly THIS layer (stopped, so the same press does not also
  // drop a row selection behind it), and focus moves into the panel on open and
  // returns to the control that opened it on close.
  useEffect(() => {
    if (!more) return
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeMore() }
    }
    document.addEventListener('keydown', k, true)
    const t = window.setTimeout(() => {
      document.querySelector<HTMLElement>('.a-ct-daylist button:not(:disabled)')?.focus()
    }, 0)
    return () => {
      document.removeEventListener('keydown', k, true)
      window.clearTimeout(t)
    }
  }, [more, closeMore])

  // 120ms, and the number is doing a job. Sweeping a pointer across a week of
  // chips fires mouseenter six or seven times; without the delay the panel
  // flashes once per cell. A native title waits about a second, which is the
  // other failure. Focus is not delayed: a keyboard operator arriving on a chip
  // has already committed to it.
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
  // The walk-queue the draft window steps through with j/k: the month's chips
  // in time order, so the window's rail matches what is on screen. Queue-source
  // chips are absent from it BY THE FILTER, not by accident: they have no draft
  // row, so there is nothing for the window to open.
  const walk = useMemo(() => {
    const ids = items.filter(i => i.source === 'draft' && inMonth.has(i.day)).map(i => i.id)
    const byId = new Map(rows.map(r => [r.id, r]))
    return ids.map(id => byId.get(id)).filter((r): r is ContentDraft => !!r)
  }, [items, inMonth, rows])

  const monthItems = useMemo(() => items.filter(i => inMonth.has(i.day)), [items, inMonth])
  // THE MONTH COUNT IS SPLIT IN WORDS, because one number counting a review row
  // carrying a date alongside a row a publisher actually holds is the lie in
  // figure form.
  const monthArmed = monthItems.filter(i => i.arming === 'armed').length
  const monthPlanned = monthItems.filter(i => i.arming === 'planned').length
  const monthOut = monthItems.filter(i => i.arming === 'out').length

  const startMove = (id: string, title: string, at: string | null) => {
    setErr(null); setDone(null)
    setMoving({ id, title, at, day: at ? (dayKeyOf(at) ?? today) : today })
  }

  // ONE write path for both gestures. The date picker and the drag land on the
  // same call with the same confirm — a drag is a faster way to say the thing
  // the picker says, not a second, quieter way to change the database.
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
  // consequence. It keeps its confirm, always, and the confirm names the day
  // AND the time it will fire. There is no bulk path and no quiet version.
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
  // still be movable. A drop on the day it came from is a cancelled drag, not a
  // no-op write — it never reaches the call and never asks for a confirm.
  const drop = async (day: string) => {
    const d = drag
    setDrag(null); setOver(null)
    if (!d || d.day === day) return
    setErr(null); setDone(null)
    await move(d.id, d.at, day)
  }

  return (
    <div className="a-ct-cal">
      <div className="a-ct-calbar">
        <IconButton
          icon="back" label="Previous month"
          onClick={() => { setStep(s2 => ({ key: `${s2.key}<`, dir: -1 })); setAnchor(a => shiftMonth(a.year, a.month, -1)) }}
        />
        <span className="a-ct-month">{monthLabel(anchor.year, anchor.month)}</span>
        <IconButton
          icon="forward" label="Next month"
          onClick={() => { setStep(s2 => ({ key: `${s2.key}>`, dir: 1 })); setAnchor(a => shiftMonth(a.year, a.month, 1)) }}
        />
        <Button
          variant="quiet" size="sm"
          onClick={() => { const n = new Date(); setAnchor({ year: n.getFullYear(), month: n.getMonth() }) }}
        >Today</Button>
        <span className="a-bar-spacer" />
        {/* TWO NUMBERS AT REST, both in words a reader already has. `scheduled`
            is what is still going out and `posted` is what already went out;
            both are drawn including at zero, because a month with nothing armed
            is exactly the thing those figures exist to say out loud. `planned`
            is not a third metric, it is a DISCREPANCY — a row carrying a date
            that nothing will publish — so it earns a slot only when it exists.
            The queue-only count is deliberately absent: those rows are already
            inside the two figures, so counting them again was never a total.
            The words come from the app's own label map and are not written
            here. */}
        <span className="a-ct-count" title="A publisher holds it: the draft is at Scheduled, or the chip is a row in the publish queue.">
          <b>{monthArmed}</b><span>{armingCountWord('armed')}</span>
        </span>
        <span className="a-ct-count"><b>{monthOut}</b><span>{armingCountWord('out')}</span></span>
        {monthPlanned > 0 && (
          <span
            className="a-ct-count" data-tone="attention"
            title="These carry a date and nothing is set to publish them. A post still waiting on a review will not go out on the day it is drawn on."
          >
            <b>{monthPlanned}</b><span>{armingCountWord('planned')}</span>
          </span>
        )}
      </div>

      <div className="a-ct-callayout">
        <div>
          <div className="a-ct-weekhead" aria-hidden>
            {WEEKDAYS.map(w => <span key={w}>{w}</span>)}
          </div>
          <div className="a-ct-grid" key={step.key} data-dir={step.dir}>
            {weeks.map((week, wi) => (
              <div className="a-ct-week" key={wi}>
                {week.map(k => {
                  const day = byDay.get(k) ?? []
                  const outside = !k.startsWith(monthPrefix(anchor.year, anchor.month))
                  // A day lights up only while a chip that could actually land
                  // there is over it — its own day never does, so the highlight
                  // never promises a write the drop will refuse.
                  const target = !!drag && drag.day !== k
                  return (
                    <div
                      key={k}
                      className="a-ct-day"
                      data-empty={day.length === 0 ? '' : undefined}
                      data-out={outside ? '' : undefined}
                      data-now={k === today ? '' : undefined}
                      data-over={target && over === k ? '' : undefined}
                      onDragOver={target ? (e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== k) setOver(k) }) : undefined}
                      onDragLeave={target ? (() => setOver(o => (o === k ? null : o))) : undefined}
                      onDrop={target ? (e => { e.preventDefault(); void drop(k) }) : undefined}
                    >
                      {/* The agenda's day header, and the grid's day numeral.
                          Same node set, one media query decides which is read. */}
                      <DayHeader label={longDay(k)} tail={day.length} />
                      <span className="a-ct-dn">
                        <span className="a-ct-dn-n">{Number(k.slice(8))}</span>
                        <span className="a-ct-dn-w">{longDay(k)}</span>
                      </span>
                      <div className="a-ct-chips">
                        {day.map(it => (
                          <Chip
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
                      {/* THE OVERFLOW. Every chip is in the DOM above; the cell
                          caps how many are PAINTED and this is the rest of
                          them. The cap is CSS, not JS, because below the grid
                          width the same DOM is an agenda with no height to run
                          out of, and there the cap is switched off and every
                          chip is drawn. So the count is always the truth about
                          the day rather than the truth about a viewport. */}
                      {day.length > VISIBLE_CHIPS && (
                        <button
                          type="button" className="a-ct-more"
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
              </div>
            ))}
          </div>
        </div>

        {/* THE RAIL. Ordered oldest first, every row prints how long it has
            been waiting, and the list is its own region so it can never push
            the grid off the screen. EVERY ROW HERE HAS A WORKING CONTROL by
            construction: the rail's own predicate is the same one that decides
            whether the button is drawn. */}
        <Group
          label="No date yet"
          tail={rail.length}
          foot={rail.length === 0 ? undefined : 'Oldest first. Drag one onto a day.'}
          stickyHead
        >
          {rail.length === 0 ? (
            <div className="a-ct-sub">Nothing is waiting for a date.</div>
          ) : (
            <Rows>
              {rail.map(r => (
                <div
                  className="a-ct-railrow" key={r.id}
                  data-drag={drag?.id === r.id ? '' : undefined}
                  draggable={r.movable}
                  onDragStart={r.movable ? (e => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', r.id)
                    // day '' is not a day key, so the drop treats every cell as
                    // a real target rather than as the day it came from.
                    setDrag({ id: r.id, title: r.title, at: null, day: '' })
                  }) : undefined}
                  onDragEnd={r.movable ? (() => { setDrag(null); setOver(null) }) : undefined}
                >
                  <Row
                    onClick={() => onOpen(r.id, r.title, rows.filter(x => rail.some(y => y.id === x.id)))}
                    title={r.title}
                    titleWrap
                    meta={
                      <>
                        <span>{typeLabel(r.type)}</span>
                        <Sep />
                        <span title={`Created ${absDay(r.createdAt)}`}>{waitedFor(r.createdAt)}</span>
                      </>
                    }
                    actions={r.movable
                      ? (
                        <span onClick={e => e.stopPropagation()}>
                          <Button variant="quiet" size="sm" onClick={() => startMove(r.id, r.title, null)}>
                            Give it a date
                          </Button>
                        </span>
                      )
                      : undefined}
                  />
                </div>
              ))}
            </Rows>
          )}
        </Group>
      </div>

      {moving && (
        <Group label="Move to another day">
          <div className="a-group-pad a-stack" data-tight>
            <div>Move <b>{moving.title}</b></div>
            <div className="a-ct-moverow">
              <Input
                type="date" label="Day" value={moving.day}
                onChange={e => setMoving(m => (m ? { ...m, day: e.target.value } : m))}
              />
              <Button variant="primary" busy={busy} disabled={!moving.day} onClick={commit}>
                {busy ? 'Moving…' : 'Move'}
              </Button>
              <Button variant="quiet" disabled={busy} onClick={() => setMoving(null)}>Cancel</Button>
            </div>
            <div className="a-ct-ref">
              Only the date changes — status and board visibility stay as they are.
              {moving.at ? ' Its time of day is kept.' : ' It has no time yet, so it goes out at 09:00.'}
            </div>
            {err && <div className="a-ct-err">{err}</div>}
          </div>
        </Group>
      )}
      {!moving && err && <Banner tone="urgent" icon="error" title={err} />}
      {done && <Banner tone="clear" icon="check" title={done} />}

      {/* THE CHIP DESCRIPTION. Suppressed while a drag is in flight: a panel
          following the pointer during a drop is a panel in the way of the thing
          being aimed at. */}
      {tip && !drag && (
        <AnchoredPanel
          anchorEl={tip.el}
          avoidEl={tip.el.closest('.a-ct-day') as HTMLElement | null}
          onDismiss={offTip}
          label={tip.text}
        >
          <div className="a-ct-tip-t">{tip.text}</div>
        </AnchoredPanel>
      )}

      {/* THE DAY PANEL. It lists the WHOLE day, not just the hidden tail: a
          panel that shows posts three to five and leaves one and two behind it
          is a panel you have to close to finish reading. */}
      <Dialog
        open={!!more}
        onClose={closeMore}
        title={more ? longDay(more.day) : ''}
        cancelLabel="Close"
      >
        <div className="a-ct-daylist" aria-label={more ? `Everything on ${longDay(more.day)}` : undefined}>
          {(more ? byDay.get(more.day) ?? [] : []).map(it => (
            <button
              key={it.id} type="button" className="a-ct-dayrow"
              data-st={it.stage} data-src={it.source}
              disabled={it.source === 'queue'}
              onClick={() => { closeMore(); onOpen(it.id, it.title, walk) }}
            >
              <span className="a-ct-dayrow-c">{hhmm(it.stage === 'published' ? (it.postedAt ?? it.at) : it.at)}</span>
              <span className="a-ct-dayrow-n">{it.title}</span>
              <span className="a-ct-dayrow-s">{STAGE_LABEL[it.stage]}</span>
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  )
}

/**
 * An anchored panel, and it exists because a native title is not one: a title
 * cannot be styled, waits about a second, is unreachable by keyboard, and the
 * browser puts it where the browser likes.
 *
 * THE ONE RULE THAT IS NOT ABOUT TASTE: it must never cover the cell it
 * describes. It is positioned against the AVOID rect (the day cell), not
 * against the chip, so it lands outside the cell rather than on top of the
 * other things in it. Vertical placement flips when there is no room below;
 * horizontal placement clamps to the viewport.
 */
function AnchoredPanel({ anchorEl, avoidEl, onDismiss, label, children }: {
  anchorEl: HTMLElement | null
  avoidEl?: HTMLElement | null
  onDismiss: () => void
  label: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number; side: 'below' | 'above' } | null>(null)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el || !anchorEl) return
    const a = anchorEl.getBoundingClientRect()
    const v = (avoidEl ?? anchorEl).getBoundingClientRect()
    const r = el.getBoundingClientRect()
    setPos(place(a, v, { w: r.width, h: r.height }, { w: window.innerWidth, h: window.innerHeight }))
  }, [anchorEl, avoidEl])

  useLayoutEffect(() => { measure() }, [measure])

  useEffect(() => {
    const on = () => measure()
    // `true` on scroll: the grid scrolls inside a pane, not on the window, and
    // a non-capturing window listener never hears that.
    window.addEventListener('scroll', on, true)
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on, true)
      window.removeEventListener('resize', on)
    }
  }, [measure])

  // ESCAPE, on the document, because a panel opened by hover has no focus to
  // hang a handler on and the key still has to work.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onDismiss() } }
    document.addEventListener('keydown', k, true)
    return () => document.removeEventListener('keydown', k, true)
  }, [onDismiss])

  if (!anchorEl) return null
  // The portal target is the app's own plate, so the panel lands in the same
  // one as the chip that opened it on a page that ever holds two.
  const host = anchorEl.closest('.wb') ?? document.body
  return createPortal(
    <div
      ref={ref}
      className="a-ct-tipwrap"
      data-side={pos?.side ?? 'below'}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      <Popover open label={label} className="a-ct-tip">{children}</Popover>
    </div>,
    host,
  )
}

/**
 * THE SENTENCE A CHIP CARRIES, a pure function of the item so the tests assert
 * on it directly: the published chip says the time it really went out and names
 * the slot it was queued for when the two disagree.
 */
export function chipDescription(it: CalendarItem): string {
  const posted = it.stage === 'published' ? it.postedAt : null
  const drifted = !!posted && hhmm(posted) !== hhmm(it.at)
  const origin = it.source === 'queue'
    ? ' · from the publish queue (scheduled_posts), no draft row, so it cannot be opened or moved here'
    : ''
  const outOfSync = it.plannedAt
    ? ` · the publish queue fires this at ${hhmm(it.at)}; the draft still says ${hhmm(it.plannedAt)}`
    : ''
  // PLAIN WORDS HERE TOO: this sentence is the chip's accessible description,
  // so it is the one a screen reader hears and the only place a keyboard user
  // meets the distinction.
  const armTip = it.arming === 'planned'
    ? ' · Dated, but nothing is set to publish it yet.'
    : it.arming === 'armed'
      ? ' · Set to publish: a publisher holds this one.'
      : ''
  return posted
    ? `Posted ${hhmm(posted)}${drifted ? ` (was set for ${hhmm(it.at)})` : ''} · ${it.title}, ${STAGE_LABEL[it.stage]}${origin}`
    : `${hhmm(it.at)} · ${it.title}, ${STAGE_LABEL[it.stage]}${armTip}${it.movable ? ' · drag to another day' : ''}${origin}${outOfSync}`
}

/**
 * A CHIP. Two lines, and the split is the point: line one is the clock (the
 * time this post is set for, or, once it is out, the time it ACTUALLY went
 * out), line two is the title wrapped to two lines rather than ellipsed at the
 * first word.
 *
 * DRAG. A movable chip drops onto any other day, which is the same write the
 * move button opens. The button STAYS: drag does not exist on touch, and it is
 * also the only keyboard route to a move.
 *
 * A QUEUE CHIP IS A DIFFERENT ANIMAL and is drawn as one: it has no draft row,
 * nothing to open and no id the date call would accept, so its face is a plain
 * span rather than a button that would look clickable and do nothing.
 */
function Chip({ it, dragging, busy, tipOpen, onTip, offTip, onOpen, onMove, onArm, onDragStart, onDragEnd }: {
  it: CalendarItem
  dragging: boolean
  busy: boolean
  /** True while THIS chip is the one the panel is describing. */
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
  // What the clock says. `postedAt` wins when it exists, because on a published
  // row the question is never "when was it meant to go", it is "when did it go".
  const posted = it.stage === 'published' ? it.postedAt : null
  const clock = hhmm(posted ?? it.at)
  // ARMED OR PLANNED, IN A WORD. Kept in the markup and withdrawn by CSS at
  // grid size only: at that content width the word costs half the room the
  // TITLE needs, and the title is what says which post this is. The description
  // carries it on every canvas.
  const armWord = it.arming === 'out' ? null : ARMING_LABEL[it.arming]
  const tip = chipDescription(it)
  const tipId = `cal-tip-${it.id}`
  // ONE SPREAD, ON WHATEVER THE FACE TURNS OUT TO BE: a queue chip's face is a
  // span and a draft chip's is a button, and both need the same four handlers
  // plus the same description, so the wiring is written once.
  //
  // `tabIndex` is on the span deliberately: a queue chip has nothing to click,
  // so it is not a button, but it DOES carry the one sentence explaining why it
  // is inert, and a description a keyboard cannot reach is the defect this
  // panel exists to remove.
  const tipProps = {
    'aria-describedby': tipId,
    ...(fromQueue ? { tabIndex: 0 } : null),
    onMouseEnter: (e: { currentTarget: HTMLElement }) => onTip(e.currentTarget, tipId, tip),
    onMouseLeave: offTip,
    onFocus: (e: { currentTarget: HTMLElement }) => onTip(e.currentTarget, tipId, tip),
    onBlur: offTip,
  }
  const face = (
    <>
      {/* The tick, not the word "posted": at a grid cell's width the word
          truncates, and a truncated word reads as a bug. */}
      <span className="a-ct-chip-h">
        {posted && <span className="a-ct-chip-out"><Icon name="check" size={16} /></span>}
        <span>{clock}</span>
        {armWord && <span className="a-ct-chip-arm">{armWord}</span>}
        {fromQueue && <span className="a-ct-chip-q"><Icon name="next" size={16} /></span>}
        {it.plannedAt && <span className="a-ct-chip-drift"><Icon name="alert" size={16} /></span>}
      </span>
      <span className="a-ct-chip-n">{it.title}</span>
      {/* The sentence itself, always in the DOM so the description a chip
          points at is reachable whether or not the panel is open. */}
      <span className="ds-sr" id={tipId}>{tip}</span>
    </>
  )
  return (
    <div
      className="a-ct-chip"
      data-st={it.stage}
      data-src={it.source}
      // SEPARATE FROM the stage, and it has to be: `review` is one status and
      // two meanings on this grid, so the fact a reader needs is the arming
      // state, not the stage.
      data-arm={it.arming}
      data-tip={tipOpen ? '' : undefined}
      data-drag={dragging ? '' : undefined}
      data-lock={it.movable ? undefined : ''}
      draggable={it.movable}
      onDragStart={it.movable ? (e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.id); onDragStart() }) : undefined}
      onDragEnd={it.movable ? onDragEnd : undefined}
    >
      <div className="a-ct-chip-row">
        {/* NO `title` ATTRIBUTE ANYWHERE ON THIS CHIP, and its absence is the
            fix: the panel opens on hover AND on focus, anchored to this chip's
            own rect, positioned so it never covers the cell it describes, and
            dismissible with Escape. */}
        {fromQueue ? (
          <span className="a-ct-chip-t" {...tipProps}>{face}</span>
        ) : (
          <button type="button" className="a-ct-chip-t" onClick={onOpen} {...tipProps}>{face}</button>
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
      {/* THE ARM STEP, and it exists only on the rows that need it. It is a
          full-width row under the chip rather than a second corner mark because
          the corner already holds the move control. It confirms every time, and
          the confirm names the day and the time. */}
      {it.armable && (
        <Button
          className="a-ct-chip-armb" variant="quiet" size="sm" disabled={busy} onClick={onArm}
          title={`Hand this to the publisher for ${absStamp(it.at)}. It confirms first.`}
          aria-label={`Arm ${it.title} for ${absStamp(it.at)}`}
        >
          Arm it
        </Button>
      )}
    </div>
  )
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

/**
 * HOW LONG THIS ROW HAS BEEN WAITING, in the shortest honest form. The rail is
 * a backlog, and a backlog with no age on it sorts silently.
 */
export function waitedFor(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const days = Math.floor((now - t) / 86_400_000)
  if (days < 1) return 'today'
  return `${days}d`
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
