import { reviewOf, type CallRow, type ReviewPattern } from '../../../lib/transcripts'

// After-call review (2026-11-18). Written by the Mac job call-review against the active discovery
// script; every quote here was found word for word in the transcript before it was stored.
// Read only. Nothing on this section sends or writes.

const LONG_RUN = 150 // words in one uninterrupted stretch worth pointing out

export function Review({ row, pattern }: { row: CallRow; pattern?: ReviewPattern | null }) {
  const rv = reviewOf(row)
  if (!rv) return null
  const ns = rv.next_step
  const missed = rv.items.filter(i => i.status === 'missed')
  const half = rv.items.filter(i => i.status === 'partial')
  const got = rv.items.filter(i => i.status === 'answered' && i.quote)
  const run = rv.talk.longest_run_words
  return <section className="sl4-review" data-call-review>
    <h3 className="sl4-eyebrow">After-call review</h3>
    <p className={ns.booked ? 'sl4-rv-next' : 'sl4-rv-next sl4-warn'} data-next-booked={ns.booked ? 'yes' : 'no'}>
      {ns.booked ? `Next call booked${ns.when ? `: ${ns.when}` : ''}` : 'No next call booked'}
      {ns.everyone_who_decides === false && <span> · not everyone who decides is on it</span>}
    </p>
    {!ns.booked && ns.quote && <blockquote className="sl4-rv-q">“{ns.quote}”</blockquote>}
    {pattern && <p className="sl4-rv-pattern" data-review-pattern>Last {pattern.n} sales calls: next call booked on {pattern.booked} of {pattern.n}{pattern.talkAvg != null ? `. You talked ${pattern.talkAvg}% on average.` : '.'}</p>}
    {rv.missed_follow_ups.length > 0 && <div className="sl-cb" data-skipped><div className="sl-cbh">Follow-ups you skipped</div><ul className="sl4-rv-list">{rv.missed_follow_ups.map((f, i) =>
      <li key={i}><blockquote className="sl4-rv-q">“{f.buyer_quote}”</blockquote><span>Ask: {f.better_question}</span></li>)}</ul></div>}
    {rv.next_call.length > 0 && <div className="sl-cb" data-next-time><div className="sl-cbh">For your next call</div><ul className="sl-dots">{rv.next_call.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
    {missed.length > 0 && <div className="sl-cb" data-missed><div className="sl-cbh">Not covered ({missed.length})</div><ul className="sl-dots">{missed.map(i => <li key={i.id}>{i.label}</li>)}</ul></div>}
    {half.length > 0 && <div className="sl-cb" data-half><div className="sl-cbh">Only half answered ({half.length})</div><ul className="sl-dots">{half.map(i => <li key={i.id}>{i.label}</li>)}</ul></div>}
    {run >= LONG_RUN && <p className="sl4-rv-run" data-long-run>Longest stretch: {run} words without a break, {rv.talk.longest_run_at_pct}% into the call.</p>}
    {got.length > 0 && <details className="sl4-rv-got"><summary>What they answered ({got.length})</summary><ul className="sl4-rv-list">{got.map(i =>
      <li key={i.id}><span>{i.label}</span><blockquote className="sl4-rv-q">“{i.quote}”</blockquote></li>)}</ul></details>}
  </section>
}
