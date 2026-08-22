import { useCallback, useMemo, useRef, useState } from 'react'
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
import { useConfirm } from '../../components/ConfirmSheet'
import { CalPopover } from './CalPopover'
import { SectionHead } from './Surface'
import { typeLabel } from './fmt'
import type { OpenDraft } from './ContentList'

// THE CALENDAR — one per lane, and the lane tabs are its only selector.
//
// What it is: the month, drawn out of the rows the list already has. Same
// fetch, same filters, same search — a chip and a row are the same draft, so
// there is no second source that can disagree with the queue about what is
// scheduled.
//
// What it is NOT: an arming surface. Exactly one thing here changes the
// database — `setScheduleDateAt`, the gated date-only RPC (content.ts, db/032)
// — and `scheduled_at` is the ONLY column it writes. Status and board
// visibility are left exactly as they were, which is what makes a date move a
// date move: nothing on a client's board appears, disappears, or gets armed
// because a post was dragged to a different Tuesday. Arming is still a separate,
// deliberate act on the draft pane (`scheduleDraftAt`).
//
// It is offered on BOTH lanes: the new RPC has no `client_id` branch, so Ivan's
// own drafts are accepted. The one refusal left is the database's status line
// (`review`/`scheduled`), and canMoveDate mirrors it, so a control is drawn only
// where the write will land.
//
// Mobile is the SAME DOM. The grid becomes an agenda list in CSS (`.cal` at
// ≤767px): the week rows unstack, empty days are display:none, and the day
// label moves inline. Nothing here reads a viewport — the workbench's rule.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * How many chips a month cell paints before the rest collapse into "+N".
 *
 * It is a NUMBER OF ROWS, not a height budget, and the chip's own height is
 * fixed against it (`--cal-chip-h` in wbcal.css). The arithmetic, restated
 * after the 2026-08-22 amendment gave the chip its second line back: 12px of
 * padding, a 16px day-number row, then rows of 48px chips and an 18px "+N" with
 * 3px gaps. One chip costs 79px, two cost 130, two and a "+N" cost 151. The
 * cell floor is 108px and stretches with the viewport, so a sparse month is
 * roomy and a busy day grows into what it needs, which is how a grid row is
 * supposed to behave.
 *
 * The "+N" row counts as one of the three, which is FullCalendar's
 * `dayMaxEventRows` semantics exactly: two posts render as two chips, three
 * render as two chips and a "+1".
 *
 * It is exported so `wbcal.css §2` and this file cannot drift apart silently:
 * the nth-child rule there is written against this number.
 */
export const VISIBLE_CHIPS = 2

type Moving = { id: string; title: string; at: string | null; day: string }
/**
 * A chip mid-drag. `day` is where it started, so a drop on its own day is a
 * no-op.
 *
 * A RAIL ROW DRAGS TOO, and it is the cheaper half of the fix: a rail row has
 * no date and therefore no day it came from, so `day` is `''`, which no day key
 * ever equals and every drop is therefore a real move. `at` is null for the
 * same reason, and publishAtForDay already defaults an undated row to 09:00.
 */
type Dragging = { id: string; title: string; at: string | null; day: string }

