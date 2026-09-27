/* Channels of one seat (`?sheet=channels&for=<seat>`): today's per-channel lane
   cards (wb/sends/index.tsx LaneCard + drill-in) as a D sheet. Per channel
   (Invites, DMs, InMail; never added together): the seat's own rule in words,
   live / slowing / quiet with "Sent Xm ago" or "No sends in N days", 24h / 7d /
   30d / all-time, blocked, 14-day bars; tap "Recent" for what went out.
   Reads lib/sends (inbox_sends_v, inbox_sends_daily_v, inbox_messages_v). */
import { useState } from 'react'
import { buildLanes, fetchLaneRecent, fetchSends, fetchSendsDaily, type Lane } from '../../lib/sends'
import { SEATS, SEAT_NAME, type Seat } from '../seats'
import { Linkified } from '../ui/Linkified'
import { Sheet } from '../ui/Sheet'
import { LoadLine, Shs } from './CampaignSheet'
import { ago } from './model'
import { useRead } from './useRead'

const CH: Record<string, string> = { connection_note: 'Invites', dm: 'DMs', inmail: 'InMail', email: 'Email' }

export function statusText(l: Pick<Lane, 'status' | 'last_sent'>, now: number): string {
  if (!l.last_sent) return 'Nothing sent yet'
  if (l.status === 'live') return `Live, sent ${ago(l.last_sent, now)}`
  if (l.status === 'slowing') return `Slowing, last ${ago(l.last_sent, now)}`
  return `Quiet: no sends in ${Math.floor((now - Date.parse(l.last_sent)) / 864e5)} days`
}

function Recent({ l, seat, now }: { l: Lane; seat: Seat; now: number }) {
  const r = useRead(() => fetchLaneRecent(l.key, seat, 12), `lr:${l.key}:${seat}`)
  return <LoadLine l={r} what="the recent sends">{rows => rows.length ? <>{rows.map(m => (
    <div className="dl-msg" key={m.id}><div className="dl-mh"><b>{m.prospect_name}</b><em>{ago(m.sent_at, now)}</em></div>
      {m.message_text ? <p className="dl-pre2"><Linkified text={m.message_text} /></p> : <p className="dl-none">No note</p>}</div>
  ))}</> : <p className="dl-sl">Nothing sent on this channel yet.</p>}</LoadLine>
}

function Card({ l, seat, now }: { l: Lane; seat: Seat; now: number }) {
  const [open, setOpen] = useState(false)
  const max = Math.max(1, ...l.daily)
  return (
    <div className="dl-chc" data-channel={l.key}>
      <div className="dl-mh"><b>{CH[l.key] ?? l.label}</b><span className={l.status === 'stale' ? 'dl-al' : l.status === 'live' ? 'dl-livet' : 'dl-dimt'}>{statusText(l, now)}</span>
        {l.blocked > 0 && <em className="dl-al">{l.blocked} blocked</em>}</div>
      <p className="dl-sl">{l.blurb}</p>
      <div className="dl-kv"><b>{l.sent_24h}</b> in 24h · <b>{l.sent_7d}</b> in 7d · <b>{l.sent_30d}</b> in 30d · {l.sent_total.toLocaleString('en-US')} all time</div>
      <div className="dl-bs dl-chb" aria-label={`${CH[l.key]}, 14 days`}>{l.daily.map((v, i) => <i key={i} className={v ? '' : 'dl-z'} style={{ height: `${v ? Math.max(8, Math.round((v / max) * 100)) : 4}%` }} />)}</div>
      <button type="button" className="dl-more" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Hide recent' : 'Recent sends ›'}</button>
      {open && <Recent l={l} seat={seat} now={now} />}
    </div>
  )
}

export function ChannelsSheet({ seat, setSeat, now, onClose }: { seat: Seat; setSeat: (s: Seat) => void; now: number; onClose: () => void }) {
  const d = useRead(async () => {
    const [rows, daily] = await Promise.all([fetchSends(), fetchSendsDaily()])
    return { rows, daily }
  }, 'channels')
  return (
    <Sheet open onClose={onClose} className="dl-sheet" title={`Channels, ${SEAT_NAME[seat]}`}
      sub="Each channel on its own rule and its own count, never added together. Confirmed sends only.">
      <div className="dl-rk" role="group" aria-label="Seat">
        {SEATS.map(s => <button key={s} type="button" className={`dl-rkey${s === seat ? ' dl-on' : ''}`} aria-pressed={s === seat} onClick={() => setSeat(s)}>{SEAT_NAME[s]}</button>)}
      </div>
      <LoadLine l={d} what="the channels">{x => <>{buildLanes(x.rows, x.daily, seat).map(l => <div key={l.key}><Shs>{CH[l.key] ?? l.label}</Shs><Card l={l} seat={seat} now={now} /></div>)}</>}</LoadLine>
    </Sheet>
  )
}
