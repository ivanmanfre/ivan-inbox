import { useState, type FormEvent } from 'react'
import { isBookLinkTask, markTaskBooked, type OpsDraft } from '../../lib/ops'
import { bookFromCard } from '../../lib/inboxCalendar'
import { Btn } from '../ui/Key'

// The "Booked" key on a book-their-link task (2026-09-27). Opens a call-time field on YOUR clock
// (the browser's time zone); Save converts it to UTC and records the booking through
// ops_task_mark_booked, which also closes the task. The UTC line under the field is the receipt:
// it is exactly what gets stored.
export function BookedKey({ d, onDone }: { d: OpsDraft; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  // A send-invite task (ARCH drafter, 2026-10-28) carries the time the prospect accepted as proposed_start_at; it opens
  // prefilled on your clock and stays editable.
  // Until the field is edited, Save sends that exact instant: a local wall time is ambiguous in the repeated DST hour.
  const proposed = typeof d.context?.proposed_start_at === 'string' ? d.context.proposed_start_at : ''
  const [when, setWhenRaw] = useState(() => toLocalInput(proposed))
  const [edited, setEdited] = useState(false)
  const setWhen = (v: string) => { setWhenRaw(v); setEdited(true) }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!isBookLinkTask(d)) return null
  // db/20261102 stamps the prospect's own words on every booking card (Gene Kakaulin: fee structure, creator
  // examples, recent creative). Shown verbatim above the key so the call prep starts from the card.
  const ask = typeof d.context?.their_ask === 'string' ? d.context.their_ask.trim() : ''
  const askBlock = ask
    ? <div className="op-ask" data-ask style={ASK_STYLE}><b style={ASK_HEAD}>What they asked for</b>{ask}</div>
    : null
  const t = !edited && proposed && when ? new Date(proposed) : when ? new Date(when) : null
  const valid = !!t && !isNaN(t.getTime())
  const utc = valid ? t!.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : ''
  async function save(e?: FormEvent) {
    e?.preventDefault()
    if (!valid || busy) return
    setBusy(true); setErr('')
    try { await markTaskBooked(d, t!.toISOString()); setOpen(false); onDone() }
    catch (x) { setErr(x instanceof Error ? x.message : String(x)) }
    finally { setBusy(false) }
  }
  if (!open) return <>{askBlock}<BookSlotKey d={d} onDone={onDone} /><Btn verb="booked" onClick={() => setOpen(true)} aria-label={`Booked: ${d.context?.prospect_name ?? 'this call'}`}>Booked</Btn></>
  return (
    <>{askBlock}<form className="op-bk" onSubmit={e => void save(e)}>
      <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} aria-label="Call time (your clock)" autoFocus />
      <small>{valid ? `Saves as ${utc}` : 'Call time, your clock'}</small>
      <Btn primary verb="booked-save" type="submit" disabled={!valid || busy}>{busy ? 'Saving…' : 'Save'}</Btn>
      <Btn verb="booked-cancel" disabled={busy} onClick={() => { setOpen(false); setErr('') }}>Cancel</Btn>
      {err && <div className="op-err">{err}</div>}
    </form></>
  )
}

// BOOKING_CARD_OFFERED_SLOT_V1 (2026-11-06). On a card where the prospect said yes to the time we offered
// (context.kind_detail = book_offered_slot): one key, "Book <time> for <email>". The tap books that exact time on the
// owner's scheduler (Mattan's HubSpot, Jonathan's TidyCal). The confirm reply in the thread then becomes sendable,
// still waiting for your approval. Nothing books until this tap; nothing sends from here.
function BookSlotKey({ d, onDone }: { d: OpsDraft; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const b = (d.context?.booking ?? null) as { label?: string; invite_email?: string; start?: string } | null
  if (d.context?.kind_detail !== 'book_offered_slot' || !b?.label || !b.invite_email || !b.start) return null
  async function book() {
    if (busy) return
    setBusy(true); setErr(''); setNote('')
    try {
      const r = await bookFromCard(d.id, crypto.randomUUID())   // a new key per tap; the server ledger blocks any double booking
      if (r.status === 'blocked') setErr(r.message || 'Nothing was booked.')
      else if (r.recorded) { setNote(r.released ? 'Booked. The confirm reply is ready in the thread.' : 'Booked. The confirm reply was changed, so reply in the thread yourself.'); onDone() }
      else setNote(r.message || 'Invite sent. The booking record is still syncing. Tap Book again in a minute to finish. It will not book twice.')
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)) }
    finally { setBusy(false) }
  }
  return <>
    <Btn primary verb="book-slot" disabled={busy} onClick={() => void book()} aria-label={`Book ${b.label} for ${b.invite_email}`}>{busy ? 'Booking…' : `Book ${b.label} for ${b.invite_email}`}</Btn>
    {note && <div className="op-note" role="status" style={NOTE_STYLE}>{note}</div>}
    {err && <div className="op-err" role="alert">{err}</div>}
  </>
}
const NOTE_STYLE = { fontSize: 15, lineHeight: 1.4, color: 'var(--t1)', margin: '6px 0' } as const

// Inline so the block looks the same on Home (which does not load ops.css) and on Ops.
const ASK_STYLE = { display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12.5, lineHeight: 1.4, color: 'var(--t2)', margin: '6px 0', paddingLeft: 8, borderLeft: '2px solid var(--line)' } as const
const ASK_HEAD = { display: 'block', fontWeight: 500, color: 'var(--t1)', marginBottom: 2 } as const

function toLocalInput(iso: unknown): string {
  const t = typeof iso === 'string' ? new Date(iso) : null
  if (!t || isNaN(t.getTime())) return ''
  return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
