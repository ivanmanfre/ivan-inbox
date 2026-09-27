import { docHref } from '../../wb/sales/Doc'
import { DIcon } from '../ui/icons'
import { meetingKind, PACK_LINKS, type CallEvent } from './model'

// Pack links: ONE mono line of plain links, each a new browser tab
// (`#doc?slug=…&doc=…` is its own page). A document not published yet is drawn
// greyed, not left out (today's quiet chip: the gap shows before the call); a
// call with no pack says "no pack yet" once. `compare` is the same public page
// for every prospect: on the plate it rides the note line (the judge: six links
// wrapped "compare" onto a line of its own), on a fortnight row it is a link.
export function PackLinks({ slug, have, big, noCompare, report, onReport }: {
  slug: string | null; have: Set<string>; big?: boolean; noCompare?: boolean
  report?: boolean; onReport?: () => void
}) {
  const links = slug ? PACK_LINKS.filter(l => !((noCompare || big) && l.doc === 'compare')) : []
  return (
    <div className={`sl-pk${big ? ' sl-pk-big' : ''}`}>
      {slug ? links.map((l, i) => {
        const on = l.kind === null || have.has(l.kind)
        return (
          <span key={l.doc} className="sl-pki">
            {on
              ? <a className="sl-pl" href={docHref(slug, l.doc)} target="_blank" rel="noreferrer" data-doc={l.doc}>{l.label}</a>
              : <span className="sl-pl sl-pl-off" data-doc-missing={l.doc} title={`The ${l.label} is not published yet`}>{l.label}</span>}
            {(i < links.length - 1 || report) && <i>·</i>}
          </span>
        )
      }) : <span className="sl-np">no pack yet</span>}
      {report && onReport && <span className="sl-pki">{!slug && <i>·</i>}<button type="button" className="sl-pl" data-verb="open-report" onClick={onReport}>report</button></span>}
      {slug && big && <span className="sl-nt"><a className="sl-pl" href={docHref(slug, 'compare')} target="_blank" rel="noreferrer" data-doc="compare">compare</a><i>·</i><DIcon name="external" /> each opens a new tab · greyed = not published yet</span>}
    </div>
  )
}

export function Join({ r, big }: { r: CallEvent; big?: boolean }) {
  if (!r.ev.meeting_url || r.past) return null
  const cls = big ? `sl-join sl-join-big${r.live ? ' sl-on' : ''}` : `sl-jn${r.live ? ' sl-on' : ''}`
  return (
    <a className={cls} href={r.ev.meeting_url} target="_blank" rel="noopener noreferrer" data-verb="join" aria-label={`Join ${r.name}`}>
      <b>Join</b>
      {big && <small>{r.live ? `live until ${r.endWarsaw}` : 'lights up an hour before'}</small>}
    </a>
  )
}

export function NextCallPlate({ r, through, from, more = 0 }: { r: CallEvent | null; through: string; from: string; more?: number }) {
  if (!r) {
    return (
      <div className="sl-nx sl-none" data-next="none">
        <div className="sl-nxl">Next call</div>
        <div className="sl-nxe">Nothing on the calendar through {through}.</div>
        <p>Read live from the calendar for the fortnight from {from}. A booking shows here the minute it syncs.</p>
      </div>
    )
  }
  const running = r.phase === 'running'
  return (
    <div className={`sl-nx${r.live ? ' sl-live' : ''}`} data-next={r.ev.id}>
      <div className="sl-nxl">{running ? 'On now' : 'Next call'}<span>{running ? `ends ${r.endWarsaw} Warsaw · ${r.endUtc} UTC` : `${r.rel} · until ${r.endWarsaw} Warsaw`}</span></div>
      <div className="sl-nxw"><b>{r.name}</b>{r.company && <span>{r.company}</span>}</div>
      <div className="sl-nxt">
        <div className="sl-clk"><small>{r.day}</small><em>{r.warsaw}</em><u>Warsaw</u></div>
        <div className="sl-clk sl-u"><small>&nbsp;</small><em>{r.utc}</em><u>UTC</u></div>
        <div className="sl-nxm" data-next-facts>{[r.type, r.source, meetingKind(r.ev.meeting_url)].filter(Boolean).join(' · ')}{r.withAll && <><br />with {r.withAll}</>}{more > 0 && <><br />{more} more {more === 1 ? 'call' : 'calls'} this week</>}</div>
      </div>
      <PackLinks slug={r.slug} have={r.have} big />
      <Join r={r} big />
    </div>
  )
}