// No `lane` prop any more, and its absence is the change: every rule this
// surface had that forked on the lane belonged to the arming RPC, and the
// date-only one has none. It draws whatever rows it is handed.
//
// `queue` is the PUBLISH QUEUE (scheduled_posts), and it is optional because it
// is Ivan's by construction — the table has no client_id column, so the Mattan
// lane passes nothing. Queue rows the drafts already account for are deduped
// away inside buildCalendarItems; what survives is the set of posts that go out
// with no draft row behind them, which before 2026-08-10 appeared NOWHERE.
//
// ⚠ Queue chips are NOT filtered by the lane's search/stage filters. `rows`
// arrives pre-filtered and `queue` does not, deliberately: a calendar that hides
// live posts because a filter is on is the same failure this merge exists to
// fix. The count in the bar names them separately so the difference is visible.
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
  // WHICH WAY THE MONTH JUST MOVED. It is a render key AND a direction: React
  // replaces the grid node when the key changes, so the entry animation runs
  // from scratch on every step, and `data-dir` tells it which side to come in
  // from. Back a month should not slide in the same direction as forward.
  const [step, setStep] = useState<{ key: string; dir: 1 | -1 }>(
    () => ({ key: 'first', dir: 1 }))
  const [moving, setMoving] = useState<Moving | null>(null)
  const [drag, setDrag] = useState<Dragging | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const confirm = useConfirm()
  // THE CHIP DESCRIPTION. One popover for the whole grid, not one per chip:
  // there is only ever one pointer and one focus ring, so 13 mounted portals
  // would be 12 of them describing nothing.
  const [tip, setTip] = useState<{ el: HTMLElement; id: string; text: string } | null>(null)
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // THE OVERFLOW POPOVER. `el` is the "+N" button, which is both the anchor and
  // the thing focus goes back to when the panel closes. `day` is the key, so
  // the panel reads the SAME `byDay` map the grid drew from and cannot show a
  // different set of posts than the cell it came out of.
  const [more, setMore] = useState<{ day: string; el: HTMLElement } | null>(null)
  const moreRef = useRef<HTMLElement | null>(null)
  const closeMore = useCallback(() => {
    setMore(m => { moreRef.current = m?.el ?? null; return null })
    // Focus goes back to the control that opened the panel, or a keyboard
    // operator is dropped at the top of the document.
    queueMicrotask(() => moreRef.current?.focus())
  }, [])

  // 120ms, and the number is doing a job. Sweeping a pointer across a week of
  // chips fires mouseenter six or seven times; without the delay the panel
  // flashes once per cell. A native title waits about a second, which is the
  // other failure and the one Ivan actually hit. Focus is not delayed: a
  // keyboard operator arriving on a chip has already committed to it.
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
  // The walk-queue the draft window steps through with j/k: the month's chips in
  // time order, so the window's rail matches what is on screen — the same
  // contract the list rows have (a queue is the list you can actually see).
  // Queue-source chips are absent from it BY THE FILTER BELOW, not by accident:
  // they have no draft row, so there is nothing for the window to open.
  const walk = useMemo(() => {
    const ids = items.filter(i => i.source === 'draft' && inMonth.has(i.day)).map(i => i.id)
    const byId = new Map(rows.map(r => [r.id, r]))
    return ids.map(id => byId.get(id)).filter((r): r is ContentDraft => !!r)
  }, [items, inMonth, rows])

  const monthItems = useMemo(() => items.filter(i => inMonth.has(i.day)), [items, inMonth])
  // 🔴 THE MONTH COUNT USED TO BE ONE NUMBER, `N dated this month`, and that
  // number is the lie in figure form: it counts a review row carrying a date
  // alongside a row a publisher actually holds. Split in words, because six of
  // the eight dated client rows live are planned and none of them go out.
  const monthArmed = monthItems.filter(i => i.arming === 'armed').length
  const monthPlanned = monthItems.filter(i => i.arming === 'planned').length
  const monthOut = monthItems.filter(i => i.arming === 'out').length
  // 🔴 THE QUEUE-ONLY COUNT IS GONE FROM THE BAR, 2026-08-22, and it is a
  // deletion rather than a move. It was never a total: a queue row is armed by
  // definition, so those posts were already inside the two figures above and
  // this fourth number double-counted them for a reader who could not tell. Its
  // real job was explaining why some chips cannot be opened or moved, and that
  // belongs on the chip, which says it in its popover and in its accessible
  // name (chipDescription's `origin` clause), where it is attached to the thing
  // it is about instead of floating above 35 day numerals.

  const startMove = (id: string, title: string, at: string | null) => {
    setErr(null); setDone(null)
    setMoving({ id, title, at, day: at ? (dayKeyOf(at) ?? today) : today })
  }

  // ONE write path for both gestures. The date picker and the drag land on the
  // same RPC with the same confirm — a drag is a faster way to say the thing the
  // picker says, not a second, quieter way to change the database.
  const move = async (id: string, at: string | null, day: string): Promise<boolean> => {
    // The RPC writes `scheduled_at` and nothing else, so the confirm says the
    // one thing that changes — and, just as importantly, the two that do not.
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
  // consequence. Measured before this: draft to armed post cost 5 interactions
  // and a full-screen takeover, because Schedule sits behind a `setMore`
  // disclosure in the draft window (DraftPane.tsx). It now costs 2 from a chip
  // that already carries a date, which is the whole step the drag was missing.
  //
  // 🔴 IT KEEPS ITS CONFIRM, ALWAYS, and the confirm names the day AND the time
  // it will fire. There is no bulk path, no drag gesture, and no quiet version:
  // this is the write that puts a post in front of the public, and the cost
  // that was worth removing was the takeover, never the deliberation.
  //
  // 🔴 It writes status='scheduled' + scheduled_at, which is NOT what the date
  // move writes. The move's own confirm still says "Status and board visibility
  // stay as they are" and that sentence stays exactly true, because these are
  // two different writes with two different confirms.
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
  // still be movable (only movable chips are given draggable in the first
  // place). A drop on the day it came from is a cancelled drag, not a no-op
  // write — it never reaches the RPC and never asks for a confirm.
  const drop = async (day: string) => {
    const d = drag
    setDrag(null); setOver(null)
    if (!d || d.day === day) return
    setErr(null); setDone(null)
    await move(d.id, d.at, day)
  }

  return (
    <div className="cal">
      <div className="cal-bar">
        <div className="cal-nav">
          <button
            type="button" className="cal-navb" aria-label="Previous month"
            onClick={() => { setStep(s2 => ({ key: `${s2.key}<`, dir: -1 })); setAnchor(a => shiftMonth(a.year, a.month, -1)) }}
          >‹</button>
          <span className="cal-month">{monthLabel(anchor.year, anchor.month)}</span>
          <button
            type="button" className="cal-navb" aria-label="Next month"
            onClick={() => { setStep(s2 => ({ key: `${s2.key}>`, dir: 1 })); setAnchor(a => shiftMonth(a.year, a.month, 1)) }}
          >›</button>
          <button
            type="button" className="cal-today"
            onClick={() => { const n = new Date(); setAnchor({ year: n.getFullYear(), month: n.getMonth() }) }}
          >Today</button>
        </div>
        {/* TWO NUMBERS AT REST, AND BOTH OF THEM IN WORDS A READER ALREADY HAS.
            2026-08-22, after a blind panel judged this bar against the one it
            replaced:

              "`1 armed` ... `Armed` is the operator's word for a state machine
               he wrote. No product ships a top-line metric its user would have
               to be told the meaning of."
              "Four numbers, two of them in private vocabulary ... above a grid
               that is already numeral-dense (35 day numbers)."

            🔴 THE WORDS COME FROM src/lib/labels.ts AND ARE NOT WRITTEN HERE.
            `armed` was never a database value, which is why it never passed
            through label(): it is a word this app coined for a derived state.
            A coined word is a raw value with extra steps, so it went into the
            same map rather than a second vocabulary next to the state machine.

            WHAT SURVIVED THE CUT FROM FOUR TO TWO, and why:

              scheduled  what is still going out. Always drawn, including at
                         zero, because a month with nothing armed is exactly the
                         thing this figure exists to say out loud.
              posted     what already went out. Always drawn, same reason.
              planned    ONLY when there is one. It is not a third metric, it is
                         a DISCREPANCY (a row carrying a date that nothing will
                         publish), so it earns a slot only when it exists and it
                         is marked as attention rather than counted as coverage.
                         The distinction phase 3 fought for is kept; what moved
                         is that a zero no longer takes a permanent slot.
              queue only WITHDRAWN from the bar. Those rows are already inside
                         the two figures above (a queue row is armed by
                         definition), so the count was never a total — it was an
                         explanation of why six chips are inert, and that
                         explanation belongs on the chip, which carries it in
                         its popover and in its accessible name. */}
        <span className="cal-count" title="A publisher holds it: the draft is at Scheduled, or the chip is a row in the publish queue.">
          <b>{monthArmed}</b><span>{armingCountWord('armed')}</span>
        </span>
        <span className="cal-count cal-count-n"><b>{monthOut}</b><span>{armingCountWord('out')}</span></span>
        {monthPlanned > 0 && (
          <span
            className="cal-count cal-count-n cal-count-warn"
            title="These carry a date and nothing is set to publish them. A post still waiting on a review will not go out on the day it is drawn on."
          >
            <b>{monthPlanned}</b><span>{armingCountWord('planned')}</span>
          </span>
        )}
      </div>

      <div className="cal-body">
        <div className="cal-grid" key={step.key} data-dir={step.dir}>
          <div className="cal-head" aria-hidden>
            {WEEKDAYS.map(w => <span key={w}>{w}</span>)}
          </div>
          {weeks.map((week, wi) => (
            <div className="cal-week" key={wi}>
              {week.map(k => {
                const day = byDay.get(k) ?? []
                const outside = !k.startsWith(monthPrefix(anchor.year, anchor.month))
                // A day lights up only while a chip that could actually land
                // there is over it — its own day never does, so the highlight
                // never promises a write that drop() will refuse.
                const target = !!drag && drag.day !== k
                return (
                  <div
                    key={k}
                    className={`cal-day${day.length === 0 ? ' cal-day-empty' : ''}${outside ? ' cal-day-out' : ''}${k === today ? ' cal-day-now' : ''}${target && over === k ? ' cal-day-over' : ''}`}
                    onDragOver={target ? (e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== k) setOver(k) }) : undefined}
                    onDragLeave={target ? (() => setOver(o => (o === k ? null : o))) : undefined}
                    onDrop={target ? (e => { e.preventDefault(); void drop(k) }) : undefined}
                  >
                    <div className="cal-dn">
                      <span className="cal-dn-n">{Number(k.slice(8))}</span>
                      <span className="cal-dn-w">{longDay(k)}</span>
                    </div>
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
                    {/* THE OVERFLOW. Every chip is in the DOM above; the GRID
                        caps how many are painted and this is the rest of them.
                        Two things about that split are deliberate:

                        1. The cap is CSS (`wbcal.css §2`), not JS, because
                           below 767px the same DOM is an agenda list with no
                           height to run out of, and there the cap is switched
                           off and every chip is drawn. Nothing here reads a
                           viewport, which is the workbench's rule.
                        2. Chip height is never what flexes. FullCalendar
                           formalises the mechanic as `dayMaxEvents`: cap the
                           ROWS a cell will paint, and the remainder goes into a
                           "+N" that opens a popover. Notion Calendar ships the
                           same merge behaviour. Growing the chip instead is how
                           an 87px chip ended up in a 124px cell.

                        Rendered whenever a day holds more than the cap, and
                        hidden by CSS on the canvases where the cap is off, so
                        the count is always the truth about the day rather than
                        the truth about a viewport. */}
                    {day.length > VISIBLE_CHIPS && (
                      <button
                        type="button" className="cal-more"
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

        {/* THE RAIL, and it holds up to 54 rows on a client lane now instead of
            the zero it was filtered to. Three things make that scannable rather
            than a wall: it is ordered oldest first (buildCalendarRail), every
            row prints how long it has been waiting, and the list is its own
            scroll region so it can never push the grid off the screen.

            🔴 EVERY ROW HERE HAS A WORKING CONTROL, by construction: the rail's
            own predicate IS canMoveDate, which is the same function that
            decides whether the button is drawn. The old `cal-note` explaining
            the rows that had no button is gone with the status they described,
            because that set is now provably empty (calendarItems.test.ts). The
            `r.movable` guard stays as the cheap belt on the braces. */}
        <div className="cal-rail">
          <SectionHead title="No date yet" count={rail.length} />
          {rail.length === 0 ? (
            <div className="cal-rail-e">Nothing is waiting for a date.</div>
          ) : (
            <>
            {/* Under the head, not inside it: the head is a content-hugging
                pill and a sentence in its tail squeezes the title and shoves
                the count to the far edge. */}
            <div className="cal-rail-h">Oldest first. Drag one onto a day.</div>
            <div className="cal-rail-l">
              {rail.map(r => (
                <div
                  className={`cal-rr${drag?.id === r.id ? ' cal-rr-drag' : ''}`} key={r.id}
                  draggable={r.movable}
                  onDragStart={r.movable ? (e => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', r.id)
                    // day '' is not a day key, so drop() treats every cell as a
                    // real target rather than as the day it came from.
                    setDrag({ id: r.id, title: r.title, at: null, day: '' })
                  }) : undefined}
                  onDragEnd={r.movable ? (() => { setDrag(null); setOver(null) }) : undefined}
                >
                  <button
                    type="button" className="cal-rr-t"
                    onClick={() => onOpen(r.id, r.title, rows.filter(x => rail.some(y => y.id === x.id)))}
                  >
                    <span className="cal-rr-n">{r.title}</span>
                    <span className="cal-rr-m">
                      {typeLabel(r.type)}
                      <span className="cal-rr-age" title={`Created ${absDay(r.createdAt)}`}>
                        {waitedFor(r.createdAt)}
                      </span>
                    </span>
                  </button>
                  {r.movable && (
                    <button
                      type="button" className="cal-mv" onClick={() => startMove(r.id, r.title, null)}
                    >Give it a date</button>
                  )}
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      </div>

      {moving && (
        <div className="cal-move" role="group" aria-label="Move to another day">
          <div className="cal-move-t">Move <b>{moving.title}</b></div>
          <div className="cal-move-r">
            <input
              type="date" className="cal-move-d" value={moving.day}
              onChange={e => setMoving(m => (m ? { ...m, day: e.target.value } : m))}
            />
            <button type="button" className="btn p" disabled={busy || !moving.day} onClick={commit}>
              {busy ? 'Moving…' : 'Move'}
            </button>
            <button type="button" className="btn s" disabled={busy} onClick={() => setMoving(null)}>Cancel</button>
          </div>
          <div className="cal-move-s">
            Only the date changes — status and board visibility stay as they are.
            {moving.at ? ' Its time of day is kept.' : ' It has no time yet, so it goes out at 09:00.'}
          </div>
          {err && <div className="ops-err">{err}</div>}
        </div>
      )}
      {!moving && err && <div className="ops-err cal-err">{err}</div>}
      {done && <div className="cal-done">{done}</div>}

      {/* THE CHIP DESCRIPTION. Suppressed while a drag is in flight: a panel
          following the pointer during a drop is a panel in the way of the
          thing being aimed at. */}
      {tip && !drag && (
        <CalPopover
          id={tip.id} role="tooltip"
          anchorEl={tip.el}
          avoidEl={tip.el.closest('.cal-day') as HTMLElement | null}
          onDismiss={offTip}
        >
          <div className="cal-pop-t">{tip.text}</div>
        </CalPopover>
      )}

      {/* THE DAY PANEL. It is anchored to the "+N" button and told not to cover
          the CELL, so it lands beside the day it lists rather than on top of
          it. It lists the whole day, not just the hidden tail: a panel that
          shows posts three to five and leaves one and two behind the panel is
          a panel you have to close to finish reading. */}
      {more && (
        <CalPopover
          id="cal-day-panel" role="dialog"
          label={`Everything on ${longDay(more.day)}`}
          anchorEl={more.el}
          avoidEl={more.el.closest('.cal-day') as HTMLElement | null}
          onDismiss={closeMore}
        >
          <div className="cal-pop-h">{longDay(more.day)}</div>
          <div className="cal-pop-l">
            {(byDay.get(more.day) ?? []).map(it => (
              <button
                key={it.id} type="button" className="cal-pop-r"
                data-st={it.stage} data-src={it.source}
                disabled={it.source === 'queue'}
                onClick={() => { closeMore(); onOpen(it.id, it.title, walk) }}
              >
                <span className="cal-pop-c">{hhmm(it.stage === 'published' ? (it.postedAt ?? it.at) : it.at)}</span>
                <span className="cal-pop-n">{it.title}</span>
                <span className="cal-pop-s">{STAGE_LABEL[it.stage]}</span>
              </button>
            ))}
          </div>
        </CalPopover>
      )}
    </div>
  )
}

/**
 * A CHIP.
 *
 * Two lines, and the split is the point. Line one is the clock — the time this
 * post is set for, or, once it is out, the time it ACTUALLY went out. Line two
 * is the title, wrapped to two lines instead of ellipsed at the first word: the
 * single-row chip spent its 150px on a `17:00` and left two characters of
 * headline behind it, which is a chip that names nothing.
 *
 * DRAG. A movable chip is `draggable` and drops onto any other day, which is
 * the same write the ⇄ button opens. The button STAYS: HTML5 drag does not
 * exist on touch, and ⇄ is also the only keyboard route to a move.
 *
 * A QUEUE CHIP IS A DIFFERENT ANIMAL and is drawn as one. It comes from
 * scheduled_posts, has no draft row, and therefore has nothing to open and no
 * id the date RPC would accept — so its face is a plain `<span>`, not a button
 * that would look clickable and do nothing. It carries a `⇢` marker and says in
 * its tooltip which table it came from, because an inert chip with no
 * explanation reads as a bug and this one is the opposite: it is the post the
 * calendar used to hide.
 */
/**
 * THE SENTENCE A CHIP CARRIES, lifted out of the component.
 *
 * It used to be a `title` attribute, so a test could read it off the static
 * markup. It is a popover now, which only exists once a pointer or a focus ring
 * has arrived, and `renderToStaticMarkup` fires neither. Rather than weaken the
 * assertions to "the chip rendered", the sentence is a pure function of the
 * item and the tests assert on it directly, which is what they were actually
 * about: the published chip says the time it really went out and names the slot
 * it was queued for when the two disagree.
 */
export function chipDescription(it: CalendarItem): string {
  const posted = it.stage === 'published' ? it.postedAt : null
  const drifted = !!posted && hhmm(posted) !== hhmm(it.at)
  const origin = it.source === 'queue'
    ? ' · from the publish queue (scheduled_posts), no draft row, so it cannot be opened or moved here'
    : ''
  const outOfSync = it.plannedAt
    ? ` · ⚠ the publish queue fires this at ${hhmm(it.at)}; the draft still says ${hhmm(it.plannedAt)}`
    : ''
  // 🔴 PLAIN WORDS HERE TOO, 2026-08-22. The bar stopped saying "armed" and a
  // description that still said it would have moved the leak rather than fixed
  // it: this sentence is the chip's accessible name, so it is the one a screen
  // reader hears and the only place a keyboard user meets the distinction.
  const armTip = it.arming === 'planned'
    ? ' · Dated, but nothing is set to publish it yet.'
    : it.arming === 'armed'
      ? ' · Set to publish: a publisher holds this one.'
      : ''
  return posted
    ? `Posted ${hhmm(posted)}${drifted ? ` (was set for ${hhmm(it.at)})` : ''} · ${it.title}, ${STAGE_LABEL[it.stage]}${origin}`
    : `${hhmm(it.at)} · ${it.title}, ${STAGE_LABEL[it.stage]}${armTip}${it.movable ? ' · drag to another day' : ''}${origin}${outOfSync}`
}

function Chip({ it, dragging, busy, tipOpen, onTip, offTip, onOpen, onMove, onArm, onDragStart, onDragEnd }: {
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
  // What the clock says. `postedAt` wins when it exists, because on a published
  // row the question is never "when was it meant to go", it is "when did it go".
  const posted = it.stage === 'published' ? it.postedAt : null
  const clock = hhmm(posted ?? it.at)
  // ARMED OR PLANNED, IN A WORD. Kept in the markup and withdrawn by CSS at
  // grid size only (wbcal.css §3): at 93px of content width the word costs half
  // the room the TITLE needs, and the title is what says which post this is.
  // Below 767px the chip is 342px wide and the word stays. The sentence in the
  // popover carries it on every canvas, which is why withdrawing it here loses
  // nothing a keyboard or a screen reader could have reached.
  const armWord = it.arming === 'out' ? null : ARMING_LABEL[it.arming]
  const tip = chipDescription(it)
  const tipId = `cal-tip-${it.id}`
  // ONE SPREAD, ON WHATEVER THE FACE TURNS OUT TO BE. A queue chip's face is a
  // span and a draft chip's is a button, and both need the same four handlers
  // plus the same describedby, so the wiring is written once rather than
  // duplicated into two branches that can drift apart.
  //
  // `tabIndex` is on the span deliberately: a queue chip has nothing to click,
  // so it is not a button, but it DOES carry the one sentence explaining why it
  // is inert, and a description a keyboard cannot reach is the defect this
  // section exists to remove.
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
      {/* The tick, not the word "posted": measured at a 112px cell, `08:14
          posted` truncated to `08:14 pos…`, and a truncated word reads as a
          bug. `✓ 08:14` always fits, and the button title spells it out. */}
      <span className="cal-chip-h">
        {posted && <span className="cal-chip-out" aria-hidden>✓</span>}
        <span className="cal-chip-hh">{clock}</span>
        {armWord && <span className="cal-chip-arm">{armWord}</span>}
        {fromQueue && <span className="cal-chip-q" aria-hidden>⇢</span>}
        {it.plannedAt && <span className="cal-chip-drift" aria-hidden>⚠</span>}
      </span>
      <span className="cal-chip-n">{it.title}</span>
    </>
  )
  return (
    <div
      className={`cal-chip${it.movable ? '' : ' cal-chip-lock'}${dragging ? ' cal-chip-drag' : ''}${fromQueue ? ' cal-chip-queue' : ''}`}
      data-st={it.stage}
      data-src={it.source}
      // 🔴 SEPARATE FROM data-st, and it has to be: `review` is one status and
      // two meanings on this grid (undated it is a queue row, dated it is a
      // false promise), so the fact a restyle needs to reach is the arming
      // state, not the stage. Phase 3 owns how these look; this attribute and
      // the word above are the semantics, and neither has to be undone to
      // restyle them.
      data-arm={it.arming}
      draggable={it.movable}
      onDragStart={it.movable ? (e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.id); onDragStart() }) : undefined}
      onDragEnd={it.movable ? onDragEnd : undefined}
    >
      <div className="cal-chip-row">
        {/* 🔴 NO `title` ATTRIBUTE ANYWHERE ON THIS CHIP, and its absence is the
            fix. A native title cannot be styled, waits about a second, is
            unreachable by keyboard, and the browser puts it where the browser
            likes, which is what Ivan saw. `tipProps` opens a real popover on
            hover AND on focus, anchored to this chip's own rect, positioned so
            it never covers the cell it describes, dismissible with Escape, and
            wired with aria-describedby rather than a tooltip nobody but a
            mouse can reach.

            The DESCRIPTION is where the arming word went (§3): the chip's face
            no longer spells out Armed or Planned at grid size, so the sentence
            here has to, and a keyboard operator gets it because focus opens
            the same panel a hover does. */}
        {fromQueue ? (
          <span className="cal-chip-t cal-chip-t-static" {...tipProps}>{face}</span>
        ) : (
          <button type="button" className="cal-chip-t" onClick={onOpen} {...tipProps}>{face}</button>
        )}
        {it.movable && (
          <button type="button" className="cal-chip-mv" onClick={onMove} title="Move to another day" aria-label={`Move ${it.title} to another day`}>
            ⇄
          </button>
        )}
      </div>
      {/* THE ARM STEP, and it exists only on the rows that need it: a planned
          chip on Ivan's lane. It is a full-width row under the chip rather than
          a second corner icon because the corner already holds ⇄ and a 112px
          cell cannot carry two of them without clipping the clock. It confirms
          every time, and the confirm names the day and the time. */}
      {it.armable && (
        <button
          type="button" className="cal-chip-armb" disabled={busy} onClick={onArm}
          title={`Hand this to the publisher for ${absStamp(it.at)}. It confirms first.`}
          aria-label={`Arm ${it.title} for ${absStamp(it.at)}`}
        >
          Arm it
        </button>
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
 * HOW LONG THIS ROW HAS BEEN WAITING, in the shortest honest form.
 *
 * The rail is a backlog now, and a backlog with no age on it sorts silently:
 * the reason the oldest row is 35 days old is that nothing on any surface ever
 * said it was. Same unit the ops rows already use, so a day is a day here and
 * there.
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
