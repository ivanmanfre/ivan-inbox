import type { ReactNode } from 'react'
import { archOutcome, archSources, outboundApproveUrl, type OpsDraft } from '../../lib/ops'
import { seatOf } from '../seats'
import { SEAT_NAME } from '../seats'
import { DIcon } from '../ui/icons'
import { warsawDayTime } from '../ui/time'
import { ago, SEAT_PERSON } from './model'

// The context half of an Ops card, one shape per kind: who, ONE mono line of
// facts and links (never a chip cluster), the quote the draft answers.
// A field the row does not carry is not drawn.

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const n = (v: unknown) => (typeof v === 'number' ? v : null)

function Out({ href, children }: { href: string; children: ReactNode }) {
  return <a className="op-lk" href={href} target="_blank" rel="noreferrer">{children}<DIcon name="external" /></a>
}

/** One mono line: the parts that exist, joined by a middle dot. */
export function Mono({ parts }: { parts: Array<ReactNode | null | false | undefined | ''> }) {
  const p = parts.filter(x => x != null && x !== false && x !== '')
  if (p.length === 0) return null
  return <div className="op-mono">{p.map((x, i) => <span key={i}>{i > 0 && <i> · </i>}{x}</span>)}</div>
}

function Who({ name, sub }: { name: string; sub?: string }) {
  if (!name) return null
  return <div className="op-who"><b>{name}</b>{sub ? <small>{sub}</small> : null}</div>
}

function Quote({ text }: { text: string }) {
  return text ? <blockquote className="op-quote">{text.replace(/\n\s*\n+/g, "\n")}</blockquote> : null
}

const ARCH_WORD: Record<string, string> = { DRAFT: 'drafted', NEEDS_DAVOR: 'needs Davor', ESCALATE: 'escalate: answer by hand', HANDLED: 'no reply needed' }

