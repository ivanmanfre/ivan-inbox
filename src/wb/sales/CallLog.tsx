/* ==========================================================================
   src/wb/sales/CallLog.tsx — "Calls on record", moved here from Today.

   Rebuild 2026-09-26: Today is gone, and this was the only door to the call
   archive (96 transcribed calls, their action items, next steps and
   objections). It is NOT a copy of the week above it: the week is the
   calendar, this is what was said. Ported from wb/today ZoneCallLog with the
   same segments, ranking, counts and strings, so nothing Ivan read on Today
   reads differently here.

   Read-only, as it was: nothing marks an action item done, which is why the
   Sales icon never counts them (decision 9).
   ========================================================================== */
import { useState } from 'react'
import { Icon, Segmented } from '../../ds'
import { Group, Row, Rows } from '../kit'
import {
  LEAD_LABEL, SEGMENT_LABEL, actionItems, callStats, callTitle, leadLine,
  owedByMe, people, segmentCalls,
  type CallRow, type CallSegment,
} from '../../lib/transcripts'

const CALL_PAGE = 6

function CallLine({ row, onOpen }: { row: CallRow; onOpen: () => void }) {
  const n = actionItems(row).length
  const mine = owedByMe(row)
  const lead = leadLine(row)
  const who = people(row.participants)
  const when = new Date(row.date)
  const day = Number.isNaN(when.getTime())
    ? 'date not recorded'
    : when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const meta = [
    day,
    row.duration_minutes ? `${row.duration_minutes}m` : null,
    who.length > 0 ? who.slice(0, 3).join(', ') : null,
  ].filter(Boolean).join(' · ')
  return (
    <Row
      className="a-sl-logrow"
      title={(
        <>
          {callTitle(row.title)}
          {n > 0 ? <span className="a-mono a-dim"> {mine > 0 ? `${mine} yours` : `${n} open`}</span> : null}
        </>
      )}
      sub={lead ? `${LEAD_LABEL[lead.kind]}: ${lead.text}` : undefined}
      meta={meta}
      tail={<Icon name="forward" size={16} />}
      onClick={onOpen}
    />
  )
}

export function CallLog({ rows, state, onOpen, onRetry }: {
  rows: CallRow[]
  /** `failed` = the transcript read errored; the list says so, never "none yet". */
  state: 'loading' | 'ok' | 'failed'
  onOpen: (id: string, queue: CallRow[]) => void
  onRetry: () => void
}) {
  const stats = callStats(rows)
  // Lands on unfinished business when there is any, else the recent week.
  // Never "all" on arrival: 96 rows by date is what this section replaces.
  const [seg, setSeg] = useState<CallSegment | null>(null)
  const [full, setFull] = useState(false)
  const active: CallSegment = seg ?? (stats.withActions > 0 ? 'open' : 'recent')
  const queue = segmentCalls(rows, active)
  const shown = full ? queue : queue.slice(0, CALL_PAGE)
  const hidden = queue.length - shown.length

  const note = (text: string, err = false) => (err
    ? (
      <div className="a-sl-warn" role="status">
        <span className="a-meta a-sl-err">{text}</span>
        <button type="button" className="wb-sl-retry" onClick={onRetry}>Read again</button>
      </div>
    )
    : <div className="a-meta a-sl-none">{text}</div>)

  if (rows.length === 0) {
    return (
      <div className="a-sl-log" data-state={state}>
        <Group label="Calls on record">
          {state === 'loading'
            ? note('Reading the call archive…')
            : state === 'failed'
              ? note('The call archive did not load. This is not an empty archive, it is an unread one.', true)
              : note('No calls have been transcribed yet. One appears here after the first recording is written up.')}
        </Group>
      </div>
    )
  }

  const counts: Record<CallSegment, number> = {
    open: stats.withActions,
    recent: stats.week,
    all: stats.total,
  }

  return (
    <div className="a-sl-log" data-state={state}>
      <Group label="Calls on record" tail={`${stats.total} kept · ${stats.meanMinutes}m average`}>
        {state === 'failed' ? note('The last read failed. These are the calls that loaded before it.', true) : null}
        <div className="a-sl-logseg">
          <Segmented
            label="Calls on record"
            markerId="a-sl-callseg"
            value={active}
            onChange={s => { setSeg(s as CallSegment); setFull(false) }}
            options={(['open', 'recent', 'all'] as CallSegment[]).map(s => ({
              id: s, label: SEGMENT_LABEL[s], count: counts[s],
            }))}
          />
        </div>
        {queue.length === 0 ? (
          note(active === 'open'
            ? 'Nothing was left open on any call. Every action item on record has an owner and a call behind it.'
            : 'No calls in the last seven days.')
        ) : (
          <Rows>
            {shown.map(r => <CallLine key={r.id} row={r} onOpen={() => onOpen(r.id, queue)} />)}
            {hidden > 0 ? (
              <Row
                className="a-sl-logmore"
                lead={<span className="a-mono a-ink">{hidden}</span>}
                title="more in this list"
                tail={<span className="a-mono">show them</span>}
                onClick={() => setFull(true)}
              />
            ) : null}
          </Rows>
        )}
      </Group>
    </div>
  )
}
