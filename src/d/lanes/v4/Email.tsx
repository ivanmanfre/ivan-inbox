// Ivan's email lane on his Lanes details (Ivan 2026-11-09: "on Lanes on ivan i wanna see the email sends count as
// well not on overview but on details ... bounce stats and all relevant email stats from instantly").
import { CAMPAIGN_STATUS, emailTotals, fetchEmailStats, lastDays } from '../../../lib/emailStats'
import { Skeleton } from '../../ui/states'
import { useRetryRead } from '../useRead'

const fmtPct = (v: number | null) => (v == null ? '' : ` (${v}%)`)
const shortName = (n: string) => n.replace(/^Ivan \| /, '')
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const dayLabel = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })

export function Email({ now }: { now: number }) {
  const [load, retry] = useRetryRead(fetchEmailStats, 'email-stats:ivan')
  const s = load.kind === 'ready' ? load.data : null
  const today = new Date(now).toISOString().slice(0, 10)
  const t = s ? emailTotals(s, today) : null
  const days = s ? lastDays(s, today) : []
  const max = Math.max(1, ...days.map(d => d.sent))
  const box = s?.mailboxes
  return <section className="dl4-panel dl4-email" data-band="email" data-seat="ivan" data-bx-block>
    <h2>Email (Instantly)</h2>
    {load.kind === 'loading' && <Skeleton lines={3} label="Reading Instantly" />}
    {load.kind === 'failed' && <p>Could not be read: {load.message} <button type="button" data-verb="retry" onClick={retry}>Retry</button></p>}
    {s && t && <>
      <div className="dl4-email-nums">
        <div><small>Sent</small><b>{t.sent}</b><span>{t.today} today · {t.week} in 7 days</span></div>
        <div><small>Bounced</small><b>{t.bounced}</b><span>{t.bouncePct != null ? `${t.bouncePct}% of sent` : 'nothing sent'}</span></div>
        <div><small>Replied</small><b>{t.replies}</b><span>{t.replyPct != null ? `${t.replyPct}% of ${t.contacted} reached` : 'nobody reached'}</span></div>
        <div><small>Auto-replies</small><b>{t.auto}</b><span>{t.unsubscribed} unsubscribed</span></div>
      </div>
      {s.campaigns.map(c => <div className="dl4-email-camp" key={c.id} data-campaign={c.id}>
        <b>{shortName(c.name)}</b> <small>{CAMPAIGN_STATUS[c.status] ?? `status ${c.status}`}{c.daily_limit != null ? ` · cap ${c.daily_limit}/day` : ''}</small>
        <p>{c.sent} sent · {plural(c.leads, 'lead', 'leads')} in it · {c.replies} replied · {c.bounced} bounced{fmtPct(c.sent ? Math.round(c.bounced / c.sent * 1000) / 10 : null)} · {plural(c.auto_replies, 'auto-reply', 'auto-replies')}{c.unsubscribed ? ` · ${c.unsubscribed} unsubscribed` : ''}</p>
      </div>)}
      {!s.campaigns.length && <p>No Instantly campaign has sent anything yet.</p>}
      {days.length > 0 && <div className="dl4-email-days" aria-label="Emails sent per day, last 7 days">
        {days.map(d => <div className="dl4-sent-bar" key={d.date}><small>{dayLabel(d.date)}</small><span className="dl4-bar"><i style={{ width: `${d.sent / max * 100}%` }} /></span><b>{d.sent}{d.replies ? ` · ${d.replies} replied` : ''}</b></div>)}
      </div>}
      <p className="dl4-supply-foot">
        {box ? (box.problems.length ? `Mailboxes ${box.day}: ${box.problems.join('; ')}` : `${box.count} mailboxes checked ${box.day}: clean on the blacklists, health ${box.min_health ?? '?'}+, ${box.spam} warm-up emails in spam.`) : 'No mailbox check in the last 3 days.'}
        {t.opensOff ? ' Opens are not counted: open tracking is off.' : ''}
      </p>
    </>}
  </section>
}
