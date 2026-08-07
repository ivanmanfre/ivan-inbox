import { useMemo, useState } from 'react'
import {
  buildCalendarItems, buildCalendarRail, dayKey, dayKeyOf, groupByDay, monthLabel, monthWeeks,
  publishAtForDay, shiftMonth, type CalendarItem,
} from '../../lib/calendarItems'
import {
  ClientRpcError, LANE_POSSESSIVE, scheduleDraftAt, STAGE_LABEL,
  type ContentDraft, type ContentLane,
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
// What it is NOT: a second write path. Exactly one thing on this surface
// changes the database — `scheduleDraftAt`, the gated RPC (content.ts) — and it
// is only offered where the RPC will actually accept it. On Ivan's lane it will
// not, and the rail says so in the database's own words rather than rendering a
// button that answers `not_a_client_draft`.
//
// Mobile is the SAME DOM. The grid becomes an agenda list in CSS (`.cal` at
// ≤767px): the week rows unstack, empty days are display:none, and the day
// label moves inline. Nothing here reads a viewport — the workbench's rule.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Moving = { id: string; title: string; at: string | null; day: string }

export function ContentCalendar({ rows, lane, onOpen, refresh }: {
  rows: ContentDraft[]
  lane: ContentLane
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

  const items = useMemo(() => buildCalendarItems(rows, lane), [rows, lane])
  const rail = useMemo(() => buildCalendarRail(rows, lane), [rows, lane])
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
    // 🔴 The RPC is not a date-only write: it also sets status='scheduled' and
    // board_visible=true, so this is the moment a paying client can see the
    // post. It gets said out loud before it fires, every time.
    const ok = await confirm({
      title: 'Move this post?',
      message: `It moves to ${moving.day}, is marked scheduled, and goes onto ${LANE_POSSESSIVE[lane]} board. `
        + 'That is what the scheduler does — there is no date-only version of it here.',
      confirmText: 'Move it',
    })
    if (!ok) return
    setBusy(true); setErr(null)
    try {
      const at = await scheduleDraftAt(moving.id, publishAtForDay(moving.at, moving.day))
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
          {lane === 'ivan' && (
            // The honest version of a missing button. Read off the live function
            // body: operator_schedule_draft answers `not_a_client_draft` for
            // client_id IS NULL, and the only other way to set a date is a direct
            // write to scheduled_at — which is exactly what the publish bridge
            // acts on. So this lane gets no move control anywhere on the surface.
            <div className="cal-note">
              Dates on your own lane are not editable here. The scheduler RPC only accepts a
              client’s draft (<code>not_a_client_draft</code>), and writing <code>scheduled_at</code>
              {' '}straight into the table is what hands a post to the publisher — so this surface
              does not do it.
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
            This also marks it scheduled and puts it on {LANE_POSSESSIVE[lane]} board.
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
