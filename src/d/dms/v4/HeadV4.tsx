// Brief 4 thread head (SPEC-dms §2.4.1-§2.4.2): avatar 36 · name (opens Context) · came-back signal ·
// Copy chat link · Ask Claude · More · Close (desktop); Back first on the phone. Under it the meta strip:
// seat, lane, route, channel chips, the stage ladder, and Spam / Delete kept visible (a ruling). Same
// props and the same closures as ThreadHead; no hooks, no writes of its own.
import type { ReactNode } from 'react'
import { channelFamilies, isDraft, isInternalConfirmation, type Thread } from '../../../lib/inbox'
import { copyRouteTag } from '../../../lib/labels'
import { seatOf, SEAT_NAME } from '../../seats'
import { DIcon } from '../../ui/icons'
import { laneChip } from '../model'
import { routeLine } from '../nextLine'
import { Ladder } from './Ladder'
import { initials } from './pill'

const ARM: Record<string, string> = { blank: 'blank invite', engager: 'engager invite', games: 'games invite', apps: 'apps invite', sponsor: 'sponsor invite', custom: 'custom invite' }

function channels(t: Thread): string {
  const on = t.messages.filter(m => !isDraft(m) && !isInternalConfirmation(m))
  const fams = channelFamilies(on.length ? on : t.messages)
  const name = { linkedin: 'LinkedIn', inmail: 'InMail', email: 'Email' }
  return fams.length ? fams.map(f => name[f]).join(' + ') : 'LinkedIn'
}

export function HeadV4({ t, phone, onBack, onCopy, copied, onAsk, onMore, moreOpen, onWho, onDelete, deleting, onSpam, signal }: {
  t: Thread; phone: boolean; onBack: () => void; onCopy: () => void; copied: boolean; onAsk: () => void; onMore: () => void; moreOpen: boolean
  onWho?: () => void; onDelete?: () => void; deleting?: boolean; onSpam?: () => void; signal?: ReactNode
}) {
  const seat = seatOf(t.client_id)
  const lane = laneChip(t)
  const route = copyRouteTag(t.copyRoute)
  const arm = (t.copyRoute ?? '').split(':')[2]
  const rl = routeLine(t)
  const headline = (t.last.prospect_headline ?? '').split('|')[0].trim()
  const sub = [headline, t.prospect_company && !headline.includes(t.prospect_company) ? t.prospect_company : ''].filter(Boolean).join(', ')
  return (
    <div className="dm-head dx-head">
      <div className="dm-mh dx-mh">
        {phone && <button type="button" className="dm-ib" aria-label="Back to the list" title="Back" data-verb="back" onClick={onBack}><DIcon name="back" /></button>}
        <div className="dm-av dx-hav" aria-hidden="true">{initials(t.prospect_name)}</div>
        <button type="button" className="dm-who" onClick={onWho} title="Context: fit, scan, your note" data-verb="context">
          <b data-d-thread-who="">{t.prospect_name}</b>
          {sub && <small>{sub}</small>}
        </button>
        {signal}
        <span className="dx-grow" />
        <button type="button" className={`dm-ib${copied ? ' dm-on' : ''}`} aria-label={copied ? 'Chat link copied' : 'Copy chat link'} title="Copy chat link, for Mattan or Davorin" data-verb="copy-link" onClick={onCopy}>
          <span key={copied ? 'ok' : 'link'} className="dx-ico-swap"><DIcon name={copied ? 'check' : 'external'} /></span>
        </button>
        {!phone && <button type="button" className="dm-ib" aria-label={`Ask Claude about ${t.prospect_name}`} title={`Ask Claude about ${t.prospect_name.split(' ')[0]} (⌘J)`} data-verb="ask-claude" onClick={onAsk}><DIcon name="claude" /></button>}
        <button type="button" className={`dm-ib${moreOpen ? ' dm-on' : ''}`} aria-label="More for this conversation" title="More" aria-expanded={moreOpen} data-verb="more" onClick={onMore}><DIcon name="more" /></button>
        {!phone && <button type="button" className="dm-ib" aria-label="Close the conversation" title="Close (Esc)" data-verb="close" onClick={onBack}><DIcon name="x" /></button>}
      </div>
      <div className="dm-chips dx-meta">
        {seat && <span className="dx-chip dx-chip-seat" data-seat={seat}><i aria-hidden="true">{SEAT_NAME[seat][0]}</i>{SEAT_NAME[seat]}</span>}
        {lane?.label && <span className={`dx-chip${lane.closed ? ' dm-off' : ''}`}>{lane.label}{lane.closed ? ' · closed' : ''}</span>}
        {route && <span className="dx-chip dx-chip-info" title={route.title}>{route.label}{arm && ARM[arm] ? ` · ${ARM[arm]}` : ''}</span>}
        <span className="dx-chip dx-chip-ch">{channels(t)}</span>
        <Ladder t={t} />
        {(onSpam || onDelete) && <span className="dm-filing">
          {onSpam && !phone && <button type="button" className="dm-del dm-spam" data-verb="spam" disabled={deleting} title="File as likely spam (asks first)" onClick={onSpam}>Spam</button>}
          {onDelete && <button type="button" className="dm-del" data-verb="delete-seat" disabled={deleting} title="Delete from the seat on LinkedIn (asks first)" onClick={onDelete}>Delete</button>}
        </span>}
      </div>
      {rl && <div className="dm-route">{rl}</div>}
    </div>
  )
}
