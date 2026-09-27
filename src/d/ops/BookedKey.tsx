import { useState, type FormEvent } from 'react'
import { isBookLinkTask, markTaskBooked, type OpsDraft } from '../../lib/ops'
import { Btn } from '../ui/Key'

// The "Booked" key on a book-their-link task (2026-09-27). Opens a call-time field on YOUR clock
// (the browser's time zone); Save converts it to UTC and records the booking through
// ops_task_mark_booked, which also closes the task. The UTC line under the field is the receipt:
// it is exactly what gets stored.
export function BookedKey({ d, onDone }: { d: OpsDraft; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [when, setWhen] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!isBookLinkTask(d)) return null
  const t = when ? new Date(when) : null
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
  if (!open) return <Btn verb="booked" onClick={() => setOpen(true)} aria-label={`Booked: ${d.context?.prospect_name ?? 'this call'}`}>Booked</Btn>
  return (
    <form className="op-bk" onSubmit={e => void save(e)}>
      <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} aria-label="Call time (your clock)" autoFocus />
      <small>{valid ? `Saves as ${utc}` : 'Call time, your clock'}</small>
      <Btn primary verb="booked-save" type="submit" disabled={!valid || busy}>{busy ? 'Saving…' : 'Save'}</Btn>
      <Btn verb="booked-cancel" disabled={busy} onClick={() => { setOpen(false); setErr('') }}>Cancel</Btn>
      {err && <div className="op-err">{err}</div>}
    </form>
  )
}
