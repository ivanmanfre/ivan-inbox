import { dHash } from '../route'
import { Btn } from '../ui/Key'
import { Empty, Failed, Skeleton } from '../ui/states'
import type { AnnaRead } from './anna'
import './anna.css'

const at = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const profile = (value: string) => /^https:\/\/(?:www\.)?linkedin\.com\/in\//i.test(value) ? value : undefined

export function AnnaLane({ read, refresh, control }: { read: AnnaRead; refresh: () => void; control: (enabled: boolean) => void }) {
  const s = read.value
  return <section className="dl4-seat anna-lane" data-seat="anna" aria-label="Anna’s LinkedIn lane">
    <div className="dl4-filter"><b>Anna’s LinkedIn</b><Btn verb="anna-refresh" onClick={refresh} disabled={read.busy}>Refresh</Btn></div>
    {read.error && <Failed what="Anna’s current lane status" detail={read.error} onRetry={refresh} />}
    {!s && !read.error && <Skeleton label="Reading Anna’s lane" />}
    {s && <>
      <div className="dl4-panel anna-control">
        <div><b>{s.enabled ? s.pause_reason ? 'Lane on hold' : 'Lane enabled' : 'Lane paused'}</b>
          <p>Up to {s.daily_cap} invitations a day. Replies appear in Anna’s DMs.</p>
          <p>Pausing also holds queued manual replies. Acceptance and reply updates continue.</p>
          {s.pause_reason && <p>{s.pause_reason.replaceAll('_', ' ')}</p>}
          <small>{read.error ? 'Last reading · may be out of date. ' : ''}{s.last_sync_at ? `Last synced ${at(s.last_sync_at)}` : 'No sync recorded yet.'}</small>
        </div>
        <Btn verb="anna-toggle" disabled={read.busy || !!read.error} onClick={() => control(!s.enabled)}>{read.busy ? 'Saving…' : s.enabled ? 'Pause lane' : 'Resume lane'}</Btn>
      </div>
      <div className="dl4-kpis anna-kpis">
        {([['Invited today', s.sent_today], ['Awaiting acceptance', s.pending], ['Accepted', s.accepted], ['Replied', s.replied], ['Queued', s.queued]] as const).map(([label, n]) =>
          <div className="dl4-kpi" key={label}><small>{label}</small><strong className="anna-number">{n}</strong></div>)}
      </div>
      <section className="dl4-panel" aria-label="Anna’s invitation activity">
        <h2>Invitation activity</h2>
        {!s.events.length ? <Empty title="No invitation activity yet." reason="Sent invitations, acceptances and replies will appear here." /> :
          <ul className="anna-events">{s.events.map(e => <li key={e.id}>
            <div className="anna-event-head"><b>{profile(e.linkedin_url) ? <a href={profile(e.linkedin_url)} target="_blank" rel="noreferrer">{e.name}</a> : e.name}</b><span>{e.status.replaceAll('_', ' ')}</span></div>
            {e.company && <p>{e.company}</p>}
            <div className="anna-dates">{e.invited_at && <span>Invited {at(e.invited_at)}</span>}{e.accepted_at && <span>Accepted {at(e.accepted_at)}</span>}{e.last_reply_at && <span>Replied {at(e.last_reply_at)}</span>}</div>
            {e.error && <p role="note">{e.error}</p>}
            {e.last_reply_at && <a className="anna-reply" href={dHash('dms', null, { seat: 'anna', thread: e.id })}>Open conversation</a>}
          </li>)}</ul>}
      </section>
    </>}
  </section>
}