export function CardContext({ d, liked, needsDavor }: { d: OpsDraft; liked: boolean; needsDavor: boolean }) {
  const c = d.context ?? {}
  const seat = seatOf(d.client_id) ?? 'ivan'
  switch (d.kind) {
    case 'comment_outbound':
      return <>
        <Who name={s(c.target_name)} sub={s(c.target_headline)} />
        <Mono parts={[s(c.post_url) && <Out href={s(c.post_url)}>open the post</Out>, s(c.posted_at) && `posted ${ago(s(c.posted_at))}`, s(c.hook)]} />
        <Quote text={s(c.post_excerpt)} />
      </>
    case 'comment_reply': {
      const out = archOutcome(d)
      const src = archSources(d)
      return <>
        <Who name={s(c.author_name)} sub={s(c.author_headline)} />
        <Mono parts={[s(c.post_url) && <Out href={s(c.post_url)}>open the post</Out>, s(c.posted_at) && `commented ${ago(s(c.posted_at))}`]} />
        <Quote text={s(c.comment_text)} />
        <Mono parts={[
          s(c.category) && s(c.category).toLowerCase().replace(/_/g, ' '),
          out && <b className={out === 'ESCALATE' ? 'op-warn' : ''}>{ARCH_WORD[out]}</b>,
          needsDavor && <b className="op-warn">waiting on Davorin</b>,
          c.drafted_on_demand === true && 'drafted on request',
          liked && 'liked',
          src.length > 0 && `${src.length} sources read`,
        ]} />
      </>
    }
    case 'escalation':
      return <>
        <Who name={[s(c.prospect_name), s(c.company)].filter(Boolean).join(' · ')} />
        <Mono parts={[Array.isArray(c.triggers) ? (c.triggers as unknown[]).map(String).join(', ').replace(/_/g, ' ') : '', s(c.source).replace(/_/g, ' ')]} />
        <Quote text={s(c.inbound)} />
        {c.replay === true && <Mono parts={['replay']} />}
      </>
    case 'update': {
      const receipts = Array.isArray(c.receipts) ? (c.receipts as unknown[]).map(String) : []
      return <>
        <Who name={`Update for ${SEAT_PERSON[seat]}`} />
        {receipts.length > 0 && <ul className="op-rc">{receipts.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      </>
    }
    case 'newsjack':
      return <>
        <Who name={s(c.headline)} />
        <Mono parts={[s(c.source_url) && <Out href={s(c.source_url)}>source</Out>,
          seat === 'ivan' ? 'writes into your feed' : `writes into ${SEAT_NAME[seat]}'s board`,
          s(c.expires_at) && `window ends ${warsawDayTime(s(c.expires_at))}`]} />
      </>
    case 'weekly_report':
      return <>
        <Who name={`Week of ${s(c.week)}`} />
        <Mono parts={[n(c.replied) !== null && `${n(c.replied)} replied`, n(c.calls_booked) !== null && `${n(c.calls_booked)} calls booked`,
          n(c.engagers) !== null && `${n(c.engagers)} commented`, n(c.impressions) !== null && `${n(c.impressions)} impressions`]} />
        <Mono parts={[s(c.report_url) && <Out href={s(c.report_url)}>read the page</Out>, s(c.send_after) && `sends ${warsawDayTime(s(c.send_after))} Warsaw`]} />
      </>
    case 'booking':
      return <>
        <Who name={s(c.prospect_name)} sub={[s(c.company), s(c.domain)].filter(Boolean).join(' · ')} />
        <Mono parts={[s(c.when_str), s(c.booked_note)]} />
        <Mono parts={[s(c.brief_url) && <Out href={s(c.brief_url)}>read the brief</Out>, s(c.hubspot_url) && <Out href={s(c.hubspot_url)}>HubSpot</Out>]} />
        {c.matched_prospect === false && <div className="op-ban">No lane history, check before claiming outbound.</div>}
      </>
    case 'precall_email':
      return <>
        <Who name={s(c.invitee_name)} sub={s(c.invitee_email)} />
        <Mono parts={[s(c.call_time) && `call ${warsawDayTime(s(c.call_time))} Warsaw`, s(c.subject) && `subject “${s(c.subject)}”`, s(c.meeting_url) && <Out href={s(c.meeting_url)}>meeting link</Out>]} />
      </>
    case 'manual_invite':
      return <>
        <Who name={s(c.prospect_name)} sub={s(c.company)} />
        <Mono parts={[s(c.when_str) && `call ${s(c.when_str)}`, s(c.matched_via) && `${s(c.matched_via).replace(/_/g, ' ')} ${s(c.matched_value)}`]} />
        <Mono parts={[s(c.meeting_title) && `“${s(c.meeting_title)}”`]} />
      </>
    case 'leads_ballot':
      return <>
        <Who name="Leads for Davorin" />
        <Mono parts={[n(c.company_count) !== null && `${n(c.company_count)} companies`, n(c.people) !== null && `${n(c.people)} people`, n(c.sendable) !== null && `${n(c.sendable)} left to send`]} />
        <Mono parts={[s(c.page_url) && <Out href={s(c.page_url)}>open his page</Out>, 'posts as your own Slack account']} />
      </>
    default:
      return null
  }
}

/** The label over the draft box. */
export function tapeLabel(d: OpsDraft): string {
  const seat = seatOf(d.client_id) ?? 'ivan'
  const person = SEAT_PERSON[seat]
  switch (d.kind) {
    case 'comment_outbound': return outboundApproveUrl(d) ? 'Your comment' : 'Mattan’s comment'
    case 'comment_reply': return seat === 'ivan' ? 'Reply from your seat' : `Reply from ${person}’s seat`
    case 'newsjack': return 'Angle'
    case 'weekly_report': return s(d.context?.send_after) ? 'Both messages, as they go out' : `Message for ${person}`
    case 'precall_email': return 'Reminder email'
    case 'manual_invite': return 'What to do'
    case 'leads_ballot': return 'Message for Davorin'
    case 'update': return `Update for ${person}`
    default: return `Message for ${person}`
  }
}
