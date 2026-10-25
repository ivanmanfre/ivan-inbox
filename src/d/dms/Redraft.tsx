// "Draft again" (Ivan 2026-10-25 on Dana Doron: "I always have to come back to here. I don't know if the draft
// has failed, is failing… should I have a button Draft again"). The ask sits in the dock under the keys; the
// status sits in the thread and says, in plain words, what the follow-up writer did with the request.
import { useEffect, useState } from 'react'
import { eventTime, fetchRedraftRequest, REDRAFT_REASON, type RedraftRequest, type Thread } from '../../lib/inbox'
import { label } from '../../lib/labels'
import { Btn } from '../ui/Key'
import { warsawDm, warsawHm } from '../ui/time'

export function RedraftAsk({ busy, onSend, onCancel }: { busy: boolean; onSend: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState('')
  return (
    <div className="dm-rest" data-redraft-ask>
      <b>Draft again</b>
      <textarea className="dm-edit" rows={2} value={note} onChange={e => setNote(e.target.value)} aria-label="What is off about this draft"
        placeholder="What's off? (optional) e.g. too generic, wrong angle, sounds like AI" />
      <p className="dm-meta">The follow-up writer reads the thread again with this draft and your note, and writes a different one.</p>
      <span className="dm-ban-row" style={{ marginTop: 0 }}>
        <Btn verb="redraft-send" className="dm-k" disabled={busy} onClick={() => onSend(note)}>{busy ? 'Working…' : 'Write a new one'}</Btn>
        <Btn verb="redraft-cancel" className="dm-k" disabled={busy} onClick={onCancel}>Cancel</Btn>
      </span>
    </div>
  )
}

const HELD: Record<string, string> = {
  not_due: 'the next follow-up is not due yet',
  prospect_held: 'this conversation is held for a manual reply',
  structured_hold: 'this conversation is on hold',
  future_date: 'a follow-up date is already set',
  snoozed: 'it is pushed to later',
  pending_draft: 'another draft is already waiting',
}

const at = (iso: string) => `${warsawDm(iso)} ${warsawHm(iso)}`

export function RedraftStatus({ t, now, reload }: { t: Thread; now: number; reload: () => void }) {
  const row = t.messages.filter(m => m.direction === 'outbound' && !m.sent_at && m.send_blocked_reason === REDRAFT_REASON)
    .sort((a, b) => Date.parse(b.send_blocked_at ?? '') - Date.parse(a.send_blocked_at ?? ''))[0]
  const askedAt = row?.send_blocked_at ?? null
  // Answered once anything newer lands on our side: the new draft, a send, or a hand reply.
  const answered = !!row && t.messages.some(m => m.id !== row.id && m.direction === 'outbound' && Date.parse(eventTime(m)) > Date.parse(askedAt ?? ''))
  const [req, setReq] = useState<RedraftRequest | null>(null)
  const [open, setOpen] = useState(false)
  const live = !!row && !answered
  useEffect(() => {
    if (!live) return
    let on = true
    const read = () => { void fetchRedraftRequest(t.prospect_id).then(r => { if (on) setReq(r?.request ?? null) }).catch(() => {}) }
    read()
    const id = window.setInterval(read, 30_000)
    return () => { on = false; window.clearInterval(id) }
  }, [live, t.prospect_id, row?.id])
  useEffect(() => { if (live && req?.outcome?.result === 'drafted') reload() }, [live, req?.outcome?.result]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!live || !askedAt) return null
  const o = req?.outcome
  const waited = (now - Date.parse(askedAt)) / 60000
  let line: string
  if (o?.result === 'no_follow_up') line = `The writer read the thread again (${at(o.at)}) and decided not to follow up now: ${o.reason ?? 'no reason given'}`
  else if (o?.result === 'held') line = `Not rewritten yet: ${HELD[o.reason ?? ''] ?? label(o.reason ?? null)}${o.due_at ? `, due ${at(o.due_at)}` : ''}. It tries again every 15 minutes.`
  else if (o?.result === 'drafted') line = 'A new draft was written. Loading it…'
  else line = waited > 45 ? 'Still waiting on the follow-up writer. It runs every 15 minutes and retries until it answers.'
    : 'Rewriting. The follow-up writer runs every 15 minutes and the new draft appears here.'
  return (
    <div className="dm-rest" data-redraft={row.id} role="status">
      <div>
        <b>Draft again · asked {at(askedAt)}</b>
        <span className="dm-ban-row" style={{ marginTop: 0 }}>
          <Btn verb="read-redrafted" aria-expanded={open} onClick={() => setOpen(x => !x)}>{open ? 'Hide old draft' : 'Old draft'}</Btn>
        </span>
      </div>
      {req?.note && <p className="dm-meta">Your note: {req.note}</p>}
      {open && <blockquote className="dm-quote">{req?.rejected_text ?? row.message_text}</blockquote>}
      <p className="dm-meta">{line}</p>
    </div>
  )
}
