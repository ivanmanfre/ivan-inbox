import { useEffect, useRef, useState } from 'react'
import { fetchProspectContext } from '../../lib/context'
import { cancelScheduledDm, fetchScheduledDms, scheduleDm, scheduleError, type ScheduledDm } from '../../lib/dmSchedule'
import { localSendDate, localSendInstant, sendTimeLabel, suggestTimezone } from '../../lib/dmScheduleTime'
import { type Thread } from '../../lib/inbox'
import { Key, Btn } from '../ui/Key'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/toast'
import './schedule.css'
export type ScheduleTarget = { ids: string[]; texts: string[]; at?: string; timezone?: string; manual?: boolean }
const zones = [...new Set(['America/Los_Angeles', 'America/New_York', 'Europe/Warsaw', 'UTC', ...Intl.supportedValuesOf('timeZone')])].sort()

export function ScheduleSheet({ t, target, onClose, onSaved }: { t: Thread; target: ScheduleTarget; onClose: () => void; onSaved: () => void }) {
  const [zone, setZone] = useState(target.timezone ?? '')
  const [date, setDate] = useState(target.at && target.timezone ? localSendDate(Date.parse(target.at), target.timezone) : '')
  const [time, setTime] = useState(target.at && target.timezone ? new Intl.DateTimeFormat('en-GB', { timeZone: target.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(target.at)) : '07:00')
  const [location, setLocation] = useState('Reading profile location…')
  const [loading, setLoading] = useState(!target.timezone)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    let live = true
    void fetchProspectContext(t.prospect_id).then(async p => {
      const suggested = await suggestTimezone(p.location)
      if (!live) return
      setLocation(p.location ? `Profile location: ${p.location}${suggested ? '' : '. Choose a timezone.'}` : 'No location saved on this profile. Choose a timezone.')
      if (!target.timezone && suggested) { setZone(suggested); setDate(localSendDate(Date.now(), suggested)) }
    }).catch(() => { if (live) setLocation('Profile location could not be loaded. Choose a timezone.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [t.prospect_id, target.timezone])
  let at = '', invalid = ''
  if (zone && date && time) {
    try { at = localSendInstant(date, time, zone); if (Date.parse(at) <= Date.now()) invalid = 'That time has passed. Choose a future time.' } catch (e) { invalid = scheduleError(e) }
  }
  const save = async () => {
    if (!at || invalid || busy) { form.current?.querySelector<HTMLInputElement>('input:invalid,select:invalid')?.focus(); return }
    setBusy(true); setError('')
    try { await scheduleDm(t, target.ids, target.texts, at, zone); onSaved(); onClose() } catch (e) { setError(scheduleError(e)) } finally { setBusy(false) }
  }
  return <Sheet open onClose={() => { if (!busy) onClose() }} title={target.at ? 'Edit scheduled send' : `Schedule DM to ${t.prospect_name}`} label="Schedule DM"
    sub="This applies to this message only." foot={<Key primary disabled={loading || busy || !at || Boolean(invalid)} verb="confirm-schedule" onClick={() => void save()}>{busy ? 'Saving…' : target.at ? 'Save schedule' : 'Schedule send'}</Key>}>
    <form ref={form} className="dm-schedule-form" onSubmit={e => { e.preventDefault(); void save() }}>
      <p className="dm-meta" role="status">{location}</p>
      <label>Recipient timezone<select aria-label="Recipient timezone" required disabled={loading || busy} value={zone} onChange={e => { setZone(e.target.value); if (!date && e.target.value) setDate(localSendDate(Date.now(), e.target.value)); setError('') }}>
        <option value="">Choose timezone</option>{zones.map(z => <option key={z} value={z}>{z.replaceAll('_', ' ')}</option>)}
      </select></label>
      <div className="dm-schedule-fields"><label>Date<input aria-label="Send date" required type="date" value={date} disabled={busy} onChange={e => { setDate(e.target.value); setError('') }} /></label>
        <label>Local time<input aria-label="Recipient local send time" required type="time" value={time} disabled={busy} onChange={e => { setTime(e.target.value); setError('') }} /></label></div>
      {invalid && <p className="dm-warn" role="alert">{invalid}</p>}
      {at && !invalid && <p className="dm-meta">{sendTimeLabel(at, zone)}<br />Your time: {sendTimeLabel(at, Intl.DateTimeFormat().resolvedOptions().timeZone)}<br />The sender picks it up within about 2 minutes after this time. A changed conversation pauses the send for review.</p>}
      <div><b className="dm-meta">Message{target.texts.length > 1 ? 's' : ''}</b>{target.texts.map((text, i) => <p className="dm-quote" key={i}>{text}</p>)}</div>
      {error && <p className="dm-warn" role="alert">{error}</p>}
    </form>
  </Sheet>
}

export function ScheduledSends({ t, reload, onEdit }: { t: Thread; reload: () => void; onEdit: (target: ScheduleTarget) => void }) {
  const [rows, setRows] = useState<ScheduledDm[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const toast = useToast()
  useEffect(() => {
    let live = true
    setRows([]); setError('')
    void fetchScheduledDms(t.prospect_id).then(r => { if (live) setRows(r) }).catch(e => { if (live) setError(scheduleError(e)) })
    return () => { live = false }
  }, [t.prospect_id, t.messages, tick])
  const cancel = async () => {
    setBusy(true); setError('')
    try { await cancelScheduledDm(rows[0].id); setRows([]); reload(); toast.show({ message: 'Scheduled send cancelled.', sub: 'Nothing will be sent.' }) } catch (e) { setError(scheduleError(e)) } finally { setBusy(false) }
  }
  if (error) return <div className="dm-rest" role="alert">{error} <Btn className="dm-k" onClick={() => setTick(n => n + 1)}>Retry schedule details</Btn></div>
  if (!rows.length) return null
  return <div className="dm-rest dm-scheduled" role="status"><b>{rows[0].state === 'review' ? 'Scheduled send paused' : `Scheduled: ${sendTimeLabel(rows[0].at, rows[0].timezone)}`}</b><p>{rows[0].state === 'review' ? 'The conversation changed. Review the message and choose a new send time, or cancel it.' : 'Waiting to send. A new reply or changed conversation pauses it for review.'}</p>
    {rows.map(m => <p className="dm-quote" key={m.id}>{m.channel === 'email' && <b>Email: </b>}{m.message_text}</p>)}
    <div><Btn className="dm-k" disabled={busy} onClick={() => onEdit({ ids: rows.map(r => r.id), texts: rows.map(r => r.message_text), at: rows[0].at, timezone: rows[0].timezone })}>Edit schedule</Btn><Btn className="dm-k" disabled={busy} onClick={() => void cancel()}>Cancel scheduled send</Btn></div>
  </div>
}
