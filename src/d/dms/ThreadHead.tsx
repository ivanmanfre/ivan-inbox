// The open conversation's head (mock `.mh` + `.df-chips`): avatar, the person's name
// (data-d-thread-who), headline, Copy chat link, Ask Claude, ⋯; then seat · lane · copy route +
// invite arm · channel and the real stage ladder, and the route line the coordinator assigned.
import { channelFamilies, isDraft, isInternalConfirmation, ladderSteps, type Thread } from '../../lib/inbox'
import { copyRouteTag, label } from '../../lib/labels'
import { seatOf, SEAT_NAME } from '../seats'
import { DIcon } from '../ui/icons'
import { laneChip } from './model'
import { routeLine } from './nextLine'

const ARM: Record<string, string> = { blank: 'blank invite', engager: 'engager invite', games: 'games invite', apps: 'apps invite', sponsor: 'sponsor invite', custom: 'custom invite' }

function initials(n: string) {
  return n.replace(/,.*/, '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function channels(t: Thread): string {
  const on = t.messages.filter(m => !isDraft(m) && !isInternalConfirmation(m))
  const fams = channelFamilies(on.length ? on : t.messages)
  const name = { linkedin: 'LinkedIn', inmail: 'InMail', email: 'Email' }
  return fams.length ? fams.map(f => name[f]).join(' + ') : 'LinkedIn'
}

export function ThreadHead({ t, phone, onBack, onCopy, copied, onAsk, onMore, moreOpen, onWho, onDelete, deleting, onSpam }: {
  t: Thread; phone: boolean; onBack: () => void; onCopy: () => void; copied: boolean; onAsk: () => void; onMore: () => void; moreOpen: boolean
  /** The name opens Context, as today's name tap does. */ onWho?: () => void
  /** Delete from seat, a visible red key as today's thread bar (not only under ⋯). */ onDelete?: () => void; deleting?: boolean
  /** Spam, visible on client seats as today's thread bar. */ onSpam?: () => void
}) {
  const seat = seatOf(t.client_id)
  const lane = laneChip(t)
  const route = copyRouteTag(t.copyRoute)
  const arm = (t.copyRoute ?? '').split(':')[2]
  const lad = ladderSteps(t)
  const rl = routeLine(t)
  const headline = (t.last.prospect_headline ?? '').split('|')[0].trim()
  const sub = [headline, t.prospect_company && !headline.includes(t.prospect_company) ? t.prospect_company : ''].filter(Boolean).join(', ')
  return (
    <div className="dm-head">
      <div className="dm-mh">
        {phone && <button type="button" className="dm-ib" aria-label="Back to the list" data-verb="back" onClick={onBack}><DIcon name="back" /></button>}
        <div className="dm-av" aria-hidden="true">{initials(t.prospect_name)}</div>
        <button type="button" className="dm-who" onClick={onWho} title="Context: fit, scan, your note" data-verb="context">
          <b data-d-thread-who="">{t.prospect_name}</b>
          {sub && <small>{sub}</small>}
        </button>
        <button type="button" className={`dm-ib${copied ? ' dm-on' : ''}`} aria-label={copied ? 'Chat link copied' : 'Copy chat link'} title="Copy chat link, for Mattan or Davorin" data-verb="copy-link" onClick={onCopy}>
          <DIcon name={copied ? 'check' : 'external'} />
        </button>
        {!phone && <button type="button" className="dm-ib" aria-label={`Ask Claude about ${t.prospect_name}`} title={`Ask Claude about ${t.prospect_name.split(' ')[0]} (⌘J)`} data-verb="ask-claude" onClick={onAsk}><DIcon name="claude" /></button>}
        {!phone && <button type="button" className="dm-ib" aria-label="Close the conversation" data-verb="close" onClick={onBack}><DIcon name="x" /></button>}
        <button type="button" className={`dm-ib${moreOpen ? ' dm-on' : ''}`} aria-label="More for this conversation" aria-expanded={moreOpen} data-verb="more" onClick={onMore}><DIcon name="more" /></button>
      </div>
      <div className="dm-chips">
        {seat && <span>{SEAT_NAME[seat]}</span>}
        {lane?.label && <span className={lane.closed ? 'dm-off' : undefined}>{lane.label}{lane.closed ? ' · closed' : ''}</span>}
        {route && <span title={route.title}>{route.label}{arm && ARM[arm] ? ` · ${ARM[arm]}` : ''}</span>}
        <span>{channels(t)}</span>
        {lad.kind === 'steps'
          ? <span className="dm-lad" aria-label="Stage">{lad.steps.map((s, i) => (
            <span key={s.id}>{i > 0 && ' › '}{s.state === 'current' || s.state === 'failed' ? <b className={s.state === 'failed' ? 'dm-failed' : undefined}>{s.label}{s.state === 'failed' ? ' (send failed)' : ''}</b> : s.label}</span>
          ))}</span>
          : <span className="dm-lad">stage <b>{label(lad.stage) || 'none'}</b></span>}
        {(onSpam || onDelete) && <span className="dm-filing">
  {onSpam && !phone && <button type="button" className="dm-del dm-spam" data-verb="spam" disabled={deleting} title="File as likely spam (asks first)" onClick={onSpam}>Spam</button>}
  {onDelete && <button type="button" className="dm-del" data-verb="delete-seat" disabled={deleting} title="Delete from the seat on LinkedIn (asks first)" onClick={onDelete}>Delete</button>}
        </span>}
      </div>
      {rl && <div className="dm-route">{rl}</div>}
    </div>
  )
}
