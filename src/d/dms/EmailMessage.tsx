import type { ReactNode } from 'react'
import type { EmailDetails } from '../../lib/emailPresentation'
import { Linkified } from '../ui/Linkified'
import { warsawDayTime } from '../ui/time'
import './email.css'

/** The same envelope and exact plain-text body are used in history and composer previews. */
export function EmailPreview({ details, state, children }: { details: EmailDetails; state?: string; children?: ReactNode }) {
  return <section className="dm-email-sheet" role="region" aria-label="Email preview">
    <header className="dm-email-heading">
      <h3>{details.subject === null ? 'Subject unavailable' : details.subject || '(no subject)'}</h3>
      {state && <span className="dm-email-state">{state}</span>}
    </header>
    <div className="dm-email-envelope-fields">
      <div className="dm-email-from"><span className="dm-email-field-name">From</span><div>{details.fromName && <strong>{details.fromName}</strong>}{details.from ? <span>{details.from}</span> : <span>Sender unavailable</span>}</div>
        {details.date && <time dateTime={details.date}>{warsawDayTime(details.date)}</time>}
      </div>
      <div className="dm-email-field"><span className="dm-email-field-name">To</span>{' '}<span>{details.to.length ? details.to.join(', ') : 'Recipient unavailable'}</span></div>
      {details.cc.length > 0 && <div className="dm-email-field"><span className="dm-email-field-name">Cc</span><span>{details.cc.join(', ')}</span></div>}
    </div>
    {/* html is escaped send HTML from emailPreview; stored inbound HTML never enters this field. */}
    {children ?? (details.html ? <div className="dm-email-body dm-email-body-html" dangerouslySetInnerHTML={{ __html: details.html }} />
      : <div className="dm-email-body">{details.body ? <Linkified text={details.body} /> : <span className="dm-email-muted">Message text unavailable</span>}</div>)}
    {details.formattingUnavailable && <p className="dm-email-error" role="note">Saved formatting is unavailable. The message text is shown.</p>}
  </section>
}
