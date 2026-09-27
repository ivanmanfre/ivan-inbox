/* The Send log sheet: today's LogView (wb/sends/index.tsx) as a D view.
   One chronological feed of sends AND blocked sends (lib/sends fetchSendLog:
   the newest 120, 60 blocked at most), grouped by Warsaw day, the real
   denominators from HEAD counts, a seat filter (URL `for=`), each row a kind
   in words (Invite, Invite without note, Invite sent bare, Open profile, DM,
   InMail, Email, Reply), whose seat, relative age. Tap a row: the full text
   and the lead's tags (fetchLeadTags) as one line of words. Read-only. */
import { useEffect, useState } from 'react'
import { fetchLeadTags, fetchSendLog, fetchSendLogTotals, sendKind, type LeadTags, type SendLogItem } from '../../lib/sends'
import { SEATS, SEAT_NAME, seatOf, type Seat } from '../seats'
import { Sheet } from '../ui/Sheet'
import { LoadLine, Shs } from './CampaignSheet'
import { ago, dayKey, dm, hm } from './model'
import { useRead } from './useRead'

const KIND: Record<string, string> = {
  connection_note: 'Invite', connection_note_blank: 'Invite, no note', connection_note_bare: 'Invite, bare',
  open_profile: 'Open profile', dm: 'DM', inmail: 'InMail', email: 'Email', manual_reply: 'Reply',
}

export function tagLine(t: LeadTags | undefined): string {
  if (!t) return ''
  const w: string[] = []
  if (t.lane) w.push(t.lane.replace(/_/g, ' '))
  if (t.eu_logic === true) w.push('EU logic')
  if (t.eu_logic === false) w.push('US-bound')
  if (t.source_kind === 'profile_view_warm') w.push('profile view')
  else if (t.source_kind === 'client_sourced_sponsor') w.push('from Davorin')
  else if (t.source_kind === 'youtube_sponsor_mining') w.push('YouTube sponsor')
  else if (t.source_kind) w.push(t.source_kind.replace(/_/g, ' '))
  if (t.network_distance === 'DISTANCE_1' || t.network_distance === 'FIRST_DEGREE') w.push('already connected')
  if (t.country) w.push(t.country.toUpperCase())
  return w.join(' · ')
}

function Row({ m, tags, now }: { m: SendLogItem; tags: LeadTags | undefined; now: number }) {
  const [open, setOpen] = useState(false)
  const failed = m.kind === 'failed'
  const text = failed ? (m.reason ?? 'send failed').replace(/_/g, ' ') : (m.message_text || '(no text stored)')
  return (
    <div className={`dl-lgr${failed ? ' dl-f' : ''}`}>
      <button type="button" className="dl-lg" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <time>{hm(m.event_at)}</time><span className="dl-k">{failed ? 'Failed' : KIND[sendKind(m)] ?? sendKind(m)}</span>
        <p><span className="dl-nm">{m.prospect_name}</span> · {text.replace(/\s+/g, ' ')}</p>
        <span className="dl-s">{SEAT_NAME[seatOf(m.client_id) ?? 'ivan']} · {ago(m.event_at, now)}</span>
      </button>
      {open && <div className="dl-lgx">
        {tagLine(tags) && <p className="dl-m dl-dimt">{tagLine(tags)}</p>}
        <p className="dl-pre">{failed ? `${text}\n\n${m.message_text || ''}`.trim() : text}</p>
      </div>}
    </div>
  )
}

export function LogSheet({ seat, setSeat, now, onClose }: { seat: Seat | null; setSeat: (s: Seat | null) => void; now: number; onClose: () => void }) {
  const who = seat ?? 'all'
  const log = useRead(() => fetchSendLog(who), `log:${who}`)
  const tot = useRead(() => fetchSendLogTotals(who), `logtot:${who}`)
  const [tags, setTags] = useState<Map<string, LeadTags>>(new Map())
  const items = log.kind === 'ready' ? log.data : null
  useEffect(() => {
    if (!items) return
    let live = true
    // Tags fail soft: a failed tag read never takes the log down.
    fetchLeadTags(items.map(i => i.prospect_id)).then(t => { if (live) setTags(t) }, () => { if (live) setTags(new Map()) })
    return () => { live = false }
  }, [items])
  const t = tot.kind === 'ready' ? tot.data : null
  const sent = items?.filter(m => m.kind === 'sent').length ?? 0, failed = items?.filter(m => m.kind === 'failed').length ?? 0
  const days: Array<{ key: string; rows: SendLogItem[] }> = []
  for (const m of items ?? []) {
    const k = dayKey(m.event_at)
    if (!days.length || days[days.length - 1].key !== k) days.push({ key: k, rows: [] })
    days[days.length - 1].rows.push(m)
  }
  return (
    <Sheet open onClose={onClose} className="dl-sheet" title="Send log"
      sub={`Newest ${sent} of ${t ? t.sent.toLocaleString('en-US') : '?'} sent · ${failed} of ${t ? t.blocked.toLocaleString('en-US') : '?'} blocked${seat ? `, ${SEAT_NAME[seat]} only` : ', all three seats'}. Tap a row for the full text and the lead.`}>
      <div className="dl-rk" role="group" aria-label="Seat">
        {[null, ...SEATS].map(s => <button key={s ?? 'all'} type="button" className={`dl-rkey${s === seat ? ' dl-on' : ''}`} aria-pressed={s === seat} onClick={() => setSeat(s)}>{s ? SEAT_NAME[s] : 'All seats'}</button>)}
      </div>
      <p className="dl-sl dl-dimt">Invite = note attached · Invite, no note = the deliberate no-note arm · Invite, bare = the note was refused, sent bare as a fallback · Open profile = a free message to an open profile.</p>
      <LoadLine l={log} what="the send log">{() => days.length === 0 ? <p className="dl-sl">No send activity yet, a verified zero.</p> : <>{days.map(d => (
        <div key={d.key}>
          <Shs tail={d.rows.length}>{d.key === dayKey(now) ? 'Today' : dm(`${d.key}T12:00:00Z`)}</Shs>
          {d.rows.map(m => <Row key={m.id} m={m} tags={tags.get(m.prospect_id)} now={now} />)}
        </div>
      ))}</>}</LoadLine>
    </Sheet>
  )
}
