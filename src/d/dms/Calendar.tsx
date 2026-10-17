import { useEffect, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { CALENDAR_LINKS, proposedTimes, requestCalendar, slotLabel, type CalendarResult } from '../../lib/inboxCalendar'
import { Btn } from '../ui/Key'
import './calendar.css'

export function CalendarPanel({ prospectId, clientId, onInsert }: { prospectId: string; clientId: string; onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  const [result, setResult] = useState<CalendarResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [booking, setBooking] = useState(false)
  const [bookMode, setBookMode] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [email, setEmail] = useState('')
  const current = useRef(''); current.current = `${prospectId}:${timezone}`
  const fallback = CALENDAR_LINKS[clientId]
  useEffect(() => {
    if (!open || !fallback) return
    let live = true
    setLoading(true); setError(''); setResult(null); setSelected([]); setBookMode(false); setAgreed(false); setBooking(false)
    void requestCalendar({ prospect_id: prospectId, action: 'availability', timezone }).then(r => {
      if (live) { setResult(r); setEmail(r.email ?? '') }
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'Calendar could not be loaded.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [open, prospectId, timezone, refresh, fallback])
  if (!fallback) return null
  const cal = result?.calendar, receipt = result?.booking ?? result?.existing_booking
  const slots = cal?.slots.filter(s => selected.includes(s.start)) ?? []
  const submit = async () => {
    if (booking || !agreed || slots.length !== 1 || !cal?.can_book) return
    const key = current.current
    setBooking(true); setError('')
    try {
      const r = await requestCalendar({ prospect_id: prospectId, action: 'book', timezone, start: slots[0].start, email, request_id: crypto.randomUUID(), confirmed: true })
      if (current.current === key) { setResult(r); setBookMode(false); setAgreed(false); setSelected([]) }
    } catch (e) {
      if (current.current === key) {
        setError(e instanceof Error ? e.message : 'Check the owner calendar before trying again.')
        // Hide the action until the server has re-read its durable booking ledger.
        setResult(null); setBookMode(false); setAgreed(false); setSelected([])
      }
    } finally { if (current.current === key) setBooking(false) }
  }
  const owner = result?.owner ?? fallback.owner
  const zones = [...new Set([timezone, 'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Warsaw', 'Europe/Zagreb', 'Asia/Jerusalem', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'])]
  return <details className="dm-calendar" open={open}>
    <summary onClick={e => { e.preventDefault(); setOpen(v => !v) }}><CalendarDays size={15} aria-hidden="true" />Calendar</summary>
    {open && <div className="dm-calendar-body">
      <div className="dm-calendar-head"><strong>{owner}’s live calendar</strong><a href={result?.booking_url ?? fallback.url} target="_blank" rel="noreferrer">Open {owner}’s booking page</a></div>
      <label className="dm-calendar-zone">Show times in <select aria-label="Calendar timezone" value={timezone} onChange={e => setTimezone(e.target.value)} disabled={booking}>{zones.map(z => <option key={z}>{z}</option>)}</select></label>
      <p className="dm-calendar-note">Prospect’s timezone is unconfirmed. Choose their timezone before proposing a time.</p>
      {loading && <p role="status">Checking live availability…</p>}
      {error && <p role="alert">{error}</p>}
      {receipt && <div role="status">
        {receipt.status === 'confirmed' ? <><strong>Invite confirmed.</strong>{receipt.start && <p>{slotLabel({ start: receipt.start, end: receipt.end ?? receipt.start }, timezone)}</p>}<p>{receipt.handoff ? 'Booking saved. Ops handoff is ready for review.' : 'Invite saved. CRM and Ops handoff are awaiting sync; refresh to check.'}</p>{receipt.calendar_event_id && <small>Calendar receipt: {receipt.calendar_event_id}</small>}</>
          : receipt.status === 'booked' ? <><strong>Already booked.</strong>{receipt.start && <p>{slotLabel({ start: receipt.start, end: receipt.end ?? receipt.start }, timezone)}</p>}<p>Use the owner’s booking page to manage this meeting.</p></>
            : <p>A booking is {receipt.status === 'pending' ? 'in progress or awaiting confirmation' : 'awaiting confirmation'}. Check the owner calendar before trying again. Another invite is blocked.</p>}
      </div>}
      {cal && !receipt && <>
        <p className="dm-calendar-note">30 minute slots · checked {new Date(cal.checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Times are available at this check; selecting one does not reserve it.</p>
        {cal.slots.length === 0 ? <p>No available times returned. Refresh or use the booking page.</p> : <div className="dm-calendar-slots">{cal.slots.map(s => <label key={s.start}><input type="checkbox" checked={selected.includes(s.start)} disabled={booking || (selected.length === 2 && !selected.includes(s.start))} onChange={() => { setSelected(prev => prev.includes(s.start) ? prev.filter(v => v !== s.start) : [...prev, s.start]); setAgreed(false) }} />{slotLabel(s, timezone)}</label>)}</div>}
        <div className="dm-calendar-actions"><Btn className="dm-k" disabled={!slots.length || booking} onClick={() => onInsert(proposedTimes(slots, timezone))}>Insert times into reply</Btn>
          {cal.can_book && <Btn className="dm-k" disabled={slots.length !== 1 || booking} onClick={() => { setBookMode(v => !v); setAgreed(false) }}>Book agreed time</Btn>}</div>
        {!cal.can_book && <p className="dm-calendar-note">Use the owner’s booking page to send the invite.</p>}
        {bookMode && <div className="dm-calendar-book"><label>Invite email<input aria-label="Invite email" type="email" value={email} disabled={booking} onChange={e => { setEmail(e.target.value); setAgreed(false) }} /></label>
          <label><input type="checkbox" checked={agreed} disabled={booking || slots.length !== 1} onChange={e => setAgreed(e.target.checked)} />They agreed to this time and email. Send them the calendar invite.</label>
          <Btn className="dm-k" disabled={booking || !agreed || slots.length !== 1 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)} onClick={() => void submit()}>{booking ? 'Booking…' : 'Book and send invite'}</Btn>
        </div>}
      </>}
      <Btn className="dm-k" disabled={loading || booking} onClick={() => setRefresh(v => v + 1)}>Refresh availability</Btn>
    </div>}
  </details>
}
