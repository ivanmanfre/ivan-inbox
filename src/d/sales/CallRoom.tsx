import { useState } from 'react'
import { label } from '../../lib/labels'
import { callTopics, type CallRow } from '../../lib/transcripts'

// The parts of today's call window D had dropped (parity 09-27): the proposal
// hook, the content pulled out of the call, the "Read of the room" inspector
// and the reading-only footer. Same fields, same words (wb/call/index.tsx).

/** Today's date line, with the year: "Tue, Sep 22, 2026". */
export function callWhen(iso: string | null | undefined): string {
  const d = new Date(iso ?? '')
  if (Number.isNaN(d.getTime())) return 'date not recorded'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

const list = (v: string[] | null | undefined) => (v ?? []).map(x => (x ?? '').trim()).filter(Boolean)

function Lines({ head, items }: { head: string; items: string[] }) {
  if (items.length === 0) return null
  return <div className="sl-cb"><div className="sl-cbh">{head}</div><ul className="sl-dots">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
}

export function Topics({ row }: { row: CallRow }) {
  const t = callTopics(row)
  if (t.length === 0) return null
  return (
    <div className="sl-cb" data-call-topics>
      <div className="sl-cbh">Content pulled out of this call ({t.length})</div>
      <ul className="sl-dots">{t.map((x, i) => <li key={i}>{x.title}{x.format && <em> · {x.format}</em>}</li>)}</ul>
    </div>
  )
}

/** "The call" facts (When, Length, Kind, everyone on it) and the Read of the room fold. */
export function CallRoom({ row, clean = false }: { row: CallRow; clean?: boolean }) {
  const b = row.brief
  const [open, setOpen] = useState(!clean)
  const facts: Array<[string, string]> = [['When', callWhen(row.date)]]
  if (row.duration_minutes) facts.push(['Length', `${row.duration_minutes} minutes`])
  if (row.meeting_type) facts.push(['Kind', label(row.meeting_type)])
  const kv: Array<[string, string]> = []
  if (b?.fit_score != null) kv.push(['Fit', `${b.fit_score} out of 5`])
  if (b?.decision_maker) kv.push(['Decision maker', b.decision_maker])
  if (b?.industry) kv.push(['Industry', b.industry])
  if (b?.team_size) kv.push(['Team size', b.team_size])
  if (b?.automation_maturity) kv.push(['Automation maturity', label(b.automation_maturity)])
  if (b?.timeline) kv.push(['Timeline', b.timeline])
  if (b?.budget_signal) kv.push(['Budget signal', label(b.budget_signal)])
  return (
    <div className="sl-room" data-call-room>
      {!clean && <dl className="sl-kv">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      <button type="button" className="sl-fold" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span>Read of the room</span><small>{b ? '' : 'none written'}</small>
      </button>
      {open && (b ? (
        <>
          {kv.length > 0 && <dl className="sl-kv">{kv.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
          <Lines head="What hurts" items={list(b.pain)} />
          <Lines head="What they run on" items={list(b.stack)} />
          <Lines head="What set this off" items={list(b.triggers)} />
        </>
      ) : (
        <div className="sl-note">The extractor writes this for sales calls and it never ran on this one. Only 1 of the 96 calls on record carries it, so an empty panel here is the normal state and not a failure.</div>
      ))}
      {!clean && <div className="sl-note">Reading only. Nothing on this screen writes to the database, and nothing here can reach the people who were on the call.</div>}
    </div>
  )
}
