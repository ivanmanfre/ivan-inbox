import { useMemo, useState } from 'react'
import {
  buildCalendarItems, buildCalendarRail, dayKey, dayKeyOf, groupByDay, monthLabel, monthWeeks,
  publishAtForDay, shiftMonth, type CalendarItem,
} from '../../lib/calendarItems'
import {
  ClientRpcError, setScheduleDateAt, STAGE_LABEL, type ContentDraft,
} from '../../lib/content'
import { useConfirm } from '../../components/ConfirmSheet'
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

type Moving = { id: string; title: string; at: string | null; day: string }

// No `lane` prop any more, and its absence is the change: every rule this
// surface had that forked on the lane belonged to the arming RPC, and the
// date-only one has none. It draws whatever rows it is handed.
export function ContentCalendar({ rows, onOpen, refresh }: {
  rows: ContentDraft[]
  onOpen: OpenDraft
  refresh: () => void
}) {
  const today = dayKey(new Date())
  const [anchor, setAnchor] = useState(() => {
    const n = new Date()
    return { year: n.getFullYear(), month: n.getMonth() }
  })
  const [moving, setMoving] = useState<Moving | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const confirm = useConfirm()

  const items = useMemo(() => buildCalendarItems(rows), [rows])
  const rail = useMemo(() => buildCalendarRail(rows), [rows])
  const byDay = useMemo(() => groupByDay(items), [items])
  const weeks = useMemo(() => monthWeeks(anchor.year, anchor.month), [anchor])
  // The queue the draft window walks with j/k: the month's chips in time order,
  // so the window's rail matches what is on screen — the same contract the list
  // rows have (a queue is the list you can actually see).
  const queue = useMemo(() => {
    const inMonth = new Set(weeks.flat())
    const ids = items.filter(i => inMonth.has(i.day)).map(i => i.id)
    const byId = new Map(rows.map(r => [r.id, r]))
    return ids.map(id => byId.get(id)).filter((r): r is ContentDraft => !!r)
  }, [items, weeks, rows])

  const monthCount = queue.length

  const startMove = (id: string, title: string, at: string | null) => {
    setErr(null); setDone(null)
    setMoving({ id, title, at, day: at ? (dayKeyOf(at) ?? today) : today })
  }

  const commit = async () => {
    if (!moving) return
    // The RPC writes `scheduled_at` and nothing else, so the confirm says the
    // one thing that changes — and, just as importantly, the two that do not.
    const ok = await confirm({
      title: 'Move this post?',
      message: `Moves to ${longDay(moving.day)}. Status and board visibility stay as they are.`,
      confirmText: 'Move it',
    })
    if (!ok) return
    setBusy(true); setErr(null)
    try {
      const at = await setScheduleDateAt(moving.id, publishAtForDay(moving.at, moving.day))
      setDone(`Moved to ${dayKeyOf(at) ?? moving.day}.`)
      setMoving(null)
      refresh()
    } catch (e) {
      setErr(e instanceof ClientRpcError || e instanceof Error ? e.message : 'The move failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cal">
      <div className="cal-bar">
        <div className="cal-nav">
          <button
            type="button" className="cal-navb" aria-label="Previous month"
            onClick={() => setAnchor(a => shiftMonth(a.year, a.month, -1))}
          >‹</button>
          <span className="cal-month">{monthLabel(anchor.year, anchor.month)}</span>
          <button
            type="button" className="cal-navb" aria-label="Next month"
            onClick={() => setAnchor(a => shiftMonth(a.year, a.month, 1))}
          >›</button>
          <button
            type="button" className="cal-today"
            onClick={() => { const n = new Date(); setAnchor({ year: n.getFullYear(), month: n.getMonth() }) }}
          >Today</button>
        </div>
        {/* ONE WORD PER NUMBER, the strip's own rule — this is the month, not
            the lane and not the pipeline. */}
        <span className="cal-count"><b>{monthCount}</b><span>dated this month</span></span>
      </div>

      <div className="cal-body">
        <div className="cal-grid">
          <div className="cal-head" aria-hidden>
            {WEEKDAYS.map(w => <span key={w}>{w}</span>)}
          </div>
          {weeks.map((week, wi) => (
            <div className="cal-week" key={wi}>
              {week.map(k => {
                const day = byDay.get(k) ?? []
                const outside = !k.startsWith(monthPrefix(anchor.year, anchor.month))
                return (
                  <div
                    key={k}
                    className={`cal-day${day.length === 0 ? ' cal-day-empty' : ''}${outside ? ' cal-day-out' : ''}${k === today ? ' cal-day-now' : ''}`}
                  >
                    <div className="cal-dn">
                      <span className="cal-dn-n">{Number(k.slice(8))}</span>
                      <span className="cal-dn-w">{longDay(k)}</span>
                    </div>
                    {day.map(it => (
                      <Chip
                        key={it.id} it={it}
                        onOpen={() => onOpen(it.id, it.title, queue)}
                        onMove={() => startMove(it.id, it.title, it.at)}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div className="cal-rail">
          <SectionHead title="Ready, no date" count={rail.length} />
          {rail.length === 0 ? (
            <div className="cal-rail-e">Nothing approved is sitting without a date.</div>
          ) : (
            rail.map(r => (
              <div className="cal-rr" key={r.id}>
                <button
                  type="button" className="cal-rr-t"
                  onClick={() => onOpen(r.id, r.title, rows.filter(x => rail.some(y => y.id === x.id)))}
                >
                  <span className="cal-rr-n">{r.title}</span>
                  <span className="cal-rr-m">{typeLabel(r.type)}</span>
                </button>
                {r.movable && (
                  <button
                    type="button" className="cal-mv" onClick={() => startMove(r.id, r.title, null)}
                  >Give it a date</button>
                )}
              </div>
            ))
          )}
          {rail.some(r => !r.movable) && (
            // The honest version of a missing button, kept for the one row the
            // new RPC still refuses. `status not in ('review','scheduled')` is
            // its whole guard, so an approved-but-undated row cannot be given a
            // date here — and it says which rule, rather than just omitting the
            // control and letting the omission look like an oversight.
            <div className="cal-note">
              Some of these have no <b>Give it a date</b> button: the date RPC takes a draft at
              Needs review or Scheduled only (<code>bad_status</code>), and these are approved.
            </div>
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
    </div>
  )
}

function Chip({ it, onOpen, onMove }: { it: CalendarItem; onOpen: () => void; onMove: () => void }) {
  return (
    <div className={`cal-chip${it.movable ? '' : ' cal-chip-lock'}`} data-st={it.stage}>
      <button
        type="button" className="cal-chip-t" onClick={onOpen}
        title={`${hhmm(it.at)} · ${it.title} — ${STAGE_LABEL[it.stage]}`}
      >
        <span className="cal-chip-h">{hhmm(it.at)}</span>
        <span className="cal-chip-n">{it.title}</span>
      </button>
      {it.movable && (
        <button type="button" className="cal-chip-mv" onClick={onMove} title="Move to another day" aria-label={`Move ${it.title} to another day`}>
          ⇄
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
